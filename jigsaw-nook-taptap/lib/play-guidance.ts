import guidance from '../content/puzzle-guidance.json' with { type: 'json' };
import { LEVELS } from './puzzle-engine';

export type PhotoGuidance = { width: number; height: number; complexity: number; preferredCount: number; reason: string };
const records: Record<string, PhotoGuidance> = guidance;
export function photoGuidance(imageId: string) { return records[imageId]; }
// Square bodies use a centered, proportional crop: the smaller dimension limits detail.
export function pixelsPerPiece(imageId: string, count: number) {
  const image = records[imageId], level = LEVELS.find(level => level.count === count);
  return image && level ? Math.floor(Math.min(image.width / level.cols, image.height / level.rows)) : null;
}
export function recommendedPieces(imageId: string) {
  const image = records[imageId];
  if (!image) return 108;
  return LEVELS.filter(level => level.count <= image.preferredCount && (pixelsPerPiece(imageId, level.count) ?? 0) >= 48).at(-1)?.count ?? 108;
}
export function puzzleDifficulty(imageId: string, count: number) {
  const score = (records[imageId]?.complexity ?? 2) + (count >= 1000 ? 2 : count >= 500 ? 1 : 0);
  return score <= 1 ? '轻松' : score === 2 ? '适中' : '挑战';
}
export function limitedDetail(imageId: string, count: number) {
  const pixels = pixelsPerPiece(imageId, count); return pixels !== null && pixels < 40;
}
