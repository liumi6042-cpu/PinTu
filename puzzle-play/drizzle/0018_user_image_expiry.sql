-- Uploaded pictures are only meant to live as long as their room.
-- Existing rows get a seven-day grace period from their creation time.
ALTER TABLE puzzle_user_images ADD COLUMN expires_at INTEGER;
UPDATE puzzle_user_images SET expires_at = created_at + 604800000 WHERE expires_at IS NULL;
CREATE INDEX IF NOT EXISTS puzzle_user_images_expiry ON puzzle_user_images(expires_at);
