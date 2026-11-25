import type {CursorInput,SharedCursor} from '../lib/room-cursors';
import type {RoomSnapshot} from '../lib/room-engine';
import type {CheerEmote,CheerSnapshot,ManagedRoomRealtime,RealtimeActionInput,RealtimeActionReply} from '../lib/room-realtime';
import {applyRoomUpdate} from '../lib/room-sync';
import type {MovePreview,RoomPreview,TapPreviewDescriptor} from '../lib/room-preview';
import {validTapPlatformId,normalizeTapPlatformId} from '../lib/tap-platform-id.mjs';

export type TapBattleManager={registerListener(listener:Record<string,(data:any)=>void>):void;unregisterListener?(listener:Record<string,(data:any)=>void>):void;[method:string]:unknown};
type PreviewSnapshot=RoomSnapshot&{tapPreview?:TapPreviewDescriptor};
type Options={authority:ManagedRoomRealtime;manager:()=>TapBattleManager|undefined;request:(body:Record<string,unknown>)=>Promise<TapPreviewDescriptor&{canCreate?:boolean}>;room:RoomSnapshot;playerId:string;randomId:()=>string;now?:()=>number;sendHz?:number;onDisconnect?:()=>void};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const platformId=(v:unknown):v is string=>validTapPlatformId(v);
const point=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=20000);
const managers=new WeakMap<TapBattleManager,{owner:object;released:Promise<void>}>();
type PreviewFailure=Error&{previewStage:string;previewReason:string;platformErrno?:string};
// 只保留步骤、错误类别和短错误码，不保存平台原始消息或任何身份凭据。
function failure(stage:string,reason:string,raw?:any):PreviewFailure{
 const value=raw?.errno??raw?.errCode??raw?.code??raw?.errorCode,code=typeof value==='number'||typeof value==='string'?String(value):'';
 const message=String(raw?.errMsg??raw?.message??raw?.errorMessage??'');
 const category=code==='TAP_PREVIEW_ALREADY_CONNECTED'?'binding-busy':/not supported|unsupported|not implemented|不支持/i.test(message)?'unsupported':/not enabled|not activated|未开通|未开启/i.test(message)?'service-disabled':/unauthori[sz]ed|forbidden|鉴权失败|无权限/i.test(message)?'denied':/timeout|timed out|超时/i.test(message)?'timeout':/network|网络/i.test(message)?'network':reason;
 return Object.assign(Error(stage+'-'+category),{previewStage:stage,previewReason:category,...(/^-?\d{1,10}$|^[A-Z][A-Z0-9_]{0,39}$/.test(code)?{platformErrno:code}:{})});
}
const phaseNames:Record<string,string>={'get-manager':'检测多人接口',listener:'注册事件',connect:'连接平台',reserve:'登记成员',createRoom:'创建平台房间',publish:'登记平台房间',joinRoom:'加入平台房间',ready:'确认入房',renew:'续期绑定',messages:'验证双方消息',sendCustomMessage:'发送平台消息','service-event':'平台连接事件'};
const reasonNames:Record<string,string>={'binding-busy':'旧连接登记尚未释放，等待自动重试','missing-api':'宿主未提供多人接口','missing-method':'宿主缺少此接口','missing-listener':'宿主缺少事件接口',failed:'调用失败',threw:'调用异常',unsupported:'接口不支持','service-disabled':'服务未开通',denied:'权限被拒绝',timeout:'调用超时',network:'网络失败','invalid-player-id':'返回玩家编号无效','invalid-channel':'返回房间编号无效'};
function detail(error:PreviewFailure){return (phaseNames[error.previewStage]??error.previewStage)+'：'+(reasonNames[error.previewReason]??error.previewReason)+(error.platformErrno?'（码 '+error.platformErrno+'）':'');}
const payloadMethods=new Set(['connect','createRoom','joinRoom']);
function nativePayload(method:string,value:any){
 // 兼容桥接的一层 data 包装，不递归搜索其他账号或身份字段。
 const field=method==='connect'?'playerId':'roomInfo',source=value?.[field]===undefined?value?.data:value;
 const key=normalizeTapPlatformId(method==='connect'?source?.playerId:source?.roomInfo?.id);
 return key===null?null:method==='connect'?{playerId:key}:{roomInfo:{id:key}};
}
function responseShape(method:string,source:string,value:any){
 const shape=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v==='string'?'string('+v.length+')':typeof v;
 // 只显示固定字段的类型与长度，不保留字段值或原始响应。
 return method+'/'+source+'：root='+shape(value)+(method==='connect'?',playerId='+shape(value?.playerId)+',data.playerId='+shape(value?.data?.playerId):',roomInfo.id='+shape(value?.roomInfo?.id)+',data.roomInfo.id='+shape(value?.data?.roomInfo?.id));
}
const valueShape=(value:unknown)=>value===null?'null':Array.isArray(value)?'array':typeof value==='string'?'string('+value.length+')':typeof value;
/** Fixed bridge envelopes only. Sender identity must still come from the platform event. */
function customPayload(event:any){
 let source=event,envelope='root';
 if(typeof source==='string'){if(source.length>8192)return {shape:'event-too-large'};try{source=JSON.parse(source);envelope='json';}catch{return {shape:'invalid-event-json'};}}
 if(!source||typeof source!=='object'||Array.isArray(source))return {shape:'event='+valueShape(source)};
 if(source.playerId===undefined&&source.fromPlayerId===undefined&&source.data&&typeof source.data==='object'&&!Array.isArray(source.data)){source=source.data;envelope+='.data';}
 const sender=source.playerId??source.fromPlayerId;
 // H5 文档使用 message，原生 SDK 使用 msg；只接受固定桥接位置，不递归猜测正文或发送者。
 const data=source.data&&typeof source.data==='object'&&!Array.isArray(source.data)?source.data:undefined;
 const candidates=[['message',source.message],['msg',source.msg],['data.message',data?.message],['data.msg',data?.msg],['data',source.data]] as const;
 const selected=candidates.find(([,value])=>value!==undefined);
 let message=selected?.[1];
 // 仅记录固定候选字段的类型和长度，不记录正文、任意字段名或身份值。
 const shape=envelope+': sender='+valueShape(sender)+',body='+(selected?.[0]??'none')+','+candidates.map(([key,value])=>key+'='+valueShape(value)).join(',');
 // The official event documents message:any. Some bridges parse the JSON body already.
 if(message&&typeof message==='object'&&!Array.isArray(message)){
  try{message=JSON.stringify(message);}catch{return {shape:shape+',invalid-message-json'};}
 }
 return {shape,raw:message,from:normalizeTapPlatformId(sender)};
}
const fallbackDetails:Record<string,string>={'message-handshake-timeout':'双方消息验证超时，已回退原通道','background':'切到后台后已回退原通道','peer-offline':'拼友掉线，已回退原通道','peer-left':'拼友离开，已回退原通道','preview-disabled':'房间未启用平台预览','channel-changed':'平台房间已变化，已回退原通道'};

/** Platform messages are disposable previews. Only the original stream can ACK actions. */
export class TapPreviewRealtime implements ManagedRoomRealtime{
 readonly preview:RoomPreview;
 private opts:Options;private room:PreviewSnapshot;private observedAt:number;private meta:TapPreviewDescriptor|null=null;
 private manager:TapBattleManager|undefined;private clientId:string;private nonce:string;private tapPlayerId='';private joined=false;private stopped=true;private closed=false;private hidden=false;private generation=0;
 private timer:ReturnType<typeof setTimeout>|null=null;private renewal:ReturnType<typeof setInterval>|null=null;
 private listeners:Record<string,(data:any)=>void>|null=null;private cleanups:Array<()=>void>=[];private releaseManager:(()=>void)|null=null;private unsafeNative=false;private cleaning=false;
 private seq=0;private cursor:CursorInput|null=null;private drag:{groupId:number;dx:number;dy:number;leaseId:string}|null=null;private dirty=false;private sentAt=-Infinity;
 private moves=new Map<string,MovePreview>();private cursors=new Map<string,SharedCursor>();private receivedSeq=new Map<string,number>();
 private heard=new Map<string,{nonce:string;at:number}>();private confirmed=new Map<string,number>();private probingAt:number|null=null;
 private moveListeners=new Set<(moves:MovePreview[])=>void>();private cursorListeners=new Set<(snapshot:{cursors:SharedCursor[];serverTime?:number})=>void>();
 private counts={platformSent:0,platformSucceeded:0,platformFailed:0,platformDragSent:0,platformReceived:0,platformCallbacks:0,rejected:0,platformBytesSent:0,platformBytesReceived:0};private error='';private errorInfo:PreviewFailure|null=null;private phase='idle';private lastReady=false;private responseInfo='';
 private eventShape='';private ignored={notReady:0,payload:0,sender:0,binding:0,duplicate:0,frame:0};
 private sendHz:number|null=null;private statsSince=0;private statsGeneration=0;private sendTimes:number[]=[];private sendPeak=0;private lastSendError='';
 private peerStats=new Map<string,{name:string;total:number;times:number[]}>();
 private sending=false;
 private nativeOperations=new Set<Promise<any>>();
 private apiOperations=new Set<Promise<any>>();private binding:{clientId:string;tapPlayerId:string;epoch:string}|null=null;
 private cleanupTask:Promise<void>|null=null;private retryTimer:ReturnType<typeof setTimeout>|null=null;private retryAt=0;private recoveryAttempts=0;private recoveryCount=0;
 constructor(options:Options){
  this.opts=options;this.room=options.room;this.observedAt=this.now();this.clientId=options.randomId();this.nonce=options.randomId();this.acceptMeta((options.room as PreviewSnapshot).tapPreview);
  this.statsSince=this.now();if([4,10,15].includes(options.sendHz!))this.sendHz=options.sendHz!;
  const owner=this;this.preview={get connected(){return owner.previewReady;},sendMove:(...args)=>this.sendMove(...args),clearMove:id=>this.clearMove(id),observe:s=>this.observe(s),subscribeMoves:fn=>this.subscribeMoves(fn)};
  this.cleanups.push(options.authority.subscribeRoom(update=>{const room=applyRoomUpdate(this.room,update);if(room)this.observe(room);}),options.authority.subscribeCursors(data=>{if(!this.previewReady)for(const fn of this.cursorListeners)fn(data);}),options.authority.subscribeState(connected=>{if(!connected)this.deactivate();else{this.refresh();this.scheduleRecovery();}}));
 }
 private now(){return this.opts.now?.()??Date.now();}
 // Room/action availability always means the authoritative connection, never a platform ACK.
 get connected(){return this.opts.authority.connected;}
 get actionsReady(){return this.opts.authority.actionsReady;}
 get actionsDiagnosticOnly(){return this.opts.authority.actionsDiagnosticOnly;}
 get pendingActionCount(){return this.opts.authority.pendingActionCount;}
 private get rosterReady(){
  if(this.stopped||this.hidden||!this.joined||!this.connected||this.room.completedAt!==null||!this.meta?.channelId)return false;
  const members=this.activeMembers();return members.length>0&&members.every(m=>this.meta!.peers.filter(p=>p.playerId===m.id&&p.ready).length===1)&&this.meta.peers.some(p=>p.clientId===this.clientId&&p.playerId===this.opts.playerId&&p.ready);
 }
 get previewReady(){return this.rosterReady&&this.meta!.peers.filter(p=>p.ready&&p.clientId!==this.clientId&&this.activeMembers().some(m=>m.id===p.playerId)).every(p=>this.now()-(this.confirmed.get(p.clientId)??-Infinity)<3500);}
 private serverNow(){return this.room.serverTime+Math.max(0,this.now()-this.observedAt);}
 private activeMembers(){return this.room.members.filter(m=>m.lastSeen>0&&this.serverNow()-m.lastSeen<22000);}
 subscribeRoom:ManagedRoomRealtime['subscribeRoom']=fn=>this.opts.authority.subscribeRoom(fn);
 subscribeState:ManagedRoomRealtime['subscribeState']=fn=>this.opts.authority.subscribeState(fn);
 subscribeCheers(fn:(data:CheerSnapshot)=>void){return this.opts.authority.subscribeCheers?.(fn)??(()=>{});}
 sendCheer(data:{id:string;emote:CheerEmote}){return this.opts.authority.sendCheer?.(data)??false;}
 subscribeCursors:ManagedRoomRealtime['subscribeCursors']=fn=>{this.cursorListeners.add(fn);return()=>{this.cursorListeners.delete(fn);};};
 subscribeMoves(fn:(moves:MovePreview[])=>void){this.moveListeners.add(fn);return()=>{this.moveListeners.delete(fn);};}
 async sendAction(input:RealtimeActionInput):Promise<RealtimeActionReply>{
  const reply=await this.opts.authority.sendAction!(input);
  if(reply.status>=200&&reply.status<300){const merged=applyRoomUpdate(this.room,reply.data);if(merged)this.observe(merged);}
  return reply;
 }
 resetActions(){this.opts.authority.resetActions?.();this.deactivate();}
 sendCursor(data:CursorInput){this.cursor=data;if(this.previewReady){this.dirty=true;this.scheduleTick();return true;}return this.opts.authority.sendCursor(data);}
 sendMove(groupId:number,dx:number,dy:number){
  const lease=this.room.leases[groupId];
  if(!this.previewReady||lease?.playerId!==this.opts.playerId||lease.expires<=this.serverNow()||!id(lease.previewId)||!point([dx,dy]))return false;
  this.drag={groupId,dx,dy,leaseId:lease.previewId};this.dirty=true;this.scheduleTick();return true;
 }
 clearMove(groupId:number){if(this.drag?.groupId===groupId){this.drag=null;this.dirty=true;this.scheduleTick();}}
 // 频率切换仅由独立自测设置入口调用；握手/心跳也计入同一个发送预算。
 setPreviewSendHz(hz:number){if(![4,10,15].includes(hz))return;this.sendHz=hz;this.scheduleTick();}
 resetPreviewStats(){
  this.statsGeneration++;this.statsSince=this.now();for(const key of Object.keys(this.counts) as Array<keyof typeof this.counts>)this.counts[key]=0;
  this.sendTimes=[];this.sendPeak=0;this.lastSendError='';this.peerStats.clear();
  for(const key of Object.keys(this.ignored) as Array<keyof typeof this.ignored>)this.ignored[key]=0;
 }
 private recent(times:number[]){while(times.length&&this.now()-times[0]>=1000)times.shift();return times.length;}
 private sendInterval(){return this.previewReady?1000/(this.sendHz??Math.max(1,Math.min(4,Math.floor(10/this.activeMembers().length)))):1000;}
 private scheduleTick(){
  if(this.timer)clearTimeout(this.timer);this.timer=null;
  if(this.stopped||this.hidden||!this.joined||this.cleaning||this.sending)return;
  const delay=!this.rosterReady||this.activeMembers().length<2?100:Math.max(1,Math.ceil((this.previewReady&&this.dirty?this.sendInterval():1000)-(this.now()-this.sentAt)));
  this.timer=setTimeout(()=>{this.timer=null;this.tick();this.scheduleTick();},delay);
 }
 observe(snapshot:RoomSnapshot){
  if(snapshot.id!==this.room.id||snapshot.revision<this.room.revision)return;
  this.room=snapshot;this.observedAt=this.now();this.acceptMeta((snapshot as PreviewSnapshot).tapPreview);
  if(this.drag&&this.room.leases[this.drag.groupId]?.previewId!==this.drag.leaseId)this.drag=null;
  this.refresh();
 }
 private acceptMeta(meta:TapPreviewDescriptor|undefined,fresh=false){
  if(!meta&&this.joined){this.meta=null;this.fail('preview-disabled');return;}
  if(!meta||meta.version!==1||typeof meta.testOnly!=='boolean'||!id(meta.epoch)||!Number.isSafeInteger(meta.serial)||!Array.isArray(meta.peers)||meta.peers.length>8)return;
  // 后端重启后计数会归零；只允许当前请求的直接响应确认新的通道代次。
  if(this.meta&&meta.serial<this.meta.serial&&!(fresh&&meta.epoch!==this.meta.epoch))return;
  if(this.joined&&this.meta?.epoch!==meta.epoch){this.meta=meta;this.fail('channel-changed');return;}
  this.meta=meta;
 }
 start(){if(!this.stopped||this.closed)return;this.stopped=false;this.opts.authority.start();this.launch();}
 private launch(){
  if(this.stopped||this.hidden||this.closed||this.cleaning||this.unsafeNative)return;
  this.error='';this.errorInfo=null;this.retryAt=0;const generation=++this.generation;
  void this.boot(generation).catch(error=>{if(!this.live(generation))return;const info=error?.previewStage?error:failure(this.phase,'failed',error);this.fail(info.message,info);});
 }
 private canRecover(){return !this.stopped&&!this.closed&&!this.hidden&&!this.unsafeNative&&!!this.error&&!!this.meta&&this.room.completedAt===null&&this.connected&&!['preview-disabled'].includes(this.error)&&!['missing-api','missing-method','missing-listener','unsupported','service-disabled','denied'].includes(this.errorInfo?.previewReason??'');}
 private scheduleRecovery(){
  if(this.retryTimer||this.cleaning||!this.canRecover())return;
  // 慢退避等待旧登记的20秒租期，绝不强行顶掉同账号的其他在线设备。
  const delay=Math.min(15000,1000*2**Math.min(this.recoveryAttempts++,4));this.retryAt=this.now()+delay;
  this.retryTimer=setTimeout(()=>{this.retryTimer=null;if(!this.canRecover()){this.retryAt=0;return;}this.recoveryCount++;this.clientId=this.opts.randomId();this.nonce=this.opts.randomId();this.probingAt=null;this.heard.clear();this.confirmed.clear();this.receivedSeq.clear();this.sentAt=-Infinity;this.launch();},delay);
 }
 setHidden(hidden:boolean){this.hidden=hidden;this.opts.authority.setHidden(hidden);if(hidden){this.deactivate();this.fail('background');}else this.scheduleRecovery();}
 private live(generation:number){return !this.stopped&&!this.hidden&&generation===this.generation;}
 private async api(op:string,extra:Record<string,unknown>={}){
  const generation=this.generation,clientId=this.clientId,tapPlayerId=this.tapPlayerId;
  const operation=Promise.resolve().then(()=>this.opts.request({op,clientId,tapPlayerId,...(this.meta?{epoch:this.meta.epoch}:{}),...extra}));
  this.apiOperations.add(operation);
  let response:TapPreviewDescriptor&{canCreate?:boolean};
  try{response=await operation;}catch(error){throw failure(op,'failed',error);}finally{this.apiOperations.delete(operation);}
  // 退出时迟到的登记响应也必须记录，清理流程会等请求结束后再注销。
  if(response.peers.some(p=>p.clientId===clientId&&p.tapPlayerId===tapPlayerId))this.binding={clientId,tapPlayerId,epoch:response.epoch};
  if(this.live(generation)&&!this.cleaning)this.acceptMeta(response,op==='reserve');return response;
 }
 private native(method:string,args:Record<string,unknown>={},timeout=5000):Promise<any>{
  const manager=this.manager,fn=manager?.[method];if(typeof fn!=='function')return Promise.reject(failure(method,'missing-method'));
  const operation=new Promise<any>((resolve,reject)=>{
   let settled=false,invalidReply=false;const finish=(error:PreviewFailure|null,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
   // Native calls cannot be cancelled. A timeout prevents this singleton being reused.
   const timer=setTimeout(()=>{this.unsafeNative=true;finish(failure(method,invalidReply?(method==='connect'?'invalid-player-id':'invalid-channel'):'timeout'));},timeout);
   const accept=(value:any,source:string)=>{
    if(settled)return;
    if(payloadMethods.has(method)){
     this.responseInfo=responseShape(method,source,value);const normalized=nativePayload(method,value);
     if(!normalized){invalidReply=true;return;}finish(null,normalized);
    }else if(source==='callback'||value!==undefined||['sendCustomMessage','leaveRoom','disconnect'].includes(method))finish(null,value);
   };
   try{
    const task=(fn as Function).call(manager,{...args,success:(value:any)=>accept(value,'callback'),fail:(raw:unknown)=>finish(failure(method,'failed',raw))});
    if(task&&typeof task.then==='function')task.then((value:any)=>accept(value,'promise'),(raw:unknown)=>finish(failure(method,'failed',raw)));
   }catch(raw){finish(failure(method,'threw',raw));}
  });
  this.nativeOperations.add(operation);void operation.then(()=>this.nativeOperations.delete(operation),()=>this.nativeOperations.delete(operation));return operation;
 }
 private async boot(generation:number){
  this.phase='get-manager';let manager:TapBattleManager|undefined;
  try{manager=this.opts.manager();}catch(raw){throw failure('get-manager','threw',raw);}
  if(!manager)throw failure('get-manager','missing-api');
  const previous=managers.get(manager);if(previous){let timer:ReturnType<typeof setTimeout>;try{await Promise.race([previous.released,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('manager-busy')),4000);})]);}finally{clearTimeout(timer!);}}
  if(!this.live(generation))return;
  if(managers.has(manager))throw Error('manager-busy');
  this.manager=manager;const released=new Promise<void>(resolve=>{this.releaseManager=resolve;});managers.set(manager,{owner:this,released});
  const custom=(name:string)=>(data:any)=>{if(this.live(generation))this.receiveCustom(data,name);};
  const disconnected=(raw:any)=>{if(!this.live(generation))return;const joined=this.joined;this.fail('disconnected',failure('service-event','failed',raw));if(joined)this.opts.onDisconnect?.();};
  const serviceError=(raw:any)=>{if(this.live(generation))this.fail('platform-error',failure('service-event','failed',raw));};
  const peer=(raw:any)=>{if(!this.live(generation))return;const sender=normalizeTapPlatformId(raw?.playerId??raw?.data?.playerId);if(sender&&sender===this.tapPlayerId){disconnected(raw);return;}for(const p of this.meta?.peers??[])if(p.tapPlayerId===sender){this.heard.delete(p.clientId);this.confirmed.delete(p.clientId);}this.refresh();};
  this.listeners={onCustomMessageReceived:custom('received'),onCustomMessage:custom('custom'),onDisconnected:disconnected,onBattleServiceError:serviceError,onPlayerOffline:peer,onPlayerLeft:peer,playerLeaveRoom:peer,onPlayerKicked:peer};
  this.phase='listener';if(typeof manager.registerListener!=='function')throw failure('listener','missing-listener');
  manager.registerListener(this.listeners);
  this.phase='connect';
  const connected=await this.native('connect');if(!this.live(generation))return;
  if(!platformId(connected?.playerId))throw failure('connect','invalid-player-id');this.tapPlayerId=connected.playerId;
  this.phase='reserve';
  let state=await this.api('reserve');if(!this.live(generation))return;
  for(let attempt=0;!state.channelId&&!state.canCreate&&attempt<45&&this.live(generation);attempt++){await new Promise(resolve=>setTimeout(resolve,300));if(!this.live(generation))return;state=await this.api('reserve');}
  if(!this.live(generation))return;
  if(state.canCreate){
   this.phase='createRoom';
   const created=await this.native('createRoom',{data:{roomCfg:{maxPlayerCount:8,type:'jigsaw-preview-v1',name:'拼图联机测试',customProperties:JSON.stringify({v:1,epoch:state.epoch}),matchParams:{level:'0',score:'0'}}}});
   if(!this.live(generation))return;const channelId=created?.roomInfo?.id;if(!platformId(channelId))throw failure('createRoom','invalid-channel');
   this.phase='publish';
   state=await this.api('publish',{channelId});
  }else{
   if(!state.channelId)throw Error('channel-pending');
   this.phase='joinRoom';const joined=await this.native('joinRoom',{data:{roomId:state.channelId}});if(joined?.roomInfo?.id!==state.channelId)throw failure('joinRoom','joined-channel-mismatch');
  }
  if(!this.live(generation))return;
  this.phase='ready';await this.api('ready',{channelId:state.channelId});if(!this.live(generation))return;
  this.joined=true;this.scheduleTick();let renewing=false;
  this.phase='messages';this.renewal=setInterval(()=>{if(renewing||!this.live(generation))return;renewing=true;void this.api('renew').then(()=>{if(this.live(generation))this.refresh();}).catch(error=>{if(this.live(generation))this.fail('binding-expired',error);}).finally(()=>{renewing=false;});},7000);
  this.refresh();
 }
 private receiveCustom(event:any,alias='received'){
  this.counts.platformCallbacks++;
  const parsed=customPayload(event),{raw,from}=parsed;this.eventShape=alias+'/'+parsed.shape;
  if(!this.rosterReady){this.ignored.notReady++;return;}
  if(typeof raw!=='string'||raw.length>2048||!/^[\x20-\x7e]+$/.test(raw)){this.ignored.payload++;return;}
  if(!platformId(from)){this.ignored.sender++;return;}
  try{
   const frame=JSON.parse(raw),binding=this.meta!.peers.find(p=>p.ready&&p.tapPlayerId===from&&p.clientId===frame.c);
   if(!binding||binding.playerId===this.opts.playerId){this.ignored.binding++;return;}
   if(frame.v!==1||frame.e!==this.meta!.epoch||!id(frame.n)||!Array.isArray(frame.a)||frame.a.length>8||!frame.a.every(id)||!Number.isSafeInteger(frame.s)||frame.s<=0||Object.keys(frame).some(k=>!['v','e','c','s','p','d','n','a'].includes(k)))throw Error();
   if(frame.s<=(this.receivedSeq.get(frame.c)??0)){this.ignored.duplicate++;return;}
   if(frame.p!==null&&!point(frame.p))throw Error();
   if(frame.d!==null&&(!Array.isArray(frame.d)||frame.d.length!==4||!Number.isSafeInteger(frame.d[0])||frame.d[0]<0||!point(frame.d.slice(1,3))||!id(frame.d[3])))throw Error();
   this.receivedSeq.set(frame.c,frame.s);this.counts.platformReceived++;this.counts.platformBytesReceived+=raw.length;
   const member=this.activeMembers().find(m=>m.id===binding.playerId);if(!member)return;
   const stats=this.peerStats.get(member.id)??{name:member.name,total:0,times:[]};stats.name=member.name;stats.total++;stats.times.push(this.now());this.recent(stats.times);this.peerStats.set(member.id,stats);
   this.heard.set(frame.c,{nonce:frame.n,at:this.now()});if(frame.a.includes(this.nonce))this.confirmed.set(frame.c,this.now());
   if(!this.previewReady){this.refresh();return;}
   if(frame.p)this.cursors.set(frame.c,{playerId:member.id,name:member.name,color:member.color,x:frame.p[0],y:frame.p[1],updatedAt:this.now()});else this.cursors.delete(frame.c);
   if(frame.d){const [groupId,dx,dy,leaseId]=frame.d,lease=this.room.leases[groupId],group=this.room.puzzle.groups.find(g=>g.id===groupId);
    if(lease?.playerId===member.id&&lease.expires>this.serverNow()&&lease.previewId===leaseId&&group&&!group.locked)this.moves.set(frame.c,{playerId:member.id,groupId,dx,dy,leaseId,receivedAt:this.now()});
   }
   this.refresh(true);
  }catch{this.counts.rejected++;this.ignored.frame++;}
 }
 private tick(){
  this.refresh();if(!this.rosterReady||this.activeMembers().length<2){this.probingAt=null;return;}if(this.sending)return;
  const ready=this.previewReady;
  if(ready){this.probingAt=null;this.recoveryAttempts=0;}else if(this.probingAt===null)this.probingAt=this.now();else if(this.now()-this.probingAt>6000){this.fail('message-handshake-timeout');return;}
  const interval=this.sendInterval();
  if(this.now()-this.sentAt<interval||ready&&!this.dirty&&this.now()-this.sentAt<1000)return;
  const raw=JSON.stringify({v:1,e:this.meta!.epoch,c:this.clientId,n:this.nonce,a:[...this.heard.values()].filter(p=>this.now()-p.at<3500).map(p=>p.nonce),s:++this.seq,p:ready&&this.cursor?.point?[this.cursor.point.x,this.cursor.point.y]:null,d:ready&&this.drag?[this.drag.groupId,this.drag.dx,this.drag.dy,this.drag.leaseId]:null});
  if(raw.length>2048){this.fail('message-too-large');return;}
  this.dirty=false;this.sentAt=this.now();this.counts.platformSent++;this.counts.platformBytesSent+=raw.length;
  if(ready&&this.drag)this.counts.platformDragSent++;this.sendTimes.push(this.now());this.sendPeak=Math.max(this.sendPeak,this.recent(this.sendTimes));
  const statsGeneration=this.statsGeneration,sendGeneration=this.generation;
  this.sending=true;void this.native('sendCustomMessage',{data:{msg:raw,type:0}},3000).then(()=>{if(statsGeneration===this.statsGeneration)this.counts.platformSucceeded++;}).catch(error=>{
   if(statsGeneration===this.statsGeneration){this.counts.platformFailed++;this.lastSendError=detail(error);}
   if(this.live(sendGeneration))this.fail('send-failed',error);
  }).finally(()=>{this.sending=false;this.scheduleTick();});
 }
 private refresh(force=false){
  const ready=this.previewReady;let changed=force;
  for(const [key,move]of this.moves){const lease=this.room.leases[move.groupId];if(!ready||this.now()-move.receivedAt>2500||lease?.playerId!==move.playerId||lease.expires<=this.serverNow()||lease.previewId!==move.leaseId){this.moves.delete(key);changed=true;}}
  for(const [key,cursor]of this.cursors)if(!ready||this.now()-cursor.updatedAt>2500){this.cursors.delete(key);changed=true;}
  for(const key of this.receivedSeq.keys())if(!this.meta?.peers.some(p=>p.clientId===key))this.receivedSeq.delete(key);
  for(const [key,value]of this.heard)if(this.now()-value.at>3500||!this.meta?.peers.some(p=>p.clientId===key)){this.heard.delete(key);this.confirmed.delete(key);}
  if(ready!==this.lastReady){this.lastReady=ready;changed=true;this.dirty=true;if(!ready){this.drag=null;if(this.cursor)this.opts.authority.sendCursor(this.cursor);}this.scheduleTick();}
  if(changed){for(const fn of this.moveListeners)fn([...this.moves.values()]);if(ready||!this.connected)for(const fn of this.cursorListeners)fn({cursors:[...this.cursors.values()],serverTime:this.now()});}
 }
 private deactivate(){this.lastReady=false;this.drag=null;this.moves.clear();this.cursors.clear();for(const fn of this.moveListeners)fn([]);for(const fn of this.cursorListeners)fn({cursors:[],serverTime:this.now()});}
 private fail(code:string,info?:PreviewFailure){
  if(this.cleaning||this.stopped)return;this.error=code;this.errorInfo=info??null;this.generation++;this.joined=false;
  if(this.timer)clearTimeout(this.timer);if(this.renewal)clearInterval(this.renewal);this.timer=this.renewal=null;
  if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;this.retryAt=0;
  this.refresh();void this.cleanupNative().then(()=>this.scheduleRecovery());
 }
 private cleanupNative():Promise<void>{
  if(this.cleanupTask)return this.cleanupTask;this.cleaning=true;const manager=this.manager,owned=!!manager&&managers.get(manager)?.owner===this;
  if(owned&&this.listeners){try{manager!.unregisterListener?.(this.listeners);}catch{}this.listeners=null;}
  this.cleanupTask=(async()=>{
   // 等待迟到登记/平台调用，再注销自己的绑定；不与下一实例或下一次重连交叉。
   await Promise.allSettled([...this.nativeOperations,...this.apiOperations]);
   const binding=this.binding;this.binding=null;
   if(binding)try{await this.opts.request({op:'leave',...binding});}catch{}
   if(owned){try{await this.native('leaveRoom',{},2000);}catch{}try{await this.native('disconnect',{},2000);}catch{}
    if(!this.unsafeNative&&managers.get(manager!)?.owner===this){managers.delete(manager!);this.releaseManager?.();}
   }
   this.manager=undefined;this.releaseManager=null;this.tapPlayerId='';
  })().finally(()=>{this.cleaning=false;this.cleanupTask=null;});return this.cleanupTask;
 }
 diagnostics(){
  const members=this.activeMembers(),missing=members.filter(m=>!this.meta?.peers.some(p=>p.playerId===m.id&&p.ready));
  const state=this.previewReady?'平台消息已双向验证':this.joined&&!this.connected?'等待原服务器连接':this.joined&&missing.length?'等待 '+missing.length+' 位玩家完成平台入房绑定':(phaseNames[this.phase]??this.phase);
  return {...this.opts.authority.diagnostics(),preview:'taptap-test',previewConnected:this.previewReady,previewRosterReady:this.rosterReady,previewSessionJoined:this.joined,previewMembersReady:members.length-missing.length,previewMembersTotal:members.length,previewMissingBindings:missing.map(m=>m.id===this.opts.playerId?'本机':m.name),previewPeersConfirmed:this.confirmed.size,previewError:this.error,previewStage:this.errorInfo?.previewStage??this.phase,previewDetail:(this.errorInfo?detail(this.errorInfo):this.error?(fallbackDetails[this.error]??'平台已回退：'+this.error):state)+(this.retryAt?'；'+Math.max(0,Math.ceil((this.retryAt-this.now())/1000))+'秒后自动重试':this.unsafeNative?'；平台调用未结束，请退出自测包后重进':''),previewErrno:this.errorInfo?.platformErrno??'',previewResponse:this.responseInfo,previewRecoveryCount:this.recoveryCount,previewRetrySeconds:this.retryAt?Math.max(0,Math.ceil((this.retryAt-this.now())/1000)):0,previewRecoveryBlocked:this.unsafeNative,...this.counts,previewEventShape:this.eventShape,previewIgnored:{...this.ignored},previewPeersExpected:Math.max(0,members.length-1),previewTargetHz:this.sendHz??Math.max(1,Math.min(4,Math.floor(10/Math.max(1,members.length)))),previewStatsSeconds:Math.floor((this.now()-this.statsSince)/1000),platformSendRate:this.recent(this.sendTimes),platformSendPeak:this.sendPeak,platformSendPending:this.sending,platformLastSendError:this.lastSendError,platformPeerReceives:[...this.peerStats.values()].map(p=>({name:p.name,total:p.total,hz:this.recent(p.times)}))};
 }
 close(){if(this.closed)return;this.closed=true;this.stopped=true;this.generation++;this.joined=false;if(this.timer)clearTimeout(this.timer);if(this.renewal)clearInterval(this.renewal);if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;this.retryAt=0;this.deactivate();void this.cleanupNative();for(const cleanup of this.cleanups)cleanup();this.cleanups=[];this.moveListeners.clear();this.cursorListeners.clear();this.opts.authority.close();}
}
