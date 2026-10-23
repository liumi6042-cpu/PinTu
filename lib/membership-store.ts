import { localDb } from './local-db';
import { MEMBERSHIP_LAUNCHED,MEMBER_ROOM_LIMIT,MEMBERSHIP_REQUIRED,canCreateMemberRoom,membershipStatus,type MembershipRecord,type MembershipSummary } from './membership-policy';
import { RoomError,type Room } from './room-engine';
import { PHOTOS } from './puzzle-catalog';
import { pieceBand } from './piece-policy';
type MembershipRow={plan:'puzzle';status:'active'|'ended';startsAt:number;expiresAt:number;cancelAtPeriodEnd:number};
export async function membershipFor(userId:string):Promise<MembershipRecord|null>{
  const row=await localDb().prepare('SELECT plan,status,starts_at AS startsAt,expires_at AS expiresAt,cancel_at_period_end AS cancelAtPeriodEnd FROM puzzle_memberships WHERE user_id=?').bind(userId).first<MembershipRow>();
  return row?{...row,cancelAtPeriodEnd:!!row.cancelAtPeriodEnd}:null;
}
export async function ownedRoomCount(userId:string,now=Date.now()){
  const row=await localDb().prepare("SELECT COUNT(*) AS count FROM puzzle_room_directory WHERE owner_id=? AND visibility='private' AND completed_at IS NULL AND expires_at>? AND slot IS NULL AND NOT EXISTS(SELECT 1 FROM puzzle_shared_created_hidden h WHERE h.owner_id=puzzle_room_directory.owner_id AND h.room_id=puzzle_room_directory.room_id)").bind(userId,now).first<{count:number}>();return row?.count||0;
}
export async function membershipSummary(userId?:string):Promise<MembershipSummary>{
  const [membership,usedRooms]=userId?await Promise.all([membershipFor(userId),ownedRoomCount(userId)]):[null,0];
  return {launched:MEMBERSHIP_LAUNCHED,account:!!userId,membership,status:membershipStatus(membership),usedRooms,roomLimit:MEMBER_ROOM_LIMIT,canCreate:!!userId&&canCreateMemberRoom(membership)&&usedRooms<MEMBER_ROOM_LIMIT};
}
export async function membershipOrders(userId:string){
  const rows=await localDb().prepare('SELECT id,amount_minor AS amountMinor,currency,status,created_at AS createdAt FROM puzzle_membership_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(userId).all<{id:string;amountMinor:number;currency:string;status:string;createdAt:number}>();return rows.results;
}
export async function insertMemberRoom(room:Room,userId:string){
  const now=Date.now(),db=localDb(),photo=room.customImage||PHOTOS.find(p=>p.id===room.puzzle.imageId)!;
  // The entitlement and quota are checked in the insertion itself, within the same transaction as the directory row.
  const result=await db.batch([
    db.prepare(`INSERT INTO puzzle_rooms (id,revision,data,expires_at) SELECT ?,0,?,?
      WHERE (?='solo' OR EXISTS (SELECT 1 FROM puzzle_memberships WHERE user_id=? AND plan='puzzle' AND status='active' AND starts_at<=? AND expires_at>?))
      AND (?='solo' OR (SELECT COUNT(*) FROM puzzle_room_directory WHERE owner_id=? AND visibility='private' AND completed_at IS NULL AND expires_at>? AND slot IS NULL AND NOT EXISTS(SELECT 1 FROM puzzle_shared_created_hidden h WHERE h.owner_id=puzzle_room_directory.owner_id AND h.room_id=puzzle_room_directory.room_id))<?)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM puzzle_user_images WHERE id=? AND owner_id=?))`).bind(room.id,JSON.stringify(room),room.expiresAt,room.visibility,userId,now,now,room.visibility,userId,now,MEMBER_ROOM_LIMIT,room.customImage?.id??null,room.customImage?.id??null,userId),
    db.prepare(`INSERT INTO puzzle_room_directory (room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot)
      SELECT ?,?,?,?,?,?,?,?,NULL,NULL WHERE EXISTS (SELECT 1 FROM puzzle_rooms WHERE id=?)`).bind(room.id,room.visibility,userId,room.title||photo.title,photo.id,pieceBand(room.puzzle.cols*room.puzzle.rows)??room.puzzle.cols*room.puzzle.rows,room.createdAt,room.expiresAt,room.id),
  ]);
  if(result[0].meta.changes!==1){
    if(room.visibility!=='solo'&&!canCreateMemberRoom(await membershipFor(userId)))throw new RoomError(MEMBERSHIP_REQUIRED,403);
    if(room.customImage&&!await db.prepare('SELECT 1 FROM puzzle_user_images WHERE id=? AND owner_id=?').bind(room.customImage.id,userId).first())throw new RoomError('图片不存在',404);
    throw new RoomError('已有 3 个进行中的私人房间，请先完成其中一局',409);
  }
}
