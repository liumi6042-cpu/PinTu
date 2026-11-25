// Web's existing cookie identities and database remain authoritative.
export const WEB_ROOM_HISTORY_SCHEMA=`
 CREATE TABLE IF NOT EXISTS puzzle_shared_room_history(owner_id TEXT NOT NULL,room_id TEXT NOT NULL,last_joined_at INTEGER NOT NULL,PRIMARY KEY(owner_id,room_id));
 CREATE INDEX IF NOT EXISTS puzzle_shared_room_history_recent ON puzzle_shared_room_history(owner_id,last_joined_at DESC,room_id DESC);
 CREATE TABLE IF NOT EXISTS puzzle_shared_room_history_seeded(owner_id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS puzzle_shared_created_hidden(owner_id TEXT NOT NULL,room_id TEXT NOT NULL,hidden_at INTEGER NOT NULL,PRIMARY KEY(owner_id,room_id));
`;
const access=`(json_extract(data,'$.ownerId')=? OR EXISTS(SELECT 1 FROM json_each(data,'$.admitted') a WHERE a.key=?)
 OR EXISTS(SELECT 1 FROM json_each(data,'$.participants') p WHERE p.key=?)
 OR EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.accountId')=? OR json_extract(m.value,'$.guestId')=?))`;
const markers=owners=>owners.map(()=>'?').join(',');
const trim=(db,owner)=>db.prepare('DELETE FROM puzzle_shared_room_history WHERE owner_id=? AND room_id NOT IN (SELECT room_id FROM puzzle_shared_room_history WHERE owner_id=? ORDER BY last_joined_at DESC,room_id DESC LIMIT 10)').bind(owner,owner);
async function seed(db,owners){
 for(const owner of owners){
  if(await db.prepare('SELECT 1 FROM puzzle_shared_room_history_seeded WHERE owner_id=?').bind(owner).first())continue;
  // Only a one-time approximation is possible for legacy admissions.
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO puzzle_shared_room_history(owner_id,room_id,last_joined_at)
    SELECT ?,id,MAX(COALESCE((SELECT MAX(CAST(json_extract(m.value,'$.joinedAt') AS INTEGER)) FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.accountId')=? OR json_extract(m.value,'$.guestId')=?),0),COALESCE(json_extract(data,'$.createdAt'),0)) joined
    FROM puzzle_rooms WHERE COALESCE(json_extract(data,'$.botRoom'),0)=0 AND ${access}
    AND NOT EXISTS(SELECT 1 FROM puzzle_shared_room_history_seeded WHERE owner_id=?)
    ORDER BY joined DESC,id DESC LIMIT 10`).bind(owner,owner,owner,owner,owner,owner,owner,owner,owner),
   trim(db,owner),db.prepare('INSERT OR IGNORE INTO puzzle_shared_room_history_seeded VALUES(?)').bind(owner),
  ]);
 }
}
function card(row,decorate){
 const room=JSON.parse(row.data),total=room.puzzle.cols*room.puzzle.rows,completed=room.completedAt!=null,now=Date.now();
 return {id:room.id,title:completed?'已完成':room.title||'一起拼图',imageId:room.puzzle.imageId,pieces:total,actualPieces:total,
  visibility:room.visibility,players:(room.members??[]).filter(m=>m.lastSeen>now-22000).length,
  placed:room.puzzle.groups.filter(g=>g.locked).reduce((sum,g)=>sum+g.pieces.length,0),completed,completedAt:room.completedAt,
  started:room.startedAt!=null,startedAt:room.startedAt,createdAt:room.createdAt,expiresAt:room.expiresAt,lastPlayedAt:room.lastPlayedAt,
  acceptingNew:room.acceptingNew!==false,lastJoinedAt:row.last_joined_at??undefined,unavailable:!!row.closed,...decorate(room)};
}
/** @param {any} db @param {string[]} owners @param {(room:any)=>any} [decorate] */
export async function webRecentRooms(db,owners,decorate=()=>({})){
 if(!owners.length)return [];
 await seed(db,owners);
 const rows=await db.prepare(`SELECT r.data,MAX(h.last_joined_at) last_joined_at,m.closed FROM puzzle_shared_room_history h
  JOIN puzzle_rooms r ON r.id=h.room_id LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id
  WHERE h.owner_id IN (${markers(owners)}) GROUP BY r.id ORDER BY last_joined_at DESC,r.id DESC LIMIT 10`).bind(...owners).all();
 return rows.results.map(row=>card(row,decorate));
}
/** @param {any} db @param {string[]} owners @param {(room:any)=>any} [decorate] */
export async function webOwnedRooms(db,owners,decorate=()=>({})){
 if(!owners.length)return [];
 const rows=await db.prepare(`SELECT r.data,m.closed FROM puzzle_rooms r LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id
  WHERE json_extract(r.data,'$.ownerId') IN (${markers(owners)}) AND COALESCE(json_extract(r.data,'$.botRoom'),0)=0
  AND NOT EXISTS(SELECT 1 FROM puzzle_shared_created_hidden h WHERE h.owner_id=json_extract(r.data,'$.ownerId') AND h.room_id=r.id)
  ORDER BY json_extract(r.data,'$.createdAt') DESC,r.id DESC`).bind(...owners).all();
 return rows.results.map(row=>card(row,decorate));
}
export async function webRecordJoin(db,owners,roomId,now=Date.now()){
 await seed(db,owners);
 // Each identity receives an entry only if it already has room admission.
 for(const owner of owners)await db.batch([
  db.prepare(`INSERT INTO puzzle_shared_room_history(owner_id,room_id,last_joined_at)
   SELECT ?,id,MAX(?,COALESCE((SELECT MAX(last_joined_at)+1 FROM puzzle_shared_room_history WHERE owner_id=?),0)) FROM puzzle_rooms
   WHERE id=? AND ${access} ON CONFLICT(owner_id,room_id) DO UPDATE SET last_joined_at=excluded.last_joined_at`).bind(owner,now,owner,roomId,owner,owner,owner,owner,owner),trim(db,owner),
 ]);
}
export async function webRemoveOwned(db,owners,roomId,now=Date.now()){
 if(!/^[a-f0-9]{32}$/.test(roomId))throw Object.assign(Error('房间编号无效'),{status:400});
 const row=await db.prepare('SELECT json_extract(data,\'$.ownerId\') owner FROM puzzle_rooms WHERE id=?').bind(roomId).first();
 if(!row||!owners.includes(row.owner))throw Object.assign(Error('只能删除自己的自创房间入口'),{status:403});
 await db.prepare('INSERT OR IGNORE INTO puzzle_shared_created_hidden VALUES(?,?,?)').bind(row.owner,roomId,now).run();
}
