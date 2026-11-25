-- Keep the highest number of pieces successfully placed in each room.
-- This table intentionally has no foreign key to puzzle_rooms: a room may be
-- cleaned up while its contribution to the site-wide counter is retained.
CREATE TABLE IF NOT EXISTS puzzle_piece_progress (
  room_id TEXT PRIMARY KEY NOT NULL,
  placed_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_piece_progress_updated_idx
  ON puzzle_piece_progress(updated_at);

-- Backfill finished rooms first.  The upsert below also makes this migration
-- safe to run repeatedly in the local D1 preview.
INSERT INTO puzzle_piece_progress (room_id,placed_count,updated_at)
SELECT room_id,piece_count,completed_at FROM puzzle_results
WHERE 1
ON CONFLICT(room_id) DO UPDATE SET
  placed_count=MAX(puzzle_piece_progress.placed_count,excluded.placed_count),
  updated_at=CASE WHEN excluded.placed_count>puzzle_piece_progress.placed_count
    THEN excluded.updated_at ELSE puzzle_piece_progress.updated_at END;

-- Rooms that are still present may contain progress that has not reached a
-- completed result yet.  Store their current locked-piece total as well.
INSERT INTO puzzle_piece_progress (room_id,placed_count,updated_at)
SELECT r.id,
  COALESCE(SUM(CASE WHEN json_extract(g.value,'$.locked')=1
    THEN json_array_length(json_extract(g.value,'$.pieces')) ELSE 0 END),0),
  COALESCE(json_extract(r.data,'$.lastPlayedAt'),json_extract(r.data,'$.createdAt'),0)
FROM puzzle_rooms r
JOIN json_each(r.data,'$.puzzle.groups') g
WHERE 1
GROUP BY r.id
ON CONFLICT(room_id) DO UPDATE SET
  placed_count=MAX(puzzle_piece_progress.placed_count,excluded.placed_count),
  updated_at=CASE WHEN excluded.placed_count>puzzle_piece_progress.placed_count
    THEN excluded.updated_at ELSE puzzle_piece_progress.updated_at END;
