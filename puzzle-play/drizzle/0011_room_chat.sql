CREATE TABLE IF NOT EXISTS puzzle_room_chat (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 room_id TEXT NOT NULL REFERENCES puzzle_rooms(id) ON DELETE CASCADE,
 identity TEXT NOT NULL,
 request_id TEXT NOT NULL,
 player_id TEXT NOT NULL,
 name TEXT NOT NULL,
 color TEXT NOT NULL,
 message TEXT NOT NULL,
 sent_at INTEGER NOT NULL,
 UNIQUE(room_id,identity,request_id)
);
CREATE INDEX IF NOT EXISTS puzzle_chat_room_cursor ON puzzle_room_chat(room_id,id);
CREATE INDEX IF NOT EXISTS puzzle_chat_sender_time ON puzzle_room_chat(identity,sent_at);
CREATE TRIGGER IF NOT EXISTS puzzle_chat_keep_recent AFTER INSERT ON puzzle_room_chat
BEGIN
 DELETE FROM puzzle_room_chat WHERE room_id=NEW.room_id
 AND id < (SELECT id FROM puzzle_room_chat WHERE room_id=NEW.room_id ORDER BY id DESC LIMIT 1 OFFSET 99);
END;
