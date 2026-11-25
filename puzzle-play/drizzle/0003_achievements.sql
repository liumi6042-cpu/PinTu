CREATE TABLE IF NOT EXISTS puzzle_achievement_facts (
  owner_id TEXT NOT NULL, room_id TEXT NOT NULL, image_id TEXT NOT NULL,
  pieces INTEGER NOT NULL, mode TEXT NOT NULL, category TEXT NOT NULL, completed_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id,room_id)
);
CREATE TABLE IF NOT EXISTS puzzle_achievement_days (
  owner_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (owner_id,day)
);
CREATE TABLE IF NOT EXISTS puzzle_achievement_awards (
  owner_id TEXT NOT NULL, badge_id TEXT NOT NULL, earned_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id,badge_id)
);
CREATE TABLE IF NOT EXISTS puzzle_achievement_profiles (
  owner_id TEXT PRIMARY KEY, equipped TEXT
);
CREATE TABLE IF NOT EXISTS puzzle_achievement_settled (room_id TEXT PRIMARY KEY);
