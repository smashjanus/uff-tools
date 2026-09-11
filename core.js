export const DEFAULT_DURATION = 12 * 60000;
export const REST = 2 * 60000;
const names = ['Koki','Lulu','Charlit3rs','Nico','Mango','Dante','Sora','Rex','Luna','Mako','Zero','Kira','Nox','Milo','Fenix','Ari','Rafa','Loki','Leo','Nova','Ryu','Santi','Akira','Yoshi','Mica','Dani','Kai','Pablo','Alex','Nero','Tavo','Izan','Vale','Beto','Coco','Nani','Ken','Lalo','Eli','Zeta','Momo','Gabo','Tito','Sol','Max','Roca','Javi','Rolo','Iris','Paco','Lina','Teo','Natsu','Pika','Nina','Ruben','Omar','Toni','Luz','Axel','Dino','Vega','Cris','Neko'];
export function createTournament(counts = [32,32], now = Date.now()) {
  if (!Array.isArray(counts) || !counts.length || counts.length > 4 || counts.some(n => !Number.isInteger(n) || n<4 || n>128)) throw new Error('Cada pool debe tener entre 4 y 128 jugadores.');
  const state = { schema:1, version:1, name:'Salamandra Open', subtitle:'Super Smash Bros. Ultimate · Singles', createdAt:now, updatedAt:now, pools:[], players:[], sets:[], stations:[], log:[] };
  counts.forEach((n,p) => {
    const pool=String.fromCharCode(65+p), size=2**Math.ceil(Math.log2(n)), k=Math.log2(size), W={},L={};
    state.pools.push({id:pool,name:`Pool ${pool}`,count:n,qualifiers:4});
    for(let i=0;i<n;i++)state.players.push({id:`${pool}-p${i+1}`,name:names[(p*32+i)%names.length]+(i>=64?` ${Math.floor(i/64)+1}`:''),pool,seed:i+1});
    for(let i=1;i<=6;i++)state.stations.push({id:`${pool}-${i}`,pool,number:p*6+i,label:`${String(p*6+i).padStart(2,'0')}`,enabled:true});
    let seedOrder=[1,2];while(seedOrder.length<size){const next=seedOrder.length*2+1;seedOrder=seedOrder.flatMap(v=>[v,next-v]);}
    const add=(side,r,i,inputs)=>{const id=`${pool}-${side}${r}-${i+1}`;state.sets.push({id,pool,side,round:r,index:i,inputs,status:'pending',players:[null,null],winnerId:null,loserId:null,stationId:null,calledAt:null,startedAt:null,completedAt:null,duration:DEFAULT_DURATION,revision:0});return id;};
    for(let r=1;r<k;r++){W[r]=[];for(let i=0;i<size/2**r;i++)W[r].push(add('W',r,i,r===1?[2*i,2*i+1].map(j=>({playerId:seedOrder[j]<=n?`${pool}-p${seedOrder[j]}`:null})):[{setId:W[r-1][2*i],outcome:'winner'},{setId:W[r-1][2*i+1],outcome:'winner'}]));}
    if(k>=3){L[1]=[];for(let i=0;i<size/4;i++)L[1].push(add('L',1,i,[{setId:W[1][2*i],outcome:'loser'},{setId:W[1][2*i+1],outcome:'loser'}]));
      for(let r=2;r<=2*k-4;r++){L[r]=[];if(r%2===0){const c=L[r-1].length;for(let i=0;i<c;i++)L[r].push(add('L',r,i,[{setId:L[r-1][i],outcome:'winner'},{setId:W[r/2+1][c-1-i],outcome:'loser'}]));}else for(let i=0;i<L[r-1].length/2;i++)L[r].push(add('L',r,i,[{setId:L[r-1][2*i],outcome:'winner'},{setId:L[r-1][2*i+1],outcome:'winner'}]));}
    }
  });
  settle(state,now); return state;
}
export function settle(state,now=Date.now()) {
  const byId=new Map(state.sets.map(s=>[s.id,s]));let changed=true;
  while(changed){changed=false;for(const s of state.sets){if(s.status!=='pending')continue;let known=true;
    s.players=s.inputs.map(input=>{if('playerId'in input)return input.playerId;const parent=byId.get(input.setId);if(!parent||!['completed','bye'].includes(parent.status)){known=false;return null;}return parent[input.outcome+'Id'];});
    if(known&&s.players.filter(Boolean).length<2){s.status='bye';s.winnerId=s.players.find(Boolean)||null;s.loserId=null;s.completedAt=now;changed=true;}
  }}return state;
}
export const playerName=(state,id)=>state.players.find(p=>p.id===id)?.name||'Rival por definir';
export const roundName=s=>s.roundLabel||`${s.side==='W'?'Winners':'Losers'} R${s.round}`;
export function readyAt(state,s){return Math.max(state.createdAt,...s.inputs.map(i=>i.setId?(state.sets.find(x=>x.id===i.setId)?.completedAt||0)+REST:0));}
export function isReady(state,s,now=Date.now()) {return !s.blocked&&!s.conditional&&s.status==='pending'&&s.players.every(Boolean)&&readyAt(state,s)<=now&&(!s.deferredUntil||s.deferredUntil<=now)&&!state.sets.some(x=>['called','playing'].includes(x.status)&&x.players.some(id=>s.players.includes(id)));}
function nearLosers(state,s,now){if(s.side!=='W'||s.round<3)return true;const drop=state.sets.find(x=>x.inputs.some(i=>i.setId===s.id&&i.outcome==='loser'));if(!drop)return true;const other=drop.inputs.find(i=>i.setId!==s.id);const feeder=state.sets.find(x=>x.id===other?.setId);return !feeder||['completed','bye','called','playing'].includes(feeder.status)||isReady(state,feeder,now);}
export function recommended(state,pool,now=Date.now()) {
  const ready=state.sets.filter(s=>s.pool===pool&&isReady(state,s,now));const order=(a,b)=>a.round-b.round||readyAt(state,a)-readyAt(state,b)||a.index-b.index;
  let W=ready.filter(s=>s.side==='W').sort(order),L=ready.filter(s=>s.side==='L').sort(order);
  const near=W.filter(s=>nearLosers(state,s,now));if(near.length)W=near;else if(L.length)W=[];
  const busy=state.sets.filter(s=>s.pool===pool&&['called','playing'].includes(s.status));let nw=busy.filter(s=>s.side==='W').length,nl=busy.filter(s=>s.side==='L').length;const result=[];
  while(W.length||L.length){let s;if(!W.length)s=L.shift();else if(!L.length)s=W.shift();else if(nw>=2)s=L.shift();else if(nl>=4)s=W.shift();else s=nl/4<=nw/2?L.shift():W.shift();result.push(s);s.side==='W'?nw++:nl++;}
  // Advanced W stays available as a manual choice, but appears after catch-up work.
  return [...result,...ready.filter(s=>!result.includes(s)).sort(order)];
}
export function reason(state,s,now=Date.now()) {
  if(s.status==='playing')return 'Partida en curso';if(s.status==='called')return 'Jugadores llamados';
  if(!s.players.every(Boolean))return 'Espera un resultado anterior';
  if(s.deferredUntil>now)return 'Pospuesta por el organizador';
  if(readyAt(state,s)>now)return 'Descanso entre sets';
  if(s.side==='L')return 'Prioridad losers · set de eliminación';
  if(!nearLosers(state,s,now))return 'Conviene esperar a que avance losers';
  if(s.round===1)return 'Desbloquea los primeros cruces';return 'Alimenta el siguiente cruce de losers';
}
export function schedule(state,now=Date.now()) {
  const entries=[];
  for(const pool of state.pools){const slots=state.stations.filter(x=>x.pool===pool.id&&x.enabled).map(st=>{const busy=state.sets.find(s=>s.stationId===st.id&&['called','playing'].includes(s.status));return {id:st.id,free:busy?Math.max(now+120000,(busy.startedAt||busy.calledAt)+busy.duration):now};});
    const queue=recommended(state,pool.id,now);queue.forEach((s,i)=>{slots.sort((a,b)=>a.free-b.free||a.id.localeCompare(b.id));const slot=slots[0];const start=slot?Math.max(now,slot.free,readyAt(state,s)):null;entries.push({setId:s.id,rank:i+1,eta:start,estimatedStationId:slot?.id||null});if(slot)slot.free=start+s.duration;});
  }return entries;
}
export function playerStatus(state,id){const active=state.sets.filter(s=>!['completed','bye'].includes(s.status)&&s.players.includes(id));if(active.length){const queueIds=state.pools.flatMap(pool=>recommended(state,pool.id).map(set=>set.id)),set=sortUpcoming(state,active,queueIds)[0];return {kind:set.status,set};}const lost=state.sets.filter(s=>s.status==='completed'&&s.loserId===id).length;return {kind:lost>=2?'eliminated':'qualified'};}
export function dependencyDepth(state,set,memo=new Map(),visiting=new Set()) {
  if(memo.has(set.id))return memo.get(set.id);
  if(visiting.has(set.id))return Number.MAX_SAFE_INTEGER;
  visiting.add(set.id);
  let depth=0;
  for(const input of set.inputs||[]){
    if(!input.setId)continue;
    const parent=state.sets.find(candidate=>candidate.id===input.setId);
    if(parent&&!['completed','bye'].includes(parent.status))depth=Math.max(depth,1+dependencyDepth(state,parent,memo,visiting));
  }
  visiting.delete(set.id);memo.set(set.id,depth);return depth;
}
export function sortUpcoming(state,sets,queueIds=[]) {
  const memo=new Map(),statusRank={playing:0,called:1,pending:2};
  return [...sets].sort((a,b)=>{
    const status=(statusRank[a.status]??3)-(statusRank[b.status]??3);
    if(status)return status;
    if(a.status==='playing')return (a.startedAt||Infinity)-(b.startedAt||Infinity)||a.id.localeCompare(b.id);
    if(a.status==='called')return (a.calledAt||Infinity)-(b.calledAt||Infinity)||a.id.localeCompare(b.id);
    const depth=dependencyDepth(state,a,memo)-dependencyDepth(state,b,memo);
    if(depth)return depth;
    if(Boolean(a.conditional)!==Boolean(b.conditional))return a.conditional?1:-1;
    const qa=queueIds.includes(a.id)?queueIds.indexOf(a.id):Number.MAX_SAFE_INTEGER;
    const qb=queueIds.includes(b.id)?queueIds.indexOf(b.id):Number.MAX_SAFE_INTEGER;
    return qa-qb||(a.callOrder??Infinity)-(b.callOrder??Infinity)||a.index-b.index||a.id.localeCompare(b.id);
  });
}
export function matchesBefore(state,set,now=Date.now()){
  if(!set)return 0;
  const queueIds=recommended(state,set.pool,now).map(candidate=>candidate.id);
  const upcoming=state.sets.filter(candidate=>candidate.pool===set.pool&&['playing','called','pending'].includes(candidate.status)&&candidate.status!=='bye');
  const position=sortUpcoming(state,upcoming,queueIds).findIndex(candidate=>candidate.id===set.id);
  return Math.max(0,position);
}
export function opponentSource(state,set,playerId){
  if(!set)return 'Rival por definir';
  let slot=set.players.findIndex(id=>id!==null&&id!==playerId);
  if(slot>=0)return playerName(state,set.players[slot]);
  slot=set.players.findIndex(id=>!id);
  const input=set.inputs?.[slot];
  if(!input?.setId)return 'Rival por definir';
  const parent=state.sets.find(candidate=>candidate.id===input.setId),outcome=input.outcome==='loser'?'Perdedor':'Ganador';
  if(!parent)return `${outcome} de una partida anterior`;
  if(parent.players?.every(Boolean))return `${outcome} entre ${playerName(state,parent.players[0])} vs ${playerName(state,parent.players[1])}`;
  return `${outcome} de ${roundName(parent)}`;
}
export function applyAction(state,action,now=Date.now()) {
  const fail=message=>{throw new Error(message);};const s=state.sets.find(x=>x.id===action.setId);
  if(action.type==='reset'){return createShowcase(action.counts||[32,32],now);}
  if(action.type==='station'){const st=state.stations.find(x=>x.id===action.stationId);if(!st)fail('Estación no encontrada.');if(state.sets.some(x=>x.stationId===st.id&&['called','playing'].includes(x.status)))fail('Termina o cancela el llamado antes de pausar esta estación.');st.enabled=!st.enabled;}
  else {
    if(!s)fail('Partida no encontrada.');
    if(action.type==='defer'){if(s.status!=='pending'||!s.players.every(Boolean))fail('Solo se pueden posponer cruces con ambos jugadores definidos.');s.deferredUntil=now+5*60000;}
    else if(action.type==='resume'){if(s.status!=='pending')fail('La partida ya fue llamada.');s.deferredUntil=null;}
    else if(action.type==='assign'){
      const st=state.stations.find(x=>x.id===action.stationId);if(!isReady(state,s,now))fail('La partida todavía no está disponible.');if(!st||!st.enabled||st.pool!==s.pool)fail('Elige una estación disponible del mismo pool.');if(state.sets.some(x=>x.stationId===st.id&&['called','playing'].includes(x.status)))fail('Otra partida ya ocupa esta estación.');s.stationId=st.id;s.status='called';s.calledAt=now;
    }else if(action.type==='start'){if(s.status!=='called')fail('Primero llama a los jugadores.');s.status='playing';s.startedAt=now;}
    else if(action.type==='cancel'){if(s.status!=='called')fail('Solo se puede cancelar un llamado que no haya empezado.');s.status='pending';s.stationId=null;s.calledAt=null;}
    else if(action.type==='simulate'){if(s.status!=='playing')fail('La partida debe estar en curso.');const winner=action.winnerId||s.players[0];if(!s.players.includes(winner))fail('Jugador inválido.');s.status='completed';s.winnerId=winner;s.loserId=s.players.find(p=>p!==winner);s.completedAt=now;}
    else fail('Acción no permitida.');
    s.revision++;
  }
  settle(state,now);state.version++;state.updatedAt=now;state.log.unshift({id:state.version,type:action.type,setId:action.setId||null,at:now});state.log=state.log.slice(0,50);return state;
}
export function createShowcase(counts=[32,32],now=Date.now()) {
  const state=createTournament(counts,now-65*60000);
  for(const pool of state.pools){
    for(const s of state.sets.filter(s=>s.pool===pool.id&&s.side==='W'&&s.round===1))if(s.status==='pending'&&s.players.every(Boolean)){s.status='completed';s.winnerId=s.players[0];s.loserId=s.players[1];s.completedAt=now-35*60000;s.startedAt=s.completedAt-DEFAULT_DURATION;}
    settle(state,now-35*60000);
    const early=state.sets.filter(s=>s.pool===pool.id&&s.side==='W'&&s.round===2&&s.status==='pending'&&s.players.every(Boolean));
    for(const s of early.slice(0,Math.max(0,early.length-2))){s.status='completed';s.winnerId=s.players[0];s.loserId=s.players[1];s.completedAt=now-18*60000;s.startedAt=s.completedAt-DEFAULT_DURATION;}
    settle(state,now-18*60000);
    const initial=state.sets.filter(s=>s.pool===pool.id&&s.side==='L'&&s.round===1&&s.status==='pending'&&s.players.every(Boolean));
    for(const s of initial.slice(0,Math.floor(initial.length/2))){s.status='completed';s.winnerId=s.players[0];s.loserId=s.players[1];s.completedAt=now-8*60000;s.startedAt=s.completedAt-DEFAULT_DURATION;}
    settle(state,now-8*60000);
    for(let j=0;j<3;j++){const next=recommended(state,pool.id,now)[0];if(!next)break;next.status=j===2?'called':'playing';next.stationId=`${pool.id}-${j+1}`;next.calledAt=now-(j===2?1:7-j*3)*60000;next.startedAt=j===2?null:next.calledAt;}
  }
  state.version=1;state.updatedAt=now;return state;
}
