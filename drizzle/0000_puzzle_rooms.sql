CREATE TABLE IF NOT EXISTS puzzle_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_rooms_expiry_idx ON puzzle_rooms(expires_at);
