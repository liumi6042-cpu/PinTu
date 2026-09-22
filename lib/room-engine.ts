import { touchPublicRoom } from './public-room-retention';
import { createPuzzle, dropGroup, LEVELS, placedCount, boardFor, WORLD, snapTolerance, shuffleLoose, type PuzzleState } from './puzzle-engine';
import { recordRoomContribution,type RoomAchievementState } from './room-achievements';
import { PHOTO_IDS } from './puzzle-catalog';
import { supportsPieceCount,PIECE_RESOLUTION_ERROR,MAX_NEW_PIECES,HIGH_PIECES_PAUSED } from './piece-policy';
export { PHOTO_IDS } from './puzzle-catalog';
export const ROOM_LIFETIME=30*24*60*60*1000, LEASE_MS=10000, ONLINE_MS=22000;
export const ORGANIZE_COOLDOWN_MS=2000;
export const COLORS=['#d6e8b4','#99caf4','#eeafcf','#ffcb8e','#b6acf7','#8cddd1','#f3e192','#dda990'];
export type Member={id:string;name:string;color:string;digest:string;previousDigests?:string[];lastSeen:number;joinedAt:number;accountId?:string;guestId?:string};
export type Lease={playerId:string;expires:number;seq:number};
export type RoomVisibility='public'|'private'|'solo';
export type Room={lastOrganizedAt?:number;customImage?:import('./custom-images').CustomImage;publicDeadline?:number;publicLastSeenAt?:number;title?:string;acceptingNew?:boolean;admitted?:Record<string,boolean>;achievements?:RoomAchievementState;syncHistory?:import('./room-sync').RoomChange[];retentionVersion?:2;lastPlayedAt?:number;id:string;puzzle:PuzzleState;revision:number;createdAt:number;expiresAt:number;completedAt:number|null;members:Member[];leases:Record<string,Lease>;visibility?:RoomVisibility;ownerId?:string;startedAt?:number|null;participants?:Record<string,string>};
export type RoomSnapshot={customImage?:import('./custom-images').CustomImage;title?:string;acceptingNew?:boolean;achievementDays?:Record<string,string>;id:string;puzzle:PuzzleState;revision:number;serverTime:number;expiresAt:number;members:Omit<Member,'digest'|'previousDigests'|'joinedAt'|'accountId'|'guestId'>[];leases:Record<string,Lease>;visibility?:RoomVisibility;completedAt?:number|null;startedAt?:number|null;participantCount?:number};
export type RoomAction={type:'heartbeat'|'leave'|'claim'|'move'|'drop'|'release'|'shuffle';groupId?:number;dx?:number;dy?:number;seq?:number};
export class RoomError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export function validName(value:unknown){if(typeof value!=='string')throw new RoomError('请填写昵称');const name=value.trim().replace(/[\u0000-\u001f\u007f]/g,'');if(!name||name.length>16)throw new RoomError('昵称请填写 1–16 个字');return name;}
export function makeRoom(id:string,imageId:string,count:number,now:number):Room{const level=LEVELS.find(l=>l.count===count);if(!level||!PHOTO_IDS.includes(imageId))throw new RoomError('请选择有效图片与片数');if(count>MAX_NEW_PIECES)throw new RoomError(HIGH_PIECES_PAUSED);if(!supportsPieceCount(imageId,count))throw new RoomError(PIECE_RESOLUTION_ERROR);return {id,retentionVersion:2,lastPlayedAt:now,puzzle:createPuzzle(imageId,level.cols,level.rows),revision:0,createdAt:now,expiresAt:now+ROOM_LIFETIME,completedAt:null,members:[],leases:{}};}
// A table counts as started once a group has been connected or locked. That is what makes it
// worth keeping after its lobby day ends, and what lets its players come back to it.
export function hasTableProgress(puzzle:Pick<PuzzleState,'groups'>){return puzzle.groups.some(group=>group.locked||group.pieces.length>1);}
export function ensureOpen(room:Pick<Room,'expiresAt'|'visibility'|'puzzle'>,now:number){
 if(room.expiresAt>now)return;
 // Past its lobby day a public table is not gone: everyone who played it can return from My
 // puzzles and pick up where they left off, and it briefly shows in the lobby again while
 // somebody plays. A table with nothing on it is not worth keeping.
 if(room.visibility==='public'&&hasTableProgress(room.puzzle))return;
 throw new RoomError('房间已过期，请重新创建房间',410);
}
export function hasRoomAdmission(room:Room,identity?:string){return !!identity&&(room.ownerId===identity||!!room.admitted?.[identity]||!!room.participants?.[identity]||room.members.some(m=>m.accountId===identity||m.guestId===identity));}
export function touchRoom(room:Room,now:number){if(room.completedAt!==null)return;room.lastPlayedAt=Math.max(room.lastPlayedAt||0,now);if(room.visibility==='public')touchPublicRoom(room,now);else room.expiresAt=room.lastPlayedAt+ROOM_LIFETIME;}
export function pruneLeases(room:Room,now:number){for(const [id,l] of Object.entries(room.leases))if(l.expires<=now||!room.puzzle.groups.some(g=>g.id===Number(id)&&!g.locked))delete room.leases[id];}
export function addMember(room:Room,id:string,name:string,digest:string,now:number,accountId?:string,guestId?:string){ensureOpen(room,now);
 if(accountId&&guestId)throw new RoomError('玩家身份无效');
 touchPublicRoom(room,now);
 const identity=accountId||guestId;
 const known=room.members.some(m=>m.digest===digest||(accountId&&m.accountId===accountId)||(guestId&&m.guestId===guestId));
 const returning=known||!!(identity&&(room.ownerId===identity||room.admitted?.[identity]||room.participants?.[identity]));
 if(room.acceptingNew===false&&!returning)throw new RoomError('房主已暂停新玩家加入，已入座的朋友可以继续',403);
 if(identity)(room.admitted??={})[identity]=true;
 if(room.visibility==='solo'&&(!identity||room.ownerId!==identity))throw new RoomError('这是一局个人拼图，只能由创建者继续',403);
 const existing=room.members.find(m=>m.digest===digest||(accountId&&m.accountId===accountId)||(guestId&&m.guestId===guestId));if(existing){if(now-existing.lastSeen>=ONLINE_MS&&room.members.filter(m=>m.id!==existing.id&&now-m.lastSeen<ONLINE_MS).length>=8)throw new RoomError('房间已有 8 位玩家，请稍后再试',409);existing.name=validName(name);existing.lastSeen=now;touchRoom(room,now);
  // Concurrent tabs share one player; keep their recent identity-bound tickets valid.
  if(identity&&existing.digest!==digest)existing.previousDigests=[existing.digest,...(existing.previousDigests||[]).filter(value=>value!==digest)].slice(0,7);
  existing.digest=digest;return existing;}
 if(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).length>=8)throw new RoomError('房间已有 8 位玩家，请稍后再试',409);
 room.members=room.members.filter(m=>now-m.lastSeen<5*60*1000);if(room.members.length>=32)throw new RoomError('加入过于频繁，请稍后再试',429);
 const used=new Set(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(m=>m.color));const member={id,name:validName(name),digest,lastSeen:now,joinedAt:now,color:COLORS.find(c=>!used.has(c))||COLORS[room.members.length%8],...(accountId?{accountId}:{}),...(guestId?{guestId}:{})};room.members.push(member);touchRoom(room,now);return member;
}
export function authenticate(room:Pick<Room,'expiresAt'|'visibility'|'puzzle'|'members'>,digest:string,now:number){ensureOpen(room,now);const member=room.members.find(m=>m.digest===digest||((m.accountId||m.guestId)&&m.previousDigests?.includes(digest)));if(!member)throw new RoomError('请重新加入房间',401);return member;}
export function roomElapsedMs(room:Room,now:number){const start=room.startedAt===undefined?room.createdAt:room.startedAt;return start===null?0:Math.max(0,(room.completedAt??now)-start);}
export function snapshotMetadata(room:Room,now:number):Omit<RoomSnapshot,'puzzle'> {return {customImage:room.customImage,title:room.title,acceptingNew:room.acceptingNew!==false,achievementDays:Object.fromEntries(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(m=>[m.id,room.achievements?.contributors[m.accountId||m.guestId||'']?.days.at(-1)||''])),id:room.id,revision:room.revision,serverTime:now,expiresAt:room.expiresAt,visibility:room.visibility,startedAt:room.startedAt,completedAt:room.completedAt,participantCount:Object.keys(room.participants||{}).length,members:room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(({id,name,color,lastSeen})=>({id,name,color,lastSeen})),leases:Object.fromEntries(Object.entries(room.leases).filter(([,l])=>l.expires>now))};}
export function snapshot(room:Room,now:number):RoomSnapshot {const puzzle=structuredClone(room.puzzle);puzzle.elapsed=Math.floor(roomElapsedMs(room,now)/1000);return {...snapshotMetadata(room,now),puzzle};}
function boundedOffset(room:Room,groupId:number,dx:number,dy:number){const group=room.puzzle.groups.find(g=>g.id===groupId)!,board=boardFor(room.puzzle.cols,room.puzzle.rows),w=board.width/room.puzzle.cols,h=board.height/room.puzzle.rows;const xs=group.pieces.map(id=>board.x+(id%room.puzzle.cols)*w),ys=group.pieces.map(id=>board.y+Math.floor(id/room.puzzle.cols)*h);return {dx:Math.max(18-Math.min(...xs),Math.min(WORLD.width-18-Math.max(...xs)-w,dx)),dy:Math.max(18-Math.min(...ys),Math.min(WORLD.height-18-Math.max(...ys)-h,dy))};}
export function applyAction(room:Room,member:Member,action:RoomAction,now:number){
 ensureOpen(room,now);pruneLeases(room,now);
 if(action.type!=='leave'&&now-member.lastSeen>=ONLINE_MS&&room.members.filter(m=>m.id!==member.id&&now-m.lastSeen<ONLINE_MS).length>=8)throw new RoomError('房间已有 8 位玩家，请稍后再连接',409);
 member.lastSeen=now;touchPublicRoom(room,now);
 if(action.type==='heartbeat'){const l=action.groupId===undefined?undefined:room.leases[action.groupId];if(l?.playerId===member.id)l.expires=now+LEASE_MS;return;}
 if(action.type==='leave'){member.lastSeen=0;for(const [key,l] of Object.entries(room.leases))if(l.playerId===member.id)delete room.leases[key];return;}
 if(action.type==='shuffle'){
  if(room.visibility==='solo'&&(!(member.accountId||member.guestId)||(member.accountId||member.guestId)!==room.ownerId))throw new RoomError('只有创建者可以整理这局个人拼图',403);
  if(room.visibility!=='solo'&&room.lastOrganizedAt!==undefined&&now-room.lastOrganizedAt<ORGANIZE_COOLDOWN_MS)throw new RoomError('刚刚整理过，请稍等 2 秒再试。',409);
  // Active leases are checked inside the same room transaction as the move.
  // This preserves both teammates' drags and this player's other open windows.
  const blocked=new Set(Object.keys(room.leases).map(Number));
  const changed=shuffleLoose(room.puzzle,now>>>0,blocked);
  if(changed){room.lastOrganizedAt=now;touchRoom(room,now);}
  return;
 }
 if(!['claim','move','drop','release'].includes(action.type))throw new RoomError('不支持的操作');
 if(!Number.isInteger(action.groupId))throw new RoomError('拼块编号无效');const groupId=action.groupId!,group=room.puzzle.groups.find(g=>g.id===groupId);
 if(!group||group.locked)throw new RoomError('这组拼块已合并或归位，请重新选择',409);
 const lease=room.leases[groupId];
 if(action.type==='claim'){
  if(lease&&lease.playerId!==member.id)throw new RoomError('这组拼块正被另一位玩家移动',409);
  if(Object.entries(room.leases).some(([id,l])=>Number(id)!==groupId&&l.playerId===member.id))throw new RoomError('请先放下当前拼块',409);
  if(room.startedAt===null)room.startedAt=now;
  const participant=member.accountId||member.guestId;if(participant)(room.participants??={})[participant]=member.name;
  room.leases[groupId]={playerId:member.id,expires:now+LEASE_MS,seq:0};touchRoom(room,now);return;
 }
 if(!lease||lease.playerId!==member.id)throw new RoomError('拖动已结束，请重新拿起拼块',409);
 if(action.type==='release'){delete room.leases[groupId];return;}
 if(!Number.isInteger(action.seq)||action.seq!<=0||!Number.isFinite(action.dx)||!Number.isFinite(action.dy)||Math.abs(action.dx!)>20000||Math.abs(action.dy!)>20000)throw new RoomError('拼块位置无效');
 if(action.seq!<=lease.seq)return;lease.seq=action.seq!;lease.expires=now+LEASE_MS;
 const offset=boundedOffset(room,groupId,action.dx!,action.dy!);group.dx=offset.dx;group.dy=offset.dy;touchRoom(room,now);
 if(action.type==='drop'){
  const blocked=new Set(Object.entries(room.leases).filter(([,l])=>l.playerId!==member.id).map(([id])=>Number(id)));
  const result=dropGroup(room.puzzle,groupId,snapTolerance(room.puzzle),blocked);delete room.leases[groupId];
  // One successful connection/placement counts once, never every piece in a carried group.
  if(result.snapped)recordRoomContribution(room,member,now);
  if(placedCount(room.puzzle)===room.puzzle.cols*room.puzzle.rows&&room.completedAt===null)room.completedAt=now;
 }
}
