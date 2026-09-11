import { CONFIG } from './config.js';
import { createShowcase, applyAction } from './core.js';
const KEY='salamandra.demo.state.v1',USER='salamandra.demo.user.v1';
export const shared=Boolean(CONFIG.apiBase);
let channel=!shared&&'BroadcastChannel'in window?new BroadcastChannel('salamandra-demo'):null;
let memory=null;
function read(){try {return JSON.parse(localStorage.getItem(KEY))||createShowcase();}catch{return memory||createShowcase();}}
function save(s){memory=s;try{localStorage.setItem(KEY,JSON.stringify(s));}catch{throw new Error('No se pudo guardar la demo. Habilita el almacenamiento del navegador.');}}
async function request(route,options={},timeout=10000){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);try{const response=await fetch(CONFIG.apiBase+route,{credentials:'include',cache:'no-store',...options,signal:abort.signal});const data=await response.json();if(!response.ok){const error=new Error(data.message||'No se pudo conectar.');error.status=response.status;throw error;}return data;}finally{clearTimeout(timer);}}
export async function fetchSnapshot(){if(shared)return request('/state');const state=read();save(state);return {state,sourceSyncedAt:Date.now(),mode:'demo',shared:false};}
export async function session(){if(shared)return (await request('/session')).user;try{return JSON.parse(sessionStorage.getItem(USER))||null;}catch{return null;}}
export async function login(accountId){if(shared)return (await request('/demo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId})})).user;const state=read(),p=state.players.find(x=>x.id===accountId);if(accountId!=='staff'&&!p)throw new Error('Cuenta no encontrada.');const user=accountId==='staff'?{id:'staff',name:'Equipo Salamandra',role:'admin',playerId:state.players[0].id}:{id:p.id,name:p.name,role:'player',playerId:p.id};sessionStorage.setItem(USER,JSON.stringify(user));return user;}
export async function logout(){if(shared)await request('/logout',{method:'POST'});else sessionStorage.removeItem(USER);}
export async function adminEvents(){if(!shared)throw new Error('El selector requiere el servidor de Salamandra.');return (await request('/admin/events')).events;}
export async function selectEvent(eventReference){if(!shared)throw new Error('El selector requiere el servidor de Salamandra.');return request('/admin/selection',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({eventReference})},60000);}
export async function mutate(action,version){if(shared)return request('/actions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({action,version})});
  if((await session())?.role!=='admin')throw new Error('Acceso de administrador requerido.');
  const work=()=>{const state=read();if(state.version!==version){const e=new Error('El torneo cambió. Actualiza e inténtalo de nuevo.');e.status=409;throw e;}const next=applyAction(state,action);next.version=version+1;save(next);channel?.postMessage('changed');return {state:next,sourceSyncedAt:Date.now(),mode:'demo',shared:false};};
  return navigator.locks? navigator.locks.request('salamandra-demo-state',work):work();
}
export function subscribe(onChange){if(shared){const events=new EventSource(CONFIG.apiBase+'/events',{withCredentials:true});events.addEventListener('changed',onChange);return ()=>events.close();}const storage=e=>{if(e.key===KEY)onChange();};window.addEventListener('storage',storage);if(channel)channel.onmessage=onChange;return ()=>{window.removeEventListener('storage',storage);channel?.close();};}
