import { rankingBoard } from '@/lib/ranking-store';
import { currentPlayer,currentGuest } from '@/lib/player-identity';
import { json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{const [player,guest]=await Promise.all([currentPlayer(request),currentGuest(request)]);return json(await rankingBoard(new URL(request.url),[...new Set([player?.id,guest?.id].filter((id):id is string=>!!id))]));}catch(error){return failure(error);}}
