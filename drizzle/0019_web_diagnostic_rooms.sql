-- Isolated diagnostic saves use the original Web SQLite database, without
-- normal room-directory, progress-statistics or reward-outbox triggers.
CREATE TABLE IF NOT EXISTS puzzle_diagnostic_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  request_id TEXT NOT NULL,
  token TEXT NOT NULL,
  player_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner,request_id)
);
CREATE INDEX IF NOT EXISTS puzzle_diagnostic_owner_idx ON puzzle_diagnostic_rooms(owner,closed);
