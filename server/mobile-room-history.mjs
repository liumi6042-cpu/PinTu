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
 const trim=owner=>db.prepare('DELETE FROM mobile_room_history WHERE owner=? AND room_id NOT IN (SELECT room_id FROM mobile_room_history WHERE owner=? ORDER BY last_joined_at DESC,room_id DESC LIMIT 10)').run(owner,owner);
 function seed(owner){
  if(db.prepare('SELECT 1 FROM mobile_room_history_seeded WHERE owner=?').get(owner))return;
  // 仅迁移一次旧参与关系。历史被挤出十条后，不会在刷新时重新补回。
  const rows=db.prepare(`SELECT data FROM mobile_rooms WHERE closed_at IS NULL AND json_extract(data,'$.diagnostic') IS NOT 1 AND
   (owner=? OR EXISTS(SELECT 1 FROM json_each(data,'$.admitted') a WHERE a.key=?)
    OR EXISTS(SELECT 1 FROM json_each(data,'$.participants') p WHERE p.key=?)
    OR EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.guestId')=?))`).all(owner,owner,owner,owner);
  const items=rows.map(row=>{const room=JSON.parse(row.data),member=room.members?.find(m=>m.guestId===owner);return {id:room.id,time:Math.max(room.createdAt,member?.joinedAt??0,member?.lastSeen??0)};});
  items.sort((a,b)=>b.time-a.time||b.id.localeCompare(a.id));
  for(const item of items.slice(0,10))db.prepare('INSERT OR IGNORE INTO mobile_room_history VALUES(?,?,?)').run(owner,item.id,item.time);
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
  return db.prepare(`SELECT r.data,r.closed_at,h.last_joined_at FROM mobile_room_history h JOIN mobile_rooms r ON r.id=h.room_id
   WHERE h.owner=? ORDER BY h.last_joined_at DESC,h.room_id DESC LIMIT 10`).all(owner).map(row=>{
    const room=JSON.parse(row.data),completed=room.completedAt!==null,value=card(room,now);
    return {...value,title:completed?'已完成':value.title,lastJoinedAt:row.last_joined_at,unavailable:!!row.closed_at};
   });
 }
 function removeOwned(owner,roomId,now){
  // 删除自创入口不改历史、不删除房间，也不影响原有准入和奖励。
  db.prepare('INSERT OR IGNORE INTO mobile_room_list_removals VALUES(?,?,?)').run(owner,roomId,now);
 }
 return {joined,view,removeOwned};
}
