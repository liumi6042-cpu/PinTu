CREATE TABLE IF NOT EXISTS puzzle_user_images (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES puzzle_users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 width INTEGER NOT NULL,
 height INTEGER NOT NULL,
 byte_size INTEGER NOT NULL,
 sha256 TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 data BLOB NOT NULL,
 preview BLOB NOT NULL,
 UNIQUE(owner_id,sha256)
);
CREATE INDEX IF NOT EXISTS puzzle_user_images_owner ON puzzle_user_images(owner_id,created_at);
