import {localDb} from './local-db';
import type {Room} from './room-engine';

export async function recordEvent(owner:string,kind:string,roomId:string,data:unknown,now=Date.now()){
 try{
  const once=kind==='room-complete'||kind==='level-clear';
  await localDb().prepare(`INSERT INTO mobile_events(owner,kind,room_id,data,created_at) SELECT ?,?,?,?,?${once?' WHERE NOT EXISTS(SELECT 1 FROM mobile_events WHERE owner=? AND kind=? AND room_id=?)':''}`).bind(owner,kind,roomId,JSON.stringify(data),now,...(once?[owner,kind,roomId]:[])).run();
 }catch{console.error('Shared event write failed',kind);}
}
export async function recordSharedCompletion(room:Room,firstClear?:boolean){
 try{
  // Only tables created or joined through the shared API belong to this funnel.
  if(!await localDb().prepare("SELECT 1 FROM mobile_events WHERE room_id=? AND created_at<=? AND kind IN ('room-create','room-join','level-start') LIMIT 1").bind(room.id,room.completedAt).first())return;
  for(const [owner,value] of Object.entries(room.achievements?.contributors??{}))if(value.count>0&&!room.members.some(member=>member.bot&&(member.accountId||member.guestId)===owner))await recordEvent(owner,'room-complete',room.id,{contribution:value.count},room.completedAt!);
  if(room.levelId&&room.ownerId)await recordEvent(room.ownerId,'level-clear',room.id,{levelId:room.levelId,firstClear:!!firstClear,energy:0},room.completedAt!);
 }catch{console.error('Shared completion event write failed');}
}
