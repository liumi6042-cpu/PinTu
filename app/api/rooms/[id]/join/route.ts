import { addMember, validName, snapshot } from '@/lib/room-engine';
import { body, digestToken, newId, mutateRoom, json, failure } from '@/lib/room-store';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const {id}=await context.params,input=await body(request),name=validName(input.name),token=newId(),digest=await digestToken(token),playerId=newId(),now=Date.now();const {room}=await mutateRoom(id,room=>addMember(room,playerId,name,digest,now));return json({token,playerId,room:snapshot(room,now)});}catch(error){return failure(error);}}
