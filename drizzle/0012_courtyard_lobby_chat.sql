CREATE TABLE puzzle_courtyard_settings (key TEXT PRIMARY KEY,value INTEGER NOT NULL);
INSERT INTO puzzle_courtyard_settings VALUES ('started_at',CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE puzzle_courtyards (user_id TEXT PRIMARY KEY REFERENCES puzzle_users(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
CREATE TABLE puzzle_courtyard_events (user_id TEXT NOT NULL REFERENCES puzzle_users(id) ON DELETE CASCADE,operation TEXT NOT NULL,kind TEXT NOT NULL,image_id TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,operation));
CREATE INDEX courtyard_image ON puzzle_courtyard_events(user_id,image_id);
CREATE TABLE puzzle_courtyard_settled (room_id TEXT PRIMARY KEY,completed_at INTEGER NOT NULL);
CREATE TABLE puzzle_lobby_chat (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES puzzle_users(id),request_id TEXT NOT NULL,name TEXT NOT NULL,message TEXT NOT NULL,sent_at INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,request_id));
CREATE INDEX lobby_chat_rate ON puzzle_lobby_chat(user_id,sent_at);
