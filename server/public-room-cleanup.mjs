// Works with both D1 and the Node SQLite adapter. All eligibility checks run
// against the latest stored row inside the same transaction as deletion.
export async function cleanupPublicRooms(database,now=Date.now()){
  const orphans="SELECT d.room_id FROM puzzle_room_directory d WHERE d.visibility='public' AND NOT EXISTS(SELECT 1 FROM puzzle_rooms r WHERE r.id=d.room_id)";
  const result=await database.batch([
    database.prepare(`DELETE FROM puzzle_rooms WHERE json_extract(data,'$.visibility')='public'
      AND NOT EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.lastSeen')>?)
      AND (NOT EXISTS(SELECT 1 FROM json_each(data,'$.puzzle.groups') g
        WHERE json_extract(g.value,'$.locked')=1 OR json_array_length(json_extract(g.value,'$.pieces'))>1)
        OR COALESCE(json_extract(data,'$.publicLastSeenAt'),json_extract(data,'$.lastPlayedAt'),json_extract(data,'$.createdAt'))<=?)`).bind(now-22000,now-86400000),
    database.prepare(`DELETE FROM puzzle_room_cursors WHERE room_id IN (${orphans})`),
    database.prepare(`DELETE FROM puzzle_room_moderation WHERE room_id IN (${orphans})`),
    database.prepare(`DELETE FROM puzzle_room_directory WHERE room_id IN (${orphans})`),
  ]);
  // Results and achievement evidence deliberately outlive their room.
  return result[0].meta.changes;
}
