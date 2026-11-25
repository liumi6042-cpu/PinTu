-- Room writes enqueue their reward facts in the same accepted CAS batch.
CREATE TABLE IF NOT EXISTS puzzle_managed_reward_events (
 id TEXT PRIMARY KEY,
 room_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 occurred_at INTEGER NOT NULL,
 payload TEXT NOT NULL,
 settled_at INTEGER,
 UNIQUE(room_id,revision)
);
CREATE INDEX IF NOT EXISTS puzzle_managed_reward_pending ON puzzle_managed_reward_events(settled_at,occurred_at,revision);
