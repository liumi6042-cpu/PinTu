-- Start a fresh 24-hour idle window for existing public work. Puzzle pieces,
-- timers, players and private/solo rooms are not changed by this migration.
UPDATE puzzle_rooms SET
 data=json_set(data,'$.publicLastSeenAt',CAST(strftime('%s','now') AS INTEGER)*1000,
  '$.expiresAt',CAST(strftime('%s','now') AS INTEGER)*1000+86400000),
 expires_at=CAST(strftime('%s','now') AS INTEGER)*1000+86400000,
 revision=revision+1
 WHERE json_extract(data,'$.visibility')='public';
UPDATE puzzle_room_directory SET expires_at=(SELECT expires_at FROM puzzle_rooms WHERE id=room_id)
 WHERE visibility='public' AND EXISTS(SELECT 1 FROM puzzle_rooms WHERE id=room_id);
