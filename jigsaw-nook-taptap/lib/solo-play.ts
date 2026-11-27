import { boardFor, WORLD, dropGroup, neighbors, snapTolerance, placedCount, restorePuzzle, type PuzzleState } from './puzzle-engine';
import type { RoomSnapshot } from './room-engine';
import type { RoomClientDependencies, RoomTicket } from './room-client';

export const SOLO_ONLINE_MS = 22000;
export const SOLO_BATCH_MAX = 40;
export const SOLO_MAX_PENDING = 600;
export const ROOM_CACHE_MAX = 8;
export const ROOM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type SoloSnapKind = 'lock' | 'join';
export type SoloOp = {
  requestId: string;
  groupId: number;
  dx: number;
  dy: number;
  snapped: boolean;
  pieceId?: number;
  snapKind?: SoloSnapKind;
  mergedPieces?: number[];
};
export type SoloWireOp = Omit<SoloOp, 'snapped'>;
export type SoloEnergy = {enabled:boolean; energy:number; cap:number; cost:number; xp:number; autoSupply:boolean; supplyEnergy:number; autoGiftCount?:number; free:boolean};
export type SoloStorage = {get(k:string):string|null; set(k:string,v:string):void; remove(k:string):void};
export type SoloOutbox = {v:1; roomId:string; playerId:string; token:string; ops:SoloOp[]; savedAt:number};
export type SoloBatchReceipt = {applied:string[]; skipped:{requestId:string;code:string}[]; stopped:null|{requestId:string;code:string;message?:string}};
export type CachedRoomSnapshot = RoomSnapshot & {levelId?:string; requestedPieces?:number; maxPlayers?:number};
export type CachedRoomEntry = {v:1; roomId:string; playerId:string; token:string; snapshot:CachedRoomSnapshot; savedAt:number};
export const SOLO_INDEX_KEY = 'jigsaw:solo-outbox:index';
export const soloOutboxKey = (roomId:string) => 'jigsaw:solo-outbox:v1:' + roomId;
export const ROOM_CACHE_INDEX_KEY = 'jigsaw:room-cache:index';
export const roomCacheKey = (roomId:string) => 'jigsaw:room-cache:v1:' + roomId;

export function toWireSoloOp(op: SoloOp): SoloWireOp {
  const wire: SoloWireOp = { requestId: op.requestId, groupId: op.groupId, dx: op.dx, dy: op.dy };
  if (op.pieceId !== undefined) wire.pieceId = op.pieceId;
  if (op.snapKind !== undefined) wire.snapKind = op.snapKind;
  if (op.mergedPieces?.length) wire.mergedPieces = op.mergedPieces;
  return wire;
}

// Keep this arithmetic identical to room-engine's boundedOffset (including WORLD).
export function clampGroupOffset(puzzle:PuzzleState,groupId:number,dx:number,dy:number) {
  const group=puzzle.groups.find(g=>g.id===groupId)!,board=boardFor(puzzle.cols,puzzle.rows),w=board.width/puzzle.cols,h=board.height/puzzle.rows;
  const xs=group.pieces.map(id=>board.x+(id%puzzle.cols)*w),ys=group.pieces.map(id=>board.y+Math.floor(id/puzzle.cols)*h);
  return {dx:Math.max(WORLD.x+18-Math.min(...xs),Math.min(WORLD.x+WORLD.width-18-Math.max(...xs)-w,dx)),dy:Math.max(WORLD.y+18-Math.min(...ys),Math.min(WORLD.y+WORLD.height-18-Math.max(...ys)-h,dy))};
}

export function applySoloDrop(puzzle:PuzzleState,op:Pick<SoloOp,'groupId'|'dx'|'dy'|'pieceId'|'snapKind'|'mergedPieces'>) {
  let group=puzzle.groups.find(g=>g.id===op.groupId);
  if((!group||group.locked)&&op.pieceId!==undefined)group=puzzle.groups.find(g=>g.pieces.includes(op.pieceId!));
  if(!group||group.locked)return {puzzle,applied:false,snapped:false,completed:placedCount(puzzle)===puzzle.cols*puzzle.rows,dx:op.dx,dy:op.dy,pieceId:op.pieceId,snapKind:undefined as SoloSnapKind|undefined,mergedPieces:undefined as number[]|undefined};
  let targetDx=op.dx,targetDy=op.dy;
  if(op.snapKind==='lock'){
    targetDx=0;targetDy=0;
  }else if(op.snapKind==='join'&&op.mergedPieces?.length){
    const own=new Set(group.pieces);
    const pendingTargets=op.mergedPieces.filter(id=>!own.has(id));
    if(!pendingTargets.length)return {puzzle,applied:false,snapped:false,completed:placedCount(puzzle)===puzzle.cols*puzzle.rows,dx:group.dx,dy:group.dy,pieceId:op.pieceId,snapKind:undefined as SoloSnapKind|undefined,mergedPieces:undefined as number[]|undefined};
    const neighborSet=new Set<number>();
    for(const piece of group.pieces)for(const n of neighbors(piece,puzzle.cols,puzzle.rows))if(!own.has(n))neighborSet.add(n);
    const matchedPiece=pendingTargets.find(id=>neighborSet.has(id));
    const targetGroup=matchedPiece!==undefined?puzzle.groups.find(g=>g.pieces.includes(matchedPiece)):undefined;
    if(targetGroup&&targetGroup.id!==group.id){
      targetDx=targetGroup.locked?0:targetGroup.dx;
      targetDy=targetGroup.locked?0:targetGroup.dy;
    }
  }
  const beforePieces=new Set(group.pieces);
  const next={...puzzle,groups:puzzle.groups.map(g=>({...g,pieces:[...g.pieces]}))};
  const offset=clampGroupOffset(puzzle,group.id,targetDx,targetDy);
  Object.assign(next.groups.find(g=>g.id===group.id)!,offset);
  const result=dropGroup(next,group.id,snapTolerance(next));
  let pieceId=group.pieces[0],snapKind:SoloSnapKind|undefined,mergedPieces:number[]|undefined;
  if(result.snapped){
    const after=next.groups.find(g=>g.id===group.id)!;
    snapKind=after.locked?'lock':'join';
    const added=after.pieces.filter(id=>!beforePieces.has(id));
    if(added.length){
      const addedSet=new Set(added),seamTargets:number[]=[];
      let seamPiece:number|undefined;
      for(const ownPiece of beforePieces){
        for(const n of neighbors(ownPiece,puzzle.cols,puzzle.rows)){
          if(addedSet.has(n)){
            if(seamPiece===undefined)seamPiece=ownPiece;
            if(!seamTargets.includes(n)&&seamTargets.length<8)seamTargets.push(n);
          }
        }
      }
      if(seamPiece!==undefined)pieceId=seamPiece;
      if(seamTargets.length)mergedPieces=seamTargets;
    }
  }
  return {puzzle:next,applied:true,snapped:result.snapped,completed:placedCount(next)===next.cols*next.rows,...offset,pieceId,snapKind,mergedPieces};
}

export function replaySoloOps(puzzle:PuzzleState,ops:readonly SoloOp[]) {
  return ops.reduce((next,op)=>applySoloDrop(next,op).puzzle,puzzle);
}
export function otherPlayersPresent(snapshot:RoomSnapshot,playerId:string) {
  return snapshot.members.some(m=>m.id!==playerId&&m.lastSeen>0&&snapshot.serverTime-m.lastSeen<SOLO_ONLINE_MS)
    ||Object.values(snapshot.leases).some(lease=>lease.playerId!==playerId);
}
export function soloCanAfford(e:SoloEnergy|null,pendingSnaps:number) {
  return !e||!e.enabled||e.free||e.cost<=0||e.energy-e.cost*pendingSnaps>=e.cost||e.autoSupply&&((e.supplyEnergy>0&&e.cap>=e.cost)||(e.autoGiftCount??0)>0);
}
export function soloNeedsAutoSupply(e:SoloEnergy|null,pendingSnaps:number) {
  return !!e&&e.enabled&&!e.free&&e.cost>0&&e.energy-e.cost*pendingSnaps<0&&e.autoSupply&&((e.supplyEnergy>0&&e.cap>=e.cost)||(e.autoGiftCount??0)>0);
}

// Shared by the live client and launch-time recovery. A stopped op invalidates
// the entire dependent tail, including drops queued while the batch was in flight.
export function acknowledgeSoloOps(ops:SoloOp[],receipt:SoloBatchReceipt) {
  const stop=receipt.stopped?ops.findIndex(op=>op.requestId===receipt.stopped!.requestId):-1;
  const done=new Set([...receipt.applied,...receipt.skipped.map(op=>op.requestId)]);
  return (stop<0?ops:ops.slice(0,stop)).filter(op=>!done.has(op.requestId));
}

const hexId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value);
const get=(storage:SoloStorage,key:string)=>{try{return storage.get(key);}catch{return null;}};
const set=(storage:SoloStorage,key:string,value:string)=>{try{storage.set(key,value);return true;}catch{return false;}};
const remove=(storage:SoloStorage,key:string)=>{try{storage.remove(key);}catch{}};
function validSoloOp(op:unknown):op is SoloOp {
  const v=op as SoloOp|null;
  if(!v||typeof v!=='object'||!hexId(v.requestId)||!Number.isSafeInteger(v.groupId)||v.groupId<0
    ||!Number.isFinite(v.dx)||!Number.isFinite(v.dy)||Math.abs(v.dx)>20000||Math.abs(v.dy)>20000
    ||typeof v.snapped!=='boolean')return false;
  if(v.pieceId!==undefined&&(!Number.isSafeInteger(v.pieceId)||v.pieceId<0))return false;
  if(v.snapKind!==undefined&&v.snapKind!=='lock'&&v.snapKind!=='join')return false;
  if(v.mergedPieces!==undefined&&(!Array.isArray(v.mergedPieces)||v.mergedPieces.length>8||!v.mergedPieces.every(n=>Number.isSafeInteger(n)&&n>=0)))return false;
  return true;
}
function outboxIndex(storage:SoloStorage):string[] {
  try{const ids:unknown=JSON.parse(get(storage,SOLO_INDEX_KEY)??'[]');if(Array.isArray(ids))return [...new Set(ids.filter(hexId))];}catch{}
  return [];
}
function removeOutbox(storage:SoloStorage,roomId:string) {
  remove(storage,soloOutboxKey(roomId));
  const ids=outboxIndex(storage).filter(id=>id!==roomId);
  if(ids.length)set(storage,SOLO_INDEX_KEY,JSON.stringify(ids));else remove(storage,SOLO_INDEX_KEY);
}
export function saveSoloOutbox(storage:SoloStorage,outbox:SoloOutbox) {
  if(!outbox.ops.length){removeOutbox(storage,outbox.roomId);return;}
  if(set(storage,soloOutboxKey(outbox.roomId),JSON.stringify(outbox)))
    set(storage,SOLO_INDEX_KEY,JSON.stringify([...new Set([...outboxIndex(storage),outbox.roomId])]));
}
export function loadSoloOutbox(storage:SoloStorage,roomId:string):SoloOutbox|null {
  let raw:string|null;
  try{raw=storage.get(soloOutboxKey(roomId));}catch{return null;}
  if(raw===null){removeOutbox(storage,roomId);return null;}
  try{
    const box=JSON.parse(raw) as SoloOutbox;
    if(box?.v!==1||box.roomId!==roomId||!hexId(box.roomId)||!hexId(box.playerId)||!hexId(box.token)
      ||!Number.isFinite(box.savedAt)||box.savedAt<0||!Array.isArray(box.ops)||box.ops.length>SOLO_MAX_PENDING
      ||!box.ops.every(validSoloOp)
      ||new Set(box.ops.map(op=>op.requestId)).size!==box.ops.length)throw new Error('Invalid solo outbox');
    return box;
  }catch{removeOutbox(storage,roomId);return null;}
}
export function listSoloOutboxes(storage:SoloStorage):SoloOutbox[] {
  return outboxIndex(storage).map(id=>loadSoloOutbox(storage,id)).filter((box):box is SoloOutbox=>box!==null);
}

function roomCacheIndex(storage:SoloStorage):string[] {
  try{const ids:unknown=JSON.parse(get(storage,ROOM_CACHE_INDEX_KEY)??'[]');if(Array.isArray(ids))return [...new Set(ids.filter(hexId))];}catch{}
  return [];
}
export function removeCachedRoom(storage:SoloStorage,roomId:string) {
  remove(storage,roomCacheKey(roomId));
  const ids=roomCacheIndex(storage).filter(id=>id!==roomId);
  if(ids.length)set(storage,ROOM_CACHE_INDEX_KEY,JSON.stringify(ids));else remove(storage,ROOM_CACHE_INDEX_KEY);
}
export function saveCachedRoom(storage:SoloStorage,entry:CachedRoomEntry) {
  if(!entry||entry.v!==1||!hexId(entry.roomId)||!hexId(entry.playerId)||!hexId(entry.token)
    ||!entry.snapshot||entry.snapshot.id!==entry.roomId||!entry.snapshot.puzzle||!Number.isFinite(entry.savedAt)||entry.savedAt<0)return;
  const serialized=JSON.stringify(entry);
  if(!set(storage,roomCacheKey(entry.roomId),serialized))return;
  const nextIds=[entry.roomId,...roomCacheIndex(storage).filter(id=>id!==entry.roomId)];
  while(nextIds.length>ROOM_CACHE_MAX){
    const evicted=nextIds.pop();
    if(evicted)remove(storage,roomCacheKey(evicted));
  }
  set(storage,ROOM_CACHE_INDEX_KEY,JSON.stringify(nextIds));
}
export function loadCachedRoom(storage:SoloStorage,roomId:string,now=Date.now()):CachedRoomEntry|null {
  if(!hexId(roomId))return null;
  let raw:string|null;
  try{raw=storage.get(roomCacheKey(roomId));}catch{return null;}
  if(raw===null){removeCachedRoom(storage,roomId);return null;}
  try{
    const entry=JSON.parse(raw) as CachedRoomEntry;
    if(entry?.v!==1||entry.roomId!==roomId||!hexId(entry.playerId)||!hexId(entry.token)
      ||!Number.isFinite(entry.savedAt)||entry.savedAt<0||now-entry.savedAt>ROOM_CACHE_TTL_MS
      ||!entry.snapshot||entry.snapshot.id!==roomId||!entry.snapshot.puzzle
      ||typeof entry.snapshot.puzzle.imageId!=='string'||!entry.snapshot.puzzle.imageId)throw new Error('Invalid cached room');
    const puzzle=restorePuzzle(JSON.stringify(entry.snapshot.puzzle),[entry.snapshot.puzzle.imageId]);
    if(!puzzle)throw new Error('Invalid cached puzzle');
    return {...entry,snapshot:{...entry.snapshot,puzzle}};
  }catch{removeCachedRoom(storage,roomId);return null;}
}
export function listCachedRooms(storage:SoloStorage,now=Date.now()):CachedRoomEntry[] {
  return roomCacheIndex(storage)
    .map(id=>loadCachedRoom(storage,id,now))
    .filter((entry):entry is CachedRoomEntry=>entry!==null&&entry.snapshot.completedAt==null)
    .sort((a,b)=>b.savedAt-a.savedAt);
}
export function cachedRoomTicket(storage:SoloStorage,roomId:string,now=Date.now()):(RoomTicket&{cachedOffline:true;room:CachedRoomSnapshot})|null {
  const entry=loadCachedRoom(storage,roomId,now);
  if(!entry)return null;
  return {token:entry.token,playerId:entry.playerId,room:entry.snapshot,cachedOffline:true};
}

export async function flushStoredSoloOutboxes({storage,fetch,now,randomId,skipRoomId}:{storage:SoloStorage;fetch:RoomClientDependencies['fetch'];now:()=>number;randomId:()=>string;skipRoomId?:string}) {
  const summary={flushed:0,removed:0,failed:0,skipped:0};
  for(const box of listSoloOutboxes(storage)){
    if(now()-box.savedAt>7*24*60*60*1000){removeOutbox(storage,box.roomId);summary.removed++;continue;}
    if(box.roomId===skipRoomId){summary.skipped++;continue;}
    try{
      while(box.ops.length){
        const reply=await fetch(`/api/rooms/${box.roomId}`,{method:'POST',headers:{Authorization:`Bearer ${box.token}`,'Content-Type':'application/json'},body:JSON.stringify({type:'batch',requestId:randomId(),ops:box.ops.slice(0,SOLO_BATCH_MAX).map(toWireSoloOp)})});
        if([404,410].includes(reply.status)){removeOutbox(storage,box.roomId);removeCachedRoom(storage,box.roomId);summary.removed++;break;}
        if([401,403].includes(reply.status)){summary.skipped++;break;}
        if(!reply.ok)throw new Error('Solo recovery failed');
        const data=await reply.json();
        const remaining=acknowledgeSoloOps(box.ops,data.soloBatch);
        if(remaining.length===box.ops.length)throw new Error('Solo recovery made no progress');
        box.ops=remaining;saveSoloOutbox(storage,box);
        if(!box.ops.length){
          if(data.completedAt!=null)removeCachedRoom(storage,box.roomId);
          summary.flushed++;
        }
      }
    }catch{summary.failed++;}
  }
  return summary;
}
