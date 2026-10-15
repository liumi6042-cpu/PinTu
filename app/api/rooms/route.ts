import { ensureBetaSeat } from '@/lib/beta-seats';
import { requiresRoomMembership, canCreateMemberRoom, MEMBERSHIP_REQUIRED } from '@/lib/membership-policy';
import { addMember, snapshot, snapshotMetadata, ONLINE_MS, RoomError, type RoomVisibility } from '@/lib/room-engine';
import { INITIAL_STATE_FORMAT, type SeedRoomTicket } from '@/lib/room-creation';
import { body, digestToken, newId, json, failure,mutateRoom } from '@/lib/room-store';
import {localDb} from '@/lib/local-db';
import {insertOrReuseEmptyPublicRoom} from '@/lib/public-room-admission.mjs';
import {pieceBand} from '@/lib/piece-policy';
import {PHOTOS,RESTORABLE_PHOTOS} from '@/lib/puzzle-catalog';
import {currentRoomArtwork,supportsArtworkSnapshot} from '@/lib/room-artwork';
import { currentPlayer,withPlayerCookie } from '@/lib/player-identity';
import { newPlayableRoom,insertPlayableRoom } from '@/lib/lobby-store';
import { membershipFor,insertMemberRoom } from '@/lib/membership-store';
import { roomTitle } from '@/lib/room-management';
import { isCustomImageId } from '@/lib/custom-images';
import { ownedUserImage } from '@/lib/user-image-store';
import { photoGuidance } from '@/lib/play-guidance';
import { createPuzzle,createFittedPuzzle,LEVELS } from '@/lib/puzzle-engine';
import type { Room } from '@/lib/room-engine';
import { countsForDimensions,gridForDimensions,PIECE_RESOLUTION_ERROR,MAX_NEW_PIECES,HIGH_PIECES_PAUSED,NEW_GAME_LEVELS } from '@/lib/piece-policy';
import {checkPieceCreation} from '@/lib/room-piece-access';
import {readManagedContent} from '@/lib/managed-content';
import {managedImageAllowed} from '@/lib/managed-economy';
export async function POST(request:Request){
 try{
  const input=await body(request),now=Date.now();
  if(input.visibility==='solo')throw new RoomError('独自拼图已下线，请创建公开房间一起拼图。',410);
  // Visible rooms use an optional account or a persistent browser guest identity.
  if(input.guestSecret!==undefined&&(typeof input.guestSecret!=='string'||!/^[a-f0-9]{64}$/.test(input.guestSecret)))throw new RoomError('玩家身份无效');
  const registered=input.visibility!==undefined,player=await currentPlayer(request,true,input.guestSecret);
  if(registered&&!['solo','public','private'].includes(input.visibility))throw new RoomError('房间类型无效');
  const memberRoom=requiresRoomMembership(input.visibility);
  if(memberRoom&&(!player?.accountId||!canCreateMemberRoom(await membershipFor(player.accountId),now)))throw new RoomError(MEMBERSHIP_REQUIRED,403);
  const name=player!.name;let room:Room;
  // Retain the existing validation/error for paused piece counts.
  if(typeof input.pieces==='number'&&input.pieces>MAX_NEW_PIECES)throw new RoomError(HIGH_PIECES_PAUSED);
  if(typeof input.pieces==='number')checkPieceCreation(input.pieces,player?.accountId);
  if(isCustomImageId(input.imageId)){
    if(!player?.accountId)throw new RoomError('请先登录本地账号',401);
    if(!['solo','private','public'].includes(input.visibility))throw new RoomError('房间类型无效');
    const image=await ownedUserImage(player.accountId,input.imageId),level=NEW_GAME_LEVELS.find(l=>l.count===input.pieces);if(!level)throw new RoomError('请选择有效图片与片数');
    // Uploads keep their own aspect ratio: the grid is fitted to the picture
    // instead of being cropped into the fixed board for that piece count.
    const grid=gridForDimensions(image.width,image.height,level.count);
    if(!grid)throw new RoomError(PIECE_RESOLUTION_ERROR);
    room={id:newId(),customImage:{id:image.id,title:image.title,width:image.width,height:image.height},title:image.title.slice(0,40),ownerId:player.id,visibility:input.visibility,retentionVersion:2,lastPlayedAt:now,puzzle:createFittedPuzzle(image.id,grid.cols,grid.rows),revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,members:[],leases:{},startedAt:null,participants:{}};
  }else{
   const content=readManagedContent();
   if(content&&!await managedImageAllowed(player!.id,input.imageId,content,now))throw new RoomError('请先在相册中解锁这张图片，或参加今日拼图。',403);
   // Catalog pictures also keep their own frame now. The room is still created
   // from the fixed level, which validates the request, then the grid is fitted
   // to the picture so a 2:1 landscape stops losing its left and right edges to
   // the 4:3 default board. Leaderboards group the fitted count into the band of
   // the level that was requested, so results stay on one board.
   room=newPlayableRoom(newId(),input.imageId,input.pieces,(input.visibility??'private') as RoomVisibility,player!.id,now,content?.photos.map(photo=>photo.id));
   if(content)room.title=content.photos.find(photo=>photo.id===input.imageId)?.title||room.title;
   const photo=content?.photos.find(photo=>photo.id===input.imageId)??RESTORABLE_PHOTOS.find(photo=>photo.id===input.imageId);
   if(!photo)throw new RoomError('图片暂不可用',503);
   room.artwork=currentRoomArtwork(photo,input.pieces,!supportsArtworkSnapshot(request.headers));
   const picture=room.artwork??photoGuidance(input.imageId),level=NEW_GAME_LEVELS.find(l=>l.count===input.pieces);
   if(picture&&level){
    const grid=gridForDimensions(picture.width,picture.height,level.count);
    if(grid&&(grid.cols!==level.cols||grid.rows!==level.rows))room.puzzle=createFittedPuzzle(input.imageId,grid.cols,grid.rows);
   }
  }
  // Shared clients use the reviewed compact table; existing/seed clients keep their layout.
  if(input.scatterVersion===3&&!input.initialState)room.puzzle=createFittedPuzzle(room.puzzle.imageId,room.puzzle.cols,room.puzzle.rows,room.puzzle.seed,3);
  // An already-open old client still reconstructs seed-v1 using the old slots.
  // Keep its creation compatible; new clients request seed-v2 instead.
  if(input.initialState==='seed-v1')room.puzzle=room.puzzle.scatterVersion===2
   ? createFittedPuzzle(room.puzzle.imageId,room.puzzle.cols,room.puzzle.rows,room.puzzle.seed,1):room.puzzle;
  if(room.visibility!=='solo') {room.title=roomTitle(input.title,true)||room.title;await ensureBetaSeat(player!.id,now);}
  const token=newId(),member=addMember(room,newId(),name,await digestToken(token),now,player?.accountId,player?.guestId);
  // Membership applies to private rooms only. A public upload room is as free as
  // any other public table, so it takes the ordinary playable path and never
  // spends a member slot; a private or solo upload still needs the image owner.
  if(memberRoom||(room.customImage&&room.visibility==='private'))await insertMemberRoom(room,player!.accountId!);
  else if(room.visibility==='public'&&!room.customImage){
   room.title??=PHOTOS.find(photo=>photo.id===room.puzzle.imageId)?.title??room.puzzle.imageId;
   const admission=await insertOrReuseEmptyPublicRoom(localDb(),room,pieceBand(room.puzzle.cols*room.puzzle.rows)??room.puzzle.cols*room.puzzle.rows,now,ONLINE_MS);
   if(!admission)throw new RoomError('房间刚刚开始或已坐满，请重试',409);
   if(!admission.created){
    const joined=await mutateRoom(admission.id,existing=>addMember(existing,member.id,name,member.digest,Date.now(),player?.accountId,player?.guestId));
    // A reused table must return its authoritative state, never a fresh seed.
    return withPlayerCookie(json({token,playerId:joined.result.id,room:snapshot(joined.room,Date.now()),reused:true},201),player!);
   }
  }else await insertPlayableRoom(room);
  const {groups:_groups,...initialPuzzle}=room.puzzle;
  const ticket=input.initialState===INITIAL_STATE_FORMAT||input.initialState==='seed-v1'
   ? {token,playerId:member.id,initialState:input.initialState==='seed-v1'?'seed-v1':INITIAL_STATE_FORMAT,room:{...snapshotMetadata(room,now),puzzle:initialPuzzle}} satisfies SeedRoomTicket
   : {token,playerId:member.id,room:snapshot(room,now)};
  const response=json(ticket,201);return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
