// Works with both D1 and the Node SQLite adapter. All eligibility checks run
// against the latest stored row inside the same transaction as deletion.
//
// A public room is shown in the lobby for one day from creation (36 hours at 500 pieces and up).
// Once that day ends the room is hidden from the lobby, but it is not thrown away: everyone who
// played it keeps it in their puzzle records and can come back at any time, and it briefly shows
// in the lobby again while somebody plays it. So the sweep only reclaims public rooms that
// nobody is sitting at and that either have no progress at all, or have been left untouched for
// a month (the same horizon private rooms use).
const IDLE_KEEP_MS=30*24*60*60*1000;
const EMPTY_ROOM_GRACE_MS=60*60*1000;
export async function cleanupPublicRooms(database,now=Date.now()){
  const orphans="SELECT d.room_id FROM puzzle_room_directory d WHERE d.visibility='public' AND NOT EXISTS(SELECT 1 FROM puzzle_rooms r WHERE r.id=d.room_id)";
  const result=await database.batch([
    database.prepare(`DELETE FROM puzzle_rooms WHERE json_extract(data,'$.visibility')='public'
      AND NOT EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.lastSeen')>?)
      AND ((NOT EXISTS(SELECT 1 FROM json_each(data,'$.puzzle.groups') g
        WHERE json_extract(g.value,'$.locked')=1 OR json_array_length(json_extract(g.value,'$.pieces'))>1)
        AND COALESCE(json_extract(data,'$.createdAt'),0)<=?)
        OR (EXISTS(SELECT 1 FROM json_each(data,'$.puzzle.groups') g
          WHERE json_extract(g.value,'$.locked')=1 OR json_array_length(json_extract(g.value,'$.pieces'))>1)
          AND COALESCE(json_extract(data,'$.lastPlayedAt'),json_extract(data,'$.createdAt'),0)<=?))`).bind(now-22000,now-EMPTY_ROOM_GRACE_MS,now-IDLE_KEEP_MS),
    database.prepare(`DELETE FROM puzzle_room_cursors WHERE room_id IN (${orphans})`),
    database.prepare(`DELETE FROM puzzle_room_moderation WHERE room_id IN (${orphans})`),
    database.prepare(`DELETE FROM puzzle_room_directory WHERE room_id IN (${orphans})`),
  ]);
  // Results and achievement evidence deliberately outlive their room.
  return result[0].meta.changes;
}
