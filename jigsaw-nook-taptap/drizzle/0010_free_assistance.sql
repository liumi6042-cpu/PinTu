CREATE TABLE IF NOT EXISTS puzzle_assistance_grants (
 room_id TEXT NOT NULL REFERENCES puzzle_rooms(id) ON DELETE CASCADE,
 identity TEXT NOT NULL,
 request_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reference','underlay','hint')),
 expires_at INTEGER NOT NULL,
 piece_ids TEXT NOT NULL,
 PRIMARY KEY(room_id,identity,request_id)
);
