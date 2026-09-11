import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createOAuth(env, fetcher=fetch) {
  const clientId=env.STARTGG_CLIENT_ID, secret=env.STARTGG_CLIENT_SECRET;
  const redirect=env.STARTGG_REDIRECT_URI;
  const selectorSlug=(env.STARTGG_EVENT_SELECTOR_USER_SLUG||'').replace(/^\/+|\/+$/g,'');
  const enabled=Boolean(clientId&&secret&&redirect);
  const pending=new Map(), scope='user.identity tournament.manager tournament.reporter';
  const cookie=(value,maxAge)=>`salamandra_oauth=${value}; HttpOnly; Path=/api/auth/startgg; SameSite=Lax; Max-Age=${maxAge}${redirect?.startsWith('https:')?'; Secure':''}`;
  async function graphql(accessToken,query,variables={}){
    const response=await fetcher('https://api.start.gg/gql/alpha',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000),body:JSON.stringify({query,variables})});
    if(!response.ok)throw Error('start.gg no pudo completar la consulta.');
    const result=await response.json();
    if(result.errors){const message=result.errors[0]?.message||'start.gg rechazó la consulta.';if(/missing.+scopes?.+tournament\.reporter/i.test(message))throw Error('Falta autorizar el permiso de torneo que start.gg exige para asignar estaciones. Vuelve a autorizar tu cuenta.');throw Error(message);}
    return result.data;
  }
  async function adminEvents(authorization){
    if(!authorization?.accessToken)throw Error('Vuelve a iniciar sesión con start.gg.');
    const items=[];let page=1,totalPages=1;
    do{
      // start.gg's default tournament order can put a newly-created event beyond
      // the first pages of an account that has administered many tournaments.
      const data=await graphql(authorization.accessToken,'query SalamandraAdminEvents($page: Int!) { currentUser { id slug } tournaments(query: { page: $page, perPage: 10, sortBy: "startAt desc", filter: { isCurrentUserAdmin: true } }) { pageInfo { totalPages } nodes { id name slug startAt endAt state events { id name slug startAt state numEntrants } } } }',{page});
      const actual=(data.currentUser?.slug||'').replace(/^\/+|\/+$/g,'');
      if(!selectorSlug||actual!==selectorSlug)throw Error('Esta cuenta no puede cambiar el evento de Salamandra.');
      for(const tournament of data.tournaments?.nodes||[])for(const event of tournament.events||[])items.push(eventRecord(event,tournament));
      totalPages=Math.min(5,Math.max(1,data.tournaments?.pageInfo?.totalPages||1));page++;
    }while(page<=totalPages);
    return [...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>(b.startAt||b.tournament.startAt||0)-(a.startAt||a.tournament.startAt||0)||a.name.localeCompare(b.name));
  }
  function eventRecord(event,tournament){
    return {id:String(event.id),name:event.name,slug:event.slug,startAt:event.startAt,state:event.state,numEntrants:event.numEntrants,tournament:{id:String(tournament.id),name:tournament.name,slug:tournament.slug,startAt:tournament.startAt,endAt:tournament.endAt,state:tournament.state}};
  }
  function normalizeEventReference(reference){
    const value=String(reference||'').trim();
    if(/^\d+$/.test(value))return {id:value};
    let pathname=value;
    try{pathname=new URL(value).pathname;}catch{}
    const match=pathname.replace(/^\/+|\/+$/g,'').match(/^(tournament\/[^/]+\/event\/[^/]+)/);
    if(!match)throw Error('Pega el enlace completo del evento de start.gg.');
    return {slug:decodeURIComponent(match[1])};
  }
  async function resolveAdminEvent(authorization,reference){
    if(!authorization?.accessToken)throw Error('Vuelve a iniciar sesión con start.gg.');
    const target=normalizeEventReference(reference),byId=Boolean(target.id);
    const query=byId
      ?'query SalamandraAdminEvent($value: ID!) { currentUser { id slug } event(id: $value) { id name slug startAt state numEntrants tournament { id name slug startAt endAt state owner { id } admins { id } } } }'
      :'query SalamandraAdminEvent($value: String!) { currentUser { id slug } event(slug: $value) { id name slug startAt state numEntrants tournament { id name slug startAt endAt state owner { id } admins { id } } } }';
    const data=await graphql(authorization.accessToken,query,{value:target.id||target.slug});
    const actual=(data.currentUser?.slug||'').replace(/^\/+|\/+$/g,'');
    if(!selectorSlug||actual!==selectorSlug)throw Error('Esta cuenta no puede cambiar el evento de Salamandra.');
    const event=data.event,tournament=event?.tournament,userId=String(data.currentUser?.id||'');
    if(!event||!tournament)throw Error('No encontramos ese evento en start.gg.');
    const owner=tournament.owner?.id!=null&&String(tournament.owner.id)===userId;
    const member=Array.isArray(tournament.admins)&&tournament.admins.some(admin=>admin?.id!=null&&String(admin.id)===userId);
    if(!owner&&!member)throw Error('Este evento no pertenece a un torneo que administras.');
    return eventRecord(event,tournament);
  }
  async function eventAdministration(authorization,eventId){
    if(!authorization?.accessToken)throw Error('Vuelve a iniciar sesión con start.gg.');
    const data=await graphql(authorization.accessToken,'query SalamandraEventAdministration($eventId: ID!) { currentUser { id } event(id: $eventId) { id tournament { id name owner { id } admins { id } stations(page: 1, perPage: 100) { nodes { id number enabled state } } } } }',{eventId});
    const event=data.event,tournament=event?.tournament,userId=String(data.currentUser?.id||'');
    if(!event||!tournament)throw Error('No encontramos el evento seleccionado en start.gg.');
    const owner=tournament.owner?.id!=null&&String(tournament.owner.id)===userId;
    const member=Array.isArray(tournament.admins)&&tournament.admins.some(admin=>admin?.id!=null&&String(admin.id)===userId);
    if(!owner&&!member)throw Error('Esta acción requiere ser administrador del torneo seleccionado.');
    return {eventId:String(event.id),tournamentId:String(tournament.id),tournamentName:tournament.name,stations:(tournament.stations?.nodes||[]).map(station=>({id:String(station.id),number:Number(station.number),enabled:station.enabled!==false,state:station.state}))};
  }
  async function assignAndCall(authorization,eventId,setId,stationNumber){
    const access=await eventAdministration(authorization,eventId);
    const station=access.stations.find(item=>item.number===Number(stationNumber));
    if(!station)throw Error(`La estación ${stationNumber} todavía no existe en start.gg.`);
    if(!station.enabled)throw Error(`La estación ${stationNumber} está deshabilitada en start.gg.`);
    await graphql(authorization.accessToken,'mutation SalamandraAssignStation($setId: ID!, $stationId: ID!) { assignStation(setId: $setId, stationId: $stationId) { id state station { id number } } }',{setId,stationId:station.id});
    try{
      await graphql(authorization.accessToken,'mutation SalamandraCallSet($setId: ID!) { markSetCalled(setId: $setId) { id state station { id number } } }',{setId});
    }catch{throw Error(`La estación ${stationNumber} fue asignada, pero start.gg no confirmó el llamado. Revisa esa partida en start.gg.`);}
    return {stationId:station.id,stationNumber:station.number};
  }
  async function markInProgress(authorization,eventId,setId){
    await eventAdministration(authorization,eventId);
    await graphql(authorization.accessToken,'mutation SalamandraStartSet($setId: ID!) { markSetInProgress(setId: $setId) { id state station { id number } } }',{setId});
    return {ok:true};
  }
  return {
    enabled,
    adminEvents,
    resolveAdminEvent,
    eventAdministration,
    assignAndCall,
    markInProgress,
    begin(){
      if(!enabled)throw Error('Falta configurar el acceso con start.gg.');
      for(const [key,item] of pending)if(item.expires<Date.now())pending.delete(key);
      if(pending.size>=1000)throw Error('Intenta iniciar sesión más tarde.');
      const state=randomBytes(32).toString('hex');pending.set(state,{expires:Date.now()+600000});
      const url=new URL('https://start.gg/oauth/authorize');
      url.search=new URLSearchParams({response_type:'code',client_id:clientId,scope,redirect_uri:redirect,state});
      return {url:url.href,cookie:cookie(state,600)};
    },
    clearCookie:()=>cookie('',0),
    async finish(url,headers,eventId=env.STARTGG_EVENT_ID){
      const state=url.searchParams.get('state')||'';
      const bound=(headers.cookie||'').split(/;\s*/).find(v=>v.startsWith('salamandra_oauth='))?.slice('salamandra_oauth='.length)||'';
      const record=pending.get(state);
      if(!record||record.expires<Date.now()||state.length!==bound.length||!timingSafeEqual(Buffer.from(state),Buffer.from(bound)))throw Error('El acceso caducó o no corresponde a este navegador. Intenta de nuevo.');
      pending.delete(state);
      if(url.searchParams.has('error')||!url.searchParams.get('code'))throw Error('No se autorizó el acceso. Puedes volver a intentarlo.');
      const tokenResponse=await fetcher('https://api.start.gg/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({grant_type:'authorization_code',client_id:clientId,client_secret:secret,redirect_uri:redirect,scope,code:url.searchParams.get('code')})});
      if(!tokenResponse.ok)throw Error('start.gg no pudo completar el acceso. Revisa la dirección de retorno configurada.');
      const token=await tokenResponse.json();
      if(!token.access_token)throw Error('start.gg no devolvió una autorización válida.');
      const identity=(await graphql(token.access_token,'query SalamandraIdentity { currentUser { id slug player { id gamerTag } } }')).currentUser;
      if(!identity?.id)throw Error('No pudimos verificar tu cuenta de start.gg.');
      const normalizedSlug=(identity.slug||'').replace(/^\/+|\/+$/g,'');
      const user={id:String(identity.id),slug:identity.slug||null,name:identity.player?.gamerTag||'Jugador de start.gg',role:'player',playerId:null,startggPlayerId:identity.player?.id?String(identity.player.id):null,provider:'start.gg',canSelectEvent:Boolean(selectorSlug&&normalizedSlug===selectorSlug)};
      if(eventId){
        user.adminVerification='unavailable';
        try{
          const permission=await graphql(token.access_token,'query SalamandraPermissions($eventId: ID!) { event(id: $eventId) { id tournament { id name owner { id } admins { id } } } }',{eventId});
          {
            const t=permission.event?.tournament;
            // Accept a verified owner even if the restricted admins field returned an error.
            const owner=t?.owner?.id!=null&&String(t.owner.id)===user.id;
            const member=Array.isArray(t?.admins)&&t.admins.some(a=>a?.id!=null&&String(a.id)===user.id);
            if(owner||member){user.role='admin';user.adminVerification='verified';}
            else if(Array.isArray(t?.admins))user.adminVerification='not-admin';
            if(t?.id){user.tournamentId=String(t.id);user.tournamentName=t.name;}
          }
        }catch{ /* Permission lookup failure must not prevent player login or grant administration. */ }
      }
      if(user.canSelectEvent)user.role='admin';
      return {user,authorization:{accessToken:token.access_token,refreshToken:token.refresh_token||null,expiresAt:Date.now()+Number(token.expires_in||604800)*1000}};
    }
  };
}
