import type {SocialMessage,SocialPlayer,SocialSnapshot} from './social-types';

/** The server accepts one private message (room invites included) per sender every 3 s; keep a margin. */
export const INVITE_GAP_MS=3200;
/** Older invites stay in 消息 but never pop up. */
export const INVITE_BANNER_MAX_AGE_MS=30*60*1000;
export const INVITE_SEEN_KEY='jigsaw:room-invite-seen:v1';
const SEEN_LIMIT=100;

export type InviteState='queued'|'sending'|'sent'|'failed';
export type InviteJob={roomId:string;code:string;requestId:string};
type QueuedJob=InviteJob&{tries:number};
export type RoomInviteQueueOptions={
 send:(job:InviteJob)=>Promise<void>;
 randomId:()=>string;
 now?:()=>number;
 wait?:(ms:number)=>Promise<void>;
 gap?:number;
 changed?:()=>void;
 sent?:(job:InviteJob)=>void;
 failed?:(error:unknown,job:InviteJob)=>void;
};
const rateLimited=(error:unknown)=>{const detail=error as {status?:number;code?:string}|null;return detail?.status===429||detail?.code==='MESSAGE_RATE_LIMIT';};

/** Sends room invites one at a time, at least `gap` ms apart, so inviting several friends never hits the server's rate limit.
 * A rate-limited send is retried (same requestId, so a replayed success is not sent twice); other errors mark the row failed.
 */
export class RoomInviteQueue{
 private readonly states=new Map<string,InviteState>();
 private jobs:QueuedJob[]=[];
 private running=false;
 private sending:QueuedJob|null=null;
 private lastSentAt=Number.NEGATIVE_INFINITY;
 private readonly gap:number;
 constructor(private readonly options:RoomInviteQueueOptions){this.gap=options.gap??INVITE_GAP_MS;}
 private now(){return this.options.now?.()??Date.now();}
 private wait(ms:number){return this.options.wait?this.options.wait(ms):new Promise<void>(resolve=>setTimeout(resolve,ms));}
 private set(job:InviteJob,state:InviteState){this.states.set(job.roomId+':'+job.code,state);this.options.changed?.();}
 state(roomId:string,code:string):InviteState|null{return this.states.get(roomId+':'+code)??null;}
 get pending(){return this.jobs.length;}
 /** Returns false when this friend is already queued, sending or invited to this room. */
 enqueue(roomId:string,code:string):boolean{
  const state=this.state(roomId,code);if(state&&state!=='failed')return false;
  const job={roomId,code,requestId:this.options.randomId(),tries:0};this.jobs.push(job);this.set(job,'queued');void this.run();return true;
 }
 /** Drops queued (not yet sending) invites for a room the player has left. */
 cancel(roomId:string){const dropped=this.jobs.filter(job=>job.roomId===roomId&&job!==this.sending);if(!dropped.length)return;this.jobs=this.jobs.filter(job=>!dropped.includes(job));for(const job of dropped)this.states.delete(job.roomId+':'+job.code);this.options.changed?.();}
 private async run(){
  if(this.running)return;this.running=true;
  try{
   while(this.jobs.length){
    const job=this.jobs[0],delay=this.lastSentAt+this.gap-this.now();
    if(delay>0)await this.wait(delay);
    if(this.jobs[0]!==job)continue;
    this.set(job,'sending');this.sending=job;
    try{await this.options.send({roomId:job.roomId,code:job.code,requestId:job.requestId});this.lastSentAt=this.now();this.jobs.shift();this.set(job,'sent');this.options.sent?.(job);}
    catch(error){
     this.lastSentAt=this.now();
     if(rateLimited(error)&&job.tries<2){job.tries++;this.set(job,'queued');continue;}
     this.jobs.shift();this.set(job,'failed');this.options.failed?.(error,job);
    }finally{this.sending=null;}
   }
  }finally{this.running=false;}
 }
}

export type IncomingInvite={message:SocialMessage;peer:SocialPlayer};
/** The newest unread room invite worth a banner: from a friend, not yet shown, recent, and not for the room the player is in. */
export function pickIncomingInvite(state:SocialSnapshot|null,seen:ReadonlySet<number>,currentRoomId:string|null,maxAge=INVITE_BANNER_MAX_AGE_MS):IncomingInvite|null{
 if(!state)return null;let best:IncomingInvite|null=null;
 for(const item of state.conversations){
  const message=item.lastMessage;
  if(message.kind!=='room-invite'||message.mine||item.unread<=0||!message.roomId||seen.has(message.id))continue;
  if(message.roomId===currentRoomId)continue;
  // Age on the server clock, so a phone with a wrong clock still drops stale invites.
  const age=(state.serverTime||Date.now())-message.sentAt;if(!(age<=maxAge))continue;
  if(!best||message.id>best.message.id)best={message,peer:item.peer};
 }
 return best;
}

type Storage={get(key:string):string|null;set(key:string,value:string):void};
/** Remembers which invites already popped up, across restarts (message ids are global). */
export class InviteSeenStore{
 private ids:number[]=[];private readonly set=new Set<number>();
 constructor(private readonly storage:Storage|undefined){try{const raw=storage?.get(INVITE_SEEN_KEY);const list=raw?JSON.parse(raw):[];if(Array.isArray(list))for(const id of list)if(Number.isSafeInteger(id)&&!this.set.has(id)){this.ids.push(id);this.set.add(id);}}catch{}}
 get seen():ReadonlySet<number>{return this.set;}
 has(id:number){return this.set.has(id);}
 add(id:number){if(this.set.has(id))return;this.ids.push(id);this.set.add(id);while(this.ids.length>SEEN_LIMIT)this.set.delete(this.ids.shift()!);try{this.storage?.set(INVITE_SEEN_KEY,JSON.stringify(this.ids));}catch{}}
}

/** Friends for the invite list: online first, then the most recently seen. */
export function inviteOrder(friends:readonly SocialPlayer[]){return [...friends].sort((a,b)=>Number(b.online)-Number(a.online)||(b.lastSeenAt??0)-(a.lastSeenAt??0));}
