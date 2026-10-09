import { currentPlayer } from '@/lib/player-identity';
import { achievementOwner } from '@/lib/room-achievements';
import { checkRoomAccount } from '@/lib/room-account';
import { body,json,failure,getDigest,readRoom } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
import { emptyBook } from '@/lib/achievements';
import { backfillSoloAchievements,equipServerAchievement,serverAchievementBook } from '@/lib/achievement-store';
async function ownerFor(request:Request){
  const roomId=new URL(request.url).searchParams.get('room');
  if(roomId){const room=await readRoom(roomId),member=await checkRoomAccount(request,room,await getDigest(request),Date.now());return achievementOwner(member);}
  return (await currentPlayer(request))?.id??null;
}
export async function GET(request:Request){try{
  const owner=await ownerFor(request);if(!owner)return json({book:emptyBook(),identity:null});
  await backfillSoloAchievements(owner);return json({book:await serverAchievementBook(owner),identity:owner.startsWith('guest:')?'guest':'account'});
}catch(e){return failure(e);}}
export async function POST(request:Request){try{
  const input=await body(request),owner=await ownerFor(request);if(!owner)throw new RoomError('请重新加入房间',401);
  if(input.action!=='equip')throw new RoomError('不支持的操作');
  return json({book:await equipServerAchievement(owner,input.badge)});
}catch(e){return failure(e);}}
