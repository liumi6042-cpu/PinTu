import { localDb } from '@/lib/local-db';
import { body, failure, getDigest, json,readRoom } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
import { ONLINE_MS, RoomError, type Member, type RoomVisibility } from '@/lib/room-engine';
import { CURSOR_TTL, cursorInput, type SharedCursor } from '@/lib/room-cursors';
type Context={params:Promise<{id:string}>};
type CursorRoom={id:string;expiresAt:number;visibility?:RoomVisibility;members:Member[]};
async function authorize(request:Request,context:Context){
  const {id}=await context.params,now=Date.now(),digest=await getDigest(request);
  if(!/^[a-f0-9]{32}$/.test(id))throw new RoomError('邀请链接格式不正确',404);
  // Share the bounded room read cache with polling. Revision is checked in SQLite on every request.
  const stored=await readRoom(id),room:CursorRoom={id,expiresAt:stored.expiresAt,visibility:stored.visibility,members:stored.members};
  const member=await checkRoomAccount(request,room,digest,now);
  if(room.visibility==='solo')throw new RoomError('单人拼图无需同步鼠标',400);
  if(now-member.lastSeen>=ONLINE_MS)throw new RoomError('请先重新连接房间',409);
  return {room,member,now};
}
async function positions(room:CursorRoom,now:number){
  const data=await localDb().prepare(`SELECT c.player_id,c.x,c.y,c.updated_at,p.equipped AS badge FROM puzzle_room_cursors c
    JOIN json_each(?) m ON json_extract(m.value,'$.id')=c.player_id
    LEFT JOIN puzzle_achievement_profiles p ON p.owner_id=COALESCE(json_extract(m.value,'$.accountId'),json_extract(m.value,'$.guestId'))
    WHERE c.room_id=? AND c.updated_at>? AND c.x IS NOT NULL AND c.y IS NOT NULL`).bind(JSON.stringify(room.members),room.id,now-CURSOR_TTL).all<{player_id:string;x:number;y:number;updated_at:number;badge:string|null}>();
  const members=new Map(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(m=>[m.id,m]));
  const cursors:SharedCursor[]=[];
  for(const row of data.results){const member=members.get(row.player_id);if(member)cursors.push({playerId:member.id,name:member.name,color:member.color,badge:row.badge,x:row.x,y:row.y,updatedAt:row.updated_at});}
  return json({cursors,serverTime:now});
}
export async function GET(request:Request,context:Context){try{const {room,now}=await authorize(request,context);return await positions(room,now);}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
  const input=cursorInput(await body(request));if(!input)throw new RoomError('鼠标位置无效');
  const {room,member,now}=await authorize(request,context),database=localDb();
  const commands=[database.prepare(`INSERT INTO puzzle_room_cursors (room_id,player_id,client_id,seq,x,y,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(room_id,player_id) DO UPDATE SET client_id=excluded.client_id,seq=excluded.seq,x=excluded.x,y=excluded.y,updated_at=excluded.updated_at
    WHERE puzzle_room_cursors.client_id!=excluded.client_id OR excluded.seq>puzzle_room_cursors.seq`).bind(room.id,member.id,input.clientId,input.seq,input.point?.x??null,input.point?.y??null,now)];
  if(input.seq%50===0)commands.push(database.prepare('DELETE FROM puzzle_room_cursors WHERE updated_at<?').bind(now-60000));
  await database.batch(commands);return await positions(room,now);
}catch(error){return failure(error);}}
