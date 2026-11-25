import { currentPlayer,currentGuest } from '@/lib/player-identity';
import { body,json,failure,mutateRoom } from '@/lib/room-store';
import { manageRoom } from '@/lib/room-management';
import { RoomError } from '@/lib/room-engine';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
  const input=await body(request),{id}=await context.params,player=await currentPlayer(request),guest=await currentGuest(request);
  const owners=new Set([player?.id,guest?.id].filter((value):value is string=>!!value));if(!owners.size)throw new RoomError('请使用房主身份继续',401);
  const {room}=await mutateRoom(id,room=>manageRoom(room,owners,input,Date.now()));
  return json({id:room.id,title:room.title,visibility:room.visibility,acceptingNew:room.acceptingNew!==false});
}catch(error){return failure(error);}}
