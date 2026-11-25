CREATE TABLE IF NOT EXISTS puzzle_users (
 id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzle_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES puzzle_users(id), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_sessions_expiry_idx ON puzzle_sessions(expires_at);
CREATE TABLE IF NOT EXISTS puzzle_login_attempts (
 username TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzle_room_directory (
 room_id TEXT PRIMARY KEY NOT NULL, visibility TEXT NOT NULL, owner_id TEXT,
 title TEXT NOT NULL, image_id TEXT NOT NULL, piece_count INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, completed_at INTEGER, slot TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS puzzle_directory_public_idx ON puzzle_room_directory(visibility,completed_at,expires_at);
CREATE INDEX IF NOT EXISTS puzzle_directory_owner_idx ON puzzle_room_directory(owner_id,created_at);
CREATE TABLE IF NOT EXISTS puzzle_results (
 room_id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL, image_id TEXT NOT NULL,
 piece_count INTEGER NOT NULL, player_count INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL,
 completed_at INTEGER NOT NULL, players_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_results_ranking_idx ON puzzle_results(mode,image_id,piece_count,player_count,elapsed_ms);
