import type { Room } from './room-engine';
import {puzzleImageSource,type PuzzleImageSource} from './puzzle-image-source';

// Only public catalog artwork can be announced before admission. Private uploads
// and private/solo room metadata must still wait for the authenticated join.
export function roomImagePreload(
  room: Pick<Room, 'visibility' | 'expiresAt' | 'customImage' | 'puzzle'>,
  photos: readonly ({id:string}&PuzzleImageSource)[],
  now = Date.now(),
) {
  if (room.visibility !== 'public' || room.expiresAt <= now || room.customImage) return null;
  const photo=photos.find(photo => photo.id === room.puzzle.imageId);
  return photo?puzzleImageSource(photo,room.puzzle.cols*room.puzzle.rows):null;
}
