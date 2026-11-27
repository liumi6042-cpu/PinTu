import { roomUpdate } from '@/lib/room-sync';
import { authenticate, applyAction, RoomError, type RoomAction } from '@/lib/room-engine';
import { body, getDigest, readRoom, mutateRoom, json, failure } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
import { botTick } from '@/lib/bot-runner';
import { botsEnabled } from '@/lib/bot-settings';
import {checkArtworkClient} from '@/lib/room-artwork';
import {recordRecentTablemates} from '@/lib/shared-recent-tablemates';
import {applySharedAction,disconnectSharedActions,clearSharedActionLease,requireSharedActionChannel,sharedActionStreamWrite,type SharedActionResult} from '@/lib/shared-actions';
import {applyRoomBatch,type RoomBatchResult} from '@/lib/room-batch';
type Context={params:Promise<{id:string}>};
let lastBotTick = 0;
export async function GET(request:Request,context:Context){try{const {id}=await context.params,digest=await getDigest(request),room=await readRoom(id),now=Date.now();if(!botsEnabled()&&room.botRoom)throw new RoomError('房间不存在，请选择其他拼图',404);await checkRoomAccount(request,room,digest,now);checkArtworkClient(room,request.headers);if(botsEnabled()&&now-lastBotTick>=4000){lastBotTick=now;void botTick(now).catch(()=>{});}return json(roomUpdate(room,now,cursor(request)));}catch(error){return artworkFailure(error);}}
export async function POST(request:Request,context:Context){try{
 const {id}=await context.params,input=await body(request) as any,digest=await getDigest(request),now=Date.now(),existing=await readRoom(id);
 if(!botsEnabled()&&existing.botRoom)throw new RoomError('房间不存在，请选择其他拼图',404);
 await checkRoomAccount(request,existing,digest,now);if(input.type!=='leave')checkArtworkClient(existing,request.headers);
 const realtime=input.type==='realtime-action'||input.type==='realtime-disconnect';
 if(realtime)requireSharedActionChannel(request,input);
 const stream=realtime?sharedActionStreamWrite(authenticate(existing,digest,now).id,input):undefined;
 const {room,result}=await mutateRoom(id,room=>{
  const member=authenticate(room,digest,now);
  if(input.type==='realtime-action')return applySharedAction(room,member,input.envelope,input.connectionId,now);
  if(input.type==='realtime-disconnect'){disconnectSharedActions(room,member,input.connectionId,now);return null;}
  if(input.type==='batch')return applyRoomBatch(room,member,input,now);
  applyAction(room,member,input,now);clearSharedActionLease(room,member,input);return null;
 },stream);
 const batchResult=input.type==='batch'?result as RoomBatchResult:null;
 if(!batchResult&&result&&(result as SharedActionResult).status>=400)return json((result as SharedActionResult).error,(result as SharedActionResult).status);
 if(input.type==='heartbeat')await recordRecentTablemates(room,authenticate(room,digest,now),now);
 return json({...roomUpdate(room,now,cursor(request)),...(batchResult?{soloBatch:batchResult.soloBatch,...(request.headers.get('X-Jigsaw-Shared-Client')==='1'?{batchContributed:batchResult.contributedOps}:{})}:result?{realtimeActionRevision:(result as SharedActionResult).revision,realtimeActionReplayed:!!(result as SharedActionResult).replayed}:{})});
}catch(error){return artworkFailure(error);}}

function artworkFailure(error:unknown){return error instanceof Error&&'code'in error?json({error:error.message,code:error.code},error instanceof RoomError?error.status:409):failure(error);}

function cursor(request:Request){const raw=new URL(request.url).searchParams.get('since');return raw!==null&&/^\d+$/.test(raw)?Number(raw):null;}
