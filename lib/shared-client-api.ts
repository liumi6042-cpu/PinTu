import {currentPlayer,currentGuest,withPlayerCookie} from './player-identity';
import {playerName} from './player-name';
import {customPhoto} from '@/lib/custom-images';
import {currentAccount} from './account-store';
import {localDb} from './local-db';
import {body,json,failure,readRoom} from './room-store';
import {RoomError,hasRoomAdmission} from './room-engine';
import {securityLimit} from './account-security';
import {readManagedContent,managedDailyPuzzle,managedGalleryPhotos,effectiveManagedAlbums} from './managed-content';
import {managedPlayerView,managedPlayerAction,managedAccessibleImageIds,managedCollectionStats,ownedManagedCursor} from './managed-economy';
import {webRecentRooms,webOwnedRooms,webRecordJoin,webRemoveOwned} from '../server/web-room-history.mjs';
import {pieceBand} from './piece-policy';
import {photoGuidance} from './play-guidance';
import {RESTORABLE_PHOTOS} from './puzzle-catalog';
import {roomArtworkPhoto,roomUsesUpgradedArtwork,supportsArtworkSnapshot} from './room-artwork';
import {sharedConfig,sharedRequestAllowed,sharedProfile,sharedCollection,sharedTasks,sharedGiftId,sharedImage,SHARED_COMPAT_URLS} from './shared-client-model';
import * as roomsRoute from '../app/api/rooms/route';
import * as roomRoute from '../app/api/rooms/[id]/route';
import * as joinRoute from '../app/api/rooms/[id]/join/route';
import * as chatRoute from '../app/api/rooms/[id]/chat/route';
import * as cursorRoute from '../app/api/rooms/[id]/cursors/route';
import * as cheersRoute from '../app/api/rooms/[id]/cheers/route';
import * as assistanceRoute from '../app/api/rooms/[id]/assistance/route';
import * as lobbyRoute from '../app/api/lobby/route';
import {webDiagnosticsAllowed,createWebDiagnostic,webDiagnosticRoom} from './shared-diagnostics';
import {sharedLobbyExtras} from './shared-lobby-extras';
import {sharedContributionView} from './shared-contribution-ranking';
import {levelsView,levelProgress,destination} from './shared-levels';
import {createSharedLevelRoom} from './shared-level-rooms';
import {recordEvent} from './shared-events';

type Data=Record<string,any>;
const phrases=['大家好！','我来找边缘','这块放这里','稍等一下','一起加油！','我来拼边缘','我来拼中间','请稍等一下','这一块在这里','谢谢你！','拼得真棒！','我要离开了','👏','👍','😊','🧩'];
const unsupported=(message='这项功能目前尚未接入网页版',url?:string)=>json({error:message,code:'WEB_FEATURE_UNAVAILABLE',...(url?{compatUrl:url}:{})},501);
// Uploaded pictures are playable here now; only solo rooms and boards above 500
// pieces still need the legacy client.
const compatibilityRoom=(room:Data)=>room.visibility==='solo'||(pieceBand(room.puzzle?.cols*room.puzzle?.rows)||0)>500;
const roomLink=(id:string)=>'/play?room='+id;
async function playerState(owner:string){const row=await localDb().prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').bind(owner).first<{data:string}>();return row?JSON.parse(row.data):{};}
async function context(request:Request,guestSecret?:string){
 const content=readManagedContent(supportsArtworkSnapshot(request.headers));if(!content)throw new RoomError('正式内容暂未发布，暂时不能读取玩家奖励',503);
 const player=(await currentPlayer(request,true,guestSecret))!,account=await currentAccount(request),guest=await currentGuest(request),origin=new URL(request.url).origin;
 const view=await managedPlayerView(player.id,content,origin) as Data;
 const owners=[...new Set([player.id,guest?.id].filter((id):id is string=>!!id))];
 const owned=await webOwnedRooms(localDb(),owners,(room:Data)=>({photo:roomPhoto(room,origin),thumbSrc:roomPhoto(room,origin)?.thumbSrc,compatUrl:roomLink(room.id),canClose:false}));
 const state=await playerState(player.id),profile={...sharedProfile(view,player,account,owned,state,await levelProgress(player.id)),diagnostics:webDiagnosticsAllowed(account)};
 return {content,player,account,origin,view,state,profile};
}
type Context=Awaited<ReturnType<typeof context>>;
function answer(value:unknown,ctx:Context,status=200){return withPlayerCookie(json(value,status),ctx.player);}
async function refresh(ctx:Context){ctx.view=await managedPlayerView(ctx.player.id,ctx.content,ctx.origin,{recover:false}) as Data;ctx.state=await playerState(ctx.player.id);ctx.profile={...sharedProfile(ctx.view,ctx.player,ctx.account,ctx.profile.ownedRooms,ctx.state,await levelProgress(ctx.player.id)),diagnostics:webDiagnosticsAllowed(ctx.account)};return ctx;}
async function action(ctx:Context,input:Data){await securityLimit('managed-content-actions',ctx.player.id,300);await managedPlayerAction(ctx.player.id,input,ctx.content);await refresh(ctx);}
function forwarded(request:Request,path:string,input?:Data){const headers=new Headers(request.headers);headers.delete('content-length');if(input)headers.set('Content-Type','application/json');return new Request(new URL(path,new URL(request.url).origin),{method:request.method,headers,...(input?{body:JSON.stringify(input)}:{})});}
async function responseData(response:Response){return await response.json() as Data;}
function replaceResponse(response:Response,value:Data){const headers=new Headers(response.headers);headers.set('Content-Type','application/json');headers.set('Cache-Control','private, no-store');return new Response(JSON.stringify(value),{status:response.status,headers});}
function roomPhoto(room:Data,origin:string){
 if(room.customImage)return sharedImage(customPhoto(room.customImage,room.id) as Data,origin);
 let photos:readonly Data[]=RESTORABLE_PHOTOS;try{photos=readManagedContent()?.photos??photos;}catch{/* Existing public pictures stay readable during a release outage. */}
 const id=room.puzzle?.imageId,photo:Data|undefined=roomArtworkPhoto(room as any,photos as any)??roomArtworkPhoto(room as any,RESTORABLE_PHOTOS);if(!photo)return undefined;
 const dimensions=photoGuidance(id);return sharedImage({...photo,width:photo.width??dimensions?.width,height:photo.height??dimensions?.height},origin);
}
function taskView(ctx:Context){return sharedTasks(ctx.view,ctx.profile,ctx.content.taskRewards);}
function collectionView(ctx:Context){return sharedCollection(ctx.view,ctx.profile,ctx.origin,ctx.content.gameSettings.collection);}
async function dropContribution(ctx:Context,roomId:string,revision:unknown,input:Data){
 if(typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId)||!Number.isSafeInteger(input.groupId)||input.groupId<0||!Number.isSafeInteger(revision))return undefined;
 // The route returns this mutation's committed revision, including a fresh
 // revision for ignored old sequences. Only a real new contribution has an
 // outbox event at this exact revision; never borrow the most recent reward.
 const eventId='room:'+roomId+':'+revision,row=await localDb().prepare('SELECT payload,settled_at FROM puzzle_managed_reward_events WHERE id=? AND room_id=? AND revision=?').bind(eventId,roomId,revision).first<{payload:string;settled_at:number|null}>();
 if(!row?.settled_at)return undefined;
 const event=JSON.parse(row.payload) as Data,contribution=event.owners?.find((value:Data)=>value.owner===ctx.player.id),settlement=ctx.state.settlements?.[eventId];
 if(event.room?.id!==roomId||event.room?.revision!==revision||!contribution||!Number.isSafeInteger(contribution.count)||contribution.count!==contribution.previousCount+1||settlement?.occurredAt!==event.occurredAt)return undefined;
 const receipt=ctx.state.receipts?.['snap:'+roomId+':'+contribution.count];
 if(!receipt||receipt.at!==event.occurredAt||!Number.isSafeInteger(receipt.xp)||receipt.xp<=0)return undefined;
 return {requestId:input.requestId,groupId:input.groupId,creditedXp:receipt.xp};
}
async function socialPeople(items:Data[]){
 const codes=[...new Set<string>(items.map((p:Data)=>p.code))],levels=new Map<string,number>();
 if(codes.length){const rows=await localDb().prepare(`SELECT c.code,COALESCE(json_extract(p.data,'$.level'),0) level FROM puzzle_managed_invitation_codes c LEFT JOIN puzzle_managed_players p ON p.owner=c.owner WHERE c.code IN (${codes.map(()=>'?').join(',')})`).bind(...codes).all<{code:string;level:number}>();for(const row of rows.results)levels.set(row.code,row.level);}
 return items.map(item=>({...item,code:item.code,level:levels.get(item.code)??0,online:false,lastSeenAt:0,createdAt:0}));
}
async function socialView(ctx:Context){
 const sources=ctx.view.friends,self={code:sources.code,name:ctx.player.name,level:ctx.profile.level,online:true,lastSeenAt:Date.now()};
 const people=await socialPeople([...sources.list,...sources.requests,...sources.outgoing]),byCode=new Map(people.map(person=>[person.code,person]));
 const friends=sources.list.map((person:Data)=>byCode.get(person.code)),incoming=sources.requests.map((person:Data)=>byCode.get(person.code)),outgoing=sources.outgoing.map((person:Data)=>byCode.get(person.code));
 return {self,friends,requests:{incoming,outgoing},conversations:[],blocked:[],unread:0,capabilities:sharedConfig(ctx.origin).capabilities.social,serverTime:Date.now()};
}
async function social(request:Request,path:string,input:Data,ctx:Context){
 const method=request.method,url=new URL(request.url);
 if(path==='/api/mobile/social'&&method==='GET')return answer(await socialView(ctx),ctx);
 if(path==='/api/mobile/social/recent'&&method==='GET'){
  const rows=await localDb().prepare(`SELECT c.code,r.peer_id AS owner,u.name,r.room_title AS roomTitle,r.seen_at AS seenAt,
   EXISTS(SELECT 1 FROM puzzle_managed_friend_requests q WHERE q.sender=r.owner_id AND q.recipient=r.peer_id) AS requested
   FROM (SELECT * FROM puzzle_shared_recent_tablemates WHERE owner_id=? ORDER BY seen_at DESC,peer_id LIMIT 60) r
   JOIN puzzle_managed_invitation_codes c ON c.owner=r.peer_id LEFT JOIN puzzle_users u ON u.id=r.peer_id
   WHERE r.peer_id<>r.owner_id AND NOT EXISTS(SELECT 1 FROM puzzle_managed_friends f WHERE f.owner=r.owner_id AND f.peer=r.peer_id)
   ORDER BY r.seen_at DESC,r.peer_id LIMIT 20`).bind(ctx.player.id).all<Data>();
  const players=await socialPeople(rows.results.map(({owner,...row})=>({...row,name:playerName(row.name,owner),requested:!!row.requested})));
  return answer({players,serverTime:Date.now()},ctx);
 }
 if(path==='/api/mobile/social/search'&&method==='GET'){
  const code=url.searchParams.get('code');if(!code||!/^[a-f0-9]{12}$/i.test(code))throw new RoomError('请填写12位好友邀请码');
  await securityLimit('shared-friend-search',ctx.player.id,120);
  const peer=await localDb().prepare("SELECT c.owner,c.code,u.name,p.data FROM puzzle_managed_invitation_codes c LEFT JOIN puzzle_users u ON u.id=c.owner LEFT JOIN puzzle_managed_players p ON p.owner=c.owner LEFT JOIN puzzle_account_security a ON a.user_id=c.owner WHERE c.code=? AND COALESCE(a.status,'active')='active'").bind(code.toLowerCase()).first<Data>();
  if(!peer)throw new RoomError('没有找到这个玩家',404);
  const relationship=peer.owner===ctx.player.id?'self':ctx.view.friends.list.some((p:Data)=>p.code===peer.code)?'friend':ctx.view.friends.requests.some((p:Data)=>p.code===peer.code)?'incoming':ctx.view.friends.outgoing.some((p:Data)=>p.code===peer.code)?'outgoing':'none';
  return answer({player:{code:peer.code,name:playerName(peer.name,peer.owner),level:peer.data?JSON.parse(peer.data).level:0,online:false,lastSeenAt:0},relationship},ctx);
 }
 if(method==='POST'&&['/api/mobile/social/requests','/api/mobile/social/requests/respond','/api/mobile/social/friends/remove'].includes(path)){
  if(typeof input.code!=='string'||!/^[a-f0-9]{12}$/i.test(input.code))throw new RoomError('请填写12位好友邀请码');
  if(path.endsWith('/requests'))await action(ctx,{action:'request-friend',code:input.code});
  else if(path.endsWith('/respond')&&input.accept===true)await action(ctx,{action:'accept-friend',code:input.code});
  else{
   if(path.endsWith('/respond')&&input.accept!==false)throw new RoomError('好友回应无效');
   await securityLimit('managed-content-actions',ctx.player.id,300);
   const db=localDb(),peer=await db.prepare('SELECT owner FROM puzzle_managed_invitation_codes WHERE code=?').bind(input.code.toLowerCase()).first<string>('owner');if(!peer||peer===ctx.player.id)throw new RoomError('好友不存在',404);
   if(path.endsWith('/respond'))await db.prepare('DELETE FROM puzzle_managed_friend_requests WHERE sender=? AND recipient=?').bind(peer,ctx.player.id).run();
   else await db.batch([db.prepare('DELETE FROM puzzle_managed_friends WHERE owner=? AND peer=?').bind(ctx.player.id,peer),db.prepare('DELETE FROM puzzle_managed_friends WHERE owner=? AND peer=?').bind(peer,ctx.player.id)]);
   await refresh(ctx);
  }
  return answer(await socialView(ctx),ctx);
 }
 return unsupported('网页版暂未接入私信、消息举报和屏蔽；好友关系及原有奖励已保留',SHARED_COMPAT_URLS.security);
}
async function sharedRoom(request:Request,path:string,input:Data){
 const match=/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|chat|cursors|cheers|assistance))?$/.exec(path);if(!match)return null;
 const id=match[1],part=match[2],method=request.method,params={params:Promise.resolve({id})};
 if(method==='DELETE')return unsupported('网页版暂不支持删除房间，已有进度会保留',roomLink(id));
 const room=await readRoom(id);
 if(compatibilityRoom(room))return json({error:'这间历史拼图目前尚未支持，原进度和权限保留',code:'LEGACY_ROOM_REQUIRED',compatUrl:roomLink(id)},409);
 if(part==='join'&&method==='POST'&&room.visibility&&room.acceptingNew===false){
  const player=await currentPlayer(request),guest=player?.accountId?await currentGuest(request):null;
  // The original join route may resume an admitted guest beneath a signed-in account.
  // Keep that identity switch in the original UI instead of issuing a mislabeled ticket.
  if(guest&&!hasRoomAdmission(room,player?.id)&&hasRoomAdmission(room,guest.id))return json({error:'这间历史拼图目前尚未支持，游客进度和奖励仍归原身份保留',code:'LEGACY_ROOM_REQUIRED',compatUrl:roomLink(id)},409);
 }
 let response:Response;
 const route:( {GET?:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>;POST?:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>})=part==='join'?joinRoute:part==='chat'?chatRoute:part==='cursors'?cursorRoute:part==='cheers'?cheersRoute:part==='assistance'?assistanceRoute:roomRoute;
 if(part==='chat'&&method==='POST'&&input.phraseId!==undefined){if(!Number.isSafeInteger(input.phraseId)||!phrases[input.phraseId])throw new RoomError('快捷消息无效');input={...input,text:phrases[input.phraseId]};}
 if(method==='GET'&&route.GET)response=await route.GET(forwarded(request,path+new URL(request.url).search),params);
 else if(method==='POST'&&route.POST)response=await route.POST(forwarded(request,path+new URL(request.url).search,input),params);
 else return json({error:'请求方式无效'},405);
 if(!response.ok)return response;
 if(method==='POST'&&(part==='join'||!part&&input.type==='heartbeat'&&input.historyJoin===true)){
  const player=await currentPlayer(request);
  if(player)await webRecordJoin(localDb(),[player.id],id);
 }
 const data=await responseData(response);
 const target=!part?data:part==='join'?data.room:null;
 const current=target?await readRoom(id):room;
 if(part==='join'&&method==='POST'){const member=current.members.find(member=>member.id===data.playerId),owner=member?.accountId||member?.guestId;if(owner)await recordEvent(owner,'room-join',id,{},Date.now());}
 const contributionView=target?await sharedContributionView(current,(await currentPlayer(request))?.id):null;
 if(target){target.photo=roomPhoto(current,new URL(request.url).origin);target.members=(target.members??[]).map((member:Data)=>({...member,...contributionView!.member(member.id)}));}
 if(part==='cursors')data.cursors=(data.cursors??[]).map((cursor:Data)=>({...cursor,decoration:cursor.managedCursor??null}));
 if(part==='cursors')response.headers.set('x-jigsaw-realtime-actions','normal');
 // The original room mutation commits its reward outbox before this DTO refresh.
 const effectiveInput=input.type==='realtime-action'?{...input.envelope?.action,requestId:input.envelope?.id}:input;
 if(target&&(target.completedAt||!part&&method==='POST'&&effectiveInput.type==='drop')){
  try{const ctx=await context(request);if(!part&&method==='POST'&&effectiveInput.type==='drop'){data.mobileProfile=ctx.profile;const contribution=data.realtimeActionReplayed?undefined:await dropContribution(ctx,id,data.realtimeActionRevision??data.revision,effectiveInput);if(contribution)data.mobileContribution=contribution;}
   if(target.completedAt){const receipts=ctx.state.receipts??{},result=receipts['completion:'+id]??{};target.mobileResult={roomId:id,contribution:ctx.state.rooms?.[id]?.rewarded??0,coins:result.coins??0,fragments:result.fragments??0,energy:0,xp:Object.entries(receipts).filter(([key])=>key.startsWith('snap:'+id+':')).reduce((sum,[,receipt])=>sum+((receipt as Data).xp??0),0),ranking:contributionView!.ranking};
    if(current.levelId&&current.ownerId===ctx.player.id){const progress=(await levelProgress(ctx.player.id)).find(row=>row.level_id===current.levelId);target.mobileResult.levelClear={levelId:current.levelId,energy:0,firstClear:progress?.room_id===id,...destination(current.levelId)};}
   }
  }catch{/* A committed room move must stay successful if optional profile reads fail. */}
 }
 delete data.realtimeActionRevision;
 delete data.realtimeActionReplayed;
 return replaceResponse(response,data);
}
async function createSharedRoom(request:Request,input:Data){
 const ctx=await context(request,typeof input.guestSecret==='string'?input.guestSecret:undefined),mode=input.mode??'selected',pieces=input.pieces;
 if(mode==='level'){
  let levelRequest=forwarded(request,'/api/rooms',{});
  if(ctx.player.cookie){const headers=new Headers(levelRequest.headers);headers.set('Cookie',[(headers.get('Cookie')??''),ctx.player.cookie.split(';')[0]].filter(Boolean).join('; '));levelRequest=new Request(levelRequest,{headers});}
  const response=await createSharedLevelRoom(levelRequest,input.levelId,ctx.content);if(!response.ok)return response;
  const data=await responseData(response);await webRecordJoin(localDb(),[ctx.player.id],data.room.id);data.room.photo=roomPhoto(data.room,ctx.origin);
  const contributionView=await sharedContributionView(await readRoom(data.room.id),ctx.player.id);data.room.members=(data.room.members??[]).map((member:Data)=>({...member,...contributionView.member(member.id)}));
  return withPlayerCookie(replaceResponse(response,data),ctx.player);
 }
 if(![108,300,500].includes(pieces))return json({error:'请选择108、300或500片；更大片数暂未开放',code:'LEGACY_CREATE_REQUIRED',compatUrl:'/play'},409);
 if(!['selected','random','daily'].includes(mode))throw new RoomError('创建方式无效');
 let imageId=input.imageId;
 if(mode==='daily')imageId=managedDailyPuzzle(ctx.content).id;
 else if(mode==='random'){
  const allowed=await managedAccessibleImageIds(ctx.player.id,ctx.content),photos=managedGalleryPhotos(ctx.content).filter(p=>allowed.has(p.id)).filter(p=>input.direction==='portrait'?p.height>p.width*1.1:input.direction==='landscape'?p.width>p.height*1.1:input.direction==='square'?Math.abs(p.width/p.height-1)<=.1:true);
  if(!photos.length)throw new RoomError('暂时没有可创建的图片',409);imageId=photos[Math.floor(Math.random()*photos.length)].id;
 }
 // Full authoritative snapshots avoid reconstructing a legacy seed with a newer layout.
 let createRequest=forwarded(request,'/api/rooms',{imageId,pieces,visibility:input.visibility??'public',scatterVersion:3});
 // Preserve the original guest selected while producing the profile, including a first visit.
 if(ctx.player.cookie){const headers=new Headers(createRequest.headers);headers.set('Cookie',[(headers.get('Cookie')??''),ctx.player.cookie.split(';')[0]].filter(Boolean).join('; '));createRequest=new Request(createRequest,{headers});}
 const response=await roomsRoute.POST(createRequest);
 if(!response.ok){const data=await responseData(response);return replaceResponse(response,{...data,...(response.status===401?{code:'ACCOUNT_REQUIRED',compatUrl:'/account'}:response.status===403&&String(data.error).includes('会员')?{code:'MEMBERSHIP_REQUIRED',compatUrl:'/membership'}:{})});}
 const data=await responseData(response);await webRecordJoin(localDb(),[ctx.player.id],data.room.id);data.room.photo=roomPhoto(data.room,ctx.origin);
 const contributionView=await sharedContributionView(await readRoom(data.room.id),ctx.player.id);data.room.members=(data.room.members??[]).map((member:Data)=>({...member,...contributionView.member(member.id)}));
 await recordEvent(ctx.player.id,'room-create',data.room.id,{mode,pieces,visibility:data.room.visibility},Date.now());
 return withPlayerCookie(replaceResponse(response,data),ctx.player);
}
async function playerCard(request:Request,code:string){
 if(!/^[a-f0-9]{12}$/i.test(code))throw new RoomError('请填写12位好友邀请码');
 const viewer=await currentPlayer(request,true);
 await securityLimit('shared-player-card',viewer!.id,120,{readOnly:true});
 const db=localDb(),peer=await db.prepare("SELECT c.owner,c.code,u.name,p.data FROM puzzle_managed_invitation_codes c LEFT JOIN puzzle_users u ON u.id=c.owner LEFT JOIN puzzle_managed_players p ON p.owner=c.owner LEFT JOIN puzzle_account_security a ON a.user_id=c.owner WHERE c.code=? AND COALESCE(a.status,'active')='active'").bind(code.toLowerCase()).first<Data>();
 if(!peer)throw new RoomError('没有找到这个玩家',404);
 const content=readManagedContent(supportsArtworkSnapshot(request.headers));
 if(!content)throw new RoomError('正式内容暂未发布，暂时不能读取玩家奖励',503);
 const state=peer.data?JSON.parse(peer.data):{},relationship=peer.owner===viewer!.id?'self':
  await db.prepare('SELECT 1 FROM puzzle_managed_friends WHERE owner=? AND peer=?').bind(viewer!.id,peer.owner).first()?'friend':
  await db.prepare('SELECT 1 FROM puzzle_managed_friend_requests WHERE sender=? AND recipient=?').bind(peer.owner,viewer!.id).first()?'incoming':
  await db.prepare('SELECT 1 FROM puzzle_managed_friend_requests WHERE sender=? AND recipient=?').bind(viewer!.id,peer.owner).first()?'outgoing':'none';
 let roomContribution=0;
 const roomId=new URL(request.url).searchParams.get('room');
 if(roomId&&/^[a-f0-9]{32}$/.test(roomId)){
  // readRoom performs maintenance and completion settlement; cards must be pure reads.
  const row=await db.prepare('SELECT r.data FROM puzzle_rooms r LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id WHERE r.id=? AND COALESCE(m.closed,0)=0').bind(roomId).first<{data:string}>();
  if(row){const room=JSON.parse(row.data);if(room.members?.some((member:Data)=>(member.guestId||member.accountId)===viewer!.id))roomContribution=room.achievements?.contributors?.[peer.owner]?.count??0;}
 }
 return withPlayerCookie(json({player:{code:peer.code,name:playerName(peer.name,peer.owner),level:state.level??0,decoration:await ownedManagedCursor(peer.owner,content)},stats:{...managedCollectionStats(state,content),roomContribution},relationship}),viewer!);
}
export async function sharedClientApi(request:Request,path:string){
 try{
  if(!sharedRequestAllowed(request))return json({error:'请从本网站操作',code:'ORIGIN_REQUIRED'},403);
  const card=/^\/api\/mobile\/players\/([^/]*)\/card$/.exec(path);
  if(card)return request.method==='GET'?await playerCard(request,card[1]):json({error:'请求方式无效'},405);
  if(!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path))return json({error:'接口不存在'},404);
  const method=request.method,input=method==='GET'?{}:await body(request);
  if(path==='/api/rooms'&&method==='POST')return await createSharedRoom(request,input);
  if(path.startsWith('/api/rooms/')){const diagnostic=await webDiagnosticRoom(request,path,input);if(diagnostic)return diagnostic;const result=await sharedRoom(request,path,input);if(result)return result;}
  if(path==='/api/lobby'&&method==='GET'){
   const response=await lobbyRoute.GET();if(!response.ok)return response;const data=await responseData(response),url=new URL(request.url);
   const direction=url.searchParams.get('direction'),limit=Math.max(1,Math.min(48,Number(url.searchParams.get('limit'))||16)),rawCursor=url.searchParams.get('cursor')??'0';if(!/^\d{1,5}$/.test(rawCursor))throw new RoomError('大厅翻页位置无效');
   const start=Number(rawCursor),filtered=(data.rooms??[]).filter((r:Data)=>{
    if(!supportsArtworkSnapshot(request.headers)&&roomUsesUpgradedArtwork({puzzle:{imageId:r.imageId},artwork:r.artwork}))return false;
    if(url.searchParams.get('pieces')&&r.pieces!==Number(url.searchParams.get('pieces')))return false;
    if(url.searchParams.get('open')==='1'&&(r.completed||r.acceptingNew===false||r.players>=8))return false;
    if(url.searchParams.get('active')==='1'&&r.players<=0)return false;
    const dimensions=r.customImage??r.artwork??photoGuidance(r.imageId),ratio=dimensions?dimensions.width/dimensions.height:1;
    return direction==='portrait'?ratio<1/1.1:direction==='landscape'?ratio>1.1:direction==='square'?Math.abs(ratio-1)<=.1:true;
   }).sort((a:Data,b:Data)=>Number(!b.completed&&b.acceptingNew!==false&&b.players<8)-Number(!a.completed&&a.acceptingNew!==false&&a.players<8)||b.players-a.players||(b.lastPlayedAt??b.createdAt??0)-(a.lastPlayedAt??a.createdAt??0)||b.id.localeCompare(a.id));
   data.rooms=filtered.slice(start,start+limit).map((r:Data)=>({...r,...(r.customImage||r.pieces>500?{compatUrl:roomLink(r.id)}:{})}));Object.assign(data,await sharedLobbyExtras(data.rooms));data.nextCursor=start+limit<filtered.length?String(start+limit):null;return replaceResponse(response,data);
  }
  if(path==='/api/room-history'||path==='/api/my-rooms'){
   const ctx=await context(request),guest=await currentGuest(request),owners=[...new Set([ctx.player.id,guest?.id].filter((id):id is string=>!!id))];
   if(path==='/api/my-rooms'&&method==='POST'){
    if(input.action!=='remove')throw new RoomError('列表操作无效');
    await webRemoveOwned(localDb(),owners,input.roomId);
    return answer({ok:true},ctx);
   }
   if(method!=='GET')return json({error:'请求方式无效'},405);
   const decorate=(room:Data)=>({photo:roomPhoto(room,ctx.origin),thumbSrc:roomPhoto(room,ctx.origin)?.thumbSrc});
   return answer({rooms:path==='/api/room-history'?await webRecentRooms(localDb(),owners,decorate):await webOwnedRooms(localDb(),owners,decorate),limit:10,serverTime:Date.now()},ctx);
  }
  if(path==='/api/levels'&&method==='GET'){const ctx=await context(request);return answer(await levelsView(ctx.player.id,ctx.content,ctx.origin),ctx);}
  if(!path.startsWith('/api/mobile/'))return json({error:'接口不存在'},404);
  const ctx=await context(request);
  if(path==='/api/mobile/diagnostics/room'&&method==='POST'){
   if(!webDiagnosticsAllowed(ctx.account))throw new RoomError('该测试入口仅对指定账号开放',403);
   const albums=effectiveManagedAlbums(ctx.content),free=new Set(albums.filter(a=>!a.purchasable||a.price===0).flatMap(a=>a.imageIds));
   const photo=managedGalleryPhotos(ctx.content).find(p=>free.has(p.id));if(!photo)throw new RoomError('暂无可测试图片',503);
   return await createWebDiagnostic(request,input,sharedImage(photo,ctx.origin));
  }
  if(path.startsWith('/api/mobile/social'))return await social(request,path,input,ctx);
  if(path==='/api/mobile/profile')return method==='GET'?answer(ctx.profile,ctx):unsupported('昵称与账号安全请在原账号管理页面设置',SHARED_COMPAT_URLS.security);
  if(path==='/api/mobile/tasks'&&method==='GET')return answer(taskView(ctx),ctx);
  if(path==='/api/mobile/collection'&&method==='GET')return answer(collectionView(ctx),ctx);
  if(path==='/api/mobile/gallery'&&method==='GET'){
   const now=Date.now(),albums=effectiveManagedAlbums(ctx.content,now),free=new Set(albums.filter(album=>!album.purchasable||album.price===0).flatMap(album=>album.imageIds)),paid=new Set(albums.filter(album=>album.purchasable&&album.price>0).flatMap(album=>album.imageIds));
   const allowed=await managedAccessibleImageIds(ctx.player.id,ctx.content,now),photos=[...managedGalleryPhotos(ctx.content,now),...(ctx.view.retainedImages??[])];
   const all=[...new Map(photos.map(p=>[p.id,p])).values()];
   return answer({imageIds:all.map(p=>p.id),freeImageIds:[...free],packedImageIds:[...paid].filter(id=>!free.has(id)),accessibleImageIds:[...allowed],photos:all.map(p=>sharedImage(p,ctx.origin)),daily:sharedImage(managedDailyPuzzle(ctx.content,now),ctx.origin),contentReleaseId:ctx.content.releaseId},ctx);
  }
  if(method!=='POST')return json({error:'请求方式无效'},405);
  if(path==='/api/mobile/gifts/open'){
   const gift=sharedGiftId(input,ctx.view),already=gift.claimed;await action(ctx,{action:'claim-gift',giftId:gift.id});
   return answer({...taskView(ctx),opened:{kind:gift.id,quantity:1,energy:0,xp:already?0:gift.xp,coins:already?0:gift.coins,levels:0,alreadyOpened:!!already}},ctx);
  }
  if(path==='/api/mobile/invitations/share'){
   const receipt=ctx.state.receipts?.['share:'+input.requestId];await action(ctx,{action:'share-invitation',requestId:input.requestId});const earned=ctx.state.receipts?.['share:'+input.requestId];
   return answer({...taskView(ctx),shared:{energy:0,xp:receipt?0:earned?.xp??0,coins:receipt?0:earned?.coins??0,levels:0,alreadyRewarded:!!receipt}},ctx);
  }
  if(path==='/api/mobile/invitations/accept'){await action(ctx,{action:'accept-invitation',code:input.code});return answer({...taskView(ctx),accepted:{alreadyBound:true,inviterName:'拼图朋友'}},ctx);}
  const mutation={'/api/mobile/collection/buy':{action:'purchase-album',albumId:input.packId},'/api/mobile/collection/craft':{action:'craft-decoration',decorationId:input.decorationId},'/api/mobile/collection/equip':{action:'equip-decoration',decorationId:input.decorationId}}[path];
  if(mutation){await action(ctx,mutation);return answer(collectionView(ctx),ctx);}
  if(path.startsWith('/api/mobile/supply/'))return unsupported('网页版沿用原公开房与会员规则，无需体力或建房券',SHARED_COMPAT_URLS.membership);
  return json({error:'接口不存在'},404);
 }catch(error){if(error instanceof RoomError&&error.status===400&&error.message==='请求格式无效'&&/^\/api\/rooms\/[a-f0-9]{32}\/cheers$/.test(path))return json({error:'喝彩内容无效',code:'INVALID_CHEER'},400);if(error instanceof Error&&'status'in error&&('code'in error||!(error instanceof RoomError)))return json({error:error.message,...('code'in error?{code:error.code}:{})},Number(error.status));return failure(error);}
}
