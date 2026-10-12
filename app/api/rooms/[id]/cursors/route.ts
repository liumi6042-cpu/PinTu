import { localDb } from '@/lib/local-db';
import { worldFor } from '@/lib/puzzle-engine';
import { body, failure, getDigest, json,readRoom } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
import { ONLINE_MS, RoomError, type Member, type Room, type RoomVisibility } from '@/lib/room-engine';
import { cursorInput, type SharedCursor } from '@/lib/room-cursors';
type Context={params:Promise<{id:string}>};
type CursorRoom={id:string;expiresAt:number;visibility?:RoomVisibility;members:Member[];puzzle:Room['puzzle']};
async function authorize(request:Request,context:Context){
  const {id}=await context.params,now=Date.now(),digest=await getDigest(request);
  if(!/^[a-f0-9]{32}$/.test(id))throw new RoomError('邀请链接格式不正确',404);
  // Share the bounded room read cache with polling. Revision is checked in SQLite on every request.
  const stored=await readRoom(id),room:CursorRoom={id,expiresAt:stored.expiresAt,visibility:stored.visibility,members:stored.members,puzzle:stored.puzzle};
  const member=await checkRoomAccount(request,room,digest,now);
  if(room.visibility==='solo')throw new RoomError('单人拼图无需同步鼠标',400);
  if(now-member.lastSeen>=ONLINE_MS)throw new RoomError('请先重新连接房间',409);
  return {room,member,now};
}
async function positions(room:CursorRoom,now:number){
  const data=await localDb().prepare(`SELECT c.player_id,c.x,c.y,c.updated_at,p.equipped AS badge,CASE WHEN COALESCE(s.status,'active')='active' AND EXISTS(SELECT 1 FROM json_each(g.data,'$.cosmetics.cursors') WHERE value=json_extract(g.data,'$.cosmetics.equipped.cursor')) THEN json_extract(g.data,'$.cosmetics.equipped.cursor') END AS cursorStyle FROM puzzle_room_cursors c
    JOIN json_each(?) m ON json_extract(m.value,'$.id')=c.player_id
    LEFT JOIN puzzle_achievement_profiles p ON p.owner_id=COALESCE(json_extract(m.value,'$.accountId'),json_extract(m.value,'$.guestId'))
    LEFT JOIN puzzle_courtyards g ON g.user_id=json_extract(m.value,'$.accountId')
    LEFT JOIN puzzle_account_security s ON s.user_id=g.user_id
    WHERE c.room_id=? AND CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>? AND c.x IS NOT NULL AND c.y IS NOT NULL`).bind(JSON.stringify(room.members),room.id,now-ONLINE_MS).all<{player_id:string;x:number;y:number;updated_at:number;badge:string|null;cursorStyle:string|null}>();
  const members=new Map(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(m=>[m.id,m]));
  const cursors:SharedCursor[]=[];
  for(const row of data.results){const member=members.get(row.player_id);if(member)cursors.push({playerId:member.id,name:member.name,color:member.color,badge:row.badge,cursorStyle:row.cursorStyle,x:row.x,y:row.y,updatedAt:row.updated_at});}
  return json({cursors,serverTime:now});
}
export async function GET(request:Request,context:Context){try{const {room,now}=await authorize(request,context);return await positions(room,now);}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
  const raw=await body(request),{room,member,now}=await authorize(request,context),database=localDb();
  const input=cursorInput(raw,worldFor(room.puzzle));if(!input)throw new RoomError('鼠标位置无效');
  const commands=[database.prepare(`INSERT INTO puzzle_room_cursors (room_id,player_id,client_id,seq,x,y,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(room_id,player_id) DO UPDATE SET client_id=excluded.client_id,seq=excluded.seq,x=excluded.x,y=excluded.y,updated_at=excluded.updated_at
    WHERE puzzle_room_cursors.client_id!=excluded.client_id OR excluded.seq>puzzle_room_cursors.seq`).bind(room.id,member.id,input.clientId,input.seq,input.point?.x??null,input.point?.y??null,now)];
  // Stationary online pointers stay visible. Only reclaim old positions belonging
  // to players who are no longer online (or whose room has been removed).
  if(input.seq%50===0)commands.push(database.prepare(`DELETE FROM puzzle_room_cursors WHERE updated_at<?
    AND NOT EXISTS(SELECT 1 FROM puzzle_rooms r,json_each(r.data,'$.members') m
      WHERE r.id=puzzle_room_cursors.room_id AND json_extract(m.value,'$.id')=puzzle_room_cursors.player_id
      AND CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?)`).bind(now-60000,now-ONLINE_MS));
  await database.batch(commands);return await positions(room,now);
}catch(error){return failure(error);}}
