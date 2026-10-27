CREATE TABLE IF NOT EXISTS mobile_events(id INTEGER PRIMARY KEY,owner TEXT,kind TEXT,room_id TEXT,data TEXT,created_at INTEGER);
CREATE INDEX IF NOT EXISTS mobile_events_kind_time ON mobile_events(kind,created_at);
CREATE INDEX IF NOT EXISTS mobile_events_room_kind_owner ON mobile_events(room_id,kind,owner);
