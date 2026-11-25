import {body,json,failure} from '@/lib/room-store';
import {currentPlayer,withPlayerCookie} from '@/lib/player-identity';
import {readManagedContent} from '@/lib/managed-content';
import {managedPlayerView,managedPlayerAction,managedRewardStatus} from '@/lib/managed-economy';
import {securityLimit} from '@/lib/account-security';
async function unavailable(request:Request){
 const player=await currentPlayer(request),settlement=player?await managedRewardStatus(player.id):{pending:0,unknownSnapshot:0};
 return json({error:'奖励待结算，暂时不能领取，请稍后重试',contentReleaseId:null,settlement:{...settlement,status:'unavailable',message:'奖励配置暂时不可用，已记录的拼合会按原日期恢复结算。'}},503);
}
export async function GET(request:Request){try{let content;try{content=readManagedContent();}catch{return await unavailable(request);}if(!content)return json({enabled:false,contentReleaseId:null});const player=(await currentPlayer(request,true))!;return withPlayerCookie(json(await managedPlayerView(player.id,content,new URL(request.url).origin)),player);}catch(error){return failure(error);}}
export async function POST(request:Request){try{const input=await body(request);let content;try{content=readManagedContent();}catch{return await unavailable(request);}const player=(await currentPlayer(request,true))!;await securityLimit('managed-content-actions',player.id,300);await managedPlayerAction(player.id,input,content);return withPlayerCookie(json(await managedPlayerView(player.id,content,new URL(request.url).origin,{recover:false})),player);}catch(error){return failure(error);}}
