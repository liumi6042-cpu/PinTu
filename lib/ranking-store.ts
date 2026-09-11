import { localDb } from './local-db';
import { RoomError,type Room } from './room-engine';
import { PHOTOS,RESTORABLE_PHOTOS } from './puzzle-catalog';
import { SAVED_LEVELS } from './puzzle-engine';
import { tokenHash } from './account-crypto';
import { beijingWeek,recordKind } from './ranking-policy';
import type { RankingRow,RankingBoard } from './lobby-types';
type Row={room_id:string;elapsed_ms:number;completed_at:number;player_count:number;players_json:string;visibility:string|null;mine?:number};
const fields='r.room_id,r.elapsed_ms,r.completed_at,r.player_count,r.players_json,d.visibility';
const joins='FROM puzzle_results r LEFT JOIN puzzle_room_directory d ON d.room_id=r.room_id';
const order='r.elapsed_ms ASC,r.completed_at ASC,r.room_id ASC';
function conditions(url:URL,now:number){
  const mode=url.searchParams.get('mode')||'team',imageId=url.searchParams.get('imageId')||PHOTOS[0].id,pieces=Number(url.searchParams.get('pieces')||108),players=Number(url.searchParams.get('players')||1),period=url.searchParams.get('period')||'all';
  if(!['solo','team'].includes(mode)||!RESTORABLE_PHOTOS.some(p=>p.id===imageId)||!SAVED_LEVELS.some(l=>l.count===pieces)||!Number.isInteger(players)||players<1||players>32||!['all','week'].includes(period))throw new RoomError('请选择有效的榜单条件');
  const week=beijingWeek(now),values:(number|string)[]=[mode,imageId,pieces,mode==='solo'?1:players];
  let sql='r.mode=? AND r.image_id=? AND r.piece_count=? AND r.player_count=? AND NOT EXISTS(SELECT 1 FROM puzzle_score_moderation m WHERE m.room_id=r.room_id AND m.hidden=1)';
  if(period==='week'){sql+=' AND r.completed_at>=? AND r.completed_at<?';values.push(week.start,week.end);}
  return {sql,values,period:period as 'all'|'week',week};
}
async function display(row:Row,rank:number):Promise<RankingRow>{return {roomId:row.visibility==='private'||row.visibility===null?'result:'+await tokenHash(row.room_id):row.room_id,elapsedMs:row.elapsed_ms,completedAt:row.completed_at,playerCount:row.player_count,names:JSON.parse(row.players_json),rank,mine:!!row.mine};}
export async function rankingBoard(url:URL,identities:string[]=[],now=Date.now()):Promise<RankingBoard>{
  const filter=conditions(url,now),owners=[...new Set(identities)].slice(0,2),db=localDb();
  const owned=owners.length?`EXISTS (SELECT 1 FROM puzzle_result_players p WHERE p.room_id=r.room_id AND p.owner_id IN (${owners.map(()=>'?').join(',')}))`:'0';
  const ownRooms=owners.length?`r.room_id IN (SELECT p.room_id FROM puzzle_result_players p WHERE p.owner_id IN (${owners.map(()=>'?').join(',')}))`:'0';
  const [top,total,best]=await Promise.all([
    db.prepare(`SELECT ${fields},${owned} AS mine ${joins} WHERE ${filter.sql} ORDER BY ${order} LIMIT 50`).bind(...owners,...filter.values).all<Row>(),
    db.prepare(`SELECT COUNT(*) AS count FROM puzzle_results r WHERE ${filter.sql}`).bind(...filter.values).first<{count:number}>(),
    owners.length?db.prepare(`SELECT ${fields},1 AS mine ${joins} WHERE ${filter.sql} AND ${ownRooms} ORDER BY ${order} LIMIT 1`).bind(...filter.values,...owners).first<Row>():Promise.resolve(null),
  ]);
  let myBest:RankingRow|null=null;
  if(best){const earlier=await db.prepare(`SELECT COUNT(*) AS count FROM puzzle_results r WHERE ${filter.sql} AND (r.elapsed_ms<? OR (r.elapsed_ms=? AND (r.completed_at<? OR (r.completed_at=? AND r.room_id<?))))`).bind(...filter.values,best.elapsed_ms,best.elapsed_ms,best.completed_at,best.completed_at,best.room_id).first<{count:number}>();myBest=await display(best,(earlier?.count||0)+1);}
  return {entries:await Promise.all(top.results.map((row,index)=>display(row,index+1))),myBest,total:total?.count||0,period:filter.period,weekStart:filter.week.start,weekEnd:filter.week.end,hasIdentity:owners.length>0};
}
export async function completionRecord(room:Room,ownerId?:string,identities:string[]=[]){
  if(!room.completedAt)throw new RoomError('拼图尚未完成',409);
  if(!ownerId||!room.participants?.[ownerId])return {kind:'observer' as const};
  const owners=[...new Set([ownerId,...identities])].slice(0,2);
  const db=localDb(),current=await db.prepare('SELECT * FROM puzzle_results WHERE room_id=?').bind(room.id).first<Row&{mode:string;image_id:string;piece_count:number}>();
  if(!current)throw new RoomError('成绩正在保存，请稍后重试',503);
  if(await db.prepare('SELECT 1 FROM puzzle_score_moderation WHERE room_id=? AND hidden=1').bind(room.id).first())throw new RoomError('成绩正在复核，暂不参与榜单',409);
  const previous=await db.prepare(`SELECT MIN(r.elapsed_ms) AS elapsed FROM puzzle_results r JOIN puzzle_result_players p ON p.room_id=r.room_id
    WHERE p.owner_id IN (${owners.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM puzzle_score_moderation m WHERE m.room_id=r.room_id AND m.hidden=1) AND r.mode=? AND r.image_id=? AND r.piece_count=? AND r.player_count=? AND r.room_id!=?
    AND (r.completed_at<? OR (r.completed_at=? AND r.room_id<?))`).bind(...owners,current.mode,current.image_id,current.piece_count,current.player_count,room.id,current.completed_at,current.completed_at,room.id).first<{elapsed:number|null}>();
  const previousMs=previous?.elapsed??null;
  return {kind:recordKind(current.elapsed_ms,previousMs),elapsedMs:current.elapsed_ms,previousMs,improvedMs:previousMs===null?0:Math.max(0,previousMs-current.elapsed_ms)};
}
