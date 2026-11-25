import {createHash} from 'node:crypto';

const KEY=/^[a-f0-9]{32}$/;
const fault=(status,code,message)=>Object.assign(new Error(message),{status,code});
const reject=(status,code,message)=>{throw fault(status,code,message);};
const MAX_STREAMS=64,MAX_RECEIPTS=256,MAX_GESTURES=128;

/** Room actions and acknowledgements use the original room transaction. The
 * compact permanent stream frontier prevents replay after bounded JSON expiry. */
export function createDiagnosticActions({db,readRoom,saveRoom,authorize,view,now,isConnectionOpen=()=>true}){
 db.exec('CREATE TABLE IF NOT EXISTS mobile_room_action_streams(room_id TEXT NOT NULL,client_id TEXT NOT NULL,member_id TEXT NOT NULL,connection_id TEXT NOT NULL,ordinal INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,client_id))');
 // Keep a closed room's replay frontier while its archive is retained. Its
 // eventual physical deletion removes only that room's frontier atomically.
 db.exec('CREATE TRIGGER IF NOT EXISTS mobile_room_action_streams_room_delete AFTER DELETE ON mobile_rooms BEGIN DELETE FROM mobile_room_action_streams WHERE room_id=OLD.id; END');
 const readStream=db.prepare('SELECT member_id,connection_id,ordinal,closed FROM mobile_room_action_streams WHERE room_id=? AND client_id=?');
 const saveStream=db.prepare('INSERT INTO mobile_room_action_streams VALUES(?,?,?,?,?,0) ON CONFLICT(room_id,client_id) DO UPDATE SET ordinal=excluded.ordinal');
 const closeStreams=db.prepare('UPDATE mobile_room_action_streams SET closed=1 WHERE room_id=? AND connection_id=?');
 function state(room){const key=room.diagnostic===true?'diagnosticActions':'roomActions';return room[key]??={version:1,streams:{},gestures:{},receipts:{},leases:{}};}
 function requireEnvelope(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!KEY.test(input.id)||!KEY.test(input.clientId)||!KEY.test(input.gestureId)||!Number.isSafeInteger(input.ordinal)||input.ordinal<1||input.since!==undefined&&(!Number.isSafeInteger(input.since)||input.since<0))reject(400,'INVALID_DIAGNOSTIC_ACTION','测试动作格式无效');
  const action=input.action;
  if(!action||typeof action!=='object'||Array.isArray(action)||!['claim','move','drop','release'].includes(action.type)||!Number.isSafeInteger(action.groupId)||action.groupId<0||Object.keys(action).some(key=>!['type','groupId','seq','dx','dy'].includes(key)))reject(400,'INVALID_DIAGNOSTIC_ACTION','测试动作格式无效');
  if(['move','drop'].includes(action.type)&&(!Number.isSafeInteger(action.seq)||action.seq<1||!Number.isFinite(action.dx)||!Number.isFinite(action.dy)||Math.abs(action.dx)>20000||Math.abs(action.dy)>20000))reject(400,'INVALID_DIAGNOSTIC_ACTION','拼块位置无效');
  if(['claim','release'].includes(action.type)&&['seq','dx','dy'].some(key=>action[key]!==undefined))reject(400,'INVALID_DIAGNOSTIC_ACTION','测试动作格式无效');
  return {type:action.type,groupId:action.groupId,...(['move','drop'].includes(action.type)?{seq:action.seq,dx:action.dx,dy:action.dy}:{})};
 }
 function prepare(context,input,connectionId){
  const room=readRoom(context.roomId),member=authorize(room,context),action=requireEnvelope(input),store=state(room);
  const fingerprint=createHash('sha256').update(JSON.stringify({memberId:member.id,clientId:input.clientId,gestureId:input.gestureId,ordinal:input.ordinal,action})).digest('hex');
  const receipt=store.receipts[input.id];
  if(receipt){if(receipt.fingerprint!==fingerprint)reject(409,'DIAGNOSTIC_REQUEST_CONFLICT','同一动作编号不能用于其他操作');return {room,member,action,store,receipt};}
  const frontier=readStream.get(room.id,input.clientId),legacy=store.streams[input.clientId];
  const stream=frontier?{memberId:frontier.member_id,connectionId:frontier.connection_id,ordinal:frontier.ordinal,closed:frontier.closed}:legacy;
  if(stream&&(stream.memberId!==undefined&&stream.memberId!==member.id||stream.connectionId!==connectionId||stream.closed))reject(409,'DIAGNOSTIC_CLIENT_CONFLICT','房间连接标识已被其他连接使用，请重新连接');
  if(input.ordinal!==(stream?.ordinal??0)+1)reject(409,'DIAGNOSTIC_ACTION_ORDER','房间动作顺序不连续，请重新连接');
  for(const [key,value]of Object.entries(store.streams))if(!isConnectionOpen(value.connectionId))delete store.streams[key];
  if(!store.streams[input.clientId]&&Object.keys(store.streams).length>=(room.diagnostic===true?16:MAX_STREAMS))reject(429,'DIAGNOSTIC_STREAM_LIMIT','房间连接较多，请关闭其他游戏页面后重新连接');
  return {room,member,action,store,fingerprint};
 }
 function leaseMatches(store,room,gesture,connectionId){
  const marker=store.leases[gesture.groupId],lease=room.leases[gesture.groupId];
  return marker?.connectionId===connectionId&&marker.clientId===gesture.clientId&&marker.gestureId===gesture.id&&lease?.playerId===marker.playerId&&(gesture.memberId===undefined||gesture.memberId===marker.playerId);
 }
 function prune(store,room){
  for(const gesture of Object.values(store.gestures))if(gesture.state==='active'&&(!leaseMatches(store,room,gesture,gesture.connectionId)||room.leases[gesture.groupId].expires<=now()))gesture.state='closed';
  for(const [groupId,marker]of Object.entries(store.leases))if(!room.leases[groupId]||room.leases[groupId].expires<=now()||store.gestures[marker.gestureId]?.state!=='active')delete store.leases[groupId];
  const receipts=Object.keys(store.receipts);for(const key of receipts.slice(0,Math.max(0,receipts.length-MAX_RECEIPTS)))delete store.receipts[key];
  const disposable=Object.values(store.gestures).filter(value=>value.state!=='active');for(const value of disposable.slice(0,Math.max(0,Object.keys(store.gestures).length-MAX_GESTURES)))delete store.gestures[value.id];
 }
 function write(context,input,connectionId,execute){
  const prepared=prepare(context,input,connectionId);
  if(prepared.receipt)return {status:prepared.receipt.status,data:prepared.receipt.status<400?view(prepared.room,context):{...prepared.receipt.error,profile:view(prepared.room,context).profile}};
  const {room,member,action,store,fingerprint}=prepared;
  const oldGesture=store.gestures[input.gestureId];let result;
  db.exec('SAVEPOINT diagnostic_action');
  try{
   if(oldGesture&&(oldGesture.memberId!==undefined&&oldGesture.memberId!==member.id||oldGesture.clientId!==input.clientId||oldGesture.groupId!==action.groupId||oldGesture.connectionId!==connectionId))reject(409,'DIAGNOSTIC_GESTURE_CONFLICT','手势标识已用于其他拖动');
   if(action.type==='claim'){
    if(oldGesture)reject(409,'DIAGNOSTIC_GESTURE_CLOSED','该拖动已开始或结束，请使用新的手势');
    const lease=room.leases[action.groupId];
    // The engine also rejects another player's lease and this player's other
    // held group. This extra check prevents same-player/same-group takeover.
    if(lease?.expires>now())reject(409,'DIAGNOSTIC_LEASE_BUSY','这组拼块仍有未结束的拖动');
   }else{
    if(!oldGesture||oldGesture.state!=='active')reject(409,'DIAGNOSTIC_GESTURE_REJECTED','该拖动已结束或被拒绝');
    if(!leaseMatches(store,room,oldGesture,connectionId))reject(409,'DIAGNOSTIC_LEASE_CHANGED','拖动租约已变化，请重新拿起');
    if(['move','drop'].includes(action.type)&&action.seq<=room.leases[action.groupId].seq)reject(409,'DIAGNOSTIC_ACTION_SEQUENCE','拖动动作序号已过期');
   }
   result={status:200,data:execute({...action,requestId:input.id},input.since)};
   db.exec('RELEASE diagnostic_action');
  }catch(error){
   db.exec('ROLLBACK TO diagnostic_action');db.exec('RELEASE diagnostic_action');
   if(!Number.isInteger(error.status)||error.status>=500)throw error;
   result={status:error.status,data:{error:error.message,code:error.code??'ROOM_ERROR',...(error.profile?{profile:error.profile}:{}),...(error.mobileProfile?{mobileProfile:error.mobileProfile}:{})}};
  }
  const current=readRoom(context.roomId),next=state(current);
  if(result.status>=400&&oldGesture?.state==='active'&&oldGesture.clientId===input.clientId&&oldGesture.connectionId===connectionId&&oldGesture.groupId===action.groupId&&leaseMatches(next,current,oldGesture,connectionId)){
   // A rejected gesture can no longer send a release. Release only the exact
   // matching generation here; another connection's lease is never touched.
   delete current.leases[oldGesture.groupId];delete next.leases[oldGesture.groupId];current.revision++;
  }
  next.streams[input.clientId]={ordinal:input.ordinal,connectionId,memberId:member.id};
  saveStream.run(current.id,input.clientId,member.id,connectionId,input.ordinal);
  const gesture=next.gestures[input.gestureId];
  // A conflicting envelope cannot replace the original gesture's owner.
  if(!gesture||gesture.clientId===input.clientId&&gesture.connectionId===connectionId&&gesture.groupId===action.groupId){
   next.gestures[input.gestureId]={id:input.gestureId,clientId:input.clientId,connectionId,memberId:member.id,groupId:action.groupId,state:result.status>=400?'rejected':['drop','release'].includes(action.type)?'closed':'active'};
  }
  if(result.status<400&&action.type==='claim')next.leases[action.groupId]={connectionId,clientId:input.clientId,gestureId:input.gestureId,playerId:member.id};
  if(result.status<400&&['drop','release'].includes(action.type))delete next.leases[action.groupId];
  next.receipts[input.id]={fingerprint,status:result.status,...(result.status>=400?{error:result.data}:{})};
  prune(next,current);saveRoom(current);if(result.status>=400)result.data.profile=view(current,context).profile;return result;
 }
 function disconnect(context,connectionId,execute){
  const room=readRoom(context.roomId);authorize(room,context);const store=state(room);
  for(const gesture of Object.values(store.gestures)){
   if(gesture.connectionId!==connectionId||gesture.state!=='active')continue;
   if(leaseMatches(store,room,gesture,connectionId)&&room.leases[gesture.groupId].expires>now())execute({type:'release',groupId:gesture.groupId});
  }
  const current=readRoom(context.roomId),next=state(current);
  closeStreams.run(current.id,connectionId);
  for(const [key,stream]of Object.entries(next.streams))if(stream.connectionId===connectionId)delete next.streams[key];
  for(const gesture of Object.values(next.gestures))if(gesture.connectionId===connectionId&&gesture.state==='active'){gesture.state='closed';if(next.leases[gesture.groupId]?.connectionId===connectionId)delete next.leases[gesture.groupId];}
  prune(next,current);saveRoom(current);return {status:200,data:view(current,context)};
 }
 return {write,disconnect};
}
