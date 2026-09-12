const range=(from,to)=>Array.from({length:to-from+1},(_,index)=>from+index);
const logicalId=(poolId,number)=>`${poolId}:station:${number}`;
const poolUsesStations=(state,pool)=>state.sets.some(set=>set.pool===pool.id&&!set.preview&&!['completed','bye'].includes(set.status))||(!state.sets.some(set=>!set.preview)&&pool.count>0);
const readyForStation=(state,set)=>{
  if(!set||set.preview||set.blocked||!['pending','called','playing'].includes(set.status))return false;
  if(['called','playing'].includes(set.status)||!Array.isArray(set.players))return true;
  if(!set.players[0]||!set.players[1])return false;
  return (set.inputs||[]).every(input=>!input.setId||state.sets.some(parent=>parent.id===input.setId&&['completed','bye'].includes(parent.status)));
};
const activePools=state=>{
  const ready=state.pools.filter(pool=>state.sets.some(set=>set.pool===pool.id&&readyForStation(state,set)));
  return ready.length?ready:state.pools.filter(pool=>poolUsesStations(state,pool));
};

export function stationNumbersForPool(state,pool){
  const name=String(pool?.name||'');
  const active=activePools(state),index=active.findIndex(candidate=>candidate.id===pool.id);
  if(index<0)return [];
  if(active.length===1)return range(1,12);
  if(/\bPool\s*A\d*\b/i.test(name))return range(1,6);
  if(/\bPool\s*B\d*\b/i.test(name))return range(7,12);
  if(index===0)return range(1,6);
  if(index===1)return range(7,12);
  return [];
}

export function decorateRealResult(result,overlays=new Map(),now=Date.now()){
  const output={...result,state:structuredClone(result.state)},state=output.state;
  if(state.provider!=='start.gg')return output;
  const rawStations=state.stations||[],byRawId=new Map(rawStations.map(station=>[String(station.id),station]));
  const observedByNumber=new Map();
  for(const station of rawStations){const number=Number(station.number??station.label);if(Number.isInteger(number)&&number>=1&&number<=12)observedByNumber.set(number,station);}
  for(const set of state.sets){
    if(!set.stationId)continue;
    const raw=byRawId.get(String(set.stationId)),number=Number(raw?.number??raw?.label);
    if(!Number.isInteger(number)||number<1||number>12)continue;
    set.startggStationId=String(set.stationId);set.stationNumber=number;set.stationId=logicalId(set.pool,number);
  }
  state.stations=[];
  for(const pool of state.pools){
    const active=poolUsesStations(state,pool);
    if(!active)continue;
    for(const number of stationNumbersForPool(state,pool)){
      const observed=observedByNumber.get(number);
      state.stations.push({id:logicalId(pool.id,number),pool:pool.id,number,label:String(number),enabled:observed?.enabled!==false,startggId:observed?.id?String(observed.id):null});
    }
  }
  for(const [key,overlay] of overlays){
    if(String(overlay.eventId)!==String(state.eventId))continue;
    const set=state.sets.find(candidate=>candidate.id===overlay.setId);
    if(!set||['completed','bye'].includes(set.status)||now-overlay.updatedAt>90000){overlays.delete(key);continue;}
    if(set.status===overlay.status&&set.stationNumber===overlay.stationNumber){overlays.delete(key);continue;}
    if(set.status==='playing'&&overlay.status==='called'){overlays.delete(key);continue;}
    const station=state.stations.find(candidate=>candidate.pool===set.pool&&candidate.number===overlay.stationNumber);
    if(!station)continue;
    set.stationId=station.id;set.stationNumber=station.number;set.startggStationId=overlay.startggStationId||set.startggStationId||null;
    set.status=overlay.status;
    set.calledAt=overlay.calledAt||set.calledAt;
    if(overlay.status==='playing')set.startedAt=overlay.startedAt||set.startedAt||overlay.calledAt;
  }
  state.stationActions=true;
  state.readOnly=false;
  return output;
}

export function recordRealAction(overlays,eventId,set,action,station,now=Date.now()){
  const key=`${eventId}:${set.id}`,previous=overlays.get(key)||{};
  overlays.set(key,{...previous,eventId:String(eventId),setId:String(set.id),stationNumber:Number(station.number),startggStationId:station.startggId||previous.startggStationId||null,status:action==='start'?'playing':'called',calledAt:previous.calledAt||now,startedAt:action==='start'?now:previous.startedAt||null,updatedAt:now});
}
