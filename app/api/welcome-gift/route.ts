import {currentAccount,requireAccount} from '@/lib/account-store';
import {currentGuest} from '@/lib/player-identity';
import {securityLimit} from '@/lib/account-security';
import {body,json,failure,readRoom} from '@/lib/room-store';
import {welcomeGift,offerWelcomeGift,claimWelcomeGift} from '@/lib/welcome-gift';
import {RoomError} from '@/lib/room-engine';
const view=(gift:Awaited<ReturnType<typeof welcomeGift>>)=>gift?{item:gift.item,claimed:!!gift.claimed_by}:null;
export async function GET(request:Request){try{const account=await currentAccount(request),guest=await currentGuest(request);return json({gift:view(await welcomeGift(account?.id,guest?.id))});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const input=await body(request),guest=await currentGuest(request);
 if(input.action==='claim'){const account=await requireAccount(request);await securityLimit('welcome-gift',account.id,60);const result=await claimWelcomeGift(account.id,guest?.id);return json({gift:view(result.gift),profile:result.profile});}
 if(input.action!=='offer')throw new RoomError('不支持的操作');
 const account=await currentAccount(request),owner=account?.id||guest?.id;if(!owner)throw new RoomError('请先加入拼图',401);
 await securityLimit('welcome-gift',owner,60);
 const room=await readRoom(String(input.roomId||''));
 return json({gift:view(await offerWelcomeGift(owner,room,account?.id,guest?.id))});
}catch(e){return failure(e);}}
