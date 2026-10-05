import { currentPlayer, currentGuest } from '@/lib/player-identity';
import { backfillSoloAchievements } from '@/lib/achievement-store';
import { personalStats } from '@/lib/personal-stats';

export async function GET(request: Request) {
  const player = await currentPlayer(request), guest = await currentGuest(request);
  const owner = player?.id || guest?.id;
  if (!owner) return Response.json({ stats: { totalCompletedPieces: 0, totalCompletedPictures: 0, bands: [] } });
  await backfillSoloAchievements(owner);
  return Response.json({ stats: await personalStats(owner) }, { headers: { 'Cache-Control': 'no-store' } });
}
