
 CREATE TABLE IF NOT EXISTS puzzle_shared_room_history(owner_id TEXT NOT NULL,room_id TEXT NOT NULL,last_joined_at INTEGER NOT NULL,PRIMARY KEY(owner_id,room_id));
 CREATE INDEX IF NOT EXISTS puzzle_shared_room_history_recent ON puzzle_shared_room_history(owner_id,last_joined_at DESC,room_id DESC);
 CREATE TABLE IF NOT EXISTS puzzle_shared_room_history_seeded(owner_id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS puzzle_shared_created_hidden(owner_id TEXT NOT NULL,room_id TEXT NOT NULL,hidden_at INTEGER NOT NULL,PRIMARY KEY(owner_id,room_id));

