import { saveTicket, type RoomTicket,roomSessionKey } from './room-client';
import { ensureGuestSession, guestCreationSecret } from './guest-client';
import { expandCreatedTicket, INITIAL_STATE_FORMAT, rememberCreatedTicket, takeCreatedTicket, type SeedRoomTicket } from './room-creation';
export async function apiJson<T>(path:string,body?:unknown):Promise<T>{
 const creation=body!==undefined&&path==='/api/rooms';
 if(creation)body={...(body as Record<string,unknown>),guestSecret:await guestCreationSecret(),initialState:INITIAL_STATE_FORMAT};
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>({error:'暂时无法连接，请重试'})) as {error?:string};
 if(!response.ok){throw new Error(data.error||'暂时无法连接，请重试');}
 if(creation){const ticket=expandCreatedTicket(data as unknown as RoomTicket|SeedRoomTicket);rememberCreatedTicket(ticket);return ticket as T;}
 return data as T;
}
export async function joinPuzzle(roomId:string,name?:string){
 const created=takeCreatedTicket(roomId);if(created){saveTicket(created);return created;}
 // Reuse a valid tab ticket before joining again, so returning does not abandon a held lease.
 let ticket:RoomTicket|null=null,guestReady=false;
 const candidates=new Set<string>();try{const raw=sessionStorage.getItem(roomSessionKey(roomId));if(raw)candidates.add(raw);}catch{}try{const raw=localStorage.getItem(roomSessionKey(roomId)+':account');if(raw)candidates.add(raw);}catch{}
 for(const raw of candidates){try{
  const saved=JSON.parse(raw);if(typeof saved.token!=='string'||!/^[a-f0-9]{32}$/.test(saved.token)||typeof saved.playerId!=='string')continue;
  const heartbeat=()=>fetch('/api/rooms/'+roomId,{method:'POST',headers:{Authorization:'Bearer '+saved.token,'Content-Type':'application/json'},body:JSON.stringify({type:'heartbeat'}),cache:'no-store',signal:AbortSignal.timeout(6500)});
  let response=await heartbeat();
  // A valid cookie + ticket is already an authenticated session. Only restore
  // the persistent guest cookie when the server actually asks for it.
  if(response.status===401&&!guestReady){await ensureGuestSession();guestReady=true;response=await heartbeat();}
  if(response.ok){ticket={token:saved.token,playerId:saved.playerId,room:await response.json()};break;}
 }catch{}}
 if(!ticket){if(!guestReady)await ensureGuestSession();ticket=await apiJson<RoomTicket>('/api/rooms/'+roomId+'/join',{name});}
 saveTicket(ticket);return ticket;
}
export const clockLabel=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return (s>=3600?Math.floor(s/3600)+':':'')+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
