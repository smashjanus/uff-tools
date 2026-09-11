import {DEFAULT_DURATION} from './core.js';
const id=v=>v==null?null:String(v);
const ms=v=>v?Number(v)*1000:null;
async function mapLimited(values,limit,work){
  const results=new Array(values.length);let next=0;
  async function worker(){while(next<values.length){const index=next++;results[index]=await work(values[index],index);}}
  await Promise.all(Array.from({length:Math.min(limit,values.length)},worker));return results;
}
export function importEvent(event,phases,now=Date.now()){
  const state={schema:1,version:now,name:`${event.slug.split('/')[1]} · ${event.name}`,eventName:event.name,subtitle:event.typeDisplayStr||event.name,provider:'start.gg',readOnly:true,eventId:id(event.id),tournamentId:id(event.tournamentId),createdAt:ms(event.createdAt)||0,updatedAt:now,pools:[],players:[],sets:[],stations:[],log:[],preview:false};
  const players=new Map();
  for(const {phase,groups} of phases)for(const data of groups){
    const g=data.groups,pool=id(g.id),entrants=data.entrants||[];
    if(!g||!Array.isArray(data.sets)||!Array.isArray(entrants))throw Error('Respuesta de bracket incompleta.');
    if(!entrants.length&&!data.sets.length)continue;
    state.pools.push({id:pool,name:`${phase.name} · Pool ${g.displayIdentifier||g.identifier}`,count:entrants.length,qualifiers:g.numProgressing});
    for(const e of entrants){const entrantId=id(e.id),existing=players.get(entrantId);if(existing){if(!existing.pools.includes(pool))existing.pools.push(pool);}else players.set(entrantId,{id:entrantId,name:e.name,pool,pools:[pool],seed:e.initialSeedNum||0,startggPlayerIds:Object.values(e.playerIds||{}).map(String)});}
    for(const [index,s] of data.sets.entries()){
      if(s.unreachable)continue;
      const preview=String(s.id).startsWith('preview_');state.preview||=preview;
      const bye=[s.entrant1PrereqType,s.entrant2PrereqType].includes('bye');
      const status=bye?'bye':s.state===3?'completed':s.state===2?'playing':s.state===6?'called':'pending';
      state.sets.push({id:id(s.id),identifier:s.identifier==null?null:String(s.identifier),callOrder:Number.isFinite(s.callOrder)?s.callOrder:null,pool,side:s.round<0?'L':'W',round:Math.abs(s.round),index,roundLabel:s.fullRoundText,preview,blocked:preview||![1,2,3,6].includes(s.state),conditional:Boolean(s.isGF&&s.identifier?.includes('reset'))||/reset/i.test(s.fullRoundText||''),inputs:[1,2].map(n=>s[`entrant${n}PrereqType`]==='set'?{setId:id(s[`entrant${n}PrereqId`]),outcome:s[`entrant${n}PrereqCondition`]==='loser'?'loser':'winner'}:{playerId:id(s[`entrant${n}Id`])}),players:[id(s.entrant1Id),id(s.entrant2Id)],winnerId:id(s.winnerId),loserId:id(s.loserId),status,stationId:id(s.stationId),calledAt:ms(s.startedAt),startedAt:ms(s.startedAt),completedAt:ms(s.completedAt),duration:DEFAULT_DURATION,revision:0});
      if(s.stationId&&!state.stations.some(st=>st.id===id(s.stationId))){const number=Number((data.station||[]).find(st=>String(st.id)===String(s.stationId))?.number);state.stations.push({id:id(s.stationId),pool,number:Number.isInteger(number)?number:null,label:String(Number.isInteger(number)?number:s.stationId),enabled:true});}
    }
  }
  state.players=[...players.values()];return state;
}
export function importGroups(event,phase,groups,now=Date.now()){return importEvent(event,[{phase,groups}],now);}
export function createPublicSource(eventId,phaseId=null,fetcher=fetch){
  let snapshot=null,pending=null,lastAttempt=0;
  async function get(route){
    let failure;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await fetcher('https://api.start.gg/'+route,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
        if(r.ok){const data=(await r.json()).entities;if(!data)throw Error('Respuesta de start.gg incompleta.');return data;}
        failure=Error('start.gg no está disponible.');
        if(r.status!==429&&r.status<500)throw failure;
      }catch(error){failure=error;}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
    }
    throw failure;
  }
  return {async read(){
    if(pending)return pending;
    if(snapshot&&Date.now()-lastAttempt<15000)return snapshot;
    lastAttempt=Date.now();
    pending=(async()=>{
      try{
        const e=await get(`event/${eventId}?expand[]=phase`);
        const selected=(e.phase||[]).filter(phase=>!phaseId||String(phase.id)===String(phaseId));
        if(phaseId&&!selected.length)throw Error('El evento no contiene la fase configurada.');
        const phaseData=await mapLimited(selected,3,async phase=>{const data=await get(`phase/${phase.id}?expand[]=groups`);if(String(data.phase.eventId)!==String(eventId))throw Error('La fase no pertenece al evento.');return data;});
        const phaseGroups=phaseData.flatMap((data,phaseIndex)=>(data.groups||[]).map(group=>({group,phaseIndex})));
        const loadedGroups=await mapLimited(phaseGroups,3,async item=>{const data=await get(`phase_group/${item.group.id}?expand[]=sets&expand[]=entrants`);return {...item,data:{...data,entrants:data.entrants||[],sets:data.sets||[]}};});
        const phases=phaseData.map((data,phaseIndex)=>({phase:data.phase,groups:loadedGroups.filter(item=>item.phaseIndex===phaseIndex).map(item=>item.data)}));
        const now=Date.now();snapshot={state:importEvent(e.event,phases,now),sourceSyncedAt:now,mode:'start.gg',shared:true,sourceError:false};
      }catch{if(!snapshot)throw Error('No pudimos importar start.gg. Usa Actualizar para volver a intentar.');snapshot={...snapshot,sourceError:true};}
      return snapshot;
    })();try{return await pending;}finally{pending=null;}
  }};
}
