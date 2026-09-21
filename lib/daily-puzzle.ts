import { PHOTOS } from './puzzle-catalog';

// One picture for the whole site: the same for every visitor on the same day, and
// the same in the HTML a crawler reads. It turns over at midnight Beijing time so
// the players this site mostly serves see it change with their own day, rather than
// at 08:00. The catalog order is fixed, so a given day always yields the same
// picture, and the rotation visits every published picture before repeating.
const DAY = 86400000, BEIJING_OFFSET = 8 * 3600000;
export const dailyPuzzleDay = (now: number) => Math.floor((now + BEIJING_OFFSET) / DAY);
export const dailyPuzzleDate = (now: number) => new Date(now + BEIJING_OFFSET).toISOString().slice(0, 10);
export function dailyPuzzle(now: number = Date.now()) {
  return PHOTOS[dailyPuzzleDay(now) % PHOTOS.length];
}
