-- Keep only per-connection replay frontiers. Player rewards remain in the
-- existing room CAS, managed reward outbox and permanent economic receipts.
CREATE TABLE IF NOT EXISTS puzzle_room_action_streams (
 room_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL,
 closed INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(room_id,client_id)
);
CREATE INDEX IF NOT EXISTS puzzle_room_action_stream_connections ON puzzle_room_action_streams(room_id,member_id,connection_id);
-- Retention/closed rooms keep replay frontiers. Only their existing physical
-- deletion path removes matching rows, inside the same SQLite transaction.
CREATE TRIGGER IF NOT EXISTS puzzle_room_action_stream_cleanup AFTER DELETE ON puzzle_rooms
BEGIN
 DELETE FROM puzzle_room_action_streams WHERE room_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS puzzle_diagnostic_action_stream_cleanup AFTER DELETE ON puzzle_diagnostic_rooms
BEGIN
 DELETE FROM puzzle_room_action_streams WHERE room_id=OLD.id;
END;
