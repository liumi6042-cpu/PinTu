import { createPuzzle, dropGroup, LEVELS, placedCount, boardFor, WORLD, snapTolerance, type PuzzleState } from './puzzle-engine';
import { PHOTO_IDS } from './puzzle-catalog';
export { PHOTO_IDS } from './puzzle-catalog';
export const ROOM_LIFETIME=24*60*60*1000, LEASE_MS=10000, ONLINE_MS=22000;
export const COLORS=['#d6e8b4','#99caf4','#eeafcf','#ffcb8e','#b6acf7','#8cddd1','#f3e192','#dda990'];
export type Member={id:string;name:string;color:string;digest:string;lastSeen:number;joinedAt:number};
export type Lease={playerId:string;expires:number;seq:number};
export type Room={id:string;puzzle:PuzzleState;revision:number;createdAt:number;expiresAt:number;completedAt:number|null;members:Member[];leases:Record<string,Lease>};
export type RoomSnapshot={id:string;puzzle:PuzzleState;revision:number;serverTime:number;expiresAt:number;members:Omit<Member,'digest'|'joinedAt'>[];leases:Record<string,Lease>};
export type RoomAction={type:'heartbeat'|'leave'|'claim'|'move'|'drop'|'release';groupId?:number;dx?:number;dy?:number;seq?:number};
export class RoomError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export function validName(value:unknown){if(typeof value!=='string')throw new RoomError('请填写昵称');const name=value.trim().replace(/[\u0000-\u001f\u007f]/g,'');if(!name||name.length>16)throw new RoomError('昵称请填写 1–16 个字');return name;}
export function makeRoom(id:string,imageId:string,count:number,now:number):Room{const level=LEVELS.find(l=>l.count===count);if(!level||!PHOTO_IDS.includes(imageId))throw new RoomError('请选择有效图片与片数');return {id,puzzle:createPuzzle(imageId,level.cols,level.rows),revision:0,createdAt:now,expiresAt:now+ROOM_LIFETIME,completedAt:null,members:[],leases:{}};}
export function ensureOpen(room:Room,now:number){if(room.expiresAt<=now)throw new RoomError('房间已过期，请重新创建房间',410);}
export function pruneLeases(room:Room,now:number){for(const [id,l] of Object.entries(room.leases))if(l.expires<=now||!room.puzzle.groups.some(g=>g.id===Number(id)&&!g.locked))delete room.leases[id];}
export function addMember(room:Room,id:string,name:string,digest:string,now:number){ensureOpen(room,now);const existing=room.members.find(m=>m.digest===digest);if(existing){existing.name=validName(name);existing.lastSeen=now;return existing;}
 if(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).length>=8)throw new RoomError('房间已有 8 位玩家，请稍后再试',409);
 room.members=room.members.filter(m=>now-m.lastSeen<5*60*1000);if(room.members.length>=32)throw new RoomError('加入过于频繁，请稍后再试',429);
 const used=new Set(room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(m=>m.color));const member={id,name:validName(name),digest,lastSeen:now,joinedAt:now,color:COLORS.find(c=>!used.has(c))||COLORS[room.members.length%8]};room.members.push(member);return member;
}
export function authenticate(room:Room,digest:string,now:number){ensureOpen(room,now);const member=room.members.find(m=>m.digest===digest);if(!member)throw new RoomError('请重新加入房间',401);return member;}
export function snapshot(room:Room,now:number):RoomSnapshot {const puzzle=structuredClone(room.puzzle);puzzle.elapsed=Math.floor(((room.completedAt??now)-room.createdAt)/1000);return {id:room.id,puzzle,revision:room.revision,serverTime:now,expiresAt:room.expiresAt,members:room.members.filter(m=>now-m.lastSeen<ONLINE_MS).map(({id,name,color,lastSeen})=>({id,name,color,lastSeen})),leases:Object.fromEntries(Object.entries(room.leases).filter(([,l])=>l.expires>now))};}
function boundedOffset(room:Room,groupId:number,dx:number,dy:number){const group=room.puzzle.groups.find(g=>g.id===groupId)!,board=boardFor(room.puzzle.cols,room.puzzle.rows),w=board.width/room.puzzle.cols,h=board.height/room.puzzle.rows;const xs=group.pieces.map(id=>board.x+(id%room.puzzle.cols)*w),ys=group.pieces.map(id=>board.y+Math.floor(id/room.puzzle.cols)*h);return {dx:Math.max(18-Math.min(...xs),Math.min(WORLD.width-18-Math.max(...xs)-w,dx)),dy:Math.max(18-Math.min(...ys),Math.min(WORLD.height-18-Math.max(...ys)-h,dy))};}
export function applyAction(room:Room,member:Member,action:RoomAction,now:number){
 ensureOpen(room,now);pruneLeases(room,now);
 if(action.type!=='leave'&&now-member.lastSeen>=ONLINE_MS&&room.members.filter(m=>m.id!==member.id&&now-m.lastSeen<ONLINE_MS).length>=8)throw new RoomError('房间已有 8 位玩家，请稍后再连接',409);
 member.lastSeen=now;
 if(action.type==='heartbeat'){const l=action.groupId===undefined?undefined:room.leases[action.groupId];if(l?.playerId===member.id)l.expires=now+LEASE_MS;return;}
 if(action.type==='leave'){member.lastSeen=0;for(const [key,l] of Object.entries(room.leases))if(l.playerId===member.id)delete room.leases[key];return;}
 if(!['claim','move','drop','release'].includes(action.type))throw new RoomError('不支持的操作');
 if(!Number.isInteger(action.groupId))throw new RoomError('拼块编号无效');const groupId=action.groupId!,group=room.puzzle.groups.find(g=>g.id===groupId);
 if(!group||group.locked)throw new RoomError('这组拼块已合并或归位，请重新选择',409);
 const lease=room.leases[groupId];
 if(action.type==='claim'){
  if(lease&&lease.playerId!==member.id)throw new RoomError('这组拼块正被另一位玩家移动',409);
  if(Object.entries(room.leases).some(([id,l])=>Number(id)!==groupId&&l.playerId===member.id))throw new RoomError('请先放下当前拼块',409);
  room.leases[groupId]={playerId:member.id,expires:now+LEASE_MS,seq:0};return;
 }
 if(!lease||lease.playerId!==member.id)throw new RoomError('拖动已结束，请重新拿起拼块',409);
 if(action.type==='release'){delete room.leases[groupId];return;}
 if(!Number.isInteger(action.seq)||action.seq!<=0||!Number.isFinite(action.dx)||!Number.isFinite(action.dy)||Math.abs(action.dx!)>20000||Math.abs(action.dy!)>20000)throw new RoomError('拼块位置无效');
 if(action.seq!<=lease.seq)return;lease.seq=action.seq!;lease.expires=now+LEASE_MS;
 const offset=boundedOffset(room,groupId,action.dx!,action.dy!);group.dx=offset.dx;group.dy=offset.dy;
 if(action.type==='drop'){
  const blocked=new Set(Object.entries(room.leases).filter(([,l])=>l.playerId!==member.id).map(([id])=>Number(id)));
  dropGroup(room.puzzle,groupId,snapTolerance(room.puzzle),blocked);delete room.leases[groupId];
  if(placedCount(room.puzzle)===room.puzzle.cols*room.puzzle.rows&&room.completedAt===null)room.completedAt=now;
 }
}
