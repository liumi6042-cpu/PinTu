import {randomBytes} from 'node:crypto';
import {validTapPlatformId} from '../lib/tap-platform-id.mjs';

const key=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const tapId=validTapPlatformId;
const fault=(status,code)=>{throw Object.assign(Error('平台预览暂不可用，请继续使用原同步'),{status,code});};
const uuid=()=>randomBytes(16).toString('hex');

/** 正式开关由服务端控制；只协调平台通道，不写入钱包、拼图或历史记录。 */
export function createTapPreview({enabled=false,roomIds=[],now=Date.now,notify=()=>{}}={}){
 const allowedIds=roomIds instanceof Set?roomIds:new Set(roomIds),states=new Map();let serial=0,sweptAt=0;
 const allowed=room=>(enabled===true&&['public','private'].includes(room.visibility)||allowedIds.size<=32&&allowedIds.has(room.id)&&room.visibility==='private')&&room.diagnostic!==true&&!room.closedAt&&room.completedAt===null;
 // 只重建易失的平台通道；游戏房间、拼图进度和租约保持原状。
 function resetChannel(s){s.epoch=uuid();s.serial=++serial;s.channelId=null;s.creator=null;s.creatorUntil=0;s.peers.clear();}
 function state(room){
  if(!allowed(room)){states.delete(room.id);return null;}
  const time=now();let s=states.get(room.id);
  // 正式房间数量不受测试白名单限制，及时释放已无人续期的易失状态。
  if(time-sweptAt>=60000){for(const [id,value]of states)if(time-value.touchedAt>=60000&&[...value.peers.values()].every(p=>p.expires<=time))states.delete(id);sweptAt=time;s=states.get(room.id);}
  if(s){
   for(const [clientId,p]of s.peers)if(p.expires<=time||!room.members.some(m=>m.id===p.playerId&&m.lastSeen>0&&time-m.lastSeen<22000)){s.peers.delete(clientId);s.serial=++serial;}
   if(s.channelId&&!s.peers.has(s.creator))resetChannel(s);
  }
  if(!s){s={epoch:uuid(),serial:++serial,channelId:null,creator:null,creatorUntil:0,peers:new Map()};states.set(room.id,s);}
  s.touchedAt=time;
  return s;
 }
 const view=s=>({version:1,testOnly:enabled!==true,epoch:s.epoch,serial:s.serial,channelId:s.channelId,peers:[...s.peers.values()].map(({clientId,tapPlayerId,playerId,ready})=>({clientId,tapPlayerId,playerId,ready}))});
 function descriptor(room){const s=state(room);return s?view(s):undefined;}
 function request(room,member,input){
  if(!allowed(room))fault(404,'TAP_PREVIEW_DISABLED');
  if(!key(input.clientId)||!tapId(input.tapPlayerId))fault(400,'TAP_PREVIEW_INPUT');
  const s=state(room),time=now(),old=s.peers.get(input.clientId);
  if(old&&(old.playerId!==member.id||old.tapPlayerId!==input.tapPlayerId))fault(409,'TAP_PREVIEW_BINDING_CONFLICT');
  if(input.op==='reserve'){
   if([...s.peers.values()].some(p=>p.clientId!==input.clientId&&(p.playerId===member.id||p.tapPlayerId===input.tapPlayerId)))fault(409,'TAP_PREVIEW_ALREADY_CONNECTED');
   if(!old&&s.peers.size>=8)fault(429,'TAP_PREVIEW_CAPACITY');
   s.peers.set(input.clientId,{clientId:input.clientId,tapPlayerId:input.tapPlayerId,playerId:member.id,ready:old?.ready??false,expires:time+20000});
   if(!s.channelId&&(!s.creator||s.creatorUntil<=time)){s.creator=input.clientId;s.creatorUntil=time+12000;}
   s.serial=++serial;notify(room.id);return {...view(s),canCreate:!s.channelId&&s.creator===input.clientId};
  }
  if(!old||input.epoch!==s.epoch)fault(409,'TAP_PREVIEW_STALE');
  if(input.op==='publish'){
   if(s.channelId||s.creator!==input.clientId||s.creatorUntil<=time||!tapId(input.channelId))fault(409,'TAP_PREVIEW_CREATOR_CHANGED');
   s.channelId=input.channelId;
  }else if(input.op==='ready'){
   if(!s.channelId||input.channelId!==s.channelId)fault(409,'TAP_PREVIEW_CHANNEL_CHANGED');
   old.ready=true;
  }else if(input.op==='leave'){
   s.peers.delete(input.clientId);
   if(s.creator===input.clientId){if(s.channelId)resetChannel(s);else s.creatorUntil=0;}
  }else if(input.op!=='renew')fault(400,'TAP_PREVIEW_INPUT');
  old.expires=time+20000;s.serial=++serial;notify(room.id);return view(s);
 }
 return {allowed,descriptor,request,clear:()=>states.clear()};
}
