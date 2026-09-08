import { currentPlayer,currentGuest } from '@/lib/player-identity';
import { roomCards } from '@/lib/lobby-store';
import { json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{const player=await currentPlayer(request),guest=await currentGuest(request),owners=new Set([player?.id,guest?.id].filter((id):id is string=>!!id));const lists=await Promise.all([...owners].map(id=>roomCards(id)));return json({rooms:lists.flat().sort((a,b)=>b.expiresAt-a.expiresAt).slice(0,24)});}catch(error){return failure(error);}}
