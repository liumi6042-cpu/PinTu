/** Personal room entries never own the shared puzzle's lifetime.
 * The caller runs mutations inside the mobile service transaction.
 */
export function createMobileRoomHistory({db,card}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_room_history(owner TEXT NOT NULL,room_id TEXT NOT NULL,last_joined_at INTEGER NOT NULL,PRIMARY KEY(owner,room_id));
 CREATE INDEX IF NOT EXISTS mobile_room_history_recent ON mobile_room_history(owner,last_joined_at DESC,room_id DESC);
 CREATE TABLE IF NOT EXISTS mobile_room_history_seeded(owner TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS mobile_room_list_removals(owner TEXT NOT NULL,room_id TEXT NOT NULL,removed_at INTEGER NOT NULL,PRIMARY KEY(owner,room_id));
 `);
 // 草稿和已完成各算各的，拼完几张不会把没拼完的挤出去。
 // 草稿多存一倍：刚加入的桌子还没拼完时算草稿，拼完后被挤出的旧草稿能回到列表。
 const DRAFT_LIMIT=20,COMPLETED_LIMIT=30,STORED_DRAFTS=DRAFT_LIMIT*2;
 const kept=`SELECT room_id FROM (SELECT h.room_id FROM mobile_room_history h JOIN mobile_rooms r ON r.id=h.room_id WHERE h.owner=? AND r.completed_at IS NULL ORDER BY h.last_joined_at DESC,h.room_id DESC LIMIT ${STORED_DRAFTS})
  UNION SELECT room_id FROM (SELECT h.room_id FROM mobile_room_history h JOIN mobile_rooms r ON r.id=h.room_id WHERE h.owner=? AND r.completed_at IS NOT NULL ORDER BY h.last_joined_at DESC,h.room_id DESC LIMIT ${COMPLETED_LIMIT})`;
 const trim=owner=>db.prepare(`DELETE FROM mobile_room_history WHERE owner=? AND room_id NOT IN (${kept})`).run(owner,owner,owner);
 function seed(owner){
  if(db.prepare('SELECT 1 FROM mobile_room_history_seeded WHERE owner=?').get(owner))return;
  // 仅迁移一次旧参与关系。被挤出上限后，不会在刷新时重新补回。
  const rows=db.prepare(`SELECT data FROM mobile_rooms WHERE closed_at IS NULL AND json_extract(data,'$.diagnostic') IS NOT 1 AND
   (owner=? OR EXISTS(SELECT 1 FROM json_each(data,'$.admitted') a WHERE a.key=?)
    OR EXISTS(SELECT 1 FROM json_each(data,'$.participants') p WHERE p.key=?)
    OR EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.guestId')=?))`).all(owner,owner,owner,owner);
  const items=rows.map(row=>{const room=JSON.parse(row.data),member=room.members?.find(m=>m.guestId===owner);return {id:room.id,time:Math.max(room.createdAt,member?.joinedAt??0,member?.lastSeen??0)};});
  items.sort((a,b)=>b.time-a.time||b.id.localeCompare(a.id));
  for(const item of items.slice(0,DRAFT_LIMIT+COMPLETED_LIMIT))db.prepare('INSERT OR IGNORE INTO mobile_room_history VALUES(?,?,?)').run(owner,item.id,item.time);
  trim(owner);db.prepare('INSERT INTO mobile_room_history_seeded VALUES(?)').run(owner);
 }
 function joined(owner,room,now){
  if(room.diagnostic===true)return;
  seed(owner);
  const latest=db.prepare('SELECT MAX(last_joined_at) t FROM mobile_room_history WHERE owner=?').get(owner).t??0;
  db.prepare('INSERT INTO mobile_room_history VALUES(?,?,?) ON CONFLICT(owner,room_id) DO UPDATE SET last_joined_at=excluded.last_joined_at').run(owner,room.id,Math.max(now,latest+1));
  trim(owner);
 }
 function view(owner,now){
  seed(owner);
  const rows=done=>db.prepare(`SELECT r.data,r.closed_at,h.last_joined_at FROM mobile_room_history h JOIN mobile_rooms r ON r.id=h.room_id
   WHERE h.owner=? AND r.completed_at IS ${done?'NOT ':''}NULL ORDER BY h.last_joined_at DESC,h.room_id DESC LIMIT ${done?COMPLETED_LIMIT:DRAFT_LIMIT}`).all(owner);
  // 旧客户端只取前10条，所以合并后仍按最近进入排序。
  return [...rows(false),...rows(true)].sort((a,b)=>b.last_joined_at-a.last_joined_at).map(row=>{
    const room=JSON.parse(row.data),completed=room.completedAt!==null,value=card(room,now);
    return {...value,title:completed?'已完成':value.title,completedAt:room.completedAt,lastJoinedAt:row.last_joined_at,unavailable:!!row.closed_at};
   });
 }
 function removeOwned(owner,roomId,now){
  // 删除自创入口不改历史、不删除房间，也不影响原有准入和奖励。
  db.prepare('INSERT OR IGNORE INTO mobile_room_list_removals VALUES(?,?,?)').run(owner,roomId,now);
 }
 return {joined,view,removeOwned,limits:{drafts:DRAFT_LIMIT,completed:COMPLETED_LIMIT}};
}
