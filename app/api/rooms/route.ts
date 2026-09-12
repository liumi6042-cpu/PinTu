import { ensureBetaSeat } from '@/lib/beta-seats';
import { requiresRoomMembership, canCreateMemberRoom, MEMBERSHIP_REQUIRED } from '@/lib/membership-policy';
import { addMember, snapshot, RoomError, type RoomVisibility } from '@/lib/room-engine';
import { body, digestToken, newId, json, failure } from '@/lib/room-store';
import { currentPlayer,withPlayerCookie } from '@/lib/player-identity';
import { newPlayableRoom,insertPlayableRoom } from '@/lib/lobby-store';
import { membershipFor,insertMemberRoom } from '@/lib/membership-store';
import { roomTitle } from '@/lib/room-management';
import { isCustomImageId } from '@/lib/custom-images';
import { ownedUserImage } from '@/lib/user-image-store';
import { createPuzzle,LEVELS } from '@/lib/puzzle-engine';
import type { Room } from '@/lib/room-engine';
import { requireSoloAccount } from '@/lib/solo-account';
export async function POST(request:Request){
 try{
  const input=await body(request),now=Date.now();
  if(input.visibility==='solo')await requireSoloAccount(request);
  // Visible rooms use an optional account or a persistent browser guest identity.
  const registered=input.visibility!==undefined,player=await currentPlayer(request,true);
  if(registered&&!['solo','public','private'].includes(input.visibility))throw new RoomError('房间类型无效');
  const memberRoom=requiresRoomMembership(input.visibility);
  if(memberRoom&&(!player?.accountId||!canCreateMemberRoom(await membershipFor(player.accountId),now)))throw new RoomError(MEMBERSHIP_REQUIRED,403);
  const name=player!.name;let room:Room;
  if(isCustomImageId(input.imageId)){
    if(!player?.accountId)throw new RoomError('请先登录本地账号',401);
    if(!['solo','private'].includes(input.visibility))throw new RoomError('自上传图片仅供自己和邀请的朋友游玩，不能公开到大厅。',403);
    const image=await ownedUserImage(player.accountId,input.imageId),level=LEVELS.find(l=>l.count===input.pieces);if(!level)throw new RoomError('请选择有效图片与片数');
    room={id:newId(),customImage:{id:image.id,title:image.title,width:image.width,height:image.height},title:image.title.slice(0,40),ownerId:player.id,visibility:input.visibility,retentionVersion:2,lastPlayedAt:now,puzzle:createPuzzle(image.id,level.cols,level.rows),revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,members:[],leases:{},startedAt:null,participants:{}};
  }else room=newPlayableRoom(newId(),input.imageId,input.pieces,(input.visibility??'private') as RoomVisibility,player!.id,now);
  if(room.visibility!=='solo') {room.title=roomTitle(input.title,true)||room.title;await ensureBetaSeat(player!.id,now);}
  const token=newId(),member=addMember(room,newId(),name,await digestToken(token),now,player?.accountId,player?.guestId);
  if(memberRoom||room.customImage)await insertMemberRoom(room,player!.accountId!);else await insertPlayableRoom(room);
  const response=json({token,playerId:member.id,room:snapshot(room,now)},201);return player?withPlayerCookie(response,player):response;
 }catch(error){return failure(error);}
}
