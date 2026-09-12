import { CONFIG } from './config.js';
import { playerName, roundName, schedule, recommended, sortUpcoming } from './core.js';
import * as api from './transport.js';

const app=document.querySelector('#app');
const notice=document.querySelector('#notice');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const refreshIcon=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg>`;

let state=null;
let selectedPool='all';
let tab='upcoming';
let entries=[];
let lastSync=0;
let syncing=false;
let syncError='';
let refreshTimer=null;

const eventTitle=()=>state?.eventName||state?.name?.split(' · ').at(-1)||'Salamandra Queue';
const poolName=id=>state?.pools.find(pool=>pool.id===id)?.name||id;
const selectedPools=()=>state.pools.filter(pool=>selectedPool==='all'||pool.id===selectedPool);
const pad=number=>String(number).padStart(2,'0');

function stationNumber(set){
  const direct=Number(set?.stationNumber);
  if(set?.stationNumber!=null&&Number.isInteger(direct))return direct;
  const linked=state?.stations.find(station=>String(station.id)===String(set?.stationId));
  const number=Number(linked?.number??linked?.label);
  return Number.isInteger(number)?number:null;
}

function poolTabName(pool){
  if(/top\s*8/i.test(pool.name))return 'Top 8';
  const parts=pool.name.split('·').map(part=>part.trim()).filter(Boolean);
  return parts.at(-1)||pool.name;
}

function syncText(){
  if(syncing)return 'Actualizando…';
  if(syncError)return 'Sin conexión';
  if(!lastSync)return 'Conectando…';
  const seconds=Math.max(0,Math.floor((Date.now()-lastSync)/1000));
  if(seconds<5)return 'Actualizado ahora';
  if(seconds<60)return `Hace ${seconds} s`;
  return `Hace ${Math.floor(seconds/60)} min`;
}

function showNotice(message,bad=false){
  notice.textContent=message;
  notice.className=`visible${bad?' error':''}`;
  clearTimeout(showNotice.timer);
  showNotice.timer=setTimeout(()=>notice.className='',4000);
}

function activeSetsFor(poolId){
  const queueIds=recommended(state,poolId).map(set=>set.id);
  const sets=state.sets.filter(set=>set.pool===poolId&&set.status!=='bye');
  if(tab==='completed')return sets.filter(set=>set.status==='completed').sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
  return sortUpcoming(state,sets.filter(set=>['playing','called','pending'].includes(set.status)),queueIds);
}

function elapsed(set){
  const start=set.status==='playing'?set.startedAt:set.status==='called'?set.calledAt:null;
  if(!start)return {seconds:null,text:'Tiempo no disponible',tone:'unknown'};
  const seconds=Math.max(0,Math.floor((Date.now()-start)/1000));
  const text=`${Math.floor(seconds/60)}:${pad(seconds%60)}`;
  if(set.status==='called')return {seconds,text,tone:'called'};
  return {seconds,text,tone:seconds<420?'green':seconds<=720?'yellow':'red'};
}

function setStatus(set,position){
  const number=stationNumber(set),station=number?`Estación ${number}`:'Sin estación';
  if(set.status==='playing'){
    const time=elapsed(set);
    return {label:'En juego',detail:station,time:`${time.text} en juego`,tone:time.tone};
  }
  if(set.status==='called'){
    const time=elapsed(set);
    return {label:'Jugadores llamados',detail:station,time:`Llamados hace ${time.text}`,tone:'called'};
  }
  if(set.status==='completed'){
    const completed=set.completedAt?new Date(set.completedAt).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit',hour12:false}):'Hora no disponible';
    return {label:'Finalizada',detail:number?station:completed,time:number?completed:'',tone:'complete'};
  }
  if(set.conditional)return {label:'Si es necesario',detail:'Depende del resultado anterior',time:'',tone:'waiting'};
  if(set.preview||set.blocked)return {label:'Esperando bracket',detail:'La partida aún no está habilitada',time:'',tone:'waiting'};
  if(!set.players?.every(Boolean))return {label:'Esperando rival',detail:'Depende de una partida anterior',time:'',tone:'waiting'};
  const entry=entries.find(item=>item.setId===set.id);
  const minutes=entry?.eta==null?null:Math.max(0,Math.ceil((entry.eta-Date.now())/60000));
  const before=Math.max(0,position-1);
  if(minutes===0)return {label:'Siguiente',detail:number?station:'Lista para ser llamada',time:'',tone:'next'};
  return {label:'Próxima',detail:before===1?'1 partida antes':`${before} partidas antes`,time:minutes?`Aprox. ${minutes} min`:'',tone:'pending'};
}

function player(id){
  const name=playerName(state,id);
  return `<span class="player ${id?'':'unknown'}"><span class="player-dot" aria-hidden="true"></span><strong>${esc(name)}</strong></span>`;
}

function matchRow(set,position){
  const status=setStatus(set,position);
  const setCode=set.identifier||set.id;
  const winner=set.status==='completed'?set.winnerId:null;
  return `<article class="match-row status-${status.tone}" data-match-id="${esc(set.id)}">
    <div class="queue-number" aria-label="Posición ${position}">${pad(position)}</div>
    <div class="players">
      <div class="player-line ${winner&&set.players[0]===winner?'winner':''}">${player(set.players?.[0])}</div>
      <span class="versus">VS</span>
      <div class="player-line ${winner&&set.players[1]===winner?'winner':''}">${player(set.players?.[1])}</div>
    </div>
    <div class="match-meta"><strong>${esc(set.roundLabel||roundName(set))}</strong><span>${esc(setCode)}</span></div>
    <div class="match-state">
      <span class="status-badge">${esc(status.label)}</span>
      <strong>${esc(status.detail)}</strong>
      ${status.time?`<span class="elapsed" data-elapsed>${esc(status.time)}</span>`:''}
    </div>
  </article>`;
}

function matchGroups(){
  const groups=selectedPools().map(pool=>({pool,sets:activeSetsFor(pool.id)})).filter(group=>group.sets.length);
  if(!groups.length)return `<div class="empty"><strong>${tab==='completed'?'Aún no hay partidas finalizadas':'No hay partidas pendientes'}</strong><span>Esta vista se actualizará automáticamente.</span></div>`;
  return groups.map(group=>`<section class="pool-group">
    ${selectedPool==='all'?`<div class="pool-heading"><strong>${esc(group.pool.name)}</strong><span>${group.sets.length} ${group.sets.length===1?'partida':'partidas'}</span></div>`:''}
    <div class="match-list">${group.sets.map((set,index)=>matchRow(set,index+1)).join('')}</div>
  </section>`).join('');
}

function visibleStations(){
  const poolIds=new Set(selectedPools().map(pool=>pool.id));
  const candidates=state.stations.filter(station=>poolIds.has(station.pool));
  if(selectedPool!=='all')return candidates.sort((a,b)=>Number(a.number)-Number(b.number));
  const occupiedPool=new Map();
  for(const set of state.sets.filter(set=>poolIds.has(set.pool)&&['playing','called'].includes(set.status))){
    const number=stationNumber(set);
    if(number)occupiedPool.set(number,set.pool);
  }
  const physical=new Map();
  for(const station of candidates){
    const number=Number(station.number??station.label);
    if(!Number.isInteger(number))continue;
    const current=physical.get(number),preferred=occupiedPool.get(number);
    if(!current||(preferred===station.pool&&current.pool!==preferred))physical.set(number,station);
  }
  return [...physical.values()].sort((a,b)=>Number(a.number)-Number(b.number));
}

function stationCard(station){
  const number=Number(station.number??station.label);
  const set=state.sets.find(candidate=>candidate.pool===station.pool&&stationNumber(candidate)===number&&['playing','called'].includes(candidate.status));
  const status=set?setStatus(set,1):null;
  return `<article class="station-card ${set?'station-'+set.status:station.enabled===false?'station-paused':'station-free'}">
    <div class="station-number"><span>ESTACIÓN</span><strong>${pad(number)}</strong></div>
    <div class="station-detail">${set
      ?`<span class="station-status">${esc(status.label)}</span><strong>${esc(playerName(state,set.players?.[0]))} <small>vs</small> ${esc(playerName(state,set.players?.[1]))}</strong><span data-station-elapsed>${esc(status.time||status.detail)}</span>`
      :`<span class="station-status">${station.enabled===false?'Pausada':'Libre'}</span><strong>${esc(poolTabName(state.pools.find(pool=>pool.id===station.pool)||{name:station.pool}))}</strong><span>${station.enabled===false?'No disponible':'Lista para otra partida'}</span>`}
    </div>
  </article>`;
}

function render(){
  if(!state){
    app.innerHTML=`<main class="boot-screen"><img src="./logo.jpeg" alt="Salamandra" width="54" height="54"><p>${esc(syncError||'Consultando el orden de partidas…')}</p>${syncError?`<button class="refresh-button" data-action="refresh">${refreshIcon}<span>Volver a intentar</span></button>`:''}</main>`;
    return;
  }
  if(selectedPool!=='all'&&!state.pools.some(pool=>pool.id===selectedPool))selectedPool='all';
  entries=schedule(state);
  const stations=visibleStations();
  app.innerHTML=`<div class="public-shell">
    <header class="sticky-header">
      <div class="event-bar">
        <div class="brand"><img src="./logo.jpeg" alt="" width="38" height="38"><div><span>SALAMANDRA QUEUE</span><h1>${esc(eventTitle())}</h1></div></div>
        <div class="refresh-area"><span id="sync-label" class="sync-label ${syncError?'offline':''}">${esc(syncText())}</span><button class="refresh-button" data-action="refresh" ${syncing?'disabled':''} aria-label="Actualizar información">${refreshIcon}<span>Actualizar</span></button></div>
      </div>
      <nav class="pool-tabs" aria-label="Filtrar fase o pool">
        <button data-pool="all" class="${selectedPool==='all'?'selected':''}" ${selectedPool==='all'?'aria-current="page"':''}>Todas las pools</button>
        ${state.pools.map(pool=>`<button data-pool="${esc(pool.id)}" class="${selectedPool===pool.id?'selected':''}" ${selectedPool===pool.id?'aria-current="page"':''}>${esc(poolTabName(pool))}</button>`).join('')}
      </nav>
    </header>
    <main>
      ${syncError?`<div class="warning" role="alert">No fue posible consultar información nueva. Se muestra la última actualización disponible.</div>`:''}
      <section class="queue-section" aria-labelledby="queue-title">
        <div class="section-heading"><div><span>ORDEN ACTUAL</span><h2 id="queue-title">${selectedPool==='all'?'Todas las partidas':esc(poolName(selectedPool))}</h2></div>
          <div class="status-tabs" aria-label="Estado de partidas"><button data-tab="upcoming" class="${tab==='upcoming'?'selected':''}">En juego y próximas</button><button data-tab="completed" class="${tab==='completed'?'selected':''}">Finalizadas</button></div>
        </div>
        ${matchGroups()}
      </section>
      <section class="stations-section" aria-labelledby="stations-title">
        <div class="section-heading"><div><span>ESTADO ACTUAL</span><h2 id="stations-title">Estaciones</h2></div><strong class="station-count">${stations.length}</strong></div>
        <div class="station-grid">${stations.length?stations.map(stationCard).join(''):`<div class="empty"><strong>Sin estaciones para esta pool</strong></div>`}</div>
      </section>
    </main>
    <footer>Datos del torneo actualizados automáticamente</footer>
  </div>`;
}

function updateTimers(){
  const sync=document.querySelector('#sync-label');
  if(sync)sync.textContent=syncText();
  for(const row of document.querySelectorAll('.match-row[data-match-id]')){
    const set=state?.sets.find(candidate=>candidate.id===row.dataset.matchId);
    if(!set||!['playing','called'].includes(set.status))continue;
    const time=elapsed(set);
    row.classList.remove('status-green','status-yellow','status-red','status-called','status-unknown');
    row.classList.add(`status-${time.tone}`);
    const label=row.querySelector('[data-elapsed]');
    if(label)label.textContent=set.status==='called'?`Llamados hace ${time.text}`:`${time.text} en juego`;
  }
  for(const card of document.querySelectorAll('.station-card')){
    const number=Number(card.querySelector('.station-number strong')?.textContent);
    const set=state?.sets.find(candidate=>stationNumber(candidate)===number&&['playing','called'].includes(candidate.status)&&(selectedPool==='all'||candidate.pool===selectedPool));
    const label=card.querySelector('[data-station-elapsed]');
    if(set&&label){const time=elapsed(set);label.textContent=set.status==='called'?`Llamados hace ${time.text}`:`${time.text} en juego`;}
  }
}

async function refresh(manual=false){
  if(syncing)return;
  syncing=true;
  syncError='';
  if(state)render();
  try{
    const result=await api.fetchSnapshot(manual);
    if(!state||result.state.version>=state.version)state=result.state;
    lastSync=result.sourceSyncedAt||Date.now();
    syncError=result.sourceError?'No se pudo consultar start.gg.':'';
    if(manual)showNotice(syncError?'Se conservan los datos anteriores.':'Información actualizada.',Boolean(syncError));
  }catch(error){
    syncError='No fue posible conectar con el servidor.';
    if(manual)showNotice(syncError,true);
  }finally{
    syncing=false;
    render();
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button||button.disabled)return;
  if(button.dataset.pool){selectedPool=button.dataset.pool;render();return;}
  if(button.dataset.tab){tab=button.dataset.tab;render();return;}
  if(button.dataset.action==='refresh')refresh(true);
});

function resume(){if(!document.hidden)refresh();}
document.addEventListener('visibilitychange',resume);
window.addEventListener('focus',resume);
window.addEventListener('online',resume);
window.addEventListener('pageshow',event=>{if(event.persisted)resume();});
window.addEventListener('offline',()=>{syncError='Sin conexión';render();});
api.subscribe(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(resume,150);});
setInterval(()=>{if(!document.hidden)refresh();},CONFIG.refreshMs);
setInterval(()=>{if(!document.hidden)updateTimers();},1000);

await refresh();
