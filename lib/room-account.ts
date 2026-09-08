import { requireAccount } from './account-store';
import { authenticate,RoomError,type Room } from './room-engine';
export async function checkRoomAccount(request:Request,room:Room,digest:string,now:number){
 const member=authenticate(room,digest,now);
 if(room.visibility){const account=await requireAccount(request);if(member.accountId!==account.id)throw new RoomError('请使用当前账号重新加入房间',401);}
 return member;
}
