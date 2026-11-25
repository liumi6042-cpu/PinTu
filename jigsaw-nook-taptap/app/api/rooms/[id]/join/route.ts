import { addMember, validName, snapshot,hasRoomAdmission, RoomError } from '@/lib/room-engine';
import { body, digestToken, newId, mutateRoom, json, failure,readRoom } from '@/lib/room-store';
import { currentPlayer,currentGuest,withPlayerCookie } from '@/lib/player-identity';
import { ensureBetaSeat } from '@/lib/beta-seats';
import { requireSoloAccount } from '@/lib/solo-account';
import { botsEnabled } from '@/lib/bot-settings';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,input=await body(request),existing=await readRoom(id);
  if(!botsEnabled()&&existing.botRoom)throw new RoomError('房间不存在，请选择其他拼图',404);
  if(existing.visibility==='solo')await requireSoloAccount(request);
  let player=existing.visibility?await currentPlayer(request,true):null;
  if(existing.visibility==='solo'&&existing.ownerId!==player?.id){const guest=await currentGuest(request);if(guest?.id===existing.ownerId)player=guest;}
  const guest=player?.accountId?await currentGuest(request):null;
  const token=newId(),digest=await digestToken(token),now=Date.now();
  if(existing.visibility!=='solo')await ensureBetaSeat(player?.id||digest,now);
  const {room,result:member}=await mutateRoom(id,room=>{
   if(room.acceptingNew===false&&guest&&!hasRoomAdmission(room,player?.id)&&hasRoomAdmission(room,guest.id))player=guest;
   return addMember(room,newId(),player?.name||validName(input.name??'游客'),digest,now,player?.accountId,player?.guestId);
  });
  const response=json({token,playerId:member.id,room:snapshot(room,now)});return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
