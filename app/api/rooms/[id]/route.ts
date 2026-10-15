import { roomUpdate } from '@/lib/room-sync';
import { authenticate, applyAction, RoomError, type RoomAction } from '@/lib/room-engine';
import { body, getDigest, readRoom, mutateRoom, json, failure } from '@/lib/room-store';
import { checkRoomAccount } from '@/lib/room-account';
import { botTick } from '@/lib/bot-runner';
import { botsEnabled } from '@/lib/bot-settings';
import {checkArtworkClient} from '@/lib/room-artwork';
type Context={params:Promise<{id:string}>};
let lastBotTick = 0;
export async function GET(request:Request,context:Context){try{const {id}=await context.params,digest=await getDigest(request),room=await readRoom(id),now=Date.now();if(!botsEnabled()&&room.botRoom)throw new RoomError('房间不存在，请选择其他拼图',404);await checkRoomAccount(request,room,digest,now);checkArtworkClient(room,request.headers);if(botsEnabled()&&now-lastBotTick>=4000){lastBotTick=now;void botTick(now).catch(()=>{});}return json(roomUpdate(room,now,cursor(request)));}catch(error){return artworkFailure(error);}}
export async function POST(request:Request,context:Context){try{const {id}=await context.params,input=await body(request) as RoomAction,digest=await getDigest(request),now=Date.now(),existing=await readRoom(id);if(!botsEnabled()&&existing.botRoom)throw new RoomError('房间不存在，请选择其他拼图',404);await checkRoomAccount(request,existing,digest,now);if(input.type!=='leave')checkArtworkClient(existing,request.headers);const {room}=await mutateRoom(id,room=>{const member=authenticate(room,digest,now);applyAction(room,member,input,now);});return json(roomUpdate(room,now,cursor(request)));}catch(error){return artworkFailure(error);}}

function artworkFailure(error:unknown){return error instanceof Error&&'code'in error&&error.code==='ARTWORK_CLIENT_UPDATE_REQUIRED'?json({error:error.message,code:error.code},409):failure(error);}

function cursor(request:Request){const raw=new URL(request.url).searchParams.get('since');return raw!==null&&/^\d+$/.test(raw)?Number(raw):null;}
