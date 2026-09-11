import { CURSOR_INTERVAL, type CursorPoint, type SharedCursor } from './room-cursors';
import { retryDelay } from './request-backoff';

export class CursorClient {
  // getRandomValues also works on LAN HTTP, where randomUUID is unavailable.
  private id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  private seq=0; private pending:CursorPoint|null|undefined;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private controller:AbortController|null=null;
  private stopped=true; private running=false; private sentAt=-Infinity;
  private lastMotion=0; private visible=false;
  private retryAt=0;
  private roomId:string;private token:string;private playerId:string;
  private receive:(cursors:SharedCursor[])=>void;private ready:()=>boolean;private hidden:()=>boolean;
  constructor(roomId:string,token:string,playerId:string,
    receive:(cursors:SharedCursor[])=>void,ready:()=>boolean,hidden:()=>boolean=()=>false){
    this.roomId=roomId;this.token=token;this.playerId=playerId;this.receive=receive;this.ready=ready;this.hidden=hidden;
  }
  start(){this.stopped=false;this.schedule(0);}
  point(point:CursorPoint|null){
    if(this.stopped || (!point&&!this.visible&&this.pending===undefined))return;
    this.visible=point!==null;this.pending=point;this.lastMotion=Date.now();
    this.schedule(Math.max(0,CURSOR_INTERVAL-(performance.now()-this.sentAt)));
  }
  private schedule(delay:number){if(this.stopped||this.running)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>void this.exchange(),Math.max(delay,this.retryAt-Date.now()));}
  private async exchange(){
    if(this.stopped)return;
    if(!this.ready()){this.receive([]);this.schedule(1500);return;}
    this.running=true;this.sentAt=performance.now();
    const point=this.pending;this.pending=undefined;let active=false;
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),3500);
    try{
      const response=await fetch(`/api/rooms/${this.roomId}/cursors`,{method:point===undefined?'GET':'POST',
        headers:{Authorization:`Bearer ${this.token}`,...(point===undefined?{}:{'Content-Type':'application/json'})},
        body:point===undefined?undefined:JSON.stringify({clientId:this.id,seq:++this.seq,point}),cache:'no-store',signal:controller.signal});
      if(!response.ok){if(response.status===429||response.status===503)this.retryAt=Date.now()+retryDelay(response.headers.get('Retry-After'));throw new Error('cursor-unavailable');}
      const data=await response.json() as {cursors:SharedCursor[];serverTime?:number};
      if(!this.stopped){
        const now=Date.now();
        const others=data.cursors.filter(cursor=>cursor.playerId!==this.playerId).map(cursor=>({...cursor,updatedAt:now-Math.max(0,(data.serverTime??now)-cursor.updatedAt)}));
        active=others.length>0;this.receive(others);
      }
    }catch{if(!this.stopped)this.receive([]);}
    finally{
      clearTimeout(timeout);this.running=false;
      if(!this.stopped)this.schedule(Math.max(0,(this.pending!==undefined||Date.now()-this.lastMotion<1000?CURSOR_INTERVAL:this.hidden()?4000:active?300:1200)-(performance.now()-this.sentAt)));
    }
  }
  stop(){
    if(this.stopped)return;
    this.stopped=true;if(this.timer)clearTimeout(this.timer);this.controller?.abort();this.receive([]);
    // A higher sequence tombstone also defeats a delayed in-flight position update.
    if(this.visible||this.pending!==undefined)void fetch(`/api/rooms/${this.roomId}/cursors`,{method:'POST',keepalive:true,
      headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({clientId:this.id,seq:++this.seq,point:null})}).catch(()=>{});
  }
}
