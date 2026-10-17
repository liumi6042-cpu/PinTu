import { PUBLIC_LOBBY_REVEAL_MS,touchPublicRoom } from './public-room-retention';
import { maintainPublicRooms } from './public-room-maintenance';
import { localDb } from './local-db';
import { makeRoom, roomElapsedMs, ONLINE_MS, type Room, type RoomVisibility } from './room-engine';
import { PHOTOS, RESTORABLE_PHOTOS } from './puzzle-catalog';
import { placedCount } from './puzzle-engine';
import { pieceBand } from './piece-policy';
import type { RoomCard } from './lobby-types';
import { env } from 'cloudflare:workers';
import { PublicLobbyCache } from './public-lobby-cache';
import {resolveRoomArtwork} from './room-artwork';
const publicLobbyCache=new PublicLobbyCache();
function publicRoomTitle(title:string){
 const match=title.match(/^机器人练习桌\s*·\s*(.+)$/);
 return match?.[1]?.trim()||title;
}
export function newPlayableRoom(id:string,imageId:string,pieces:number,visibility:RoomVisibility,ownerId?:string,now=Date.now(),allowedImageIds?:readonly string[]){
 const room=makeRoom(id,imageId,pieces,now,allowedImageIds);room.visibility=visibility;room.ownerId=ownerId;room.startedAt=null;room.participants={};touchPublicRoom(room,now);return room;
}
// The directory and the leaderboard both record the *band* of the grid that was
// played, not the raw fitted count: a picture asked for 300 pieces may come out
// as 288 or 312 once the board follows its own ratio, and all of those belong to
// the same 300-piece board. A fixed level is its own band, so existing rows and
// retired levels keep the exact grid they always had.
function directoryInsert(room:Room,slot:string|null){
 // A room playing an uploaded picture has no catalog entry, so the room's own
 // title and image id are used. The directory row never carries the picture.
 const photo=PHOTOS.find(p=>p.id===room.puzzle.imageId);
 return localDb().prepare('INSERT INTO puzzle_room_directory (room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot) VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(room.id,room.visibility,room.ownerId||null,room.title||photo?.title||room.puzzle.imageId,room.puzzle.imageId,placedBand(room),room.createdAt,room.expiresAt,slot);
}
export async function insertPlayableRoom(room:Room,slot:string|null=null){
 const database=localDb(),commands=[];
 if(slot)commands.push(database.prepare('UPDATE puzzle_room_directory SET slot=NULL WHERE slot=? AND (expires_at<=? OR completed_at IS NOT NULL)').bind(slot,Date.now()));
 commands.push(database.prepare('INSERT INTO puzzle_rooms (id,revision,data,expires_at) VALUES (?,0,?,?)').bind(room.id,JSON.stringify(room),room.expiresAt),directoryInsert(room,slot));
 await database.batch(commands);
}
// A room's board size reduced to the leaderboard band it belongs to.
function placedBand(room:Room){return pieceBand(room.puzzle.cols*room.puzzle.rows)??room.puzzle.cols*room.puzzle.rows;}
export async function saveCompletion(room:Room){
 if(!room.completedAt||!room.visibility)return;
 const database=localDb(),commands=[database.prepare('UPDATE puzzle_room_directory SET completed_at=? WHERE room_id=?').bind(room.completedAt,room.id)];
 const names=Object.values(room.participants||{});
 if(!room.customImage&&room.startedAt!=null&&names.length&&placedCount(room.puzzle)===room.puzzle.cols*room.puzzle.rows){
 commands.push(database.prepare('INSERT OR IGNORE INTO puzzle_results (room_id,mode,image_id,piece_count,player_count,elapsed_ms,completed_at,players_json) VALUES (?,?,?,?,?,?,?,?)').bind(room.id,room.visibility==='solo'?'solo':'team',room.puzzle.imageId,placedBand(room),names.length,roomElapsedMs(room,room.completedAt),room.completedAt,JSON.stringify(names)));
 commands.push(database.prepare('INSERT OR IGNORE INTO puzzle_result_players (room_id,owner_id) SELECT ?,value FROM json_each(?)').bind(room.id,JSON.stringify(Object.keys(room.participants||{}))));
 }
 await database.batch(commands);
}
type CardRow={artworkData:string|null;customImageData:string|null;customTitle:number;acceptingNew:number;lastPlayedAt:number;id:string;title:string;imageId:string;pieces:number;visibility:RoomVisibility;expiresAt:number;completedAt:number|null;startedAt:number|null;online:number;placed:number};
const summaryColumns=`json_extract(r.data,'$.artwork') AS artworkData,json_extract(r.data,'$.customImage') AS customImageData,(json_extract(r.data,'$.title') IS NOT NULL) AS customTitle,COALESCE(json_extract(r.data,'$.acceptingNew'),1) AS acceptingNew,d.room_id AS id,d.title,d.image_id AS imageId,d.piece_count AS pieces,d.visibility,d.expires_at AS expiresAt,d.completed_at AS completedAt,COALESCE(json_extract(r.data,'$.lastPlayedAt'),d.created_at) AS lastPlayedAt,json_extract(r.data,'$.startedAt') AS startedAt,
 (SELECT COUNT(*) FROM json_each(r.data,'$.members') m WHERE CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?) AS online,
 COALESCE((SELECT SUM(json_array_length(json_extract(g.value,'$.pieces'))) FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')=1),0) AS placed`;
export async function roomCards(ownerId?:string,onlyOwned=false){
 await maintainPublicRooms();
 const database=localDb();
 // withSession may produce a new wrapper on every request. Key by the underlying
 // binding, while the actual query continues to use this request's primary session.
 const binding=(env as unknown as {PUZZLE_DB?:D1Database}).PUZZLE_DB;
 if(!ownerId&&!onlyOwned&&binding)return publicLobbyCache.read(binding,()=>queryRoomCards(database));
 return queryRoomCards(database,ownerId,onlyOwned);
}
// A room that has left the lobby is not gone. With progress on the table it stays in the puzzle
// records of everyone who played it, and it shows in the lobby again while somebody plays it
// (an hour after the play stops it hides again). A table with nothing on it is not kept.
const keptAfterLobby="(d.visibility='public' AND EXISTS(SELECT 1 FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')=1 OR json_array_length(json_extract(g.value,'$.pieces'))>1))";
const lobbyReveal="(d.expires_at>? OR COALESCE(json_extract(r.data,'$.lastPlayedAt'),d.created_at)>?)";
async function queryRoomCards(database:D1DatabaseSession,ownerId?:string,onlyOwned=false){
 const now=Date.now(),where=onlyOwned?"d.owner_id=? AND d.visibility IN ('private','public') AND d.slot IS NULL AND d.expires_at>?":ownerId?"(d.owner_id=? OR (d.visibility!='solo' AND (EXISTS (SELECT 1 FROM json_each(r.data,'$.participants') participant WHERE participant.key=?) OR EXISTS (SELECT 1 FROM json_each(r.data,'$.members') member WHERE json_extract(member.value,'$.accountId')=? OR json_extract(member.value,'$.guestId')=?)))) AND (d.expires_at>? OR "+keptAfterLobby+")":"d.visibility='public' AND d.completed_at IS NULL AND "+lobbyReveal;
 const query=database.prepare('SELECT '+summaryColumns+' FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id WHERE '+where+' AND COALESCE(json_extract(r.data,\'$.botRoom\'),0)=0 AND NOT EXISTS(SELECT 1 FROM puzzle_room_moderation m WHERE m.room_id=r.id AND m.closed=1) ORDER BY lastPlayedAt DESC'+(ownerId?'':' LIMIT 24'));
 const result=await (onlyOwned?query.bind(now-ONLINE_MS,ownerId,now):ownerId?query.bind(now-ONLINE_MS,ownerId,ownerId,ownerId,ownerId,now):query.bind(now-ONLINE_MS,now,now-PUBLIC_LOBBY_REVEAL_MS)).all<CardRow>();
 // Uploaded public rooms expose only safe image metadata. The card requests its
 // separate 480px preview; neither original nor preview bytes enter this JSON.
 return result.results.filter(row=>RESTORABLE_PHOTOS.some(p=>p.id===row.imageId)||row.customImageData).map(row=>{
  const artwork=resolveRoomArtwork({puzzle:{imageId:row.imageId},artwork:row.artworkData?JSON.parse(row.artworkData):undefined,customImage:row.customImageData});
  // Uploaded pictures have no catalogue entry, so their preview URL is built here.
  const uploaded=row.customImageData?JSON.parse(row.customImageData):null;
  const thumbSrc=artwork?.thumbSrc??(uploaded?'/api/user-images/'+uploaded.id+'?room='+row.id+'&preview=1':undefined);
  return {artwork,thumbSrc,...(uploaded?{customImage:uploaded}:{}),customTitle:!!row.customTitle,acceptingNew:!!row.acceptingNew,lastPlayedAt:row.lastPlayedAt,id:row.id,title:publicRoomTitle(row.title),imageId:row.imageId,pieces:row.pieces,visibility:row.visibility,players:row.online,placed:row.placed,elapsed:row.startedAt===null?0:Math.floor(Math.max(0,(row.completedAt??now)-row.startedAt)/1000),started:row.startedAt!==null,startedAt:row.startedAt,completed:row.completedAt!==null,expiresAt:row.expiresAt};
 }) satisfies RoomCard[];
}
export async function managedRooms(ownerId:string){return roomCards(ownerId,true);}
