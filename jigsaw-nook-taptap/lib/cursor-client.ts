import { CURSOR_INTERVAL, type CursorInput, type CursorPoint, type SharedCursor } from './room-cursors';
import { retryDelay } from './request-backoff';
import type { RoomFetchReply } from './room-client';

export type CursorClientDependencies={
 fetch:(url:string,init?:RequestInit&{timeout?:number})=>Promise<RoomFetchReply>;
 randomId:()=>string;now:()=>number;performanceNow:()=>number;
 subscribeVisibility:(listener:()=>void)=>()=>void;
 retainUntilLeave?:boolean;
 realtime?:{readonly connected:boolean;subscribeCursors(fn:(data:{cursors:SharedCursor[];serverTime?:number})=>void):()=>void;subscribeState(fn:(connected:boolean)=>void):()=>void;sendCursor(data:CursorInput):boolean};
};
export const REALTIME_CURSOR_INTERVAL=1000/15;
const browserDependencies:CursorClientDependencies={
 fetch:(url,init)=>fetch(url,init),
 randomId:()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),
 now:()=>Date.now(),performanceNow:()=>typeof performance!=='undefined'?performance.now():Date.now(),
 subscribeVisibility(listener){if(typeof document==='undefined')return()=>{};const target=document;target.addEventListener('visibilitychange',listener);return()=>target.removeEventListener('visibilitychange',listener);},
};

export class CursorClient {
  // getRandomValues also works on LAN HTTP, where randomUUID is unavailable.
  private id:string;private deps:CursorClientDependencies;
  private seq=0; private pending:CursorPoint|null|undefined;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private controller:AbortController|null=null;
  private cancelExchange:(()=>void)|null=null;
  private stopped=true; private running=false; private sentAt=-Infinity;
  private socketSentAt=-Infinity;private lastPoint:CursorPoint|null|undefined;
  private lastMotion=0; private visible=false;
  private retryAt=0;
  private roomId:string;private token:string;private playerId:string;
  private receive:(cursors:SharedCursor[])=>void;private ready:()=>boolean;private hidden:()=>boolean;
  private removeVisibility:(()=>void)|null=null;
  private removeRealtime:(()=>void)|null=null;private removeRealtimeState:(()=>void)|null=null;
  private transportRevision=0;
  private realtimeChanged=()=>{
    if(this.stopped)return;
    this.transportRevision++;
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(this.deps.realtime?.connected){this.retryAt=0;this.cancelExchange?.();this.controller?.abort();}
    // One latest snapshot survives a transport change; no movement queue is replayed.
    if(this.visible&&this.lastPoint)this.pending=this.lastPoint;
    this.schedule(0);
  };
  private visibilityChanged=()=>{
    if(this.stopped)return;
    if(this.hidden()){
      if(this.timer)clearTimeout(this.timer);this.timer=null;
      // A hidden shared game remains in its room. Only stop() retires its position.
      if(!this.deps.retainUntilLeave){this.point(null);this.receive([]);}
    }else this.schedule(0);
  };
  constructor(roomId:string,token:string,playerId:string,
    receive:(cursors:SharedCursor[])=>void,ready:()=>boolean,hidden:()=>boolean=()=>false,dependencies:Partial<CursorClientDependencies>={}){
    this.deps={...browserDependencies,...dependencies};this.id=this.deps.randomId();
    this.roomId=roomId;this.token=token;this.playerId=playerId;this.receive=receive;this.ready=ready;this.hidden=hidden;
  }
  start(){
    if(!this.stopped)return;this.stopped=false;
    this.removeVisibility=this.deps.subscribeVisibility(this.visibilityChanged);
    this.removeRealtime=this.deps.realtime?.subscribeCursors(data=>{if(!this.stopped&&this.deps.realtime?.connected&&this.ready())this.accept(data);})??null;
    this.removeRealtimeState=this.deps.realtime?.subscribeState(this.realtimeChanged)??null;
    // State subscribers intentionally do not invoke their listener on subscription.
    this.schedule(0);
  }
  // Scene/modal visibility can change without a native page visibility event.
  refresh(){this.visibilityChanged();}
  point(point:CursorPoint|null){
    if(this.deps.retainUntilLeave&&(!point||this.hidden()))return;
    if(this.hidden())point=null;
    if(this.stopped || (!point&&!this.visible&&this.pending===undefined))return;
    this.visible=point!==null;this.pending=point;this.lastPoint=point;this.lastMotion=this.deps.now();
    this.schedule(Math.max(0,(this.deps.realtime?.connected?REALTIME_CURSOR_INTERVAL:CURSOR_INTERVAL)-(this.deps.performanceNow()-(this.deps.realtime?.connected?this.socketSentAt:this.sentAt))));
  }
  private schedule(delay:number){
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(this.stopped||this.running||(this.hidden()&&this.pending!==null))return;
    if(this.deps.realtime?.connected&&this.pending===undefined)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.exchange();},Math.max(delay,this.deps.realtime?.connected?0:this.retryAt-this.deps.now()));
  }
  private accept(data:{cursors:SharedCursor[];serverTime?:number}){
    const now=this.deps.now(),others=data.cursors.filter(cursor=>cursor.playerId!==this.playerId).map(cursor=>({...cursor,updatedAt:now-Math.max(0,(data.serverTime??now)-cursor.updatedAt)}));
    this.receive(this.hidden()&&!this.deps.retainUntilLeave?[]:others);return others.length>0;
  }
  private exchangeRealtime(){
    const realtime=this.deps.realtime,point=this.pending;if(!realtime?.connected||point===undefined)return;
    const wait=REALTIME_CURSOR_INTERVAL-(this.deps.performanceNow()-this.socketSentAt);if(wait>0){this.schedule(Math.ceil(wait));return;}
    this.pending=undefined;
    // sendCursor owns no queue. A rejected send retains only the newest point.
    const seq=++this.seq;let sent=false;try{sent=realtime.sendCursor({clientId:this.id,seq,point});}catch{}
    if(sent)this.socketSentAt=this.deps.performanceNow();else if(this.pending===undefined)this.pending=point;
    if(this.pending!==undefined)this.schedule(REALTIME_CURSOR_INTERVAL);
  }
  private async exchange(){
    if(this.stopped||(this.hidden()&&this.pending!==null))return;
    if(!this.ready()){if(!this.deps.retainUntilLeave)this.receive([]);this.schedule(1500);return;}
    if(this.deps.realtime?.connected){this.exchangeRealtime();return;}
    this.running=true;this.sentAt=this.deps.performanceNow();
    const point=this.pending,revision=this.transportRevision;this.pending=undefined;let active=false;
    const controller=typeof AbortController==='function'?new AbortController():null;this.controller=controller;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
      const request=this.deps.fetch(`/api/rooms/${this.roomId}/cursors`,{method:point===undefined?'GET':'POST',
        headers:{Authorization:`Bearer ${this.token}`,...(point===undefined?{}:{'Content-Type':'application/json'})},
        body:point===undefined?undefined:JSON.stringify({clientId:this.id,seq:++this.seq,point}),cache:'no-store',signal:controller?.signal,timeout:3500});
      const response=await Promise.race([request,new Promise<never>((_resolve,reject)=>{this.cancelExchange=()=>{controller?.abort();reject(Error('cursor-cancelled'));};timeout=setTimeout(()=>{controller?.abort();reject(Error('cursor-timeout'));},3500);})]);
      if(!response.ok){if(response.status===429||response.status===503)this.retryAt=this.deps.now()+retryDelay(response.headers.get('Retry-After'));throw new Error('cursor-unavailable');}
      const data=await response.json() as {cursors:SharedCursor[];serverTime?:number};
      if(!this.stopped&&revision===this.transportRevision&&!this.deps.realtime?.connected)active=this.accept(data);
    }catch{
      if(!this.stopped&&!this.deps.realtime?.connected&&this.deps.retainUntilLeave){
        // Keep the latest unsent position while reconnecting, never replay an older move over a newer one.
        if(point!==undefined&&this.pending===undefined)this.pending=point;
        this.retryAt=Math.max(this.retryAt,this.deps.now()+1200);
      }else if(!this.stopped&&!this.deps.realtime?.connected)this.receive([]);
    }
    finally{
      clearTimeout(timeout);this.cancelExchange=null;this.running=false;
      if(!this.stopped)this.schedule(this.deps.realtime?.connected?0:Math.max(0,(this.pending!==undefined||this.deps.now()-this.lastMotion<1000?CURSOR_INTERVAL:this.hidden()?4000:active?300:1200)-(this.deps.performanceNow()-this.sentAt)));
    }
  }
  stop(){
    if(this.stopped)return;
    this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;
    this.removeVisibility?.();this.removeVisibility=null;
    this.removeRealtime?.();this.removeRealtime=null;this.removeRealtimeState?.();this.removeRealtimeState=null;
    this.cancelExchange?.();this.controller?.abort();this.receive([]);
    // A higher sequence tombstone also defeats a delayed in-flight position update.
    if(this.visible||this.pending!==undefined){const tombstone={clientId:this.id,seq:++this.seq,point:null};let sent=false;try{sent=!!this.deps.realtime?.connected&&this.deps.realtime.sendCursor(tombstone);}catch{}
      if(!sent)void this.deps.fetch(`/api/rooms/${this.roomId}/cursors`,{method:'POST',keepalive:true,timeout:3500,
        headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(tombstone)}).catch(()=>{});
    }
  }
}
