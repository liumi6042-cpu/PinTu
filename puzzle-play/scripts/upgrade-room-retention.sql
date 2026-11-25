-- Idempotent local data upgrade. Only still-accessible rooms are extended.
-- No puzzle layout, ticket, member, timer, or completion data is replaced.
UPDATE puzzle_rooms
SET expires_at = MAX(expires_at, COALESCE(json_extract(data, '$.completedAt'), unixepoch() * 1000) + 2592000000),
    data = json_set(data,
      '$.expiresAt', MAX(expires_at, COALESCE(json_extract(data, '$.completedAt'), unixepoch() * 1000) + 2592000000),
      '$.lastPlayedAt', COALESCE(json_extract(data, '$.lastPlayedAt'), json_extract(data, '$.createdAt')),
      '$.retentionVersion', 2)
WHERE COALESCE(json_extract(data, '$.retentionVersion'), 0) < 2
  AND expires_at > unixepoch() * 1000;

UPDATE puzzle_room_directory
SET expires_at = (SELECT r.expires_at FROM puzzle_rooms r WHERE r.id = room_id)
WHERE EXISTS (SELECT 1 FROM puzzle_rooms r WHERE r.id = room_id AND r.expires_at != puzzle_room_directory.expires_at);
