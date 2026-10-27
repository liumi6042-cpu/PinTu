import {currentPlayer,withPlayerCookie} from './player-identity';
import {ensureBetaSeat} from './beta-seats';
import {addMember,snapshot,RoomError,ROOM_LIFETIME,type Room} from './room-engine';
import {digestToken,newId,json} from './room-store';
import {insertPlayableRoom} from './lobby-store';
import {localDb} from './local-db';
import {gridForDimensions,PIECE_RESOLUTION_ERROR} from './piece-policy';
import {createFittedPuzzle} from './puzzle-engine';
import {currentRoomArtwork,supportsArtworkSnapshot} from './room-artwork';
import {RoomWriteQueue} from './room-write-queue';
import type {ManagedContentSnapshot} from './managed-content';
import {findLevel,levelsView} from './shared-levels';
import {recordEvent} from './shared-events';
import * as joinRoute from '../app/api/rooms/[id]/join/route';

const writes=new RoomWriteQueue();
export async function createSharedLevelRoom(request:Request,levelId:string,content:ManagedContentSnapshot){
 const player=(await currentPlayer(request,true))!,now=Date.now(),level=findLevel(await levelsView(player.id,content,new URL(request.url).origin,now),levelId);
 if(!level)throw new RoomError('关卡不存在',404);
 if(level.status==='unavailable')throw new RoomError('关卡暂不可用',409);
 if(!['unlocked','cleared'].includes(level.status))throw Object.assign(new RoomError('先拼完上一格才能解锁这一格',403),{code:'LEVEL_LOCKED'});
 return writes.run(player.id+':'+level.id,async()=>{
  const existing=await localDb().prepare(`SELECT r.id FROM puzzle_rooms r LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id
   WHERE json_extract(r.data,'$.ownerId')=? AND json_extract(r.data,'$.levelId')=? AND json_extract(r.data,'$.completedAt') IS NULL
   AND r.expires_at>? AND COALESCE(m.closed,0)=0 ORDER BY json_extract(r.data,'$.createdAt') DESC LIMIT 1`).bind(player.id,level.id,now).first<{id:string}>();
  if(existing)return joinRoute.POST(request,{params:Promise.resolve({id:existing.id})});
  const photo=content.photos.find(photo=>photo.id===level.imageId);if(!photo)throw new RoomError('关卡图片暂不可用',409);
  const artwork=currentRoomArtwork(photo,level.pieces,!supportsArtworkSnapshot(request.headers)),grid=gridForDimensions(artwork.width,artwork.height,level.pieces);
  if(!grid)throw new RoomError(PIECE_RESOLUTION_ERROR,409);
  await ensureBetaSeat(player.id,now);
  // Fixed-level builders reject these small grids and content-only pictures.
  const room:Room={id:newId(),levelId:level.id,title:photo.title,ownerId:player.id,visibility:'private',artwork,retentionVersion:2,lastPlayedAt:now,
   puzzle:createFittedPuzzle(photo.id,grid.cols,grid.rows,now>>>0,3),revision:0,createdAt:now,expiresAt:now+ROOM_LIFETIME,completedAt:null,members:[],leases:{},startedAt:null,participants:{}};
  const token=newId(),member=addMember(room,newId(),player.name,await digestToken(token),now,player.accountId,player.guestId);
  await insertPlayableRoom(room);
  await recordEvent(player.id,'room-create',room.id,{mode:'level',pieces:level.pieces,visibility:room.visibility},now);
  await recordEvent(player.id,'level-start',room.id,{levelId:level.id,pieces:level.pieces},now);
  return withPlayerCookie(json({token,playerId:member.id,room:snapshot(room,now)},201),player);
 });
}
