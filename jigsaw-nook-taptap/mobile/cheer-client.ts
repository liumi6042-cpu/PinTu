import {CHEER_EMOTES,parseCheerSnapshot,type Cheer,type CheerEmote,type RealtimeRoomStream} from '../lib/room-realtime';
import type {RoomFetchReply} from '../lib/room-client';

export const CHEER_LABELS:Readonly<Record<CheerEmote,string>>={clap:'鼓掌',popper:'撒花',heart:'比心',star:'好耶',tea:'干杯',cat:'喵～'};
export type CheerClientOptions={
 roomId:string;token:string;playerId:string;name:string;
 fetch:(url:string,init?:RequestInit&{timeout?:number})=>Promise<RoomFetchReply>;
 realtime:RealtimeRoomStream|null;
 onCheer:(cheer:Cheer,own:boolean)=>void;
 now?:()=>number;randomId?:()=>string;
 setTimer?:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 clearTimer?:(timer:ReturnType<typeof setTimeout>)=>void;
};

/** Disposable completion effects; no room revisions, replay queue or DOM state. */
export class CheerClient{
 private readonly options:CheerClientOptions;
 private active=false;private closed=false;private available=true;private cursor=0;
 private sentAt:number[]=[];private seen=new Set<string>();
 private timer:ReturnType<typeof setTimeout>|null=null;private polling=false;
 private removeCheers:(()=>void)|undefined;private removeState:()=>void;
 private controllers=new Set<AbortController>();
 constructor(options:CheerClientOptions){
  this.options=options;
  this.removeCheers=options.realtime?.subscribeCheers?.(data=>this.accept(data));
  this.removeState=options.realtime?.subscribeState(()=>this.refreshPolling())??(()=>{});
 }
 get supported(){return this.available;}
 private now(){return this.options.now?.()??Date.now();}
 private remember(id:string){this.seen.add(id);if(this.seen.size>200)this.seen.delete(this.seen.values().next().value!);}
 send(emote:CheerEmote):boolean{
  if(this.closed||!CHEER_EMOTES.includes(emote))return false;
  const now=this.now();this.sentAt=this.sentAt.filter(at=>now-at<2000);
  if(this.sentAt.length>=4||(this.sentAt.length>0&&now-this.sentAt[this.sentAt.length-1]<300))return false;
  const id=this.options.randomId?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  this.sentAt.push(now);this.remember(id);
  this.options.onCheer({seq:0,id,playerId:this.options.playerId,name:this.options.name,emote,at:now},true);
  if(!this.available||this.closed)return true;
  let sent=false;try{sent=!!this.options.realtime?.connected&&!!this.options.realtime.sendCheer?.({id,emote});}catch{}
  if(!sent)void this.request({id,emote,after:this.cursor});
  return true;
 }
 setActive(open:boolean){if(this.closed||this.active===open)return;this.active=open;this.refreshPolling();}
 private shouldPoll(){return this.active&&!this.closed&&this.available&&!this.options.realtime?.connected;}
 private clearPoll(){if(this.timer!==null)(this.options.clearTimer??clearTimeout)(this.timer);this.timer=null;}
 private refreshPolling(){this.clearPoll();this.schedulePoll(0);}
 private schedulePoll(delay:number){
  if(!this.shouldPoll()||this.polling||this.timer!==null)return;
  this.timer=(this.options.setTimer??setTimeout)(()=>{this.timer=null;void this.poll();},delay);
 }
 private async poll(){
  if(!this.shouldPoll()||this.polling)return;
  this.polling=true;
  try{await this.request();}finally{this.polling=false;this.schedulePoll(1000);}
 }
 private async request(body?:{id:string;emote:CheerEmote;after:number}){
  const controller=typeof AbortController==='function'?new AbortController():null;
  if(controller)this.controllers.add(controller);
  try{
   const response=await this.options.fetch(`/api/rooms/${this.options.roomId}/cheers${body?'':`?after=${this.cursor}`}`,{
    method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.options.token}`,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,cache:'no-store',timeout:3500,signal:controller?.signal,
   });
   if(this.closed)return;
   if(response.status===404){this.available=false;this.clearPoll();return;}
   if(response.ok)this.accept(await response.json());
  }catch{}finally{if(controller)this.controllers.delete(controller);}
 }
 private accept(value:unknown){
  if(this.closed)return;
  const data=parseCheerSnapshot(value);if(!data)return;
  // A lower service cursor denotes a backend restart; subsequent reads start there.
  this.cursor=data.cursor;
  for(const cheer of data.cheers){
   if(this.seen.has(cheer.id))continue;
   this.remember(cheer.id);
   if(cheer.at<data.serverTime-4000)continue;
   this.options.onCheer(cheer,false);
  }
 }
 close(){
  if(this.closed)return;this.closed=true;this.clearPoll();this.removeCheers?.();this.removeState();
  for(const controller of this.controllers)controller.abort();this.controllers.clear();this.seen.clear();
 }
}
