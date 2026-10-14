-- Daily counts start when this migration is enabled. The previous history only
-- kept each room's highest placed count, not the time each piece was placed, so
-- historical daily increments cannot be reconstructed and are not fabricated.
CREATE TABLE IF NOT EXISTS puzzle_piece_daily_tracking (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
  started_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO puzzle_piece_daily_tracking(singleton,started_at)
VALUES(1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));

-- No foreign key: statistics survive room cleanup, just like the lifetime total.
CREATE TABLE IF NOT EXISTS puzzle_piece_daily_events (
  room_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  day_start INTEGER NOT NULL,
  placed_delta INTEGER NOT NULL CHECK(placed_delta>0),
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,revision)
);
CREATE INDEX IF NOT EXISTS puzzle_piece_daily_events_day_idx
  ON puzzle_piece_daily_events(day_start);

-- An UPDATE trigger runs only for the room state that won the compare-and-swap.
-- Its writes are in that same transaction, so failed CAS attempts, replayed
-- actions, and incorrect drops cannot contribute. SQLite restores changes()
-- after a trigger, preserving the immediately-following managed reward outbox.
CREATE TRIGGER IF NOT EXISTS puzzle_room_piece_progress_committed
AFTER UPDATE OF data ON puzzle_rooms
WHEN NEW.revision>OLD.revision
BEGIN
  INSERT OR IGNORE INTO puzzle_piece_daily_events
    (room_id,revision,day_start,placed_delta,occurred_at)
  SELECT NEW.id,NEW.revision,
    ((CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+28800000)/86400000)*86400000-28800000,
    current_placed-previous_placed,
    CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  FROM (
    SELECT
      COALESCE((SELECT SUM(json_array_length(json_extract(g.value,'$.pieces')))
        FROM json_each(NEW.data,'$.puzzle.groups') g
        WHERE json_extract(g.value,'$.locked')=1),0) AS current_placed,
      MAX(COALESCE((SELECT placed_count FROM puzzle_piece_progress WHERE room_id=NEW.id),0),
        (SELECT COALESCE(SUM(json_array_length(json_extract(g.value,'$.pieces'))),0)
          FROM json_each(OLD.data,'$.puzzle.groups') g
          WHERE json_extract(g.value,'$.locked')=1)) AS previous_placed
  )
  WHERE current_placed>previous_placed;

  INSERT INTO puzzle_piece_progress(room_id,placed_count,updated_at)
  SELECT NEW.id,
    MAX(COALESCE(SUM(json_array_length(json_extract(g.value,'$.pieces'))),0),
      (SELECT COALESCE(SUM(json_array_length(json_extract(old_group.value,'$.pieces'))),0)
        FROM json_each(OLD.data,'$.puzzle.groups') old_group
        WHERE json_extract(old_group.value,'$.locked')=1)),
    CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  FROM json_each(NEW.data,'$.puzzle.groups') g
  WHERE json_extract(g.value,'$.locked')=1
  ON CONFLICT(room_id) DO UPDATE SET
    placed_count=MAX(puzzle_piece_progress.placed_count,excluded.placed_count),
    updated_at=CASE WHEN excluded.placed_count>puzzle_piece_progress.placed_count
      THEN excluded.updated_at ELSE puzzle_piece_progress.updated_at END;
END;
