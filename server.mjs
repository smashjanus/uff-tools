import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createShowcase, applyAction, isReady } from './core.js';
import { createPublicSource } from './startgg-public.mjs';
import { createOAuth } from './oauth.mjs';
import { decorateRealResult, recordRealAction } from './real-queue.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
if(process.env.SALAMANDRA_ENV_FILE!=='none'&&existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const oauth=createOAuth(process.env);
const dataDir=process.env.DATA_DIR||path.join(root,'data');
await mkdir(dataDir,{recursive:true});
const statePath=path.join(dataDir,'demo-state.json');
const selectionPath=path.join(dataDir,'active-event.json');
let selection=existsSync(selectionPath)?JSON.parse(await readFile(selectionPath,'utf8')):{eventId:process.env.STARTGG_EVENT_ID||null};
let live=selection.eventId?createPublicSource(selection.eventId):null;
let state=existsSync(statePath)?JSON.parse(await readFile(statePath,'utf8')):createShowcase();
const sessions=new Map(),streams=new Set(),requests=new Map(),realOverlays=new Map();let chain=Promise.resolve();
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const allowed=process.env.FRONTEND_ORIGIN||'';
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const snapshot=()=>({state,sourceSyncedAt:Date.now(),mode:'demo',shared:true});
const currentSnapshot=async()=>live?decorateRealResult(await live.read(),realOverlays):snapshot();
async function atomicJson(file,value){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value));await rename(tmp,file);}
async function persist(){await atomicJson(statePath,state);}
await persist();
function getSession(req){const token=(req.headers.cookie||'').split('; ').find(v=>v.startsWith('salamandra_session='))?.split('=')[1];const session=sessions.get(token);if(!session||session.expires<Date.now()){sessions.delete(token);return null;}return {...session,token};}
async function body(req){let buffer='';for await(const chunk of req){buffer+=chunk;if(buffer.length>16384)throw new Error('Solicitud demasiado grande.');}return buffer?JSON.parse(buffer):{};}
function announce(version=state.version){for(const res of streams)res.write(`event: changed\ndata: ${JSON.stringify({version})}\n\n`);}
function enqueue(fn){const result=chain.then(fn);chain=result.catch(()=>{});return result;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  const ownOrigin=`http://${req.headers.host}`,origin=req.headers.origin;
  if(origin&&origin!==ownOrigin&&origin!==allowed)return json(res,403,{message:'Origen no permitido.'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Headers':'Content-Type, Idempotency-Key','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});return res.end();}
  const url=new URL(req.url,ownOrigin),user=getSession(req);
  try{
    if(url.pathname==='/api/auth/startgg'&&req.method==='GET'){
      if(!oauth.enabled)return json(res,503,{message:'Falta configurar el acceso con start.gg.'});
      const flow=oauth.begin();res.writeHead(302,{'Location':flow.url,'Set-Cookie':flow.cookie,'Cache-Control':'no-store'});return res.end();
    }
    if(url.pathname==='/api/auth/startgg/callback'&&req.method==='GET'){
      res.setHeader('Referrer-Policy','no-referrer');
      try{
        const authenticated=await oauth.finish(url,req.headers,selection.eventId),identity=authenticated.user,token=randomBytes(32).toString('hex');
        if(user)sessions.delete(user.token);
        sessions.set(token,{user:identity,authorization:authenticated.authorization,verifiedEventId:identity.adminVerification==='unavailable'?null:selection.eventId,expires:Date.now()+86400000});
        res.writeHead(303,{'Location':identity.role==='admin'?'/#control':'/#mi-partida','Cache-Control':'no-store','Set-Cookie':[oauth.clearCookie(),`salamandra_session=${token}; HttpOnly; Path=/api; SameSite=Lax; Max-Age=86400${process.env.STARTGG_REDIRECT_URI?.startsWith('https:')?'; Secure':''}`]});return res.end();
      }catch(error){
        const network=['EACCES','EPERM','ENOTFOUND','ECONNREFUSED','ETIMEDOUT'].includes(error.cause?.code)||['TimeoutError','AbortError'].includes(error.name);
        const reason=network?'network':'failed';
        // Log only a category; callback codes, cookies and provider responses are private.
        console.warn(`OAuth could not complete: ${reason}`);
        res.writeHead(303,{'Location':`/?auth=${reason}`,'Cache-Control':'no-store','Set-Cookie':oauth.clearCookie()});return res.end();
      }
    }
    if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,await currentSnapshot());
    if(url.pathname==='/api/session'&&req.method==='GET'){
      const stored=user?sessions.get(user.token):null;
      if(stored?.user.provider==='start.gg'&&stored.verifiedEventId!==selection.eventId){
        try{const access=await oauth.eventAdministration(stored.authorization,selection.eventId);stored.user.role='admin';stored.user.adminVerification='verified';stored.user.tournamentId=access.tournamentId;stored.user.tournamentName=access.tournamentName;stored.verifiedEventId=selection.eventId;}
        catch{stored.user.role=stored.user.canSelectEvent?'admin':'player';stored.user.adminVerification='unavailable';delete stored.user.tournamentId;delete stored.user.tournamentName;stored.verifiedEventId=null;}
      }
      const identity=stored?.user?{...stored.user,eventId:selection.eventId}:null;
      if(identity&&live){try{const current=await currentSnapshot();identity.playerId=current.state.players.find(p=>p.startggPlayerIds.includes(identity.startggPlayerId))?.id||null;}catch{}}
      return json(res,200,{user:identity});
    }
    if(url.pathname==='/api/events'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');streams.add(res);const pulse=setInterval(()=>res.write(': keepalive\n\n'),25000);pulse.unref();req.on('close',()=>{streams.delete(res);clearInterval(pulse);});return;
    }
    if(url.pathname==='/api/admin/events'&&req.method==='GET'){
      if(!user?.user.canSelectEvent)return json(res,403,{message:'Esta cuenta no puede cambiar el evento de Salamandra.'});
      const events=await oauth.adminEvents(user.authorization);return json(res,200,{events,activeEventId:selection.eventId});
    }
    if(url.pathname==='/api/admin/selection'&&req.method==='POST'){
      if(!user?.user.canSelectEvent)return json(res,403,{message:'Esta cuenta no puede cambiar el evento de Salamandra.'});
      const data=await body(req),eventReference=String(data.eventReference||data.eventId||'').trim();
      if(!eventReference)return json(res,400,{message:'Selecciona un evento o pega su enlace.'});
      return await enqueue(async()=>{
        const selected=await oauth.resolveAdminEvent(user.authorization,eventReference),eventId=selected.id;
        const candidate=createPublicSource(eventId),result=await candidate.read();
        selection={eventId,tournamentId:selected.tournament.id,eventName:selected.name,tournamentName:selected.tournament.name,selectedBy:user.user.id,selectedAt:Date.now()};
        const stored=sessions.get(user.token);if(stored){stored.user.role='admin';stored.user.adminVerification='verified';stored.user.tournamentId=selected.tournament.id;stored.user.tournamentName=selected.tournament.name;stored.verifiedEventId=eventId;}
        await atomicJson(selectionPath,selection);live=candidate;realOverlays.clear();const decorated=decorateRealResult(result,realOverlays);announce(decorated.state.version);return json(res,200,decorated);
      });
    }
    if(url.pathname==='/api/demo/login'&&req.method==='POST'){
      if(oauth.enabled)return json(res,403,{message:'El acceso simulado está deshabilitado en este servidor.'});
      const data=await body(req);const p=state.players.find(x=>x.id===data.accountId);
      if(data.accountId!=='staff'&&!p)return json(res,400,{message:'Cuenta de demostración no válida.'});
      const token=randomBytes(32).toString('hex'),identity=data.accountId==='staff'?{id:'staff',name:'Equipo Salamandra',role:'admin',playerId:state.players[0].id}:{id:p.id,name:p.name,role:'player',playerId:p.id};
      sessions.set(token,{user:identity,expires:Date.now()+86400000});
      res.setHeader('Set-Cookie',`salamandra_session=${token}; HttpOnly; Path=/api; SameSite=${allowed?'None; Secure':'Lax'}; Max-Age=86400`);return json(res,200,{user:identity});
    }
    if(url.pathname==='/api/logout'&&req.method==='POST'){if(user)sessions.delete(user.token);res.setHeader('Set-Cookie','salamandra_session=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0');return json(res,200,{ok:true});}
    if(url.pathname==='/api/actions'&&req.method==='POST'){
      if(user?.user.provider==='start.gg'){
        const data=await body(req),key=req.headers['idempotency-key'];
        if(!key||key.length>128)return json(res,400,{message:'Falta el identificador de la acción.'});
        return await enqueue(async()=>{
          const cacheKey=user.token+':'+key;if(requests.has(cacheKey))return json(res,200,requests.get(cacheKey));
          const current=await currentSnapshot(),action=data.action||{},set=current.state.sets.find(candidate=>candidate.id===String(action.setId));
          if(!set)return json(res,400,{message:'Partida no encontrada en el evento actual.'});
          if(action.type==='assign'){
            const station=current.state.stations.find(candidate=>candidate.id===String(action.stationId));
            if(!isReady(current.state,set))return json(res,409,{message:'La partida todavía no está disponible o cambió en start.gg.'});
            if(!station||station.pool!==set.pool)return json(res,400,{message:'Elige una estación permitida para este pool.'});
            if(current.state.sets.some(candidate=>candidate.id!==set.id&&candidate.stationId===station.id&&['called','playing'].includes(candidate.status)))return json(res,409,{message:`La estación ${station.number} ya está ocupada.`});
            const assigned=await oauth.assignAndCall(user.authorization,selection.eventId,set.id,station.number);
            recordRealAction(realOverlays,selection.eventId,set,'assign',{...station,startggId:assigned.stationId});
          }else if(action.type==='start'){
            if(set.status!=='called')return json(res,409,{message:'Primero asigna una estación y llama a los jugadores.'});
            const station=current.state.stations.find(candidate=>candidate.id===set.stationId);
            if(!station)return json(res,400,{message:'No encontramos la estación asignada.'});
            await oauth.markInProgress(user.authorization,selection.eventId,set.id);
            recordRealAction(realOverlays,selection.eventId,set,'start',station);
          }else return json(res,400,{message:'Esta acción real no está habilitada. Los resultados se reportan directamente en start.gg.'});
          const result=await currentSnapshot();requests.set(cacheKey,result);if(requests.size>256)requests.delete(requests.keys().next().value);announce(result.state.version);return json(res,200,result);
        });
      }
      if(user?.user.role!=='admin')return json(res,403,{message:'Esta acción requiere acceso de administrador.'});
      const data=await body(req),key=req.headers['idempotency-key'];
      if(!key||key.length>128)return json(res,400,{message:'Falta el identificador de la acción.'});
      return await enqueue(async()=>{
        const cacheKey=user.token+':'+key;if(requests.has(cacheKey))return json(res,200,requests.get(cacheKey));
        if(data.version!==state.version)return json(res,409,{message:'El torneo cambió en otro dispositivo. Actualizamos los datos; vuelve a elegir la partida.'});
        const previous=state;try{const next=applyAction(structuredClone(state),data.action);next.version=previous.version+1;state=next;await persist();}catch(e){state=previous;throw e;}
        const result=snapshot();requests.set(cacheKey,result);if(requests.size>256)requests.delete(requests.keys().next().value);announce();return json(res,200,result);
      });
    }
    if(url.pathname.startsWith('/api/'))return json(res,404,{message:'Ruta de la aplicación no encontrada.'});
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{message:'Método no permitido.'});
    const publicFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/core.js':'core.js','/transport.js':'transport.js','/config.js':'config.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/logo.jpeg':'logo.jpeg','/logo1.jpeg':'logo1.jpeg','/logo2.jpeg':'logo2.jpeg','/logo3.jpeg':'logo3.jpeg'};
    const file=publicFiles[url.pathname];if(!file)return json(res,404,{message:'Página no encontrada.'});
    if(file==='config.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(`export const CONFIG = ${JSON.stringify({name:'Salamandra Queue',mode:'node',backend:'node',apiBase:'/api',refreshMs:15000,oauthEnabled:oauth.enabled})};`);}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpeg':'image/jpeg'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:await readFile(path.join(root,file)));
  }catch(e){if(!res.headersSent)json(res,400,{message:e.message||'No se pudo completar la solicitud.'});else res.end();}
});
server.listen(port,host,()=>console.log(`Salamandra Queue activa: http://${host}:${server.address().port}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const res of streams)res.end();server.close(()=>process.exit(0));});
