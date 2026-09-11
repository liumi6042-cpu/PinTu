import { readRoom,getDigest,json,failure } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
import { completionRecord } from '@/lib/ranking-store';
import { currentPlayer,currentGuest } from '@/lib/player-identity';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
  const {id}=await context.params,room=await readRoom(id),member=await checkRoomAccount(request,room,await getDigest(request),Date.now());
  const [player,guest]=await Promise.all([currentPlayer(request),currentGuest(request)]);
  return json(await completionRecord(room,member.accountId||member.guestId,[player?.id,guest?.id].filter((id):id is string=>!!id)));
}catch(error){return failure(error);}}
