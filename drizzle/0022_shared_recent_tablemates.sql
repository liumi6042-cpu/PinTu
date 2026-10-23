CREATE TABLE IF NOT EXISTS puzzle_shared_recent_tablemates (
 owner_id TEXT NOT NULL,
 peer_id TEXT NOT NULL,
 room_id TEXT NOT NULL,
 room_title TEXT NOT NULL,
 seen_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,peer_id)
);
CREATE INDEX IF NOT EXISTS puzzle_shared_recent_tablemates_seen ON puzzle_shared_recent_tablemates(owner_id,seen_at DESC);
