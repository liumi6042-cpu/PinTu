import type {RoomSnapshot} from './room-engine';
import type {RealtimeActionInput,RealtimeActionReply,RealtimeRoomStream} from './room-realtime';

type Position={dx:number;dy:number};
type Gesture={id:number;gestureId:string;seq:number;granted:boolean;ending:boolean;canceled:boolean;latest:Position|null;timer:ReturnType<typeof setTimeout>|null;lastMoveAt:number;movePending:number;generation:number;finished:Promise<void>;finish:()=>void;grant:(ok:boolean)=>void};
type Hooks={randomId:()=>string;now:()=>number;revision:()=>number;receive:(reply:RealtimeActionReply,input:RealtimeActionInput)=>void;profile?:(data:any)=>void;error:(error:Error&{status?:number;code?:string})=>void;reconcile:()=>Promise<void>;cancel:(id?:number)=>void;timing:(action:string,started:number,status?:number,serverMs?:number)=>void};

/** Capability-gated ordered writes. Sending is independent of acknowledgement;
 * no predicted connection/reward is created and no sent action is replayed. */
export class DiagnosticDragPipeline{
 private activated=false;private stopped=false;private recovering=false;private recovery:Promise<void>|null=null;
 private generation=0;private clientId='';private ordinal=0;private active:Gesture|null=null;
 private gestures=new Set<Gesture>();private latest=new Map<number,Gesture>();private cleanup:()=>void;
 private stream:RealtimeRoomStream;private hooks:Hooks;private diagnosticRoom:boolean;
 constructor(stream:RealtimeRoomStream,hooks:Hooks,diagnosticRoom=false){this.stream=stream;this.hooks=hooks;this.diagnosticRoom=diagnosticRoom;this.cleanup=stream.subscribeState(connected=>{
  if(!this.activated)return;
  if(!connected){this.recovering=true;this.invalidate();void this.reconcile();}
  else{this.clientId=this.hooks.randomId();this.ordinal=0;void this.reconcile();}
 });}
 get inUse(){return this.activated;}
 get available(){return this.stream.actionsReady===true&&!!this.stream.sendAction&&(this.diagnosticRoom||this.stream.actionsDiagnosticOnly===false);}
 get pending(){return this.gestures.size;}
 get holdingId(){return this.active?.id;}
 protectedIds(){return new Set([...this.latest.values()].filter(g=>!g.canceled).map(g=>g.id));}
 handles(id:number){return this.latest.has(id);}
 canAcquire(id:number){return !this.stopped&&!this.recovering&&this.available&&!this.active&&this.gestures.size<24&&(this.stream.pendingActionCount??0)<48&&(!this.latest.has(id)||this.latest.get(id)!.ending);}
 acquire(id:number):Promise<boolean>{
  if(!this.canAcquire(id))return Promise.resolve(false);
  if(!this.activated){this.activated=true;this.clientId=this.hooks.randomId();}
  let grant!:(ok:boolean)=>void,finish!:()=>void;
  const granted=new Promise<boolean>(resolve=>{grant=resolve;}),finished=new Promise<void>(resolve=>{finish=resolve;});
  const gesture:Gesture={id,gestureId:this.hooks.randomId(),seq:0,granted:false,ending:false,canceled:false,latest:null,timer:null,lastMoveAt:-Infinity,movePending:0,generation:this.generation,finished,finish,grant};
  this.gestures.add(gesture);this.latest.set(id,gesture);this.active=gesture;this.send(gesture,{type:'claim',groupId:id});return granted;
 }
 move(id:number,dx:number,dy:number){const gesture=this.latest.get(id);if(!gesture||gesture.ending||gesture.canceled)return;gesture.latest={dx,dy};this.flushMove(gesture);}
 private flushMove(gesture:Gesture){
  if(gesture.timer||gesture.ending||gesture.canceled||!gesture.latest||this.stopped||this.recovering)return;
  if(this.stream.preview?.connected&&!gesture.granted){gesture.timer=setTimeout(()=>{gesture.timer=null;this.flushMove(gesture);},80);return;}
  if(gesture.movePending>=4||(this.stream.pendingActionCount??0)>=56){gesture.timer=setTimeout(()=>{gesture.timer=null;this.flushMove(gesture);},80);return;}
  const delay=80-(this.hooks.now()-gesture.lastMoveAt);if(delay>0){gesture.timer=setTimeout(()=>{gesture.timer=null;this.flushMove(gesture);},delay);return;}
  const position=gesture.latest;gesture.latest=null;gesture.lastMoveAt=this.hooks.now();const seq=++gesture.seq;
  // Preview acceptance is not an action ACK and consumes no authoritative ordinal.
  if(gesture.granted&&this.stream.preview?.sendMove(gesture.id,position.dx,position.dy))return;
  gesture.movePending++;
  this.send(gesture,{type:'move',groupId:gesture.id,...position,seq},()=>{gesture.movePending--;this.flushMove(gesture);});
 }
 drop(id:number,dx:number,dy:number){const gesture=this.latest.get(id);if(!gesture||gesture.ending)return gesture?.finished??Promise.resolve();
  const started=this.hooks.now();this.hooks.timing('drop-start',started);this.end(gesture);this.hooks.timing('drop-queue',started);
  this.send(gesture,{type:'drop',groupId:id,dx,dy,seq:++gesture.seq},()=>{},started);return gesture.finished;
 }
 release(id:number){const gesture=this.latest.get(id);if(!gesture||gesture.ending)return;this.end(gesture);this.send(gesture,{type:'release',groupId:id});}
 private end(gesture:Gesture){gesture.ending=true;gesture.latest=null;if(gesture.timer)clearTimeout(gesture.timer);gesture.timer=null;if(this.active===gesture)this.active=null;}
 private send(gesture:Gesture,action:RealtimeActionInput['action'],after=()=>{},droppedAt?:number){
  const started=this.hooks.now(),generation=this.generation,input:RealtimeActionInput={id:this.hooks.randomId(),clientId:this.clientId,gestureId:gesture.gestureId,ordinal:++this.ordinal,action,since:this.hooks.revision()};
  let operation:Promise<RealtimeActionReply>;
  try{operation=this.stream.sendAction!(input);}catch(error){operation=Promise.reject(error);}
  void operation.then(reply=>{
   if(this.stopped||generation!==this.generation)return;
   this.hooks.profile?.(reply.data);this.hooks.timing(action.type,started,reply.status,reply.data?.diagnosticTiming?.serverMs);
   if(gesture.canceled)return;
   if(reply.status<200||reply.status>=300){const error=Object.assign(Error(reply.data?.error??'操作未能确认'),{status:reply.status,code:reply.data?.code});this.reject(gesture,error);return;}
   if(action.type==='drop'||action.type==='release')this.finish(gesture);
   if(!gesture.canceled)this.hooks.receive(reply,input);
   if(action.type==='claim'){gesture.granted=true;gesture.grant(!gesture.canceled);this.flushMove(gesture);}
   if(action.type==='drop'||action.type==='release'){
    if(droppedAt!==undefined)this.hooks.timing('drop-total',droppedAt,reply.status);
   }
  }).catch(error=>{
   if(this.stopped||generation!==this.generation)return;
   this.hooks.timing(action.type,started,0);this.recovering=true;this.invalidate();this.hooks.error(Object.assign(Error('操作连接中断，正在读取已保存位置'),{code:(error as {code?:string})?.code??'ACTION_CONNECTION_LOST'}));
   this.stream.resetActions?.();void this.reconcile();
  }).finally(after);
 }
 private reject(gesture:Gesture,error:Error&{status?:number;code?:string}){
  const latest=this.latest.get(gesture.id)===gesture;gesture.canceled=true;gesture.grant(false);if(latest)this.hooks.cancel(gesture.id);this.finish(gesture);this.hooks.error(error);
  const protocolError=['DIAGNOSTIC_ACTION_ORDER','DIAGNOSTIC_CLIENT_CONFLICT','INVALID_ACTION_INPUT','ACTION_BACKPRESSURE','ACTION_RATE_LIMIT'].includes(error.code??'');
  if(protocolError||error.status===401||error.status===403&&error.code!=='ENERGY_EMPTY'||error.status===410||error.status===429||(error.status??0)>=500){this.recovering=true;this.invalidate();this.stream.resetActions?.();}
  void this.reconcile();
 }
 private finish(gesture:Gesture){this.end(gesture);if(this.latest.get(gesture.id)===gesture){this.latest.delete(gesture.id);this.stream.preview?.clearMove(gesture.id);}this.gestures.delete(gesture);gesture.grant(false);gesture.finish();}
 observe(snapshot:RoomSnapshot){const gesture=this.active;if(!gesture)return;const group=snapshot.puzzle.groups.find(g=>g.id===gesture.id);
  if(!group||group.locked){this.hooks.cancel(gesture.id);this.release(gesture.id);}
 }
 private invalidate(){this.generation++;for(const gesture of this.gestures){gesture.canceled=true;gesture.grant(false);this.stream.preview?.clearMove(gesture.id);this.end(gesture);gesture.finish();}this.gestures.clear();this.latest.clear();this.active=null;this.hooks.cancel();}
 private reconcile(){
  if(this.stopped)return Promise.resolve();if(this.recovery)return this.recovery;
  this.recovery=this.hooks.reconcile().then(()=>{if(this.available)this.recovering=false;}).catch(()=>{}).finally(()=>{this.recovery=null;});return this.recovery;
 }
 async drain(){await Promise.all([...this.gestures].map(g=>g.finished));}
 hasActive(){return !!this.active;}
 stop(){if(this.stopped)return;this.stopped=true;this.cleanup();this.invalidate();}
}
