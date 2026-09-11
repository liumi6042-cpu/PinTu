import { touchPublicRoom } from './public-room-retention';
import { maintainPublicRooms } from './public-room-maintenance';
import { localDb } from './local-db';
import { makeRoom, roomElapsedMs, ONLINE_MS, type Room, type RoomVisibility } from './room-engine';
import { PHOTOS, RESTORABLE_PHOTOS } from './puzzle-catalog';
import { placedCount } from './puzzle-engine';
import type { RoomCard } from './lobby-types';
export function newPlayableRoom(id:string,imageId:string,pieces:number,visibility:RoomVisibility,ownerId?:string,now=Date.now()){
 const room=makeRoom(id,imageId,pieces,now);room.visibility=visibility;room.ownerId=ownerId;room.startedAt=null;room.participants={};touchPublicRoom(room,now);return room;
}
function directoryInsert(room:Room,slot:string|null){const photo=PHOTOS.find(p=>p.id===room.puzzle.imageId)!;return localDb().prepare('INSERT INTO puzzle_room_directory (room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot) VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(room.id,room.visibility,room.ownerId||null,room.title||photo.title,photo.id,room.puzzle.cols*room.puzzle.rows,room.createdAt,room.expiresAt,slot);}
export async function insertPlayableRoom(room:Room,slot:string|null=null){
 const database=localDb(),commands=[];
 if(slot)commands.push(database.prepare('UPDATE puzzle_room_directory SET slot=NULL WHERE slot=? AND (expires_at<=? OR completed_at IS NOT NULL)').bind(slot,Date.now()));
 commands.push(database.prepare('INSERT INTO puzzle_rooms (id,revision,data,expires_at) VALUES (?,0,?,?)').bind(room.id,JSON.stringify(room),room.expiresAt),directoryInsert(room,slot));
 await database.batch(commands);
}
export async function saveCompletion(room:Room){
 if(!room.completedAt||!room.visibility)return;
 const database=localDb(),commands=[database.prepare('UPDATE puzzle_room_directory SET completed_at=? WHERE room_id=?').bind(room.completedAt,room.id)];
 const names=Object.values(room.participants||{});
 if(!room.customImage&&room.startedAt!=null&&names.length&&placedCount(room.puzzle)===room.puzzle.cols*room.puzzle.rows){
 commands.push(database.prepare('INSERT OR IGNORE INTO puzzle_results (room_id,mode,image_id,piece_count,player_count,elapsed_ms,completed_at,players_json) VALUES (?,?,?,?,?,?,?,?)').bind(room.id,room.visibility==='solo'?'solo':'team',room.puzzle.imageId,room.puzzle.cols*room.puzzle.rows,names.length,roomElapsedMs(room,room.completedAt),room.completedAt,JSON.stringify(names)));
 commands.push(database.prepare('INSERT OR IGNORE INTO puzzle_result_players (room_id,owner_id) SELECT ?,value FROM json_each(?)').bind(room.id,JSON.stringify(Object.keys(room.participants||{}))));
 }
 await database.batch(commands);
}
type CardRow={customImageData:string|null;customTitle:number;acceptingNew:number;lastPlayedAt:number;id:string;title:string;imageId:string;pieces:number;visibility:RoomVisibility;expiresAt:number;completedAt:number|null;startedAt:number|null;online:number;placed:number};
const summaryColumns=`json_extract(r.data,'$.customImage') AS customImageData,(json_extract(r.data,'$.title') IS NOT NULL) AS customTitle,COALESCE(json_extract(r.data,'$.acceptingNew'),1) AS acceptingNew,d.room_id AS id,d.title,d.image_id AS imageId,d.piece_count AS pieces,d.visibility,d.expires_at AS expiresAt,d.completed_at AS completedAt,COALESCE(json_extract(r.data,'$.lastPlayedAt'),d.created_at) AS lastPlayedAt,json_extract(r.data,'$.startedAt') AS startedAt,
 (SELECT COUNT(*) FROM json_each(r.data,'$.members') m WHERE CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?) AS online,
 COALESCE((SELECT SUM(json_array_length(json_extract(g.value,'$.pieces'))) FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')=1),0) AS placed`;
export async function roomCards(ownerId?:string,onlyOwned=false){
 await maintainPublicRooms();
 const now=Date.now(),where=onlyOwned?"d.owner_id=? AND d.visibility IN ('private','public') AND d.slot IS NULL":ownerId?"(d.owner_id=? OR (d.visibility!='solo' AND (EXISTS (SELECT 1 FROM json_each(r.data,'$.participants') participant WHERE participant.key=?) OR EXISTS (SELECT 1 FROM json_each(r.data,'$.members') member WHERE json_extract(member.value,'$.accountId')=? OR json_extract(member.value,'$.guestId')=?))))":'d.visibility=\'public\' AND d.completed_at IS NULL';
 const query=localDb().prepare('SELECT '+summaryColumns+' FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id WHERE '+where+' AND NOT EXISTS(SELECT 1 FROM puzzle_room_moderation m WHERE m.room_id=r.id AND m.closed=1) AND d.expires_at>? ORDER BY lastPlayedAt DESC'+(ownerId?'':' LIMIT 24'));
 const result=await (onlyOwned?query.bind(now-ONLINE_MS,ownerId,now):ownerId?query.bind(now-ONLINE_MS,ownerId,ownerId,ownerId,ownerId,now):query.bind(now-ONLINE_MS,now)).all<CardRow>();
 return result.results.filter(row=>RESTORABLE_PHOTOS.some(p=>p.id===row.imageId)||(ownerId&&row.customImageData)).map(row=>({...(row.customImageData?{customImage:JSON.parse(row.customImageData)}:{}),customTitle:!!row.customTitle,acceptingNew:!!row.acceptingNew,lastPlayedAt:row.lastPlayedAt,id:row.id,title:row.title,imageId:row.imageId,pieces:row.pieces,visibility:row.visibility,players:row.online,placed:row.placed,elapsed:row.startedAt===null?0:Math.floor(Math.max(0,(row.completedAt??now)-row.startedAt)/1000),started:row.startedAt!==null,startedAt:row.startedAt,completed:row.completedAt!==null,expiresAt:row.expiresAt})) satisfies RoomCard[];
}
export async function managedRooms(ownerId:string){return roomCards(ownerId,true);}
