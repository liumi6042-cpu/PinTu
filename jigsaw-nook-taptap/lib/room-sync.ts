import { snapshot, snapshotMetadata, roomElapsedMs, type Room, type RoomSnapshot } from './room-engine';
import type { Group } from './puzzle-engine';

// Persist only changed IDs, never a second copy of the puzzle or authentication data.
export type RoomChange = { revision: number; changed: number[]; removed: number[] };
export type RoomDelta = Omit<RoomSnapshot, 'puzzle'> & {
  kind: 'delta'; baseRevision: number; elapsed: number; groups: Group[]; removed: number[];
};
export type RoomUpdate = RoomSnapshot | RoomDelta;
const HISTORY_LIMIT = 96;

export function recordRoomChange(room: Room, previous: Group[]) {
  const before = new Map(previous.map(group => [group.id, group]));
  const changed: number[] = [];
  for (const group of room.puzzle.groups) {
    const old = before.get(group.id);
    if (!old || old.dx !== group.dx || old.dy !== group.dy || old.locked !== group.locked ||
      old.pieces.length !== group.pieces.length || old.pieces.some((id, i) => id !== group.pieces[i])) changed.push(group.id);
    before.delete(group.id);
  }
  const entry = { revision: room.revision, changed, removed: [...before.keys()] };
  // Whole-table operations start a fresh baseline and use a full snapshot once.
  if (changed.length + before.size > 512) { room.syncHistory = []; return; }
  room.syncHistory = [...(room.syncHistory || []), entry].slice(-HISTORY_LIMIT);
}

export function roomUpdate(room: Room, now: number, since: number | null): RoomUpdate {
  const history = room.syncHistory || [];
  if (since === null || !Number.isSafeInteger(since) || since < 0 || since > room.revision ||
    (since < room.revision && (!history.length || since < history[0].revision - 1))) return snapshot(room, now);
  const ids = new Set<number>();
  for (const change of history) if (change.revision > since) {
    for (const id of change.changed) ids.add(id);
    for (const id of change.removed) ids.add(id);
  }
  const groups = room.puzzle.groups.filter(group => ids.has(group.id));
  for (const group of groups) ids.delete(group.id);
  return { ...snapshotMetadata(room, now), kind: 'delta', baseRevision: since,
    elapsed: snapshotElapsed(room, now), groups, removed: [...ids] };
}

const snapshotElapsed = (room: Room, now: number) => Math.floor(roomElapsedMs(room, now) / 1000);

export function applyRoomUpdate(current: RoomSnapshot, update: RoomUpdate): RoomSnapshot | null {
  if (update.id !== current.id) return null;
  if (update.revision < current.revision || (update.revision === current.revision && update.serverTime < current.serverTime)) return current;
  if (!('kind' in update)) return update;
  if (update.baseRevision > current.revision) return null;
  const { kind, baseRevision, elapsed, groups, removed, ...metadata } = update;
  if (!groups.length && !removed.length) return { ...metadata, puzzle: { ...current.puzzle, elapsed } };
  const upserts = new Map(groups.map(group => [group.id, group]));
  const deleted = new Set(removed);
  const next = current.puzzle.groups.filter(group => !deleted.has(group.id)).map(group => {
    const replacement = upserts.get(group.id); upserts.delete(group.id); return replacement || group;
  });
  next.push(...upserts.values());
  return { ...metadata, puzzle: { ...current.puzzle, elapsed, groups: next } };
}

export function roomPollDelay(active: boolean, idlePolls: number, hidden = false) {
  if (hidden) return 4000;
  return active ? 300 : Math.min(2000, 400 + idlePolls * 300);
}
