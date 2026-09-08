import { makeRoom, addMember, validName, snapshot, RoomError, type RoomVisibility } from '@/lib/room-engine';
import { body, digestToken, newId, insertRoom, json, failure } from '@/lib/room-store';
import { requireAccount } from '@/lib/account-store';
import { newPlayableRoom,insertPlayableRoom } from '@/lib/lobby-store';
export async function POST(request:Request){
 try{
  const input=await body(request),now=Date.now();
  // Old invite tickets stay compatible; every new UI-created mode requires an account.
  const registered=input.visibility!==undefined,account=registered?await requireAccount(request):null;
  if(registered&&!['solo','public','private'].includes(input.visibility))throw new RoomError('房间类型无效');
  const name=account?.name||validName(input.name),room=registered?newPlayableRoom(newId(),input.imageId,input.pieces,input.visibility as RoomVisibility,account!.id,now):makeRoom(newId(),input.imageId,input.pieces,now);
  const token=newId(),member=addMember(room,newId(),name,await digestToken(token),now,account?.id);
  if(registered)await insertPlayableRoom(room);else await insertRoom(room);
  return json({token,playerId:member.id,room:snapshot(room,now)},201);
 }catch(error){return failure(error);}
}
