import {body,failure,getDigest,json,readRoom,mutateRoom,digestToken} from '@/lib/room-store';
import {checkRoomAccount} from '@/lib/room-account';
import {RoomError} from '@/lib/room-engine';
import {continuationChoices,winningPicture} from '@/lib/puzzle-journey';
import {newPlayableRoom,insertPlayableRoom} from '@/lib/lobby-store';
import {createFittedPuzzle} from '@/lib/puzzle-engine';
import {gridForDimensions} from '@/lib/piece-policy';
import {photoGuidance} from '@/lib/play-guidance';
import {securityLimit} from '@/lib/account-security';
import {readManagedContent,effectiveManagedAlbums,managedGalleryPhotos,type ManagedContentSnapshot} from '@/lib/managed-content';
type Context={params:Promise<{id:string}>};
async function authorize(request:Request,context:Context){const {id}=await context.params,digest=await getDigest(request),room=await readRoom(id),member=await checkRoomAccount(request,room,digest,Date.now());if(!room.completedAt)throw new RoomError('完成这张拼图后再继续下一张',409);return {room,owner:member.accountId||member.guestId||''};}
function choicesFor(room:Awaited<ReturnType<typeof readRoom>>,content:ManagedContentSnapshot|null){
 if(room.continuation?.roomId)return room.continuation.choices;
 if(!content)return room.continuation?.choices||continuationChoices(room.puzzle.imageId);
 const free=new Set(effectiveManagedAlbums(content).filter(album=>!album.purchasable).flatMap(album=>album.imageIds));
 const photos=managedGalleryPhotos(content).filter(photo=>free.has(photo.id));
 const previous=room.continuation?.choices.filter(id=>id!==room.puzzle.imageId&&free.has(id));
 return previous?.length?previous:continuationChoices(room.puzzle.imageId,photos);
}
function view(room:Awaited<ReturnType<typeof readRoom>>,owner:string,choices:string[]){const c=room.continuation,contributions=room.achievements?.contributors||{},count=contributions[owner]?.count||0,total=Object.values(contributions).reduce((s,c)=>s+c.count,0);return {choices,votes:Object.fromEntries(choices.map(id=>[id,Object.values(c?.votes||{}).filter(v=>v===id).length])),myVote:c?.votes[owner]||null,nextRoomId:c?.roomId||null,selected:c?.selected||null,count,total,names:Object.values(room.participants||{}),completedAt:room.completedAt,canContinue:room.visibility==='public'&&count>0&&(choices.length>0||!!c?.roomId)};}
export async function GET(request:Request,context:Context){try{const {room,owner}=await authorize(request,context),content=readManagedContent();return json(view(room,owner,choicesFor(room,content)));}catch(e){return failure(e);}}
export async function POST(request:Request,context:Context){try{
 const input=await body(request),{room,owner}=await authorize(request,context);if(room.visibility!=='public'||!owner||!(room.achievements?.contributors[owner]?.count))throw new RoomError('有拼合贡献的公开房间伙伴可以发起续局',403);await securityLimit('puzzle-next',owner,120);
 if(input.action!=='vote'&&input.action!=='start')throw new RoomError('操作无效');
 const content=readManagedContent(),choices=choicesFor(room,content);if(!choices.length)throw new RoomError('暂时没有其他可用图片，请回大厅挑选。',409);
 const nextId=(await digestToken(room.id+':next-v1')).slice(0,32);
 const changed=await mutateRoom(room.id,r=>{const c=r.continuation??={choices,votes:{}};if(c.roomId)return;c.choices=choices;if(c.selected&&choices.includes(c.selected))return;c.selected=undefined;if(input.action==='vote'){if(!c.choices.includes(input.imageId))throw new RoomError('请选择候选图片');c.votes[owner]=input.imageId;}else c.selected=winningPicture(c.choices,c.votes);});
 if(input.action==='start'){
  const choice=changed.room.continuation!.selected!,target=newPlayableRoom(nextId,choice,300,'public',owner,Date.now(),content?.photos.map(photo=>photo.id)),picture=photoGuidance(choice);if(content)target.title=content.photos.find(photo=>photo.id===choice)?.title;if(picture){const grid=gridForDimensions(picture.width,picture.height,300);if(grid)target.puzzle=createFittedPuzzle(choice,grid.cols,grid.rows);}
  try{await insertPlayableRoom(target);}catch(e){const existing=await readRoom(nextId);if(existing.puzzle.imageId!==choice)throw e;}
  const linked=await mutateRoom(room.id,r=>{r.continuation!.roomId=nextId;});return json(view(linked.room,owner,choicesFor(linked.room,content)));
 }
 return json(view(changed.room,owner,choicesFor(changed.room,content)));
 }catch(e){return failure(e);}}
