import { localDb } from './local-db';
import { achievementById,awardAchievements,emptyBook,type AchievementId,type AchievementFact } from './achievements';
import { RESTORABLE_PHOTOS } from './puzzle-catalog';
import { completionOwners } from './room-achievements';
import { RoomError,type Room } from './room-engine';

export async function serverAchievementBook(owner:string){
  const db=localDb(),[facts,days,awards,profile]=await Promise.all([
    db.prepare('SELECT f.room_id AS key,f.image_id AS imageId,f.pieces,f.mode,f.category,f.completed_at AS completedAt,(SELECT players_json FROM puzzle_results r WHERE r.room_id=f.room_id) AS partnersJson FROM puzzle_achievement_facts f WHERE f.owner_id=? ORDER BY f.completed_at').bind(owner).all<AchievementFact & {partnersJson:string|null}>(),
    db.prepare('SELECT day FROM puzzle_achievement_days WHERE owner_id=? ORDER BY day').bind(owner).all<{day:string}>(),
    db.prepare('SELECT badge_id,earned_at FROM puzzle_achievement_awards WHERE owner_id=?').bind(owner).all<{badge_id:AchievementId;earned_at:number}>(),
    db.prepare('SELECT equipped FROM puzzle_achievement_profiles WHERE owner_id=?').bind(owner).first<{equipped:AchievementId|null}>(),
  ]);
  const book=emptyBook();book.facts=facts.results.map(({partnersJson,...f})=>({...f,partners:partnersJson?JSON.parse(partnersJson):[]}));book.days=days.results.map(d=>d.day);
  for(const row of awards.results)if(achievementById(row.badge_id))book.earned[row.badge_id]=row.earned_at;
  book.equipped=profile?.equipped&&book.earned[profile.equipped]?profile.equipped:null;return book;
}
async function awardOwner(owner:string,now:number){
  const book=await serverAchievementBook(owner),added=awardAchievements(book,now),db=localDb();
  if(added.length)await db.batch(added.map(id=>db.prepare('INSERT OR IGNORE INTO puzzle_achievement_awards (owner_id,badge_id,earned_at) VALUES (?,?,?)').bind(owner,id,now)));
}
export function roomAchievementDays(room:Room){return Object.fromEntries(Object.entries(room.achievements?.contributors||{}).map(([owner,c])=>[owner,c.days.length]));}
export async function saveAchievementActivity(room:Room,previous:Record<string,number>={}){
  const entries=Object.entries(room.achievements?.contributors||{}).filter(([owner,c])=>c.days.length>(previous[owner]||0));if(!entries.length)return;
  const db=localDb(),commands=entries.flatMap(([owner,c])=>c.days.slice(previous[owner]||0).map(day=>db.prepare('INSERT OR IGNORE INTO puzzle_achievement_days (owner_id,day) VALUES (?,?)').bind(owner,day)));
  if(commands.length)await db.batch(commands);
  await Promise.all(entries.map(([owner])=>awardOwner(owner,Date.now())));
}
export async function saveAchievementCompletion(room:Room){
  if(!room.completedAt||room.customImage)return;const db=localDb();
  if(await db.prepare('SELECT 1 FROM puzzle_achievement_settled WHERE room_id=?').bind(room.id).first())return;
  const owners=completionOwners(room),photo=RESTORABLE_PHOTOS.find(p=>p.id===room.puzzle.imageId);if(!photo)return;
  const commands=owners.map(({owner,mode})=>db.prepare('INSERT OR IGNORE INTO puzzle_achievement_facts (owner_id,room_id,image_id,pieces,mode,category,completed_at) VALUES (?,?,?,?,?,?,?)').bind(owner,room.id,photo.id,room.puzzle.cols*room.puzzle.rows,mode,photo.category,room.completedAt!));
  for(const [owner,c] of Object.entries(room.achievements?.contributors||{}))for(const day of c.days)commands.push(db.prepare('INSERT OR IGNORE INTO puzzle_achievement_days (owner_id,day) VALUES (?,?)').bind(owner,day));
  commands.push(db.prepare('INSERT OR IGNORE INTO puzzle_achievement_settled (room_id) VALUES (?)').bind(room.id));
  await db.batch(commands);await Promise.all(owners.map(({owner})=>awardOwner(owner,room.completedAt!)));
}
export async function backfillSoloAchievements(owner:string){
  const db=localDb();
  // Only provable solo completions are eligible. Historical team participants are not contribution evidence.
  const rows=await db.prepare("SELECT r.id,json_extract(r.data,'$.puzzle.imageId') AS imageId,json_extract(r.data,'$.puzzle.cols')*json_extract(r.data,'$.puzzle.rows') AS pieces,json_extract(r.data,'$.completedAt') AS completedAt FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id WHERE d.owner_id=? AND d.visibility='solo' AND json_extract(r.data,'$.visibility')='solo' AND json_extract(r.data,'$.completedAt') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM puzzle_achievement_facts f WHERE f.owner_id=? AND f.room_id=r.id) AND NOT EXISTS (SELECT 1 FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')!=1)").bind(owner,owner).all<{id:string;imageId:string;pieces:number;completedAt:number}>();
  const commands=rows.results.flatMap(r=>{const photo=RESTORABLE_PHOTOS.find(p=>p.id===r.imageId);return photo?[db.prepare('INSERT OR IGNORE INTO puzzle_achievement_facts (owner_id,room_id,image_id,pieces,mode,category,completed_at) VALUES (?,?,?,?,?,?,?)').bind(owner,r.id,r.imageId,r.pieces,'solo',photo.category,r.completedAt)]:[];});
  if(commands.length)await db.batch(commands);await awardOwner(owner,Date.now());
}
export async function equipServerAchievement(owner:string,id:unknown){
  if(id!==null&&!achievementById(id))throw new RoomError('请选择有效徽章');
  const book=await serverAchievementBook(owner);if(id&&!book.earned[id as AchievementId])throw new RoomError('请先解锁这枚徽章',403);
  await localDb().prepare('INSERT INTO puzzle_achievement_profiles (owner_id,equipped) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET equipped=excluded.equipped').bind(owner,id).run();
  return {...book,equipped:id as AchievementId|null};
}
