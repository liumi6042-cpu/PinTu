import { makeRoom, addMember, validName, snapshot } from '@/lib/room-engine';
import { body, digestToken, newId, insertRoom, json, failure } from '@/lib/room-store';
export async function POST(request:Request){try{const input=await body(request),name=validName(input.name),now=Date.now(),room=makeRoom(newId(),input.imageId,input.pieces,now),token=newId(),member=addMember(room,newId(),name,await digestToken(token),now);await insertRoom(room);return json({token,playerId:member.id,room:snapshot(room,now)},201);}catch(error){return failure(error);}}
