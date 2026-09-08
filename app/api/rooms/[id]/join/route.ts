import { addMember, validName, snapshot } from '@/lib/room-engine';
import { body, digestToken, newId, mutateRoom, json, failure,readRoom } from '@/lib/room-store';
import { currentPlayer,currentGuest,withPlayerCookie } from '@/lib/player-identity';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,input=await body(request),existing=await readRoom(id);
  let player=existing.visibility?await currentPlayer(request,true):null;
  if(existing.visibility==='solo'&&existing.ownerId!==player?.id){const guest=await currentGuest(request);if(guest?.id===existing.ownerId)player=guest;}
  const name=player?.name||validName(input.name??'游客');
  const token=newId(),digest=await digestToken(token),now=Date.now();
  const {room,result:member}=await mutateRoom(id,room=>addMember(room,newId(),name,digest,now,player?.accountId,player?.guestId));
  const response=json({token,playerId:member.id,room:snapshot(room,now)});return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
