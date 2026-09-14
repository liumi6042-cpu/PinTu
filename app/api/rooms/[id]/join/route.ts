import { addMember, validName, snapshot,hasRoomAdmission } from '@/lib/room-engine';
import { body, digestToken, newId, mutateRoom, json, failure,readRoom } from '@/lib/room-store';
import { currentPlayer,currentGuest,withPlayerCookie } from '@/lib/player-identity';
import { ensureBetaSeat } from '@/lib/beta-seats';
import { requireSoloAccount } from '@/lib/solo-account';
import {requiresPieceAccount} from '@/lib/piece-access';
import {checkPieceAdmission} from '@/lib/room-piece-access';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,input=await body(request),existing=await readRoom(id);
  if(existing.visibility==='solo')await requireSoloAccount(request);
  let player=existing.visibility||requiresPieceAccount(existing.puzzle.cols*existing.puzzle.rows)?await currentPlayer(request,true):null;
  if(existing.visibility==='solo'&&existing.ownerId!==player?.id){const guest=await currentGuest(request);if(guest?.id===existing.ownerId)player=guest;}
  const guest=player?.accountId?await currentGuest(request):null;
  const token=newId(),digest=await digestToken(token),now=Date.now();
  checkPieceAdmission(existing,player?.accountId,player?.id);
  if(existing.visibility!=='solo')await ensureBetaSeat(player?.id||digest,now);
  const {room,result:member}=await mutateRoom(id,room=>{
   checkPieceAdmission(room,player?.accountId,player?.id);
   if(room.acceptingNew===false&&guest&&!hasRoomAdmission(room,player?.id)&&hasRoomAdmission(room,guest.id))player=guest;
   return addMember(room,newId(),player?.name||validName(input.name??'游客'),digest,now,player?.accountId,player?.guestId);
  });
  const response=json({token,playerId:member.id,room:snapshot(room,now)});return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
