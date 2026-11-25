-- Additive managed content assets. Legacy courtyard inventories are untouched.
CREATE TABLE IF NOT EXISTS puzzle_managed_players (
  owner TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzle_managed_settings (key TEXT PRIMARY KEY,value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS puzzle_managed_room_baselines (
  room_id TEXT NOT NULL,owner TEXT NOT NULL,count INTEGER NOT NULL,
  PRIMARY KEY(room_id,owner)
);
CREATE TABLE IF NOT EXISTS puzzle_managed_recent_activity (
  room_id TEXT NOT NULL,owner TEXT NOT NULL,count INTEGER NOT NULL,created_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,owner)
);
CREATE INDEX IF NOT EXISTS puzzle_managed_activity_time ON puzzle_managed_recent_activity(room_id,created_at);
CREATE TABLE IF NOT EXISTS puzzle_managed_invitation_codes (owner TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS puzzle_managed_invitation_bindings (invitee TEXT PRIMARY KEY,inviter TEXT NOT NULL,bound_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS puzzle_managed_invitation_owner ON puzzle_managed_invitation_bindings(inviter,bound_at);
CREATE TABLE IF NOT EXISTS puzzle_managed_friend_requests (sender TEXT NOT NULL,recipient TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(sender,recipient));
CREATE TABLE IF NOT EXISTS puzzle_managed_friends (owner TEXT NOT NULL,peer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,peer));
