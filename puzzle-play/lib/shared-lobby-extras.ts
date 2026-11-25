import {env} from 'cloudflare:workers';
import {localDb} from './local-db';
import {ONLINE_MS} from './room-engine';
import {dailyPuzzle,dailyPuzzleDate} from './daily-puzzle';
import {readManagedContent,managedDailyPuzzle} from './managed-content';
import {ownedManagedCursors} from './managed-economy';
import {playerName} from './player-name';

export const ONLINE_SQL=`SELECT COUNT(DISTINCT COALESCE(NULLIF(json_extract(m.value,'$.accountId'),''),NULLIF(json_extract(m.value,'$.guestId'),''))) AS count
 FROM puzzle_rooms r, json_each(r.data,'$.members') m
 WHERE json_extract(r.data,'$.completedAt') IS NULL
 AND COALESCE(json_extract(r.data,'$.botRoom'),0)=0
 AND CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?
 AND NOT EXISTS(SELECT 1 FROM puzzle_room_moderation x WHERE x.room_id=r.id AND x.closed=1)`;
// Web DailyJoin deliberately joins ordinary tables for the daily image. There is
// no daily mode flag: image + Beijing completion day is the existing Web policy.
// Results survive room cleanup, so this query must not join the live room table.
export const DAILY_FINISHED_SQL=`SELECT COUNT(DISTINCT p.owner_id) AS count
 FROM puzzle_results r JOIN puzzle_result_players p ON p.room_id=r.room_id
 WHERE r.completed_at>=? AND r.completed_at<? AND r.image_id=?`;
const dailyCache=new WeakMap<object,{day:string;imageId:string;at:number;count:number}>();
const onlineCache=new WeakMap<object,{at:number;count:number}>();
type Card={id:string;[key:string]:any};
type Seat={roomId:string;owner:string;name:string;level:number};
export async function sharedLobbyExtras(cards:Card[],now=Date.now()){
 const db=localDb(),content=readManagedContent(),day=dailyPuzzleDate(now),imageId=(content?managedDailyPuzzle(content,now):dailyPuzzle(now)).id;
 const binding=(env as unknown as {PUZZLE_DB:object}).PUZZLE_DB;
 // The lobby is polled and this scans every open room's JSON, so share one count for 10 s.
 let presence=onlineCache.get(binding);
 if(!presence||now<presence.at||now-presence.at>=10000){presence={at:now,count:Number(await db.prepare(ONLINE_SQL).bind(now-90000).first<number>('count')??0)};onlineCache.set(binding,presence);}
 const online=presence.count;
 let cached=dailyCache.get(binding);
 if(!cached||cached.day!==day||cached.imageId!==imageId||now<cached.at||now-cached.at>=30000){
  const start=Date.parse(day+'T00:00:00+08:00');
  cached={day,imageId,at:now,count:Number(await db.prepare(DAILY_FINISHED_SQL).bind(start,start+86400000,imageId).first<number>('count')??0)};
  dailyCache.set(binding,cached);
 }
 const members=new Map<string,Seat[]>();
 if(cards.length){
  const rows=await db.prepare(`SELECT r.id AS roomId,
   COALESCE(NULLIF(json_extract(m.value,'$.accountId'),''),NULLIF(json_extract(m.value,'$.guestId'),'')) AS owner,
   json_extract(m.value,'$.name') AS name,COALESCE(json_extract(p.data,'$.level'),0) AS level
   FROM puzzle_rooms r, json_each(r.data,'$.members') m
   LEFT JOIN puzzle_managed_players p ON p.owner=COALESCE(NULLIF(json_extract(m.value,'$.accountId'),''),NULLIF(json_extract(m.value,'$.guestId'),''))
   WHERE r.id IN (${cards.map(()=>'?').join(',')})
   AND CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?
   AND COALESCE(json_extract(m.value,'$.bot'),0)=0
   ORDER BY r.id,CAST(m.key AS INTEGER)`).bind(...cards.map(card=>card.id),now-ONLINE_MS).all<Seat>();
  for(const row of rows.results){if(!row.owner)continue;const seats=members.get(row.roomId)??[];if(seats.length<4)seats.push(row);members.set(row.roomId,seats);}
 }
 const cursors=await ownedManagedCursors([...members.values()].flat().map(seat=>seat.owner),content);
 return {online,dailyFinished:cached.count,rooms:cards.map(card=>({...card,members:(members.get(card.id)??[]).map(seat=>({name:playerName(seat.name,seat.owner),level:seat.level,decoration:cursors.get(seat.owner)??null}))}))};
}
