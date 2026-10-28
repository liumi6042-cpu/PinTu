import { boardFor, WORLD, dropGroup, snapTolerance, placedCount, type PuzzleState } from './puzzle-engine';
import type { RoomSnapshot } from './room-engine';
import type { RoomClientDependencies } from './room-client';

export const SOLO_ONLINE_MS = 22000;
export const SOLO_BATCH_MAX = 40;
export const SOLO_MAX_PENDING = 600;
export type SoloOp = {requestId:string; groupId:number; dx:number; dy:number; snapped:boolean};
export type SoloEnergy = {enabled:boolean; energy:number; cap:number; cost:number; xp:number; autoSupply:boolean; supplyEnergy:number; free:boolean};
export type SoloStorage = {get(k:string):string|null; set(k:string,v:string):void; remove(k:string):void};
export type SoloOutbox = {v:1; roomId:string; playerId:string; token:string; ops:SoloOp[]; savedAt:number};
export type SoloBatchReceipt = {applied:string[]; skipped:{requestId:string;code:string}[]; stopped:null|{requestId:string;code:string;message?:string}};
export const SOLO_INDEX_KEY = 'jigsaw:solo-outbox:index';
export const soloOutboxKey = (roomId:string) => 'jigsaw:solo-outbox:v1:' + roomId;

// Keep this arithmetic identical to room-engine's boundedOffset (including WORLD).
export function clampGroupOffset(puzzle:PuzzleState,groupId:number,dx:number,dy:number) {
  const group=puzzle.groups.find(g=>g.id===groupId)!,board=boardFor(puzzle.cols,puzzle.rows),w=board.width/puzzle.cols,h=board.height/puzzle.rows;
  const xs=group.pieces.map(id=>board.x+(id%puzzle.cols)*w),ys=group.pieces.map(id=>board.y+Math.floor(id/puzzle.cols)*h);
  return {dx:Math.max(WORLD.x+18-Math.min(...xs),Math.min(WORLD.x+WORLD.width-18-Math.max(...xs)-w,dx)),dy:Math.max(WORLD.y+18-Math.min(...ys),Math.min(WORLD.y+WORLD.height-18-Math.max(...ys)-h,dy))};
}

export function applySoloDrop(puzzle:PuzzleState,op:Pick<SoloOp,'groupId'|'dx'|'dy'>) {
  const group=puzzle.groups.find(g=>g.id===op.groupId);
  if(!group||group.locked)return {puzzle,applied:false,snapped:false,completed:placedCount(puzzle)===puzzle.cols*puzzle.rows,dx:op.dx,dy:op.dy};
  const next={...puzzle,groups:puzzle.groups.map(g=>({...g,pieces:[...g.pieces]}))};
  const offset=clampGroupOffset(puzzle,op.groupId,op.dx,op.dy);
  Object.assign(next.groups.find(g=>g.id===op.groupId)!,offset);
  const result=dropGroup(next,op.groupId,snapTolerance(next));
  return {puzzle:next,applied:true,snapped:result.snapped,completed:placedCount(next)===next.cols*next.rows,...offset};
}

export function replaySoloOps(puzzle:PuzzleState,ops:readonly SoloOp[]) {
  return ops.reduce((next,op)=>applySoloDrop(next,op).puzzle,puzzle);
}
export function otherPlayersPresent(snapshot:RoomSnapshot,playerId:string) {
  return snapshot.members.some(m=>m.id!==playerId&&m.lastSeen>0&&snapshot.serverTime-m.lastSeen<SOLO_ONLINE_MS)
    ||Object.values(snapshot.leases).some(lease=>lease.playerId!==playerId);
}
export function soloCanAfford(e:SoloEnergy|null,pendingSnaps:number) {
  return !e||!e.enabled||e.free||e.cost<=0||e.energy-e.cost*pendingSnaps>=e.cost||e.autoSupply&&e.supplyEnergy>0&&e.cap>=e.cost;
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
      ||!box.ops.every(op=>op&&hexId(op.requestId)&&Number.isSafeInteger(op.groupId)&&op.groupId>=0&&Number.isFinite(op.dx)&&Number.isFinite(op.dy)&&Math.abs(op.dx)<=20000&&Math.abs(op.dy)<=20000&&typeof op.snapped==='boolean')
      ||new Set(box.ops.map(op=>op.requestId)).size!==box.ops.length)throw new Error('Invalid solo outbox');
    return box;
  }catch{removeOutbox(storage,roomId);return null;}
}
export function listSoloOutboxes(storage:SoloStorage):SoloOutbox[] {
  return outboxIndex(storage).map(id=>loadSoloOutbox(storage,id)).filter((box):box is SoloOutbox=>box!==null);
}

export async function flushStoredSoloOutboxes({storage,fetch,now,randomId,skipRoomId}:{storage:SoloStorage;fetch:RoomClientDependencies['fetch'];now:()=>number;randomId:()=>string;skipRoomId?:string}) {
  const summary={flushed:0,removed:0,failed:0,skipped:0};
  for(const box of listSoloOutboxes(storage)){
    if(now()-box.savedAt>7*24*60*60*1000){removeOutbox(storage,box.roomId);summary.removed++;continue;}
    if(box.roomId===skipRoomId){summary.skipped++;continue;}
    try{
      while(box.ops.length){
        const reply=await fetch(`/api/rooms/${box.roomId}`,{method:'POST',headers:{Authorization:`Bearer ${box.token}`,'Content-Type':'application/json'},body:JSON.stringify({type:'batch',requestId:randomId(),ops:box.ops.slice(0,SOLO_BATCH_MAX).map(({snapped,...op})=>op)})});
        if([404,410].includes(reply.status)){removeOutbox(storage,box.roomId);summary.removed++;break;}
        if([401,403].includes(reply.status)){summary.skipped++;break;}
        if(!reply.ok)throw new Error('Solo recovery failed');
        const data=await reply.json();
        const remaining=acknowledgeSoloOps(box.ops,data.soloBatch);
        if(remaining.length===box.ops.length)throw new Error('Solo recovery made no progress');
        box.ops=remaining;saveSoloOutbox(storage,box);
        if(!box.ops.length)summary.flushed++;
      }
    }catch{summary.failed++;}
  }
  return summary;
}
