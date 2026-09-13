import type { Room } from './room-engine';

// Only public catalog artwork can be announced before admission. Private uploads
// and private/solo room metadata must still wait for the authenticated join.
export function roomImagePreload(
  room: Pick<Room, 'visibility' | 'expiresAt' | 'customImage' | 'puzzle'>,
  photos: readonly {id:string;src:string}[],
  now = Date.now(),
) {
  if (room.visibility !== 'public' || room.expiresAt <= now || room.customImage) return null;
  return photos.find(photo => photo.id === room.puzzle.imageId)?.src ?? null;
}
