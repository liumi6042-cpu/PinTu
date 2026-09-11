-- Only retained server room identities can prove ownership of earlier results.
-- Names alone and browser-local saves must never be used to claim a score.
INSERT OR IGNORE INTO puzzle_result_players (room_id,owner_id)
SELECT r.room_id,p.key FROM puzzle_results r
JOIN puzzle_rooms room ON room.id=r.room_id
JOIN json_each(room.data,'$.participants') p
WHERE json_extract(room.data,'$.completedAt') IS NOT NULL
 AND (p.key GLOB 'guest:*' OR length(p.key)=32);
PRAGMA optimize;
