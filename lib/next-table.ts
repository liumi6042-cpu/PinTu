import { PHOTOS } from './puzzle-catalog';
import { pieceBand, supportsPieceCount } from './piece-policy';
import { recommendedPieces } from './play-guidance';
import { randomPhoto } from './random-photo';

// What "another table straight away" means: never the picture just finished, the same size as
// the last one when the new picture can carry it, and otherwise whatever that picture is best at.
// Kept apart from the component so the choice can be tested on its own.
export function nextTableChoice(
  finished: { imageId: string; cols: number; rows: number },
  options: {
    photos?: typeof PHOTOS;
    supports?: (imageId: string, pieces: number) => boolean;
    recommended?: (imageId: string) => number;
    random?: () => number;
  } = {},
) {
  const photos = options.photos ?? PHOTOS;
  const supports = options.supports ?? supportsPieceCount;
  const recommended = options.recommended ?? recommendedPieces;
  const band = pieceBand(finished.cols * finished.rows);
  const pool = photos.filter((photo) => photo.id !== finished.imageId);
  if (!pool.length) throw new Error('图库暂时没有可用图片');
  const sameSize = band ? pool.filter((photo) => supports(photo.id, band)) : [];
  const photo = randomPhoto(sameSize.length ? sameSize : pool, options.random);
  return { photo, pieces: sameSize.length && band ? band : recommended(photo.id) };
}
