import { settleGarden } from './courtyard-store';
import { maintainPublicRooms } from './public-room-maintenance';
import { MEMBER_ROOM_LIMIT,MEMBERSHIP_REQUIRED,canCreateMemberRoom } from './membership-policy';
import { membershipFor } from './membership-store';
import { restartPublicLifetime,touchPublicRoom } from './public-room-retention';
import { recordRoomChange } from './room-sync';
import { localDb } from './local-db';
import { saveCompletion } from './lobby-store';
import { RoomError, type Room } from './room-engine';
import { normalizePuzzle } from './puzzle-engine';
import { RESTORABLE_PHOTO_IDS } from './puzzle-catalog';
import { roomAchievementDays,saveAchievementActivity,saveAchievementCompletion } from './achievement-store';
import { RoomReadCache } from './room-read-cache';
import { RoomWriteQueue } from './room-write-queue';
import {readManagedContent,type ManagedContentSnapshot} from './managed-content';
import {prepareManagedRoomEvent,drainManagedRewards} from './managed-economy';
const db=localDb;
const roomCache=new RoomReadCache();
const writes=new RoomWriteQueue();
export async function readRoom(id:string){
 await maintainPublicRooms();
 if(!/^[a-f0-9]{32}$/.test(id))throw new RoomError('邀请链接格式不正确',404);
 const cached=roomCache.get(id),row=await db().prepare('SELECT r.revision,r.expires_at,m.closed,CASE WHEN r.revision=? AND r.expires_at=? THEN NULL ELSE r.data END AS data FROM puzzle_rooms r LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id WHERE r.id=?').bind(cached?.revision??-1,cached?.expiresAt??-1,id).first<{data:string|null;revision:number;expires_at:number;closed:number|null}>();
 if(!row){roomCache.remove(id);throw new RoomError('房间不存在，请检查邀请链接',404);}
 if(row.closed)throw new RoomError('这张拼图桌已由管理员暂停，请选择其他桌',403);
 if(row.data===null&&cached)return cached;
 const room=JSON.parse(row.data!) as Room;room.revision=row.revision;room.expiresAt=row.expires_at;
 // An intact upload reference stays playable in every room kind, including a
 // public one: uploaded pictures can now be opened to the lobby.
 if(!RESTORABLE_PHOTO_IDS.includes(room.puzzle.imageId)&&!(room.customImage?.id===room.puzzle.imageId&&/^custom-[a-f0-9]{32}$/.test(room.puzzle.imageId)&&['solo','private','public'].includes(room.visibility||'')))throw new RoomError('这张早期试玩图片已下架，请重新选择本站生成的拼图',410);
 normalizePuzzle(room.puzzle);if(room.completedAt){await saveCompletion(room);await saveAchievementCompletion(room);}
 return roomCache.put(room,row.data!.length*2);
}
export async function insertRoom(room:Room){await db().prepare('INSERT INTO puzzle_rooms (id,revision,data,expires_at) VALUES (?,0,?,?)').bind(room.id,JSON.stringify(room),room.expiresAt).run();}
export async function mutateRoom<T>(id:string,fn:(room:Room)=>T){
 return writes.run(id,()=>commitRoom(id,fn));
}
async function commitRoom<T>(id:string,fn:(room:Room)=>T){
 let content:ManagedContentSnapshot|null|undefined,contentRead=false,contentUnavailable=false;
 for(let attempt=0;attempt<8;attempt++){
  const base=await readRoom(id),room=structuredClone(base),before=room.revision,previousExpiry=room.expiresAt,previousTitle=room.title,previousVisibility=room.visibility,previousDays=roomAchievementDays(room),wasComplete=!!room.completedAt;
  const previous=base.puzzle.groups;
  const result=fn(room);room.revision++;recordRoomChange(room,previous);
  const rewardChanged=(!wasComplete&&!!room.completedAt)||Object.entries(room.achievements?.contributors||{}).some(([owner,value])=>value.count>(base.achievements?.contributors[owner]?.count||0));
  // Capture one content version for this committed gameplay event. A broken
  // rewards release must stop payouts without interrupting a player's drag.
  if(rewardChanged&&!contentRead){contentRead=true;try{content=readManagedContent();}catch{contentUnavailable=true;console.error('Managed reward configuration unavailable');}}
  const becomingPrivate=base.visibility==='public'&&room.visibility==='private',now=Date.now();
  const rewardEvent=rewardChanged?await prepareManagedRoomEvent(room,base,content??null,now,{unavailable:contentUnavailable}):null;
  if(becomingPrivate){
   if(!room.ownerId||!canCreateMemberRoom(await membershipFor(room.ownerId),now))throw new RoomError(MEMBERSHIP_REQUIRED,403);
   room.expiresAt=Math.max(room.lastPlayedAt||room.createdAt,room.publicLastSeenAt||0)+30*86400000;
  }else if(base.visibility!=='public'&&room.visibility==='public'){restartPublicLifetime(room);touchPublicRoom(room,now);}
  const admission=becomingPrivate?` AND EXISTS(SELECT 1 FROM puzzle_memberships WHERE user_id=? AND plan='puzzle' AND status='active' AND starts_at<=? AND expires_at>?)
    AND (SELECT COUNT(*) FROM puzzle_room_directory WHERE owner_id=? AND visibility='private' AND completed_at IS NULL AND expires_at>? AND slot IS NULL)<?`:'';
  const admissionValues=becomingPrivate?[room.ownerId!,now,now,room.ownerId!,now,MEMBER_ROOM_LIMIT]:[];
  const serialized=JSON.stringify(room),database=db(),commands=[database.prepare('UPDATE puzzle_rooms SET data = ?, revision = ?, expires_at = ? WHERE id = ? AND revision = ?'+admission).bind(serialized,room.revision,room.expiresAt,id,before,...admissionValues)];
  // The immediately preceding CAS is the only operation allowed to enqueue this
  // original-time event. Room progress and pending rewards therefore survive
  // together, including a failed payout or a service restart.
  if(rewardEvent)commands.push(database.prepare(`INSERT OR IGNORE INTO puzzle_managed_reward_events(id,room_id,revision,occurred_at,payload)
    SELECT ?,?,?,?,? WHERE changes()=1`).bind(rewardEvent.id,rewardEvent.roomId,rewardEvent.revision,rewardEvent.occurredAt,rewardEvent.payload));
  if(room.expiresAt!==previousExpiry||room.title!==previousTitle||room.visibility!==previousVisibility||!!room.completedAt!==wasComplete)
   commands.push(database.prepare(`UPDATE puzzle_room_directory SET
    expires_at=(SELECT expires_at FROM puzzle_rooms WHERE id=?),
    title=COALESCE((SELECT json_extract(data,'$.title') FROM puzzle_rooms WHERE id=?),title),
    visibility=COALESCE((SELECT json_extract(data,'$.visibility') FROM puzzle_rooms WHERE id=?),visibility),
    completed_at=(SELECT json_extract(data,'$.completedAt') FROM puzzle_rooms WHERE id=?) WHERE room_id=?`).bind(id,id,id,id,id));
  // Migration 0017 records lifetime and Beijing-day placed-piece increments in
  // the successful room UPDATE's trigger, in this same transaction. A rejected
  // CAS must never persist this attempt's piece totals.
  const [updated]=await database.batch(commands);
  if(becomingPrivate&&updated.meta.changes!==1){
   if(!canCreateMemberRoom(await membershipFor(room.ownerId!),Date.now()))throw new RoomError(MEMBERSHIP_REQUIRED,403);
   throw new RoomError('已有 3 个进行中的私人房间，请先完成其中一局',409);
  }
  if(updated.meta.changes===1){
   // Room state and directory metadata commit together, including privacy changes and quota release.
   if(room.completedAt)await saveCompletion(room);
   if(room.completedAt&&!wasComplete){await saveAchievementCompletion(room);try{await settleGarden(room);}catch{console.error('Courtyard reward pending recovery');}}
   else await saveAchievementActivity(room,previousDays);
   if(rewardEvent)try{await drainManagedRewards(content??null);}catch{console.error('Managed room reward pending recovery');}
   roomCache.put(room,serialized.length*2);
   return {room,result};
  }
 }
 throw new RoomError('房间正在同步，请稍后重试',409);
}
export async function digestToken(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function newId(){return crypto.randomUUID().replaceAll('-','');}
export async function getDigest(request:Request){const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{32}$/.test(token))throw new RoomError('请先加入房间',401);return digestToken(token);}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export async function body(request:Request){
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
 if(reader){try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw new RoomError('请求内容过长',413);}chunks.push(value);}}finally{reader.releaseLock();}}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const raw=new TextDecoder().decode(bytes);
 const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)throw new RoomError('请从本网站加入房间',403);
 if(!request.headers.get('Content-Type')?.includes('application/json'))throw new RoomError('请求格式无效');
 try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new RoomError('请求格式无效');}
}
export function failure(error:unknown){const response=error instanceof RoomError?json({error:error.message},error.status):json({error:'房间连接暂时不可用，请稍后重试'},503);if(response.status===429||response.status===503)response.headers.set('Retry-After','2');if(!(error instanceof RoomError))console.error('Room request failed');return response;}

