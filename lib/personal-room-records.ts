import { RoomError } from './room-engine';

type Database = Pick<D1DatabaseSession, 'prepare' | 'batch'>;

export async function hiddenPersonalRooms(database: Database, owners: string[]) {
  if (!owners.length) return new Set<string>();
  const rows = await database.prepare(`SELECT room_id FROM puzzle_personal_hidden_rooms WHERE owner_id IN (${owners.map(() => '?').join(',')})`)
    .bind(...owners).all<{ room_id: string }>();
  return new Set(rows.results.map(row => row.room_id));
}

export async function setPersonalRoomHidden(database: Database, owners: string[], roomId: string, hidden: boolean, now = Date.now()) {
  if (!owners.length) throw new RoomError('请重新打开个人空间后重试', 401);
  if (!/^[a-f0-9]{32}$/.test(roomId)) throw new RoomError('拼图记录无效', 400);
  const markers = owners.map(() => '?').join(',');
  // Only identities obtained from the current cookies can change their own list.
  const accessible = await database.prepare(`SELECT id FROM puzzle_rooms r WHERE id=? AND expires_at>? AND (
    json_extract(r.data,'$.ownerId') IN (${markers}) OR
    (COALESCE(json_extract(r.data,'$.visibility'),'private')!='solo' AND (
      EXISTS (SELECT 1 FROM json_each(r.data,'$.participants') p WHERE p.key IN (${markers})) OR
      EXISTS (SELECT 1 FROM json_each(r.data,'$.members') m WHERE
        json_extract(m.value,'$.accountId') IN (${markers}) OR json_extract(m.value,'$.guestId') IN (${markers}))
    )))`).bind(roomId, now, ...owners, ...owners, ...owners, ...owners).first();
  if (!accessible) throw new RoomError('这条拼图记录不存在或已过期', 404);
  if (hidden) {
    await database.batch(owners.map(owner => database.prepare(`INSERT INTO puzzle_personal_hidden_rooms(owner_id,room_id,hidden_at)
      SELECT ?,id,? FROM puzzle_rooms WHERE id=?
      ON CONFLICT(owner_id,room_id) DO UPDATE SET hidden_at=excluded.hidden_at`).bind(owner, now, roomId)));
  } else {
    await database.prepare(`DELETE FROM puzzle_personal_hidden_rooms WHERE room_id=? AND owner_id IN (${markers})`).bind(roomId, ...owners).run();
  }
}
