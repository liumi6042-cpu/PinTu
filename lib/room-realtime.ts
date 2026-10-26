import type {RoomUpdate} from './room-sync';
import type {CursorInput,SharedCursor} from './room-cursors';
import type {RoomPreview} from './room-preview';

export type CursorSnapshot={cursors:SharedCursor[];serverTime?:number};
export const CHEER_EMOTES=['clap','popper','heart','star','tea','cat'] as const;
export type CheerEmote=typeof CHEER_EMOTES[number];
export type Cheer={seq:number;id:string;playerId:string;name:string;emote:CheerEmote;at:number};
export type CheerSnapshot={cheers:Cheer[];cursor:number;serverTime:number};
/** Shared validation for ephemeral WS pushes and HTTP fallback responses. */
export function parseCheerSnapshot(value:unknown):CheerSnapshot|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const data=value as CheerSnapshot;
 if(!Array.isArray(data.cheers)||data.cheers.length>60||!Number.isSafeInteger(data.cursor)||!Number.isFinite(data.serverTime))return null;
 const cheers=data.cheers.filter((item):item is Cheer=>!!item&&typeof item==='object'&&!Array.isArray(item)&&
  Number.isSafeInteger(item.seq)&&typeof item.id==='string'&&/^[a-f0-9]{32}$/.test(item.id)&&typeof item.playerId==='string'&&typeof item.name==='string'&&CHEER_EMOTES.includes(item.emote)&&Number.isFinite(item.at));
 return {cheers,cursor:data.cursor,serverTime:data.serverTime};
}
export type RealtimeActionInput={id:string;clientId:string;gestureId:string;ordinal:number;action:{type:'claim'|'move'|'drop'|'release';groupId:number;seq?:number;dx?:number;dy?:number};since?:number};
export type RealtimeActionReply={status:number;data:any};
export type RealtimeActionError=Error&{code:string;sent:boolean};
export type RealtimeSocket={readonly bufferedAmount?:number;send(data:string):void;close():void};
export type RealtimeSocketHandlers={open():void;message(data:string):void;close():void;error():void};
export type RealtimeRoomStream={
 readonly preview?:RoomPreview;
 readonly connected:boolean;
 readonly actionsReady?:boolean;
 readonly actionsDiagnosticOnly?:boolean;
 readonly pendingActionCount?:number;
 sendAction?(input:RealtimeActionInput):Promise<RealtimeActionReply>;
 resetActions?():void;
 subscribeRoom(listener:(data:RoomUpdate)=>void):()=>void;
 subscribeCursors(listener:(data:CursorSnapshot)=>void):()=>void;
 subscribeCheers?(listener:(data:CheerSnapshot)=>void):()=>void;
 subscribeState(listener:(connected:boolean)=>void):()=>void;
 sendCursor(data:CursorInput):boolean;
 sendCheer?(data:{id:string;emote:CheerEmote}):boolean;
};
export type ManagedRoomRealtime=RealtimeRoomStream&{start():void;setHidden(hidden:boolean):void;close():void;diagnostics():Record<string,unknown>;setPreviewSendHz?(hz:number):void;resetPreviewStats?():void};
type Credentials={roomId:string;token:string;session?:string;since?:number};
type Options={url:string;credentials():Promise<Credentials>;openSocket:(url:string,handlers:RealtimeSocketHandlers)=>RealtimeSocket;now?:()=>number;random?:()=>number};
const actionError=(code:string,sent:boolean)=>Object.assign(new Error(code),{code,sent}) as RealtimeActionError;
const actionInteger=(value:unknown,min=0):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=2147483647;
const actionId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const validAction=(input:RealtimeActionInput)=>{
 const action=input?.action;
 return actionId(input?.id)&&actionId(input?.clientId)&&actionId(input?.gestureId)&&actionInteger(input?.ordinal,1)&&
  (input.since===undefined||Number.isSafeInteger(input.since)&&input.since>=0)&&action&&typeof action==='object'&&!Array.isArray(action)&&['claim','move','drop','release'].includes(action.type)&&actionInteger(action.groupId)&&
  (action.seq===undefined||actionInteger(action.seq,1))&&
  (action.dx===undefined||Number.isFinite(action.dx)&&Math.abs(action.dx)<=20000)&&(action.dy===undefined||Number.isFinite(action.dy)&&Math.abs(action.dy)<=20000)&&
  (!['move','drop'].includes(action.type)||actionInteger(action.seq,1)&&Number.isFinite(action.dx)&&Number.isFinite(action.dy));
};

/** Authenticated room push; actions are explicitly advertised and never replayed. */
export class RoomRealtime implements RealtimeRoomStream{
 private socket:RealtimeSocket|null=null;private generation=0;private stopped=true;private hidden=false;private terminal=false;private joining=false;private online=false;
 private retry:ReturnType<typeof setTimeout>|null=null;private watchdog:ReturnType<typeof setInterval>|null=null;private handshake:ReturnType<typeof setTimeout>|null=null;
 private failures=0;private lastMessage=0;private lastPing=0;private boundRoom='';
 private actionCapability=false;
 private actionDiagnosticOnly=true;
 private pendingActions=new Map<string,{resolve:(reply:RealtimeActionReply)=>void;reject:(error:RealtimeActionError)=>void;timer:ReturnType<typeof setTimeout>}>();
 private roomListeners=new Set<(data:RoomUpdate)=>void>();private cursorListeners=new Set<(data:CursorSnapshot)=>void>();private stateListeners=new Set<(connected:boolean)=>void>();
 private cheerListeners=new Set<(data:CheerSnapshot)=>void>();
 private counts={connections:0,roomMessages:0,cursorMessages:0,sentCursors:0,cheerMessages:0,sentCheers:0,cheerErrors:0,reconnects:0};private lastError='';
 private readonly options:Options;
 constructor(options:Options){this.options=options;}
 get connected(){return this.online;}
 get actionsReady(){return this.online&&this.actionCapability&&!this.stopped&&!this.hidden;}
 get actionsDiagnosticOnly(){return this.actionsReady?this.actionDiagnosticOnly:true;}
 get pendingActionCount(){return this.pendingActions.size;}
 resetActions(){this.disconnect(true,'ACTION_TRANSPORT_RESET');}
 subscribeRoom(listener:(data:RoomUpdate)=>void){this.roomListeners.add(listener);return()=>{this.roomListeners.delete(listener);};}
 subscribeCursors(listener:(data:CursorSnapshot)=>void){this.cursorListeners.add(listener);return()=>{this.cursorListeners.delete(listener);};}
 subscribeCheers(listener:(data:CheerSnapshot)=>void){this.cheerListeners.add(listener);return()=>{this.cheerListeners.delete(listener);};}
 subscribeState(listener:(connected:boolean)=>void){this.stateListeners.add(listener);return()=>{this.stateListeners.delete(listener);};}
 private now(){return this.options.now?.()??Date.now();}
 private state(value:boolean){if(this.online===value)return;this.online=value;for(const listener of this.stateListeners)listener(value);}
 diagnostics(){return {...this.counts,connected:this.online,actionsReady:this.actionsReady,actionsDiagnosticOnly:this.actionsDiagnosticOnly,pendingActions:this.pendingActions.size,hidden:this.hidden,terminal:this.terminal,lastError:this.lastError};}
 start(){if(!this.stopped)return;this.stopped=false;void this.connect();}
 setHidden(hidden:boolean){if(this.hidden===hidden)return;this.hidden=hidden;if(hidden)this.disconnect(false);else if(!this.stopped&&!this.terminal)void this.connect();}
 private clearTimers(){if(this.retry)clearTimeout(this.retry);if(this.watchdog)clearInterval(this.watchdog);if(this.handshake)clearTimeout(this.handshake);this.retry=null;this.watchdog=null;this.handshake=null;}
 private disconnect(retry:boolean,code='ACTION_CONNECTION_LOST'){
  this.generation++;this.joining=false;this.clearTimers();const socket=this.socket;this.socket=null;this.actionCapability=false;this.actionDiagnosticOnly=true;
  for(const pending of this.pendingActions.values()){clearTimeout(pending.timer);pending.reject(actionError(code,true));}this.pendingActions.clear();
  this.state(false);try{socket?.close();}catch{}
  if(retry&&!this.stopped&&!this.hidden&&!this.terminal){const delay=Math.min(15000,500*2**Math.min(5,this.failures++))*(.8+(this.options.random?.()??Math.random())*.4);this.retry=setTimeout(()=>{this.retry=null;void this.connect();},delay);}
 }
 private async connect(){
  if(this.stopped||this.hidden||this.terminal||this.socket||this.joining)return;
  this.joining=true;const generation=++this.generation;
  try{
   const credentials=await this.options.credentials();
   if(this.stopped||this.hidden||generation!==this.generation)return;
   if(!/^[a-f0-9]{32}$/.test(credentials.roomId)||!/^[a-f0-9]{32}$/.test(credentials.token)||(credentials.session!==undefined&&!/^[a-f0-9]{64}$/.test(credentials.session)))throw Error('invalid-room-credentials');
   this.boundRoom=credentials.roomId;this.counts.connections++;if(this.counts.connections>1)this.counts.reconnects++;
   const current=()=>!this.stopped&&!this.hidden&&generation===this.generation;
   const failed=(reason:string)=>{if(!current())return;this.lastError=reason;this.disconnect(true);};
   this.handshake=setTimeout(()=>failed('connection-timeout'),7000);
   this.socket=this.options.openSocket(this.options.url,{
    open:()=>{if(!current())return;try{this.socket?.send(JSON.stringify({type:'subscribe',...credentials}));}catch{failed('send-failed');}},
    message:data=>{if(!current())return;try{this.receive(data);}catch{failed('invalid-message');}},
    close:()=>failed('connection-closed'),error:()=>failed('connection-error'),
   });
   this.lastMessage=this.now();this.lastPing=this.lastMessage;
   this.watchdog=setInterval(()=>{if(!current())return;const now=this.now();if(now-this.lastMessage>30000){failed('connection-stale');return;}if(this.online&&now-this.lastPing>=15000){this.lastPing=now;try{this.socket?.send('{"type":"ping"}');}catch{failed('send-failed');}}},5000);
  }catch{if(generation===this.generation){this.lastError='connection-unavailable';this.disconnect(true);}}
  finally{if(generation===this.generation)this.joining=false;}
 }
 private receive(raw:string){
  if(typeof raw!=='string'||raw.length>1024*1024)throw Error('message-too-large');
  const message=JSON.parse(raw);if(!message||typeof message!=='object')throw Error('invalid-message');this.lastMessage=this.now();
  if(message.type==='ready'){
   if(this.handshake)clearTimeout(this.handshake);this.handshake=null;this.failures=0;this.lastError='';this.actionCapability=message.actions?.version===1&&typeof message.actions?.diagnosticOnly==='boolean';this.actionDiagnosticOnly=this.actionCapability?message.actions.diagnosticOnly:true;this.state(true);return;
  }
  if(message.type==='action-result'){
   if(!actionId(message.id)||!Number.isInteger(message.status)||message.status<200||message.status>599||!Object.hasOwn(message,'data'))throw Error('invalid-action-result');
   const pending=this.pendingActions.get(message.id);if(!pending)return;this.pendingActions.delete(message.id);clearTimeout(pending.timer);pending.resolve({status:message.status,data:message.data});return;
  }
  if(message.type==='pong')return;
  if(message.type==='cheer-error'){this.counts.cheerErrors++;return;}
  if(message.type==='cheers'){
   const data=parseCheerSnapshot(message.data);if(!data)return;
   this.counts.cheerMessages++;for(const listener of this.cheerListeners){try{listener(data);}catch{}}return;
  }
  if(message.type==='error'){
   if([401,403,404,410].includes(message.status))this.terminal=true;
   this.lastError=typeof message.code==='string'?message.code:'server-error';this.disconnect(true);return;
  }
  if(message.type==='room'){
   const data=message.data;
   if(!data||data.id!==this.boundRoom||!Number.isSafeInteger(data.revision)||!Number.isFinite(data.serverTime)||!Array.isArray(data.members)||!data.leases||
    (data.kind==='delta'?(!Array.isArray(data.groups)||!Array.isArray(data.removed)||!Number.isSafeInteger(data.baseRevision)):!Array.isArray(data.puzzle?.groups)))throw Error('invalid-room-update');
   this.counts.roomMessages++;for(const listener of this.roomListeners)listener(data as RoomUpdate);return;
  }
  if(message.type==='cursors'){
   const data=message.data;if(!data||!Array.isArray(data.cursors)||data.cursors.length>128||(data.serverTime!==undefined&&!Number.isFinite(data.serverTime)))throw Error('invalid-cursors');
   this.counts.cursorMessages++;for(const listener of this.cursorListeners)listener(data as CursorSnapshot);
  }
 }
 async sendAction(input:RealtimeActionInput):Promise<RealtimeActionReply>{
  if(!validAction(input))throw actionError('INVALID_ACTION_INPUT',false);
  if(!this.actionsReady||!this.socket)throw actionError('ACTION_TRANSPORT_UNAVAILABLE',false);
  if(this.pendingActions.has(input.id))throw actionError('ACTION_ID_PENDING',false);
  if(this.pendingActions.size>=64||(this.socket.bufferedAmount??0)>64*1024)throw actionError('ACTION_BACKPRESSURE',false);
  const raw=JSON.stringify({...input,type:'action'});if(raw.length>4096)throw actionError('ACTION_MESSAGE_TOO_LARGE',false);
  return new Promise<RealtimeActionReply>((resolve,reject)=>{
   const timer=setTimeout(()=>{if(!this.pendingActions.has(input.id))return;this.lastError='action-timeout';this.disconnect(true,'ACTION_TIMEOUT');},8000);
   this.pendingActions.set(input.id,{resolve,reject,timer});
   try{this.socket!.send(raw);}catch{this.lastError='action-send-failed';this.disconnect(true,'ACTION_SEND_FAILED');}
  });
 }
 sendCursor(data:CursorInput){if(!this.online||!this.socket||this.hidden||this.stopped)return false;try{this.socket.send(JSON.stringify({type:'cursor',data}));this.counts.sentCursors++;return true;}catch{this.disconnect(true);return false;}}
 sendCheer(data:{id:string;emote:CheerEmote}){if(!this.online||!this.socket||this.hidden||this.stopped)return false;try{this.socket.send(JSON.stringify({type:'cheer',data}));this.counts.sentCheers++;return true;}catch{this.disconnect(true);return false;}}
 close(){if(this.stopped)return;this.stopped=true;this.disconnect(false);this.roomListeners.clear();this.cursorListeners.clear();this.cheerListeners.clear();this.stateListeners.clear();}
}
