import { authenticate, applyAction, snapshot, type RoomAction } from '@/lib/room-engine';
import { body, getDigest, readRoom, mutateRoom, json, failure } from '@/lib/room-store';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{const {id}=await context.params,digest=await getDigest(request),room=await readRoom(id),now=Date.now();authenticate(room,digest,now);return json(snapshot(room,now));}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{const {id}=await context.params,input=await body(request) as RoomAction,digest=await getDigest(request),now=Date.now();const {room}=await mutateRoom(id,room=>{const member=authenticate(room,digest,now);applyAction(room,member,input,now);});return json(snapshot(room,now));}catch(error){return failure(error);}}
