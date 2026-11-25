import { recordLocalPuzzle } from './local-achievements';
import { RESTORABLE_PHOTO_IDS, RESTORABLE_PHOTOS } from './puzzle-catalog';
import { SAVED_LEVELS, placedCount, restorePuzzle, type PuzzleState } from './puzzle-engine';

export const activeKey = 'together-puzzle:active:v1';
export const saveKey = (imageId: string, count: number) => `together-puzzle:v1:${imageId}:${count}`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
export type LocalProgress = { key: string; state: PuzzleState; savedAt: number; completed: boolean };

export function readLocalProgress(storage: StorageAccess): LocalProgress[] {
  const results: LocalProgress[] = [];
  for (const photo of RESTORABLE_PHOTOS) for (const level of SAVED_LEVELS) {
    const key = saveKey(photo.id, level.count), raw = storage.getItem(key);
    if (!raw) continue;
    const state = restorePuzzle(raw, RESTORABLE_PHOTO_IDS);
    // Never open data from a different slot, even if the JSON itself is valid.
    if (!state || state.imageId !== photo.id || state.cols * state.rows !== level.count) continue;
    const savedAt = Number(storage.getItem(key + ':saved-at'));
    results.push({ key, state, savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0,
      completed: placedCount(state) === level.count });
  }
  return results.sort((a, b) => b.savedAt - a.savedAt);
}

export function writeLocalProgress(storage: StorageAccess, state: PuzzleState, now = Date.now()) {
  const key = saveKey(state.imageId, state.cols * state.rows);
  storage.setItem(key, JSON.stringify(state));
  storage.setItem(key + ':saved-at', String(now));
  storage.setItem(activeKey, key);
  try { recordLocalPuzzle(storage,state,now); } catch { /* Puzzle progress is saved even if the album is unavailable. */ }
}

type RemovableStorage = StorageAccess & Pick<Storage, 'removeItem'>;
export type RemovedLocalProgress = { key: string; raw: string; savedAt: string | null; wasActive: boolean };
export function removeLocalProgress(storage: RemovableStorage, key: string): RemovedLocalProgress {
  if (!RESTORABLE_PHOTOS.some(photo => SAVED_LEVELS.some(level => saveKey(photo.id, level.count) === key))) throw new Error('拼图记录无效');
  const raw = storage.getItem(key);
  if (raw === null) throw new Error('这条记录已不存在');
  const removed = { key, raw, savedAt: storage.getItem(key + ':saved-at'), wasActive: storage.getItem(activeKey) === key };
  storage.removeItem(key);
  storage.removeItem(key + ':saved-at');
  if (removed.wasActive) storage.removeItem(activeKey);
  return removed;
}

export function restoreRemovedLocalProgress(storage: RemovableStorage, removed: RemovedLocalProgress) {
  if (storage.getItem(removed.key) !== null) throw new Error('该拼图已有新进度，未覆盖新存档。');
  storage.setItem(removed.key, removed.raw);
  if (removed.savedAt !== null) storage.setItem(removed.key + ':saved-at', removed.savedAt);
  if (removed.wasActive && storage.getItem(activeKey) === null) storage.setItem(activeKey, removed.key);
}
