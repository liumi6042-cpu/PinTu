CREATE TABLE IF NOT EXISTS puzzle_personal_hidden_rooms (
 owner_id TEXT NOT NULL,
 room_id TEXT NOT NULL REFERENCES puzzle_rooms(id) ON DELETE CASCADE,
 hidden_at INTEGER NOT NULL,
 PRIMARY KEY (owner_id, room_id)
);
CREATE INDEX IF NOT EXISTS puzzle_personal_hidden_room_idx ON puzzle_personal_hidden_rooms(room_id);
