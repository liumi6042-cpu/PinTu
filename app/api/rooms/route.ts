import { makeRoom, addMember, validName, snapshot, RoomError, type RoomVisibility } from '@/lib/room-engine';
import { body, digestToken, newId, insertRoom, json, failure } from '@/lib/room-store';
import { currentPlayer,withPlayerCookie } from '@/lib/player-identity';
import { newPlayableRoom,insertPlayableRoom } from '@/lib/lobby-store';
export async function POST(request:Request){
 try{
  const input=await body(request),now=Date.now();
  // Visible rooms use an optional account or a persistent browser guest identity.
  const registered=input.visibility!==undefined,player=registered?await currentPlayer(request,true):null;
  if(registered&&!['solo','public','private'].includes(input.visibility))throw new RoomError('房间类型无效');
  const name=player?.name||validName(input.name),room=registered?newPlayableRoom(newId(),input.imageId,input.pieces,input.visibility as RoomVisibility,player!.id,now):makeRoom(newId(),input.imageId,input.pieces,now);
  const token=newId(),member=addMember(room,newId(),name,await digestToken(token),now,player?.accountId,player?.guestId);
  if(registered)await insertPlayableRoom(room);else await insertRoom(room);
  const response=json({token,playerId:member.id,room:snapshot(room,now)},201);return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
