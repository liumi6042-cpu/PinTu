CREATE TABLE IF NOT EXISTS puzzle_room_cursors (
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  x REAL,
  y REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX IF NOT EXISTS puzzle_cursor_expiry_idx ON puzzle_room_cursors(updated_at);
