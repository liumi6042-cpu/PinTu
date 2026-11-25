import {applyAction,RoomError,type Room,type Member,type RoomAction} from './room-engine';

const KEY=/^[a-f0-9]{32}$/;
type Action={type:'claim'|'move'|'drop'|'release';groupId:number;seq?:number;dx?:number;dy?:number};
type Envelope={id:string;clientId:string;gestureId:string;ordinal:number;action:Action};
type Stream={memberId:string;connectionId:string;ordinal:number;at:number;closed?:boolean};
type Gesture={id:string;clientId:string;memberId:string;connectionId:string;groupId:number;state:'active'|'closed'|'rejected'};
type Marker={clientId:string;gestureId:string;memberId:string;connectionId:string};
type Receipt={fingerprint:string;memberId:string;connectionId:string;revision:number;status:number;error?:{error:string;code:string}};
type State={version:1;streams:Record<string,Stream>;gestures:Record<string,Gesture>;receipts:Record<string,Receipt>;leases:Record<string,Marker>};
type StoredRoom=Room&{sharedActions?:State};
export type SharedActionResult={status:number;revision:number;replayed?:boolean;error?:{error:string;code:string}};
export type SharedActionStreamWrite={kind:'action'|'disconnect';memberId:string;connectionId:string;clientId?:string;ordinal?:number;id?:string};
const reject=(status:number,code:string,message:string):never=>{throw Object.assign(new RoomError(message,status),{code});};
/** The Node bridge owns the one-use permit registry. A public request cannot
 * enter this channel by inventing an envelope, connection ID or proxy header. */
export function requireSharedActionChannel(request:Request,input:any){
 const authorize=(globalThis as any)[Symbol.for('jigsaw.shared.action.authorize')];
 if(typeof authorize!=='function'||authorize(request,input)!==true)reject(403,'REALTIME_CHANNEL_REQUIRED','请通过已验证的游戏长连接操作');
}
export function sharedActionStreamWrite(memberId:string,input:any):SharedActionStreamWrite{
 if(!KEY.test(input.connectionId))reject(400,'INVALID_DIAGNOSTIC_ACTION','连接标识无效');
 if(input.type==='realtime-disconnect')return {kind:'disconnect',memberId,connectionId:input.connectionId};
 const envelope=normalize(input.envelope);return {kind:'action',memberId,connectionId:input.connectionId,clientId:envelope.clientId,ordinal:envelope.ordinal,id:envelope.id};
}
/** Persistent frontier survives bounded JSON receipt/stream reclamation and a
 * process restart. It never contains wallet or contribution amounts. */
export async function checkSharedActionFrontier(db:any,room:StoredRoom,write?:SharedActionStreamWrite){
 if(!write||write.kind!=='action')return;
 const row=await db.prepare('SELECT member_id,connection_id,ordinal,closed FROM puzzle_room_action_streams WHERE room_id=? AND client_id=?').bind(room.id,write.clientId).first();
 if(!row)return;
 if(row.member_id!==write.memberId||row.connection_id!==write.connectionId||row.closed)reject(409,'DIAGNOSTIC_CLIENT_CONFLICT','拖动连接已变化，请重新连接');
 if(write.ordinal!>row.ordinal+1||write.ordinal!<=row.ordinal&&!room.sharedActions?.receipts[write.id!])reject(409,'DIAGNOSTIC_ACTION_ORDER','旧拖动回执已过期，请重新连接');
}
/** Call after the room UPDATE in its original batch. The exact committed JSON
 * guard keeps a failed CAS from advancing an ordinal or closing a connection. */
export function sharedActionFrontierCommand(db:any,room:Room,serialized:string,write:SharedActionStreamWrite,diagnostic=false){
 const guard='EXISTS(SELECT 1 FROM '+(diagnostic?'puzzle_diagnostic_rooms':'puzzle_rooms')+' WHERE id=? AND revision=? AND data=?)';
 if(write.kind==='disconnect')return db.prepare('UPDATE puzzle_room_action_streams SET closed=1,updated_at=? WHERE room_id=? AND member_id=? AND connection_id=? AND '+guard).bind(Date.now(),room.id,write.memberId,write.connectionId,room.id,room.revision,serialized);
 return db.prepare(`INSERT INTO puzzle_room_action_streams(room_id,client_id,member_id,connection_id,ordinal,closed,updated_at)
  SELECT ?,?,?,?,?,0,? WHERE ${guard}
  ON CONFLICT(room_id,client_id) DO UPDATE SET ordinal=MAX(ordinal,excluded.ordinal),updated_at=excluded.updated_at
  WHERE member_id=excluded.member_id AND connection_id=excluded.connection_id AND closed=0`).bind(room.id,write.clientId,write.memberId,write.connectionId,write.ordinal,Date.now(),room.id,room.revision,serialized);
}
function state(room:StoredRoom):State{return room.sharedActions??={version:1,streams:{},gestures:{},receipts:{},leases:{}};}
function normalize(raw:any):Envelope{
 if(!raw||!KEY.test(raw.id)||!KEY.test(raw.clientId)||!KEY.test(raw.gestureId)||!Number.isSafeInteger(raw.ordinal)||raw.ordinal<1)reject(400,'INVALID_DIAGNOSTIC_ACTION','拖动动作格式无效');
 const a=raw.action;
 if(!a||!['claim','move','drop','release'].includes(a.type)||!Number.isSafeInteger(a.groupId)||a.groupId<0||Object.keys(a).some(key=>!['type','groupId','seq','dx','dy'].includes(key)))reject(400,'INVALID_DIAGNOSTIC_ACTION','拖动动作格式无效');
 if(['move','drop'].includes(a.type)&&(!Number.isSafeInteger(a.seq)||a.seq<1||!Number.isFinite(a.dx)||!Number.isFinite(a.dy)||Math.abs(a.dx)>20000||Math.abs(a.dy)>20000))reject(400,'INVALID_DIAGNOSTIC_ACTION','拼块位置无效');
 if(['claim','release'].includes(a.type)&&['seq','dx','dy'].some(key=>a[key]!==undefined))reject(400,'INVALID_DIAGNOSTIC_ACTION','拖动动作格式无效');
 return {id:raw.id,clientId:raw.clientId,gestureId:raw.gestureId,ordinal:raw.ordinal,action:{type:a.type,groupId:a.groupId,...(['move','drop'].includes(a.type)?{seq:a.seq,dx:a.dx,dy:a.dy}:{})}};
}
function matches(room:Room,s:State,g:Gesture,connectionId:string){const marker=s.leases[g.groupId];return marker?.connectionId===connectionId&&marker.gestureId===g.id&&marker.clientId===g.clientId&&marker.memberId===g.memberId&&room.leases[g.groupId]?.playerId===g.memberId;}
function prune(room:Room,s:State,now:number,keepClientId?:string){
 for(const g of Object.values(s.gestures))if(g.state==='active'&&(!matches(room,s,g,g.connectionId)||(room.leases[g.groupId]?.expires??0)<=now))g.state='closed';
 for(const [id,marker]of Object.entries(s.leases))if(s.gestures[marker.gestureId]?.state!=='active'||(room.leases[id]?.expires??0)<=now)delete s.leases[id];
 for(const [clientId,stream]of Object.entries(s.streams))if(clientId!==keepClientId&&now-stream.at>45000&&!Object.values(s.gestures).some(g=>g.state==='active'&&g.connectionId===stream.connectionId))stream.closed=true;
 // Closed sockets cannot send again. A new connection receives a fresh server
 // ID, so evicting closed epochs cannot authorize old frames on that socket.
 const closed=Object.entries(s.streams).filter(([,value])=>value.closed).sort((a,b)=>a[1].at-b[1].at);
 for(const [id]of closed.slice(0,Math.max(0,Object.keys(s.streams).length-32)))delete s.streams[id];
 const receipts=Object.keys(s.receipts);for(const id of receipts.slice(0,Math.max(0,receipts.length-512)))delete s.receipts[id];
 const disposable=Object.values(s.gestures).filter(g=>g.state!=='active');for(const g of disposable.slice(0,Math.max(0,Object.keys(s.gestures).length-256)))delete s.gestures[g.id];
}
/** Runs synchronously inside the existing room CAS callback. The mutation,
 * receipt and original reward outbox are committed by that same CAS/batch. */
export function applySharedAction(room:StoredRoom,member:Member,raw:any,connectionId:string,now:number):SharedActionResult{
 if(!KEY.test(connectionId))reject(400,'INVALID_DIAGNOSTIC_ACTION','连接标识无效');
 const input=normalize(raw),s=state(room),fingerprint=JSON.stringify(input),prior=s.receipts[input.id];prune(room,s,now,input.clientId);
 if(prior){if(prior.memberId!==member.id||prior.connectionId!==connectionId||prior.fingerprint!==fingerprint)reject(409,'DIAGNOSTIC_REQUEST_CONFLICT','动作编号已用于其他操作');return {status:prior.status,revision:prior.revision,replayed:true,error:prior.error};}
 const stream=s.streams[input.clientId];
 if(stream&&(stream.memberId!==member.id||stream.connectionId!==connectionId||stream.closed))reject(409,'DIAGNOSTIC_CLIENT_CONFLICT','拖动连接已变化，请重新连接');
 if(input.ordinal!==(stream?.ordinal??0)+1)reject(409,'DIAGNOSTIC_ACTION_ORDER','拖动动作顺序不连续，请重新连接');
 if(!stream&&Object.values(s.streams).filter(value=>!value.closed).length>=32)reject(429,'DIAGNOSTIC_STREAM_LIMIT','同时打开的拖动连接较多');
 const action=input.action,old=s.gestures[input.gestureId],before=structuredClone(room);let error:Receipt['error'],status=200;
 try{
  if(old&&(old.memberId!==member.id||old.clientId!==input.clientId||old.connectionId!==connectionId||old.groupId!==action.groupId))reject(409,'DIAGNOSTIC_GESTURE_CONFLICT','手势标识已用于其他拖动');
  if(action.type==='claim'){
   if(old)reject(409,'DIAGNOSTIC_GESTURE_CLOSED','该拖动已开始或结束');
   if((room.leases[action.groupId]?.expires??0)>now)reject(409,'DIAGNOSTIC_LEASE_BUSY','这组拼块仍有未结束的拖动');
  }else{
   if(!old||old.state!=='active')reject(409,'DIAGNOSTIC_GESTURE_REJECTED','该拖动已结束或被拒绝');
   if(!matches(room,s,old,connectionId))reject(409,'DIAGNOSTIC_LEASE_CHANGED','拖动租约已变化，请重新拿起');
   if(['move','drop'].includes(action.type)&&action.seq!<=room.leases[action.groupId].seq)reject(409,'DIAGNOSTIC_ACTION_SEQUENCE','拖动动作序号已过期');
  }
  applyAction(room,member,action as RoomAction,now);
 }catch(e){
  if(!(e instanceof RoomError)||e.status>=500)throw e;
  for(const key of Object.keys(room))delete (room as any)[key];Object.assign(room,before);
  status=e.status;error={error:e.message,code:(e as any).code??'ROOM_ERROR'};
 }
 const next=state(room);
 if(status>=400&&old?.state==='active'&&old.memberId===member.id&&old.connectionId===connectionId&&old.clientId===input.clientId&&old.groupId===action.groupId&&matches(room,next,old,connectionId)){delete room.leases[old.groupId];delete next.leases[old.groupId];}
 next.streams[input.clientId]={memberId:member.id,connectionId,ordinal:input.ordinal,at:now};
 if(!old||old.memberId===member.id&&old.connectionId===connectionId&&old.clientId===input.clientId&&old.groupId===action.groupId)next.gestures[input.gestureId]={id:input.gestureId,memberId:member.id,clientId:input.clientId,connectionId,groupId:action.groupId,state:status>=400?'rejected':['drop','release'].includes(action.type)?'closed':'active'};
 if(status<400&&action.type==='claim')next.leases[action.groupId]={memberId:member.id,connectionId,clientId:input.clientId,gestureId:input.gestureId};
 if(status<400&&['drop','release'].includes(action.type))delete next.leases[action.groupId];
 const revision=room.revision+1;next.receipts[input.id]={fingerprint,memberId:member.id,connectionId,status,revision,...(error?{error}:{})};prune(room,next,now,input.clientId);
 return {status,revision,error};
}
export function disconnectSharedActions(room:StoredRoom,member:Member,connectionId:string,now:number){
 if(!KEY.test(connectionId))reject(400,'INVALID_DIAGNOSTIC_ACTION','连接标识无效');const s=state(room);
 for(const g of Object.values(s.gestures))if(g.memberId===member.id&&g.connectionId===connectionId&&g.state==='active'){
  if(matches(room,s,g,connectionId))delete room.leases[g.groupId];if(s.leases[g.groupId]?.connectionId===connectionId)delete s.leases[g.groupId];g.state='closed';
 }
 for(const stream of Object.values(s.streams))if(stream.memberId===member.id&&stream.connectionId===connectionId){stream.closed=true;stream.at=now;}
 prune(room,s,now);
}
/** A legacy HTTP action keeps its original semantics and supersedes any old
 * stream marker for the lease it actually changed. */
export function clearSharedActionLease(room:StoredRoom,member:Member,action:RoomAction){
 const s=room.sharedActions;if(!s)return;
 for(const [id,marker]of Object.entries(s.leases))if(marker.memberId===member.id&&(action.type==='leave'||Number(id)===action.groupId&&['claim','drop','release'].includes(action.type))){const g=s.gestures[marker.gestureId];if(g)g.state='closed';delete s.leases[id];}
}
