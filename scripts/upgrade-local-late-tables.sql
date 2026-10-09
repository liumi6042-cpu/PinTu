-- The local preview can be restarted many times, so these late tables are deliberately idempotent here.
CREATE TABLE IF NOT EXISTS puzzle_courtyard_settings (key TEXT PRIMARY KEY,value INTEGER NOT NULL);
INSERT OR IGNORE INTO puzzle_courtyard_settings VALUES ('started_at',CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE IF NOT EXISTS puzzle_courtyards (user_id TEXT PRIMARY KEY REFERENCES puzzle_users(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puzzle_courtyard_events (user_id TEXT NOT NULL REFERENCES puzzle_users(id) ON DELETE CASCADE,operation TEXT NOT NULL,kind TEXT NOT NULL,image_id TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,operation));
CREATE INDEX IF NOT EXISTS courtyard_image ON puzzle_courtyard_events(user_id,image_id);
CREATE TABLE IF NOT EXISTS puzzle_courtyard_settled (room_id TEXT PRIMARY KEY,completed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS puzzle_lobby_chat (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES puzzle_users(id),request_id TEXT NOT NULL,name TEXT NOT NULL,message TEXT NOT NULL,sent_at INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,request_id));
CREATE INDEX IF NOT EXISTS lobby_chat_rate ON puzzle_lobby_chat(user_id,sent_at);
CREATE TABLE IF NOT EXISTS puzzle_welcome_gifts (
 owner_id TEXT PRIMARY KEY,
 item TEXT NOT NULL CHECK(item IN ('fern','cushion','blueVase')),
 created_at INTEGER NOT NULL,
 claimed_by TEXT UNIQUE REFERENCES puzzle_users(id) ON DELETE CASCADE,
 claimed_at INTEGER
);
