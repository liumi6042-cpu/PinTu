import {body,failure,getDigest,json,readRoom} from '@/lib/room-store';
import {checkRoomAccount} from '@/lib/room-account';
import {ONLINE_MS,RoomError} from '@/lib/room-engine';
import {CheerError,roomCheers} from '@/lib/room-cheers';
type Context={params:Promise<{id:string}>};
async function authorize(request:Request,context:Context){
  const {id}=await context.params,now=Date.now(),digest=await getDigest(request);
  if(!/^[a-f0-9]{32}$/.test(id))throw new RoomError('邀请链接格式不正确',404);
  let room;try{room=await readRoom(id);}catch(error){if(error instanceof RoomError&&[403,404,410].includes(error.status))roomCheers.forget(id);throw error;}
  const member=await checkRoomAccount(request,room,digest,now);
  if(room.visibility==='solo')throw new RoomError('单人拼图无需同步鼠标',400);
  if(member.lastSeen<=0)throw new CheerError(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
  if(now-member.lastSeen>=ONLINE_MS)throw new RoomError('请先重新连接房间',409);
  return {room,member,now};
}
function failed(error:unknown){
  if(!(error instanceof CheerError))return failure(error);
  const response=json({code:error.code,error:error.message},error.status);
  if(error.status===429)response.headers.set('Retry-After','2');
  return response;
}
export async function GET(request:Request,context:Context){try{
  const {room,now}=await authorize(request,context);
  return json(roomCheers.cheersView(room.id,new URL(request.url).searchParams.get('after'),now));
}catch(error){return failed(error);}}
export async function POST(request:Request,context:Context){try{
  let input;try{input=await body(request);}catch(error){if(error instanceof RoomError&&error.status===400)throw new CheerError(400,'INVALID_CHEER','喝彩内容无效');throw error;}
  const {room,member,now}=await authorize(request,context);
  roomCheers.putCheer(room,member,input,now);
  return json(roomCheers.cheersView(room.id,input.after,now));
}catch(error){return failed(error);}}
