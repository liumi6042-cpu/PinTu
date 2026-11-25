CREATE TABLE puzzle_welcome_gifts (
 owner_id TEXT PRIMARY KEY,
 item TEXT NOT NULL CHECK(item IN ('fern','cushion','blueVase')),
 created_at INTEGER NOT NULL,
 claimed_by TEXT UNIQUE REFERENCES puzzle_users(id) ON DELETE CASCADE,
 claimed_at INTEGER
);
