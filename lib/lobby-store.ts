import { localDb } from './local-db';
import { makeRoom, roomElapsedMs, RoomError, ONLINE_MS, type Room, type RoomVisibility } from './room-engine';
import { PHOTOS } from './puzzle-catalog';
import { LEVELS, placedCount } from './puzzle-engine';
import type { RoomCard,RankingRow } from './lobby-types';
export function newPlayableRoom(id:string,imageId:string,pieces:number,visibility:RoomVisibility,ownerId?:string,now=Date.now()){
 const room=makeRoom(id,imageId,pieces,now);room.visibility=visibility;room.ownerId=ownerId;room.startedAt=null;room.participants={};return room;
}
function directoryInsert(room:Room,slot:string|null){const photo=PHOTOS.find(p=>p.id===room.puzzle.imageId)!;return localDb().prepare('INSERT INTO puzzle_room_directory (room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot) VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(room.id,room.visibility,room.ownerId||null,photo.title,photo.id,room.puzzle.cols*room.puzzle.rows,room.createdAt,room.expiresAt,slot);}
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
 if(room.startedAt!=null&&names.length&&placedCount(room.puzzle)===room.puzzle.cols*room.puzzle.rows){
 commands.push(database.prepare('INSERT OR IGNORE INTO puzzle_results (room_id,mode,image_id,piece_count,player_count,elapsed_ms,completed_at,players_json) VALUES (?,?,?,?,?,?,?,?)').bind(room.id,room.visibility==='solo'?'solo':'team',room.puzzle.imageId,room.puzzle.cols*room.puzzle.rows,names.length,roomElapsedMs(room,room.completedAt),room.completedAt,JSON.stringify(names)));
 }
 await database.batch(commands);
}
async function ensurePublicTables(){
 const counts=[48,108,300,500],now=Date.now();
 for(let i=0;i<PHOTOS.length;i++){
  const slot='daily-'+PHOTOS[i].id,existing=await localDb().prepare('SELECT room_id FROM puzzle_room_directory WHERE slot=? AND expires_at>? AND completed_at IS NULL').bind(slot,now).first();
  if(existing)continue;
  const room=newPlayableRoom(crypto.randomUUID().replaceAll('-',''),PHOTOS[i].id,counts[i%counts.length],'public',undefined,now);
  try{await insertPlayableRoom(room,slot);}catch(error){if(!String(error).includes('UNIQUE'))throw error;}
 }
}
type CardRow={id:string;title:string;imageId:string;pieces:number;visibility:RoomVisibility;expiresAt:number;completedAt:number|null;startedAt:number|null;online:number;placed:number};
const summaryColumns=`d.room_id AS id,d.title,d.image_id AS imageId,d.piece_count AS pieces,d.visibility,d.expires_at AS expiresAt,d.completed_at AS completedAt,json_extract(r.data,'$.startedAt') AS startedAt,
 (SELECT COUNT(*) FROM json_each(r.data,'$.members') m WHERE CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?) AS online,
 COALESCE((SELECT SUM(json_array_length(json_extract(g.value,'$.pieces'))) FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')=1),0) AS placed`;
export async function roomCards(ownerId?:string){
 if(!ownerId)await ensurePublicTables();
 const now=Date.now(),where=ownerId?'d.owner_id=?':'d.visibility=\'public\' AND d.completed_at IS NULL';
 const query=localDb().prepare('SELECT '+summaryColumns+' FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id WHERE '+where+' AND d.expires_at>? ORDER BY d.created_at DESC LIMIT 24');
 const result=await (ownerId?query.bind(now-ONLINE_MS,ownerId,now):query.bind(now-ONLINE_MS,now)).all<CardRow>();
 return result.results.filter(row=>PHOTOS.some(p=>p.id===row.imageId)).map(row=>({id:row.id,title:row.title,imageId:row.imageId,pieces:row.pieces,visibility:row.visibility,players:row.online,placed:row.placed,elapsed:row.startedAt===null?0:Math.floor(Math.max(0,(row.completedAt??now)-row.startedAt)/1000),started:row.startedAt!==null,completed:row.completedAt!==null,expiresAt:row.expiresAt})) satisfies RoomCard[];
}
export async function rankings(url:URL){
 const mode=url.searchParams.get('mode')||'team',imageId=url.searchParams.get('imageId')||PHOTOS[0].id,pieces=Number(url.searchParams.get('pieces')||48),players=Number(url.searchParams.get('players')||1);
 if(!['solo','team'].includes(mode)||!PHOTOS.some(p=>p.id===imageId)||!LEVELS.some(l=>l.count===pieces)||!Number.isInteger(players)||players<1||players>32)throw new RoomError('请选择有效的榜单条件');
 const count=mode==='solo'?1:players;
 const data=await localDb().prepare('SELECT room_id,elapsed_ms,completed_at,player_count,players_json FROM puzzle_results WHERE mode=? AND image_id=? AND piece_count=? AND player_count=? ORDER BY elapsed_ms ASC,completed_at ASC,room_id ASC LIMIT 50').bind(mode,imageId,pieces,count).all<{room_id:string;elapsed_ms:number;completed_at:number;player_count:number;players_json:string}>();
 return data.results.map(r=>({roomId:r.room_id,elapsedMs:r.elapsed_ms,completedAt:r.completed_at,playerCount:r.player_count,names:JSON.parse(r.players_json) as string[]})) satisfies RankingRow[];
}
