CREATE TABLE IF NOT EXISTS puzzle_level_progress(owner TEXT NOT NULL,level_id TEXT NOT NULL,room_id TEXT,cleared_at INTEGER,energy INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,level_id));
