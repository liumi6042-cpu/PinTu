import { requireAccount } from './account-store';
import { authenticate,RoomError,type Room } from './room-engine';
import { currentGuest } from './player-identity';
export async function checkRoomAccount(request:Request,room:Room,digest:string,now:number){
 const member=authenticate(room,digest,now);
 if(member.accountId){const account=await requireAccount(request);if(member.accountId!==account.id)throw new RoomError('请使用当前账号重新加入房间',401);}
 else if(member.guestId){const player=await currentGuest(request);if(player?.guestId!==member.guestId)throw new RoomError('请重新加入房间',401);}
 else if(room.visibility)throw new RoomError('请重新加入房间',401);
 return member;
}
