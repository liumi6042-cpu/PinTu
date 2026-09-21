import { RESTORABLE_PHOTOS } from './puzzle-catalog';
import { placedCount } from './puzzle-engine';
import type { LocalProgress } from './local-progress';
import type { RoomCard } from './lobby-types';

export type ResumeProgress = {
  customImage?:import('./custom-images').CustomImage;
  customTitle?:boolean;
  id: string; source: 'local' | 'server'; title: string; imageId: string;
  pieces: number; placed: number; elapsed: number; completed: boolean;
  updatedAt: number; expiresAt: number | null; visibility: 'solo' | 'public' | 'private';
};
export function resumeProgress(local: LocalProgress[], rooms: RoomCard[]): ResumeProgress[] {
  const entries: ResumeProgress[] = local.map(entry => ({ id: entry.key, source: 'local',
    title: RESTORABLE_PHOTOS.find(photo => photo.id === entry.state.imageId)!.title,
    imageId: entry.state.imageId, pieces: entry.state.cols * entry.state.rows,
    placed: placedCount(entry.state), elapsed: entry.state.elapsed, completed: entry.completed,
    updatedAt: entry.savedAt, expiresAt: null, visibility: 'solo' }));
  const unique = new Map(rooms.map(room => [room.id, room]));
  for (const room of unique.values()) entries.push({ ...room, source: 'server', updatedAt: room.lastPlayedAt ?? 0 });
  return entries.sort((a, b) => Number(a.completed) - Number(b.completed) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
// The one to offer on the home page: the newest entry that is genuinely in progress.
// Entries at zero pieces were opened and abandoned, and finished ones are not a
// reason to come back, so neither is worth a reminder.
export function nextResume(entries: ResumeProgress[]) {
  return entries.find(entry => !entry.completed && entry.placed > 0 && entry.placed < entry.pieces);
}
