import { currentGuest,withPlayerCookie } from '@/lib/player-identity';
import { body,json,failure } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
export async function POST(request:Request){try{
 const input=await body(request);if(typeof input.secret!=='string'||!/^[a-f0-9]{64}$/.test(input.secret))throw new RoomError('玩家身份无效');
 const guest=(await currentGuest(request,true,input.secret))!;
 return withPlayerCookie(json({ready:true}),guest);
}catch(error){return failure(error);}}
