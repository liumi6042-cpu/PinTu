export type Piece = { id: number; row: number; col: number; edges: number[]; border: boolean };
export type Group = { id: number; pieces: number[]; dx: number; dy: number; locked: boolean };
export type PuzzleState = { version: 1; layout?:'square'; imageId: string; cols: number; rows: number; seed: number; groups: Group[]; elapsed: number };
export const BOARD = { x: 360, y: 260, width: 800, height: 600 };
export const WORLD = { width: 1520, height: 1120 };
export function boardFor(cols:number,rows:number) {
  const unit=Math.min(BOARD.width/cols,BOARD.height/rows),width=cols*unit,height=rows*unit;
  return {x:BOARD.x+(BOARD.width-width)/2,y:BOARD.y+(BOARD.height-height)/2,width,height};
}
// Preserve completed groups and relative arrangements when loading the old 4:3 layout.
export function normalizePuzzle(state:PuzzleState) {
  if(state.layout==='square')return state;
  const board=boardFor(state.cols,state.rows);
  for(const group of state.groups){group.dx*=board.width/BOARD.width;group.dy*=board.height/BOARD.height;}
  state.layout='square';return state;
}
export const LEVELS = [
  { count:108, cols:12, rows:9, label:'认真挑战' }, { count:300, cols:20, rows:15, label:'渐入佳境' },
  { count:500, cols:25, rows:20, label:'沉浸时光' }, { count:1000, cols:40, rows:25, label:'千片挑战' },
  { count:2000, cols:50, rows:40, label:'一起攻克' },
  { count:5000, cols:100, rows:50, label:'五千片旅程' },
];
// Retired grids remain valid only for existing progress, never for new games.
export const SAVED_LEVELS = [...LEVELS, { count:12, cols:4, rows:3, label:'轻松体验' }, { count:48, cols:8, rows:6, label:'慢慢享受' }, { count:1500, cols:50, rows:30, label:'耐心之旅' }, { count:3000, cols:60, rows:50, label:'长线挑战' }, { count:4000, cols:80, rows:50, label:'沉浸挑战' }].sort((a,b)=>a.count-b.count);
const savedGrids = SAVED_LEVELS;
export function snapTolerance(state:Pick<PuzzleState,'cols'|'rows'>) { const board=boardFor(state.cols,state.rows);return Math.min(board.width/state.cols,board.height/state.rows)*.26; }
export function neighbors(id:number,cols:number,rows:number) {
  const result:number[]=[];
  if(id%cols>0)result.push(id-1);if(id%cols<cols-1)result.push(id+1);
  if(id>=cols)result.push(id-cols);if(id<cols*(rows-1))result.push(id+cols);
  return result;
}
export function random(seed:number) { let s=seed>>>0; return ()=>{s+=0x6D2B79F5;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;}; }
export function piecesFor(cols:number,rows:number,seed:number):Piece[] {
  const rand=random(seed), pieces:Piece[]=[];
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const id=row*cols+col;
    pieces.push({id,row,col,border:row===0||col===0||row===rows-1||col===cols-1,edges:[row? -pieces[id-cols].edges[2]:0,col===cols-1?0:rand()>.5?1:-1,row===rows-1?0:rand()>.5?1:-1,col?-pieces[id-1].edges[1]:0]});
  } return pieces;
}
export function pathFor(piece:Piece,cols:number,rows:number):string {
  const board=boardFor(cols,rows),w=board.width/cols,h=board.height/rows,d=Math.min(w,h)*.23; let out='M 0 0';
  const sides=[[0,0,w,0,0,-1],[w,0,0,h,1,0],[w,h,-w,0,0,1],[0,h,0,-h,-1,0]];
  sides.forEach(([x,y,tx,ty,nx,ny],i)=>{
    const sign=piece.edges[i], p=(t:number,v:number)=>`${x+tx*t+nx*d*v*sign} ${y+ty*t+ny*d*v*sign}`;
    if(!sign) {out+=` L ${p(1,0)}`;return;}
    out+=` L ${p(.32,0)} C ${p(.4,0)} ${p(.44,0)} ${p(.42,.16)} C ${p(.30,.70)} ${p(.36,1)} ${p(.50,1)} C ${p(.64,1)} ${p(.70,.70)} ${p(.58,.16)} C ${p(.56,0)} ${p(.60,0)} ${p(.68,0)} L ${p(1,0)}`;
  });return out+' Z';
}
function slots(cols:number,rows:number,seed:number) {
  const board=boardFor(cols,rows),w=board.width/cols,h=board.height/rows, rand=random(seed),result:{x:number;y:number}[]=[];
  for(let y=h*.68;y<WORLD.height-h*.6;y+=h*1.20) for(let x=w*.68;x<WORLD.width-w*.6;x+=w*1.20) {
    if(x>board.x-w*.55&&x<board.x+board.width+w*.55&&y>board.y-h*.55&&y<board.y+board.height+h*.55)continue;
    result.push({x:x+(rand()-.5)*w*.05,y:y+(rand()-.5)*h*.05});
  }
  for(let i=result.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
function scatteredGroups(cols:number,rows:number,seed:number):Group[] {
  const board=boardFor(cols,rows),points=slots(cols,rows,seed),w=board.width/cols,h=board.height/rows;
  if(points.length<cols*rows)throw new Error('桌面没有足够的散片位置');
  return Array.from({length:cols*rows},(_,id)=>{
    const point=points[id%points.length];return {id,pieces:[id],dx:point.x-w/2-board.x-(id%cols)*w,dy:point.y-h/2-board.y-Math.floor(id/cols)*h,locked:false};
  });
}
export function createPuzzle(imageId:string,cols:number,rows:number,seed=Date.now()>>>0):PuzzleState {
  if(!LEVELS.some(l=>l.cols===cols&&l.rows===rows)) throw new Error('不支持的拼图片数');
  return {version:1,layout:'square',imageId,cols,rows,seed,elapsed:0,groups:scatteredGroups(cols,rows,seed)};
}
// Member uploads use a grid fitted to the picture instead of a fixed board, so a
// portrait photo keeps its top and bottom. Only new games take this path: saved
// rooms and local progress are still restored through SAVED_LEVELS below, and a
// dynamic grid is never accepted by restorePuzzle, which reads a stored grid only.
export const MAX_FITTED_PIECES=1000;
export function createFittedPuzzle(imageId:string,cols:number,rows:number,seed=Date.now()>>>0):PuzzleState {
  if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<2)throw new Error('不支持的拼图片数');
  const total=cols*rows;
  if(total<12||total>MAX_FITTED_PIECES)throw new Error('不支持的拼图片数');
  return {version:1,layout:'square',imageId,cols,rows,seed,elapsed:0,groups:scatteredGroups(cols,rows,seed)};
}
// A grid already stored in a room or a local save is always playable, whether it
// came from the fixed levels or from a fitted upload. Validation of new games is
// separate: createPuzzle only accepts fixed levels, createFittedPuzzle only
// accepts a fitted grid, and neither accepts an arbitrary one.
export function knownGrid(cols:number,rows:number){return savedGrids.some(l=>l.cols===cols&&l.rows===rows);}
export function fittedGrid(cols:number,rows:number){return Number.isInteger(cols)&&Number.isInteger(rows)&&cols>=2&&rows>=2&&cols*rows>=12&&cols*rows<=MAX_FITTED_PIECES;}
export function restartPuzzle(state:PuzzleState,seed=Date.now()>>>0):PuzzleState {
  if(!knownGrid(state.cols,state.rows)&&!fittedGrid(state.cols,state.rows))throw new Error('不支持的拼图片数');
  return {version:1,layout:'square',imageId:state.imageId,cols:state.cols,rows:state.rows,seed,elapsed:0,groups:scatteredGroups(state.cols,state.rows,seed)};
}
export function adjacent(a:number,b:number,cols:number) {return Math.abs(a-b)===cols || (Math.floor(a/cols)===Math.floor(b/cols)&&Math.abs(a-b)===1);}
export function raiseGroup(state:PuzzleState,id:number) {const i=state.groups.findIndex(g=>g.id===id);if(i<0||state.groups[i].locked)return;state.groups.push(...state.groups.splice(i,1));}
export function moveGroup(state:PuzzleState,id:number,dx:number,dy:number) {
  const group=state.groups.find(g=>g.id===id); if(!group||group.locked||!Number.isFinite(dx)||!Number.isFinite(dy))return false;
  group.dx=dx;group.dy=dy;return true;
}
export function dropGroup(state:PuzzleState,id:number,tolerance:number,blocked=new Set<number>()) {
  const active=state.groups.find(g=>g.id===id);if(!active||active.locked)return {snapped:false,joined:0,placed:0};
  const before=placedCount(state);let joined=0,snapped=false;
  if(Math.hypot(active.dx,active.dy)<=tolerance) {active.dx=0;active.dy=0;active.locked=true;snapped=true;}
  const owner:Group[]=new Array(state.cols*state.rows),candidates=new Set<Group>(),merged=new Set<Group>();
  for(const group of state.groups)for(const piece of group.pieces)owner[piece]=group;
  const expand=(pieces:number[])=>{for(const piece of pieces)for(const neighbor of neighbors(piece,state.cols,state.rows)){
    const target=owner[neighbor];if(target!==active&&!merged.has(target)&&!blocked.has(target.id))candidates.add(target);
  }};
  expand(active.pieces);
  while(candidates.size){
    let target:Group|undefined,nearest=tolerance;
    for(const candidate of candidates){const distance=Math.hypot(candidate.dx-active.dx,candidate.dy-active.dy);if(distance<=nearest){target=candidate;nearest=distance;}}
    if(!target)break;
    // Only true neighbors can join; a board anchor never moves away from zero.
    const anchor=active.locked?active:target;
    active.dx=anchor.dx;active.dy=anchor.dy;active.locked=active.locked||target.locked;
    candidates.delete(target);merged.add(target);
    for(const piece of target.pieces)owner[piece]=active;
    active.pieces.push(...target.pieces);expand(target.pieces);joined++;snapped=true;
  }
  if(merged.size)state.groups=state.groups.filter(group=>!merged.has(group));
  if(active.locked){active.dx=0;active.dy=0;}
  return {snapped,joined,placed:placedCount(state)-before};
}
export function placedCount(state:PuzzleState) {return state.groups.filter(g=>g.locked).reduce((n,g)=>n+g.pieces.length,0);}
export function visibleGroup(group:Group,pieces:Piece[],edgesOnly:boolean) {return group.locked||!edgesOnly||group.pieces.some(id=>pieces[id].border);}
export function shuffleLoose(state:PuzzleState,seed=Date.now()>>>0,blocked:ReadonlySet<number>=new Set()) {
  if(!knownGrid(state.cols,state.rows)&&!fittedGrid(state.cols,state.rows))throw new Error('不支持的拼图片数');
  const fresh=scatteredGroups(state.cols,state.rows,seed);let changed=0;
  for(const g of state.groups) if(!g.locked&&g.pieces.length===1&&!blocked.has(g.id)) {const pos=fresh[g.pieces[0]];g.dx=pos.dx;g.dy=pos.dy;changed++;}
  return changed;
}
export function restorePuzzle(raw:string,imageIds:string[]):PuzzleState|null {
  try {
    const v=JSON.parse(raw) as PuzzleState;
    if(v.version!==1||(v.layout!==undefined&&v.layout!=='square')||!imageIds.includes(v.imageId)||(!knownGrid(v.cols,v.rows)&&!fittedGrid(v.cols,v.rows))||!Number.isInteger(v.seed)||v.seed<0||v.seed>0xffffffff||!Number.isFinite(v.elapsed)||v.elapsed<0||!Array.isArray(v.groups)||v.groups.length===0)return null;
    const ids=new Set<number>(),groups=new Set<number>();
    for(const g of v.groups) {
      if(!Number.isInteger(g.id)||groups.has(g.id)||!Array.isArray(g.pieces)||!g.pieces.length||!Number.isFinite(g.dx)||!Number.isFinite(g.dy)||Math.abs(g.dx)>20000||Math.abs(g.dy)>20000||typeof g.locked!=='boolean'||g.locked&&(g.dx!==0||g.dy!==0))return null;
      groups.add(g.id);
      for(const id of g.pieces){if(!Number.isInteger(id)||id<0||id>=v.cols*v.rows||ids.has(id))return null;ids.add(id);}
      // Saved movable groups must consist of connected neighboring pieces.
      const pending=new Set(g.pieces),queue=[g.pieces[0]];pending.delete(queue[0]);
      for(let i=0;i<queue.length;i++)for(const neighbor of neighbors(queue[i],v.cols,v.rows))if(pending.delete(neighbor))queue.push(neighbor);
      if(pending.size)return null;
    }
    return ids.size===v.cols*v.rows?normalizePuzzle(v):null;
  }catch{return null;}
}
