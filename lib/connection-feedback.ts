import { boardFor,type Group,type Piece,type PuzzleState } from './puzzle-engine';

export const CONNECTION_GLOW_MS=300;
export type ConnectionSeam={pieceId:number;side:1|2};
export type ConnectionGlow={anchor:number;seams:ConnectionSeam[]};

// Compare topology, never positions: dragging, arranging, and polling echoes are silent.
export function newConnections(before:readonly Group[],after:PuzzleState):ConnectionGlow[]{
 const previous=new Map(before.map(g=>[g.id,g]));
 const changed=after.groups.filter(g=>g.pieces.length>1&&g.pieces.length!==(previous.get(g.id)?.pieces.length??0));
 if(!changed.length)return [];
 const owners=new Int32Array(after.cols*after.rows).fill(-1);
 before.forEach((g,index)=>g.pieces.forEach(id=>owners[id]=index));
 const glows:ConnectionGlow[]=[];
 for(const group of changed){
  const ids=new Set(group.pieces),seams:ConnectionSeam[]=[];
  for(const id of group.pieces){
   for(const [neighbor,side] of [[id%after.cols<after.cols-1?id+1:-1,1],[id+after.cols<after.cols*after.rows?id+after.cols:-1,2]] as const){
    if(neighbor>=0&&ids.has(neighbor)&&owners[id]>=0&&owners[neighbor]>=0&&owners[id]!==owners[neighbor])seams.push({pieceId:id,side});
    if(seams.length===32)break;
   }
   if(seams.length===32)break;
  }
  if(seams.length)glows.push({anchor:group.pieces[0],seams});
  if(glows.length===3)break;
 }
 return glows;
}
export function successfulDrop(before:Pick<Group,'pieces'|'locked'>|undefined,after:PuzzleState,groupId:number){
 if(!before||before.locked)return false;
 const group=after.groups.find(g=>g.id===groupId);
 return !!group&&(group.locked||group.pieces.length>before.pieces.length)&&before.pieces.every(id=>group.pieces.includes(id));
}
export function successfulRemoteConnection(before:readonly Group[],after:PuzzleState,protectedIds:ReadonlySet<number>){
 const previous=new Map(before.map(group=>[group.id,group]));
 return after.groups.some(group=>!protectedIds.has(group.id)&&successfulDrop(previous.get(group.id),after,group.id));
}
// Same tab geometry as pathFor, limited to the shared right/bottom edge.
export function connectionPath(piece:Piece,cols:number,rows:number,side:1|2){
 const board=boardFor(cols,rows),w=board.width/cols,h=board.height/rows,d=Math.min(w,h)*.23;
 const [x,y,tx,ty,nx,ny]=side===1?[w,0,0,h,1,0]:[w,h,-w,0,0,1],sign=piece.edges[side];
 const p=(t:number,v:number)=>`${x+tx*t+nx*d*v*sign} ${y+ty*t+ny*d*v*sign}`;
 return `M ${p(0,0)} L ${p(.32,0)} C ${p(.4,0)} ${p(.44,0)} ${p(.42,.16)} C ${p(.30,.70)} ${p(.36,1)} ${p(.50,1)} C ${p(.64,1)} ${p(.70,.70)} ${p(.58,.16)} C ${p(.56,0)} ${p(.60,0)} ${p(.68,0)} L ${p(1,0)}`;
}

export const MOBILE_CONNECTION_GLOW_MS = 500;
export const MOBILE_REDUCED_GLOW_MS = 170;
export type MobileConnectionGlow = ConnectionGlow & { outlineIds: number[]; source: 'local' | 'teammate' };
export type MobileContributionReceipt = { requestId: string; groupId: number; creditedXp: number };

/** Mobile feedback also covers a single piece locking to the board. Position
 * changes and repeated snapshots remain silent; classic seam feedback is unchanged. */
export function newMobileConnections(before: readonly Group[], after: PuzzleState, localGroups: ReadonlySet<number> = new Set()): MobileConnectionGlow[] {
 const previousOwners = new Map<number, Group>();
 for (const group of before) for (const id of group.pieces) previousOwners.set(id, group);
 const connections = newConnections(before, after), result: MobileConnectionGlow[] = [];
 for (const group of after.groups) {
  const newlyLocked = group.locked ? group.pieces.filter(id => previousOwners.has(id) && !previousOwners.get(id)!.locked) : [];
  const connection = connections.find(glow => group.pieces.includes(glow.anchor));
  if (!newlyLocked.length && !connection) continue;
  const touched = newlyLocked.length ? newlyLocked : connection!.seams.flatMap(seam => [seam.pieceId, seam.pieceId + (seam.side === 1 ? 1 : after.cols)]);
  // One burst per changed group, not one burst per piece in a large merged group.
  const outlineIds = [...new Set(touched)].slice(0, 3);
  result.push({ anchor: outlineIds[0], seams: connection?.seams ?? [], outlineIds, source: [...localGroups].some(id => group.id === id || group.pieces.includes(id)) ? 'local' : 'teammate' });
  if (result.length === 3) break;
 }
 return result;
}

/** Only positive, authoritative receipts may produce XP text. A gate lives for
 * one table, so a delayed poll or a replayed request cannot replay the reward. */
export class MobileContributionGate {
 private seen = new Set<string>();
 claim(receipt: MobileContributionReceipt) {
  if (!receipt || typeof receipt.requestId !== 'string' || !receipt.requestId || receipt.requestId.length > 128 || !Number.isSafeInteger(receipt.groupId) || receipt.groupId < 0 || !Number.isSafeInteger(receipt.creditedXp) || receipt.creditedXp <= 0 || this.seen.has(receipt.requestId)) return false;
  this.seen.add(receipt.requestId); return true;
 }
 clear() { this.seen.clear(); }
}
