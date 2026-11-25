import { localDb } from './local-db';
import { pieceBand } from './piece-policy';

export const PERSONAL_STAT_BANDS = [108, 300, 500, 1000] as const;
export type PersonalStats = {
  totalCompletedPieces: number;
  totalCompletedPictures: number;
  bands: { pieces: number; pictures: number; completedPieces: number }[];
};

export async function personalStats(owner: string): Promise<PersonalStats> {
  const rows = await localDb().prepare('SELECT pieces FROM puzzle_achievement_facts WHERE owner_id=? ORDER BY completed_at').bind(owner).all<{ pieces: number }>();
  const knownBands = new Set<number>(PERSONAL_STAT_BANDS);
  for (const row of rows.results) { const band = pieceBand(Number(row.pieces) || 0); if (band !== null) knownBands.add(band); }
  const bands = [...knownBands].sort((a, b) => a - b).map(pieces => ({ pieces, pictures: 0, completedPieces: 0 }));
  let totalCompletedPieces = 0;
  for (const row of rows.results) {
    const count = Number(row.pieces) || 0;
    const band = pieceBand(count);
    totalCompletedPieces += count;
    const target = bands.find(item => item.pieces === band);
    if (target) { target.pictures++; target.completedPieces += count; }
  }
  return { totalCompletedPieces, totalCompletedPictures: rows.results.length, bands };
}
