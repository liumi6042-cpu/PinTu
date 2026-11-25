import { checkRoomAccount } from '@/lib/room-account';
import { body,failure,getDigest,json,readRoom } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
import { isAssistanceKind } from '@/lib/assistance-policy';
import { grantRoomAssistance,roomAssistance } from '@/lib/assistance-store';
type Context={params:Promise<{id:string}>};
async function authorized(request:Request,context:Context){
 const {id}=await context.params,now=Date.now(),digest=await getDigest(request),room=await readRoom(id),member=await checkRoomAccount(request,room,digest,now);
 return {room,now,identity:member.accountId||member.guestId||digest};
}
export async function GET(request:Request,context:Context){try{const {room,identity}=await authorized(request,context);return json({grants:await roomAssistance(room.id,identity),serverTime:Date.now()});}catch(e){return failure(e);}}
export async function POST(request:Request,context:Context){try{
 const input=await body(request);if(!isAssistanceKind(input.kind)||typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId))throw new RoomError('请求格式无效');
 const {room,identity,now}=await authorized(request,context);
 const grants=await grantRoomAssistance(room,identity,input.kind,input.requestId,now);
 return json({grants,serverTime:Date.now()});
}catch(e){return failure(e);}}
