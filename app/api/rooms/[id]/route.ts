import { roomUpdate } from '@/lib/room-sync';
import { authenticate, applyAction, type RoomAction } from '@/lib/room-engine';
import { body, getDigest, readRoom, mutateRoom, json, failure } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{const {id}=await context.params,digest=await getDigest(request),room=await readRoom(id),now=Date.now();await checkRoomAccount(request,room,digest,now);return json(roomUpdate(room,now,cursor(request)));}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{const {id}=await context.params,input=await body(request) as RoomAction,digest=await getDigest(request),now=Date.now();await checkRoomAccount(request,await readRoom(id),digest,now);const {room}=await mutateRoom(id,room=>{const member=authenticate(room,digest,now);applyAction(room,member,input,now);});return json(roomUpdate(room,now,cursor(request)));}catch(error){return failure(error);}}

function cursor(request:Request){const raw=new URL(request.url).searchParams.get('since');return raw!==null&&/^\d+$/.test(raw)?Number(raw):null;}
