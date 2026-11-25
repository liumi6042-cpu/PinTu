CREATE TABLE IF NOT EXISTS puzzle_account_security (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES puzzle_users(id),
 recovery_hash TEXT, recovery_expires_at INTEGER,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended'))
);
CREATE TABLE IF NOT EXISTS puzzle_privacy_requests (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES puzzle_users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','cancelled','completed')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolution TEXT
);
CREATE INDEX IF NOT EXISTS puzzle_privacy_status_idx ON puzzle_privacy_requests(status,created_at);
CREATE TABLE IF NOT EXISTS puzzle_admin_audit (
 id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_admin_audit_time_idx ON puzzle_admin_audit(created_at);
CREATE TABLE IF NOT EXISTS puzzle_score_moderation (
 room_id TEXT PRIMARY KEY NOT NULL, hidden INTEGER NOT NULL CHECK(hidden IN (0,1))
);
CREATE TABLE IF NOT EXISTS puzzle_room_moderation (
 room_id TEXT PRIMARY KEY NOT NULL, closed INTEGER NOT NULL CHECK(closed IN (0,1))
);
CREATE TABLE IF NOT EXISTS puzzle_request_limits (
 key TEXT PRIMARY KEY NOT NULL, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_request_limits_expiry_idx ON puzzle_request_limits(expires_at);
CREATE TABLE IF NOT EXISTS puzzle_beta_seats (
 identity TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_beta_seats_expiry_idx ON puzzle_beta_seats(expires_at);
CREATE INDEX IF NOT EXISTS puzzle_sessions_user_idx ON puzzle_sessions(user_id);
PRAGMA optimize;
