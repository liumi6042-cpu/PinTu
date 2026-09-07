import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleTable } from './puzzle-table';
export type RoomTicket={token:string;playerId:string;room:RoomSnapshot};
export class RoomClient {
  ticket:RoomTicket; snapshot:RoomSnapshot; state; connected=true; message='房间已连接';
  private table:PuzzleTable|null=null;private stopped=false;private listeners=new Set<()=>void>();private revision=-1;private currentGroup:number|null=null;private seq=0;
  private pending:{id:number;dx:number;dy:number}|null=null;private moveTimer:ReturnType<typeof setTimeout>|null=null;private pollTimer:ReturnType<typeof setTimeout>|null=null;
  private heartbeatAt=0;private failures=0;private tail:Promise<unknown>=Promise.resolve();private acquiring=false;
  constructor(ticket:RoomTicket){this.ticket=ticket;this.snapshot=ticket.room;this.state=structuredClone(ticket.room.puzzle);}
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
  private emit(){for(const fn of this.listeners)fn();}
  private async request(action?:RoomAction){const response=await fetch(`/api/rooms/${this.ticket.room.id}`,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${this.ticket.token}`,...(action?{'Content-Type':'application/json'}:{})},body:action?JSON.stringify(action):undefined,cache:'no-store',signal:AbortSignal.timeout(6500)});const data=await response.json() as RoomSnapshot & {error?:string};if(!response.ok){const error=new Error(data.error||'连接暂时中断') as Error&{status:number};error.status=response.status;throw error;}return data as RoomSnapshot;}
  private action(action:RoomAction){const next=this.tail.then(()=>this.request(action));this.tail=next.catch(()=>{});return next;}
  private receive(s:RoomSnapshot){if(this.stopped||s.revision<this.revision)return;this.revision=s.revision;this.snapshot=s;this.connected=true;this.failures=0;this.message='房间已连接';
    if(this.currentGroup!==null&&s.leases[this.currentGroup]?.playerId!==this.ticket.playerId){this.currentGroup=null;this.pending=null;this.table?.cancelNetworkDrag();}
    const owners:Record<string,{name:string;color:string}>={};for(const [id,l] of Object.entries(s.leases))if(l.playerId!==this.ticket.playerId){const p=s.members.find(p=>p.id===l.playerId);owners[id]={name:p?.name||'朋友',color:p?.color||'#99caf4'};}
    if(this.table){this.table.networkReady=true;this.table.syncRemote(s.puzzle,owners,this.currentGroup);}else{this.state.groups=structuredClone(s.puzzle.groups);this.state.elapsed=s.puzzle.elapsed;}
    this.emit();
  }
  private fail(error:unknown){if(this.stopped)return;const status=(error as {status?:number})?.status;this.message=error instanceof Error?error.message:'连接中断，正在重连';
    if(status!==409&&status!==400){this.connected=false;this.failures++;if(this.table){this.table.networkReady=false;this.table.cancelNetworkDrag();}this.currentGroup=null;this.pending=null;}
    this.emit();
  }
  attach(table:PuzzleTable){this.table=table;this.stopped=false;table.network={acquire:id=>this.acquire(id),move:(id,dx,dy)=>this.move(id,dx,dy),drop:(id,dx,dy)=>this.drop(id,dx,dy),release:id=>this.release(id)};this.receive(this.snapshot);void this.poll();return()=>{this.stopped=true;if(this.pollTimer)clearTimeout(this.pollTimer);if(this.moveTimer)clearTimeout(this.moveTimer);this.table=null;};}
  private async poll(){if(this.stopped)return;try{const now=Date.now();let data:RoomSnapshot;if(now-this.heartbeatAt>5000){this.heartbeatAt=now;data=await this.action({type:'heartbeat',...(this.currentGroup===null?{}:{groupId:this.currentGroup})});}else data=await this.request();this.receive(data);}catch(error){this.fail(error);}finally{if(!this.stopped)this.pollTimer=setTimeout(()=>void this.poll(),this.connected?300:Math.min(4000,800*this.failures));}}
  async acquire(id:number){if(!this.connected||this.currentGroup!==null||this.acquiring)return false;this.acquiring=true;try{const s=await this.action({type:'claim',groupId:id});this.currentGroup=id;this.seq=0;this.receive(s);return true;}catch(error){this.fail(error);return false;}finally{this.acquiring=false;}}
  private move(id:number,dx:number,dy:number){if(this.currentGroup!==id||!this.connected)return;this.pending={id,dx,dy};if(!this.moveTimer)this.moveTimer=setTimeout(()=>this.flush(),140);}
  private flush(){this.moveTimer=null;const next=this.pending;this.pending=null;if(!next||this.currentGroup!==next.id)return;const seq=++this.seq;void this.action({type:'move',groupId:next.id,dx:next.dx,dy:next.dy,seq}).then(s=>this.receive(s)).catch(error=>{this.currentGroup=null;this.table?.cancelNetworkDrag();this.fail(error);});}
  private async drop(id:number,dx:number,dy:number){if(this.moveTimer)clearTimeout(this.moveTimer);this.moveTimer=null;this.pending=null;if(this.currentGroup!==id)return;try{const data=await this.action({type:'drop',groupId:id,dx,dy,seq:++this.seq});this.currentGroup=null;this.receive(data);}catch(error){this.currentGroup=null;this.table?.cancelNetworkDrag();this.fail(error);try{this.receive(await this.request());}catch{}}}
  private release(id:number){this.pending=null;this.currentGroup=null;void this.action({type:'release',groupId:id}).then(s=>this.receive(s)).catch(error=>this.fail(error));}
  leave(){this.stopped=true;if(this.pollTimer)clearTimeout(this.pollTimer);if(this.moveTimer)clearTimeout(this.moveTimer);this.table?.cancelNetworkDrag();this.pending=null;void fetch(`/api/rooms/${this.ticket.room.id}`,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.ticket.token}`},body:JSON.stringify({type:'leave'})}).catch(()=>{});}
}
export function roomSessionKey(id:string){return `together-puzzle:room:${id}`;}
export function saveTicket(ticket:RoomTicket){try{sessionStorage.setItem(roomSessionKey(ticket.room.id),JSON.stringify({token:ticket.token,playerId:ticket.playerId}));}catch{}}

