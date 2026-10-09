import { checkRoomAccount } from '@/lib/room-account';
import { body, failure, getDigest, json, readRoom } from '@/lib/room-store';
import { RoomError, ONLINE_MS } from '@/lib/room-engine';
import { chatCursor, chatText } from '@/lib/room-chat';
import { readChat, sendChat } from '@/lib/room-chat-store';
type Context={params:Promise<{id:string}>};
async function authorize(request:Request,context:Context){
 const {id}=await context.params,now=Date.now(),digest=await getDigest(request),room=await readRoom(id);
 const member=await checkRoomAccount(request,room,digest,now);
 if(room.visibility==='solo')throw new RoomError('聊天仅用于多人拼图',403);
 if(now-member.lastSeen>=ONLINE_MS)throw new RoomError('请先重新连接房间',409);
 return {room,member,now,identity:member.accountId||member.guestId||digest};
}
export async function GET(request:Request,context:Context){try{
 const after=chatCursor(new URL(request.url).searchParams.get('after')??'0');
 if(after===null)throw new RoomError('消息游标无效');
 const {room}=await authorize(request,context);return json(await readChat(room.id,after));
}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 const input=await body(request),text=chatText(input.text),after=chatCursor(input.after??0);
 if(!text)throw new RoomError('消息请填写 1–300 个字');
 if(after===null||typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId))throw new RoomError('请求格式无效');
 const {room,member,identity,now}=await authorize(request,context);
 const message=await sendChat(room.id,member,identity,input.requestId,text,now);
 return json({...await readChat(room.id,after),message});
}catch(error){return failure(error);}}
