export type Piece = { id: number; row: number; col: number; edges: number[]; border: boolean };
export type Group = { id: number; pieces: number[]; dx: number; dy: number; locked: boolean };
export type PuzzleState = { version: 1; imageId: string; cols: number; rows: number; seed: number; groups: Group[]; elapsed: number };
export const BOARD = { x: 360, y: 260, width: 800, height: 600 };
export const WORLD = { width: 1520, height: 1120 };
export const LEVELS = [{ count:12, cols:4, rows:3, label:'轻松体验' }, { count:48, cols:8, rows:6, label:'慢慢享受' }, { count:108, cols:12, rows:9, label:'认真挑战' }];
export function random(seed:number) { let s=seed>>>0; return ()=>{s+=0x6D2B79F5;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;}; }
export function piecesFor(cols:number,rows:number,seed:number):Piece[] {
  const rand=random(seed), pieces:Piece[]=[];
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const id=row*cols+col;
    pieces.push({id,row,col,border:row===0||col===0||row===rows-1||col===cols-1,edges:[row? -pieces[id-cols].edges[2]:0,col===cols-1?0:rand()>.5?1:-1,row===rows-1?0:rand()>.5?1:-1,col?-pieces[id-1].edges[1]:0]});
  } return pieces;
}
export function pathFor(piece:Piece,cols:number,rows:number):string {
  const w=BOARD.width/cols,h=BOARD.height/rows,d=Math.min(w,h)*.23; let out='M 0 0';
  const sides=[[0,0,w,0,0,-1],[w,0,0,h,1,0],[w,h,-w,0,0,1],[0,h,0,-h,-1,0]];
  sides.forEach(([x,y,tx,ty,nx,ny],i)=>{
    const sign=piece.edges[i], p=(t:number,v:number)=>`${x+tx*t+nx*d*v*sign} ${y+ty*t+ny*d*v*sign}`;
    if(!sign) {out+=` L ${p(1,0)}`;return;}
    out+=` L ${p(.32,0)} C ${p(.4,0)} ${p(.44,0)} ${p(.42,.16)} C ${p(.30,.70)} ${p(.36,1)} ${p(.50,1)} C ${p(.64,1)} ${p(.70,.70)} ${p(.58,.16)} C ${p(.56,0)} ${p(.60,0)} ${p(.68,0)} L ${p(1,0)}`;
  });return out+' Z';
}
function slots(cols:number,rows:number,seed:number) {
  const w=BOARD.width/cols,h=BOARD.height/rows, rand=random(seed),result:{x:number;y:number}[]=[];
  for(let y=h*.68;y<WORLD.height-h*.6;y+=h*1.20) for(let x=w*.68;x<WORLD.width-w*.6;x+=w*1.20) {
    if(x>BOARD.x-w*.55&&x<BOARD.x+BOARD.width+w*.55&&y>BOARD.y-h*.55&&y<BOARD.y+BOARD.height+h*.55)continue;
    result.push({x:x+(rand()-.5)*w*.05,y:y+(rand()-.5)*h*.05});
  }
  for(let i=result.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function createPuzzle(imageId:string,cols:number,rows:number,seed=Date.now()>>>0):PuzzleState {
  if(!LEVELS.some(l=>l.cols===cols&&l.rows===rows)) throw new Error('不支持的拼图片数');
  const points=slots(cols,rows,seed),w=BOARD.width/cols,h=BOARD.height/rows;
  if(points.length<cols*rows)throw new Error('桌面没有足够的散片位置');
  return {version:1,imageId,cols,rows,seed,elapsed:0,groups:Array.from({length:cols*rows},(_,id)=>{
    const point=points[id%points.length];return {id,pieces:[id],dx:point.x-w/2-BOARD.x-(id%cols)*w,dy:point.y-h/2-BOARD.y-Math.floor(id/cols)*h,locked:false};
  })};
}
export function adjacent(a:number,b:number,cols:number) {return Math.abs(a-b)===cols || (Math.floor(a/cols)===Math.floor(b/cols)&&Math.abs(a-b)===1);}
export function raiseGroup(state:PuzzleState,id:number) {const i=state.groups.findIndex(g=>g.id===id);if(i<0||state.groups[i].locked)return;state.groups.push(...state.groups.splice(i,1));}
export function moveGroup(state:PuzzleState,id:number,dx:number,dy:number) {
  const group=state.groups.find(g=>g.id===id); if(!group||group.locked||!Number.isFinite(dx)||!Number.isFinite(dy))return false;
  group.dx=dx;group.dy=dy;return true;
}
export function dropGroup(state:PuzzleState,id:number,tolerance:number,blocked=new Set<number>()) {
  let active=state.groups.find(g=>g.id===id);if(!active||active.locked)return {snapped:false,joined:0,placed:0};
  const before=placedCount(state);let joined=0,snapped=false;
  if(Math.hypot(active.dx,active.dy)<=tolerance) {active.dx=0;active.dy=0;active.locked=true;snapped=true;}
  let again=true;
  while(again){again=false;
    for(const target of state.groups) {
      if(target===active||blocked.has(target.id)||Math.hypot(target.dx-active.dx,target.dy-active.dy)>tolerance)continue;
      if(!active.pieces.some(a=>target.pieces.some(b=>adjacent(a,b,state.cols))))continue;
      // An already anchored group must never be moved away from the board.
      const anchor=active.locked?active:target;
      active.dx=anchor.dx;active.dy=anchor.dy;active.locked=active.locked||target.locked;
      active.pieces.push(...target.pieces);state.groups.splice(state.groups.indexOf(target),1);joined++;snapped=true;again=true;break;
    }
  }
  if(active.locked){active.dx=0;active.dy=0;}
  return {snapped,joined,placed:placedCount(state)-before};
}
export function placedCount(state:PuzzleState) {return state.groups.filter(g=>g.locked).reduce((n,g)=>n+g.pieces.length,0);}
export function visibleGroup(group:Group,pieces:Piece[],edgesOnly:boolean) {return group.locked||!edgesOnly||group.pieces.some(id=>pieces[id].border);}
export function shuffleLoose(state:PuzzleState,seed=Date.now()>>>0) {
  const fresh=createPuzzle(state.imageId,state.cols,state.rows,seed);let changed=0;
  for(const g of state.groups) if(!g.locked&&g.pieces.length===1) {const pos=fresh.groups[g.pieces[0]];g.dx=pos.dx;g.dy=pos.dy;changed++;}
  return changed;
}
export function restorePuzzle(raw:string,imageIds:string[]):PuzzleState|null {
  try {
    const v=JSON.parse(raw) as PuzzleState;
    if(v.version!==1||!imageIds.includes(v.imageId)||!LEVELS.some(l=>l.cols===v.cols&&l.rows===v.rows)||!Number.isInteger(v.seed)||v.seed<0||v.seed>0xffffffff||!Number.isFinite(v.elapsed)||v.elapsed<0||!Array.isArray(v.groups)||v.groups.length===0)return null;
    const ids=new Set<number>(),groups=new Set<number>();
    for(const g of v.groups) {
      if(!Number.isInteger(g.id)||groups.has(g.id)||!Array.isArray(g.pieces)||!g.pieces.length||!Number.isFinite(g.dx)||!Number.isFinite(g.dy)||Math.abs(g.dx)>20000||Math.abs(g.dy)>20000||typeof g.locked!=='boolean'||g.locked&&(g.dx!==0||g.dy!==0))return null;
      groups.add(g.id);
      for(const id of g.pieces){if(!Number.isInteger(id)||id<0||id>=v.cols*v.rows||ids.has(id))return null;ids.add(id);}
      // Saved movable groups must consist of connected neighboring pieces.
      const connected=new Set([g.pieces[0]]);let grew=true;
      while(grew){grew=false;for(const id of g.pieces)if(!connected.has(id)&&[...connected].some(a=>adjacent(a,id,v.cols))){connected.add(id);grew=true;}}
      if(connected.size!==g.pieces.length)return null;
    }
    return ids.size===v.cols*v.rows?v:null;
  }catch{return null;}
}
