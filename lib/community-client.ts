import { saveTicket, type RoomTicket,roomSessionKey } from './room-client';
export async function apiJson<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(12000)});
 const data=await response.json() as {error?:string};
 if(!response.ok){if(response.status===401&&typeof window!=='undefined'&&!path.startsWith('/api/auth/'))window.dispatchEvent(new Event('puzzle:session-expired'));throw new Error(data.error||'暂时无法连接，请重试');}return data as T;
}
export async function joinPuzzle(roomId:string,name?:string){
 // Reuse a valid tab ticket before joining again, so returning does not abandon a held lease.
 let ticket:RoomTicket|null=null;
 const candidates=new Set<string>();try{const raw=sessionStorage.getItem(roomSessionKey(roomId));if(raw)candidates.add(raw);}catch{}try{const raw=localStorage.getItem(roomSessionKey(roomId)+':account');if(raw)candidates.add(raw);}catch{}
 for(const raw of candidates){try{const saved=JSON.parse(raw),response=await fetch('/api/rooms/'+roomId,{headers:{Authorization:'Bearer '+saved.token},cache:'no-store'});if(response.ok){ticket={token:saved.token,playerId:saved.playerId,room:await response.json()};break;}}catch{}}
 if(!ticket)ticket=await apiJson<RoomTicket>('/api/rooms/'+roomId+'/join',{name});
 saveTicket(ticket);return ticket;
}
export const clockLabel=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return (s>=3600?Math.floor(s/3600)+':':'')+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
