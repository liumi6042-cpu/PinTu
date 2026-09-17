import { boardFor, normalizePuzzle, WORLD, piecesFor, pathFor, moveGroup, dropGroup, raiseGroup, placedCount, visibleGroup, shuffleLoose, snapTolerance, type PuzzleState, type Group } from './puzzle-engine';
import { PuzzleSprites } from './puzzle-sprites';
import { pictureCrop, drawPiecePicture } from './puzzle-picture';
import { t,subscribeLanguage } from './i18n';
import { TABLE_PALETTES, type TableTheme } from './table-theme';
import { newConnections } from './connection-feedback';
import { ConnectionGlowRenderer } from './connection-glow';
import { SnapSound,type SoundPreferences } from './snap-sound';
import { DragImage } from './drag-image';
type Notice = (message:string)=>void;
// A drag carries at most this many groups. The ceiling keeps the browser drag
// layer, the dirty rectangle and the per-gesture network claim bounded, and it
// must stay at or below the room engine's `DRAG_LEASE_GROUPS`, because one
// gesture claims its whole selection in a single request.
export const MULTI_SELECT_LIMIT=12;
export type TableNetwork={canAcquire?:(id:number)=>boolean;canAcquireAll?:(ids:number[])=>boolean;acquire:(id:number)=>Promise<boolean>;acquireAll?:(ids:number[])=>Promise<boolean>;move:(id:number,dx:number,dy:number)=>void;drop:(id:number,dx:number,dy:number)=>Promise<void>;release:(id:number)=>void};
export class PuzzleTable {
  canvas:HTMLCanvasElement; state:PuzzleState; ctx:CanvasRenderingContext2D; hit:CanvasRenderingContext2D;
  board:ReturnType<typeof boardFor>;
  image:HTMLImageElement; picture:HTMLCanvasElement; pieces; paths:Path2D[]; camera={x:0,y:0,z:1}; width=0; height=0;
  edges=false; paused=false; selected:number|null=null;
  // Multi-select layers an opt-in gesture on top of the single-piece drag rather
  // than replacing it: one click drags exactly one group, Shift/Ctrl click adds to
  // the set, and only then does a click on a member pick the whole set up. Nothing
  // is ever added to a gesture behind the player's back. `selected` is always one of
  // `selectedExtra`, so the keyboard N/arrows and the outline colour keep working on
  // the last group touched.
  private selectedExtra=new Set<number>();
  private didMultiSelect=false;
  private feedback:ConnectionGlowRenderer|null=null;private snapAudio=new SnapSound();
  private dragImage:DragImage|null=null;
  private floatingDrag:string|null=null;
  private hintIds:number[]=[]; private hintUntil=0; private underlayUntil=0;
  private underlayTimer:ReturnType<typeof setTimeout>|null=null;
  private sprites:PuzzleSprites|null=null; private background:HTMLCanvasElement;
  private backgroundDirty=true; private backgroundDrag:number|null=null;
  private previousDragRect:{x:number;y:number;width:number;height:number}|null=null;
  private theme:TableTheme='beige';
  network:TableNetwork|null=null; networkReady=true; private claimSerial=0;
  private remoteOwners:Record<string,{name:string;color:string}>={};
  private drag:{id:number;x:number;y:number;dx:number;dy:number}|null=null;
  // The pieces carried by the current drag. A single group gives the same object
  // as before, so nothing about single-piece behaviour changes; a multi-selection
  // moves several groups by one shared delta.
  private dragIds:number[]=[];
  private dragOffsets=new Map<number,{dx:number;dy:number}>();
  private pan:{x:number;y:number;cx:number;cy:number}|null=null;
  private pointers=new Map<number,{x:number;y:number}>(); private pinch:{distance:number;z:number;wx:number;wy:number}|null=null;
  private space=false; private raf=0; private timer:ReturnType<typeof setInterval>; private hintTimer:ReturnType<typeof setTimeout>|null=null;
  private resize:ResizeObserver; private abort=new AbortController();
  private update:()=>void; private notice:Notice;
  private stopLanguage:()=>void;
  constructor(canvas:HTMLCanvasElement,state:PuzzleState,image:HTMLImageElement,update:()=>void,notice:Notice) {
    this.canvas=canvas;this.state=normalizePuzzle(state);this.board=boardFor(state.cols,state.rows);this.image=image;this.update=update;this.notice=notice;
    this.ctx=canvas.getContext('2d')!;this.hit=document.createElement('canvas').getContext('2d')!;
    this.picture=document.createElement('canvas');this.background=document.createElement('canvas');
    const crop=pictureCrop(image.naturalWidth,image.naturalHeight,this.board.width,this.board.height);
    this.picture.width=Math.round(crop.width);this.picture.height=Math.round(crop.height);
    this.picture.getContext('2d')!.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,this.picture.width,this.picture.height);
    this.pieces=piecesFor(state.cols,state.rows,state.seed);this.paths=this.pieces.map(p=>new Path2D(pathFor(p,state.cols,state.rows)));
    if(canvas.parentElement)this.feedback=new ConnectionGlowRenderer(canvas.parentElement,state,this.pieces,()=>this.camera);
    if(this.pieces.length>=300)this.sprites=new PuzzleSprites(this.picture,this.pieces,this.paths,state.cols,state.rows);
    this.resize=new ResizeObserver(()=>this.resizeCanvas());this.resize.observe(canvas);
    const opts={signal:this.abort.signal};
    canvas.addEventListener('pointerdown',this.down,opts);canvas.addEventListener('pointermove',this.move,opts);canvas.addEventListener('pointerup',this.up,opts);canvas.addEventListener('pointercancel',this.cancel,opts);canvas.addEventListener('lostpointercapture',this.cancel,opts);
    canvas.addEventListener('wheel',this.wheel,{...opts,passive:false});canvas.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    canvas.addEventListener('keydown',this.keydown,opts);canvas.addEventListener('keyup',e=>{if(e.code==='Space'){this.space=false;this.canvas.style.cursor='grab';}},opts);
    canvas.addEventListener('blur',()=>{this.space=false;this.release();},opts);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();},opts);
    this.timer=setInterval(()=>{if(!this.network&&!this.paused&&!document.hidden&&placedCount(state)<this.pieces.length){state.elapsed++;this.update();}},1000);
    this.stopLanguage=subscribeLanguage(()=>this.draw());
  }
  private resizeCanvas(){const r=this.canvas.getBoundingClientRect(),oldW=this.width,oldH=this.height;this.width=r.width;this.height=r.height;const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);if(!oldW)this.fit();else{this.camera.x+=(this.width-oldW)/2;this.camera.y+=(this.height-oldH)/2;}this.draw();}
  private point(e:{clientX:number;clientY:number}){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  private world(p:{x:number;y:number}){return {x:(p.x-this.camera.x)/this.camera.z,y:(p.y-this.camera.y)/this.camera.z};}
  // Everything the current gesture carries. A plain click drags exactly the group
  // under the pointer; only an explicit selection (Shift/Ctrl click, or Ctrl+A) makes
  // a gesture carry more than one group.
  //
  // There used to be an "auto-select touching neighbours" rule here, which quietly
  // turned every plain click into a multi-piece drag. That surprised players (picking
  // up one piece also grabbed the ones beside it) and made the common case depend on
  // every neighbour's lease being free, so a single refused neighbour looked like
  // "nothing can be dragged at all". Multi-piece moving is now strictly opt-in.
  private dragMembers(id:number){
    const ids=new Set<number>([id]);
    // Only an explicit selection widens the gesture, and only when the clicked group
    // is part of it — clicking outside a selection starts a fresh single-group drag.
    if(this.selectedExtra.size>1&&this.selectedExtra.has(id))for(const extra of this.selectedExtra)ids.add(extra);
    return [...ids].filter(groupId=>{const group=this.state.groups.find(g=>g.id===groupId);return !!group&&!group.locked;});
  }
  // Bounding box of several groups in the same coordinate space dragRect uses.
  private dragBounds(ids:readonly number[]){
    const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const id of ids){const group=this.state.groups.find(g=>g.id===id);if(!group)continue;
      for(const piece of group.pieces){const p=this.pieces[piece];left=Math.min(left,p.col*w+group.dx);top=Math.min(top,p.row*h+group.dy);right=Math.max(right,(p.col+1)*w+group.dx);bottom=Math.max(bottom,(p.row+1)*h+group.dy);}}
    return Number.isFinite(left)?{left:left+this.board.x,top:top+this.board.y,right:right+this.board.x,bottom:bottom+this.board.y}:null;
  }
  private groupAt(x:number,y:number):Group|undefined {    const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    for(let i=this.state.groups.length-1;i>=0;i--){const g=this.state.groups[i];if(g.locked||(!visibleGroup(g,this.pieces,this.edges)&&!g.pieces.some(id=>this.hintNumber(id))))continue;
      for(const id of g.pieces){const p=this.pieces[id],lx=x-this.board.x-p.col*w-g.dx,ly=y-this.board.y-p.row*h-g.dy,pad=Math.min(w,h)*.24;
        if(lx>=-pad&&lx<=w+pad&&ly>=-pad&&ly<=h+pad&&this.hit.isPointInPath(this.paths[id],lx,ly))return g;}
    }
  }
  private down=(e:PointerEvent)=>{
    if(this.paused||!this.networkReady||e.button>2)return;this.unlockSound();e.preventDefault();this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(e.pointerId);const p=this.point(e);this.pointers.set(e.pointerId,p);
    if(this.pointers.size===2){this.release();const [a,b]=[...this.pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},world=this.world(center);this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),z:this.camera.z,wx:world.x,wy:world.y};this.pan=null;return;}
    if(this.pointers.size>2)return;
    const wp=this.world(p),g=this.groupAt(wp.x,wp.y);
    if(g&&!this.space&&e.button===0){
      const additive=e.shiftKey||e.ctrlKey||e.metaKey||e.altKey;
      if(additive){this.toggleSelection(g.id);return;}
      // A plain click on a member of a multi-selection picks the whole set up. Clicking
      // any other group collapses the selection to just that group and drags it alone.
      if(this.selectedExtra.has(g.id)&&this.selectedExtra.size>1){this.beginDrag(g,wp);return;}
      this.selected=g.id;this.selectedExtra=new Set([g.id]);this.didMultiSelect=false;
      this.beginDrag(g,wp);
    }
    else{this.selectedExtra.clear();this.selected=null;this.didMultiSelect=false;this.pan={x:p.x,y:p.y,cx:this.camera.x,cy:this.camera.y};this.canvas.style.cursor='grabbing';}
    this.draw();
  };
  // Shift/ctrl click toggles one group in or out of the multi-selection. This is the
  // only way a gesture ever carries more than one group, apart from Ctrl+A. The
  // anchor (`selected`) is simply the most recently touched group, so the set is
  // always exactly `selectedExtra` and there is no separate anchor bookkeeping to
  // get out of step. A plain click is the reset: it collapses the set to one group.
  private toggleSelection(id:number){
    if(this.selectedExtra.has(id))this.selectedExtra.delete(id);else this.selectedExtra.add(id);
    // Never leave an empty set: removing the last member keeps it selected.
    if(!this.selectedExtra.size)this.selectedExtra.add(id);
    this.selected=id;
    raiseGroup(this.state,id);this.canvas.style.cursor='grab';this.draw();this.notice(`${this.selectionLabel()}已选中 ${this.selectedCount()} 组，拖动即可整组移动。按住 Shift 点选可加减。`);
  }
  // `selected` is always one of `selectedExtra`, so the set's size is the count.
  private selectedCount(){return this.selectedExtra.size;}
  private selectionLabel(){
    if(this.selected===null)return '';
    const group=this.state.groups.find(g=>g.id===this.selected),piece=group?.pieces[0]??0;
    const col=piece%this.state.cols,row=Math.floor(piece/this.state.cols);
    return `第 ${row+1} 行第 ${col+1} 列`;
  }
  private beginDrag(g:Group,wp:{x:number;y:number}){
    // How many groups this gesture carries is decided entirely by the selection: one
    // group for a plain click, the whole set when the pointer lands on a group that is
    // part of an explicit multi-selection. Nothing is added behind the player's back.
    const ids=this.dragMembers(g.id);
    this.dragOffsets.clear();this.dragIds=[];
    for(const id of ids){
      const group=this.state.groups.find(item=>item.id===id);if(!group||group.locked)continue;
      this.dragOffsets.set(id,{dx:group.dx,dy:group.dy});raiseGroup(this.state,id);
    }
    this.dragIds=[...this.dragOffsets.keys()];
    this.didMultiSelect=this.dragIds.length>1;
    const ownerName=this.dragIds.map(id=>this.remoteOwners[id]?.name).find(Boolean);
    if(ownerName){this.notice(`${ownerName} 正在移动这组拼块`);return;}
    if(this.network?.canAcquireAll?.(this.dragIds)===false)return;
    this.drag={id:g.id,x:wp.x,y:wp.y,dx:g.dx,dy:g.dy};this.canvas.style.cursor='grabbing';
    if(this.network){const serial=++this.claimSerial;void this.acquireSelected(serial,this.dragIds);}
  }
  private async acquireSelected(serial:number,ids:number[]){
    // Local pointer motion begins immediately. Only a denied claim cancels it, and the
    // claim is one request for the whole selection, so a refusal never leaves part of
    // the selection locked to this player.
    const network=this.network;if(!network)return;
    const ok=network.acquireAll?await network.acquireAll(ids):await this.claimOneByOne(network,ids);
    if(!ok&&serial===this.claimSerial){this.dropDrag();this.canvas.style.cursor='grab';this.draw();}
  }
  /** Fallback for a transport without batch claims; releases what it took before bailing. */
  private async claimOneByOne(network:TableNetwork,ids:number[]){
    const taken:number[]=[];
    for(const id of ids){
      const ok=await network.acquire(id);
      if(!ok){for(const held of taken)network.release(held);return false;}
      taken.push(id);
    }
    return true;
  }
  private dropDrag(){this.drag=null;this.dragIds=[];this.dragOffsets.clear();}
  moveSelectionTo(dx:number,dy:number){
    if(!this.drag)return;
    // dx/dy are absolute offsets for the group the gesture started on. Every other
    // carried group keeps its own starting offset plus the same *relative* motion,
    // and nothing is re-anchored mid-gesture: `drag` is set once in beginDrag and
    // only cleared by release. That is what keeps a selection rigid.
    const base={dx:this.drag.dx,dy:this.drag.dy};
    moveGroup(this.state,this.drag.id,dx,dy);this.network?.move(this.drag.id,dx,dy);
    for(const id of this.dragIds){
      if(id===this.drag.id)continue;
      const start=this.dragOffsets.get(id);if(!start)continue;
      const next={dx:start.dx+(dx-base.dx),dy:start.dy+(dy-base.dy)};
      moveGroup(this.state,id,next.dx,next.dy);this.network?.move(id,next.dx,next.dy);
    }
  }
  private move=(e:PointerEvent)=>{
    const p=this.point(e);if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,p);
    if(this.pinch&&this.pointers.size>=2){const [a,b]=[...this.pointers.values()],z=this.clamp(this.pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance));this.camera={x:(a.x+b.x)/2-this.pinch.wx*z,y:(a.y+b.y)/2-this.pinch.wy*z,z};this.draw();return;}
    if(this.drag){const wp=this.world(p);this.moveSelectionTo(this.drag.dx+wp.x-this.drag.x,this.drag.dy+wp.y-this.drag.y);this.draw(false);}
    else if(this.pan){this.camera.x=this.pan.cx+p.x-this.pan.x;this.camera.y=this.pan.cy+p.y-this.pan.y;this.draw();}
    else if(!this.paused){const wp=this.world(p);this.canvas.style.cursor=this.groupAt(wp.x,wp.y)?'grab':this.space?'grabbing':'default';}
  };
  private up=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);if(this.pinch){this.pinch=null;this.pan=null;}else this.release();if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);};
  private cancel=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);this.release();this.pinch=null;};
  private release(){
    this.claimSerial++;
    if(this.drag&&this.network){const ids=[...this.dragIds];this.keepOnTable(ids);this.drag=null;
      for(const id of ids){const group=this.state.groups.find(g=>g.id===id);if(group)void this.network.drop(id,group.dx,group.dy);}}
    if(this.drag){
      const ids=this.dragIds.length?[...this.dragIds]:[this.drag.id];
      this.keepOnTable(ids);
      const before=this.state.groups.map(g=>({...g,pieces:[...g.pieces]}));
      let snapped=false,placed=false;
      // Multi-selections drop in reading order so a cluster joins from the top
      // left inward; each drop re-reads the live group list, because an earlier
      // merge may already have absorbed a later id into a locked anchor.
      for(const id of ids){const group=this.state.groups.find(g=>g.id===id);if(!group||group.locked)continue;
        const result=dropGroup(this.state,id,snapTolerance(this.state));snapped=snapped||result.snapped;placed=placed||result.placed>0;}
      if(snapped){this.feedback?.show(newConnections(before,this.state));this.playConnectionSound();this.notice(placedCount(this.state)===this.pieces.length?'每一片，都找到了自己的位置。':placed?`拼对了！已归位 ${placedCount(this.state)} / ${this.pieces.length} 片`:'拼块连在一起了，可以整组拖动');}
      if(this.didMultiSelect)this.selectedExtra.clear();
      this.dropDrag();this.update();}
    this.didMultiSelect=false;
    this.pan=null;this.canvas.style.cursor='grab';this.draw();
  }
  private keepOnTable(id:number|readonly number[]){for(const groupId of typeof id==='number'?[id]:id){const g=this.state.groups.find(item=>item.id===groupId);if(!g||g.locked)continue;const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    const minX=Math.min(...g.pieces.map(id=>this.board.x+this.pieces[id].col*w)),maxX=Math.max(...g.pieces.map(id=>this.board.x+(this.pieces[id].col+1)*w));
    const minY=Math.min(...g.pieces.map(id=>this.board.y+this.pieces[id].row*h)),maxY=Math.max(...g.pieces.map(id=>this.board.y+(this.pieces[id].row+1)*h));
    g.dx=Math.max(18-minX,Math.min(WORLD.width-18-maxX,g.dx));g.dy=Math.max(18-minY,Math.min(WORLD.height-18-maxY,g.dy));}}
  private wheel=(e:WheelEvent)=>{e.preventDefault();if(this.drag||this.paused)return;this.zoom(Math.exp(-e.deltaY*.0014),this.point(e));};
  private keydown=(e:KeyboardEvent)=>{
    if(this.paused||!this.networkReady)return;
    if(e.code==='Space'){e.preventDefault();this.space=true;this.canvas.style.cursor='grabbing';return;}
    if(e.key==='+'||e.key==='='){e.preventDefault();this.zoom(1.2);return;}if(e.key==='-'){e.preventDefault();this.zoom(1/1.2);return;}
    if(e.key==='0'){e.preventDefault();this.fit();return;}
    if(e.key==='Tab'){return;}
    if(e.key.toLowerCase()==='n') {e.preventDefault();const visible=this.state.groups.filter(g=>!g.locked&&visibleGroup(g,this.pieces,this.edges)),idx=visible.findIndex(g=>g.id===this.selected);if(visible.length){this.selected=visible[(idx+1)%visible.length].id;this.selectedExtra=new Set([this.selected]);this.draw();this.notice('已选中下一块。方向键移动，回车吸附。');}return;}
    if(e.key.toLowerCase()==='a'&&(e.ctrlKey||e.metaKey)){e.preventDefault();const visible=this.state.groups.filter(g=>!g.locked&&visibleGroup(g,this.pieces,this.edges)).slice(0,MULTI_SELECT_LIMIT);this.selectedExtra=new Set(visible.map(g=>g.id));this.selected=this.selectedExtra.has(this.selected??-1)?this.selected:visible[0]?.id??null;this.draw();this.notice(this.selectedExtra.size>1?`已全选桌上的 ${this.selectedExtra.size} 组拼块，拖动即可整组移动。`:'桌面上没有可选的散片。');return;}
    if(this.selected===null)return;const g=this.state.groups.find(g=>g.id===this.selected);if(!g||g.locked)return;
    if(this.network&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'].includes(e.key)){e.preventDefault();this.notice('多人模式请拖动拼块，方向键移动暂用于单人模式');return;}
    // The arrow keys and Enter act on the whole selection in solo games, so a set
    // gathered with Shift can be nudged and snapped without touching the pointer.
    const carried=this.selectedExtra.size>1?[...this.selectedExtra]:[g.id];
    const delta:Record<string,number[]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(delta[e.key]){e.preventDefault();const step=e.shiftKey?2:12;
      for(const id of carried){const group=this.state.groups.find(item=>item.id===id);if(!group||group.locked)continue;group.dx+=delta[e.key][0]*step;group.dy+=delta[e.key][1]*step;}
      this.keepOnTable(carried);for(const id of carried)raiseGroup(this.state,id);this.draw();this.update();}
    if(e.key==='Enter'){e.preventDefault();this.unlockSound();const before=this.state.groups.map(group=>({...group,pieces:[...group.pieces]}));let snapped=false;
      for(const id of carried){const group=this.state.groups.find(item=>item.id===id);if(!group||group.locked)continue;snapped=dropGroup(this.state,id,snapTolerance(this.state)).snapped||snapped;}
      if(snapped){this.feedback?.show(newConnections(before,this.state));this.playConnectionSound();}this.update();this.draw();}
  };
  private clamp(z:number){const max=Math.max(3,Math.min(16,96/Math.min(this.board.width/this.state.cols,this.board.height/this.state.rows)));return Math.max(.15,Math.min(max,z));}
  zoom(factor:number,point={x:this.width/2,y:this.height/2}){const w=this.world(point),z=this.clamp(this.camera.z*factor);this.camera={x:point.x-w.x*z,y:point.y-w.y*z,z};this.draw();this.update();}
  fit(completed=false){const bounds=completed?this.board:{x:0,y:0,...WORLD},z=Math.min(this.width/bounds.width,this.height/bounds.height)*(completed?.76:.94);this.camera={x:(this.width-bounds.width*z)/2-bounds.x*z,y:(this.height-bounds.height*z)/2-bounds.y*z,z};this.draw();this.update();}
  setEdges(v:boolean){this.release();this.edges=v;this.draw();}
  setPaused(v:boolean){this.release();this.paused=v;}
  shuffle(){if(this.network){this.notice('多人模式保留大家正在整理的桌面，请直接拖动散片');return;}this.release();const n=shuffleLoose(this.state);this.fit();this.draw();this.update();this.notice(n?`已整理 ${n} 块散片，组合保持完整`:'没有需要整理的散片');}
  syncRemote(next:PuzzleState,owners:Record<string,{name:string;color:string}>,protectIds:ReadonlySet<number>,showFeedback=true){
    const beforeGroups=this.state.groups;
    const before=placedCount(this.state),elapsedChanged=this.state.elapsed!==next.elapsed,previous=new Map(this.state.groups.map(g=>[g.id,g])),order=this.state.groups.map(g=>g.id);let changed=previous.size!==next.groups.length;
    this.state.groups=next.groups.map(incoming=>{
      const old=previous.get(incoming.id),same=old&&old.locked===incoming.locked&&old.pieces.length===incoming.pieces.length&&old.pieces.every((id,i)=>id===incoming.pieces[i]);
      if(same){if(!protectIds.has(old.id)&&(old.dx!==incoming.dx||old.dy!==incoming.dy)){old.dx=incoming.dx;old.dy=incoming.dy;changed=true;}return old;}
      changed=true;return {...incoming,pieces:[...incoming.pieces]};
    });
    for(const id of protectIds)raiseGroup(this.state,id);
    if(this.state.groups.some((g,i)=>g.id!==order[i]))changed=true;
    if(JSON.stringify(this.remoteOwners)!==JSON.stringify(owners))changed=true;
    this.state.elapsed=next.elapsed;this.remoteOwners=owners;const after=placedCount(this.state);
    if(elapsedChanged||before!==after)this.update();
    if(after>before)this.notice(`一起拼对了！已归位 ${after} / ${this.pieces.length} 片`);
    if(showFeedback&&beforeGroups.length>this.state.groups.length)this.feedback?.show(newConnections(beforeGroups,this.state));
    if(changed)this.draw();
  }
  cancelNetworkDrag(id?:number){if(id!==undefined&&this.drag?.id!==id)return;this.claimSerial++;this.dropDrag();this.pan=null;this.canvas.style.cursor='default';this.draw();}
  setHints(ids:number[],until:number){
    if(this.hintTimer)clearTimeout(this.hintTimer);
    this.hintIds=ids.filter(id=>Number.isInteger(id)&&!!this.pieces[id]).slice(0,3);this.hintUntil=until;this.draw();
    if(this.hintIds.length&&until>Date.now())this.notice('把相同编号的拼块与桌面轮廓对应起来。');
    if(until>Date.now())this.hintTimer=setTimeout(()=>{this.hintIds=[];this.draw();},until-Date.now());
  }
  setUnderlay(until:number){
    if(this.underlayTimer)clearTimeout(this.underlayTimer);this.underlayUntil=until;this.draw();
    if(until>Date.now())this.underlayTimer=setTimeout(()=>{this.underlayUntil=0;this.draw();},until-Date.now());
  }
  private hintNumber(id:number){return this.hintIds.length&&this.hintUntil>Date.now()?this.hintIds.indexOf(id)+1:0;}
  private hintMarker(c:CanvasRenderingContext2D,id:number,target=false){
    const number=this.hintNumber(id);if(!number)return;
    const z=this.camera.z,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    c.strokeStyle=this.theme==='dark'?'#f6d897':'#8b4e30';c.lineWidth=3/z;c.stroke(this.paths[id]);
    if(target){c.fillStyle='#d49b4930';c.fill(this.paths[id]);}
    const radius=Math.min(10/z,w*.3,h*.3);c.beginPath();c.arc(w/2,h/2,radius,0,Math.PI*2);c.fillStyle='#8b4e30';c.fill();
    c.fillStyle='#fff8e8';c.font=`bold ${radius*1.4}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(number),w/2,h/2);
  }
  setSoundPreferences(settings:SoundPreferences){this.snapAudio.setPreferences(settings);}
  unlockSound(){void this.snapAudio.unlock();}
  playConnectionSound(){void this.snapAudio.play();}
  setTheme(theme:TableTheme){if(this.theme===theme)return;this.theme=theme;this.draw();}
  draw(backgroundChanged=true){if(backgroundChanged)this.backgroundDirty=true;if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.feedback?.update();this.render();});}
  private render(){
    if(this.drag){
      const key=this.dragKey();
      if(this.canvas.parentElement&&this.renderDraggedImage(this.ctx,true)){
        // The full table is painted once; subsequent frames move only a small
        // compositor layer. No background readback/copy while the pointer moves.
        if(this.backgroundDirty||this.floatingDrag!==key)this.renderScene(this.ctx,this.carriedIds());
        this.backgroundDirty=false;this.floatingDrag=key;this.previousDragRect=null;return;
      }
      if(this.floatingDrag!==null){this.floatingDrag=null;this.backgroundDirty=true;}
      const rebuild=this.backgroundDirty||this.backgroundDrag!==this.drag.id||this.background.width!==this.canvas.width||this.background.height!==this.canvas.height;
      if(rebuild){
        if(this.background.width!==this.canvas.width)this.background.width=this.canvas.width;
        if(this.background.height!==this.canvas.height)this.background.height=this.canvas.height;
        this.renderScene(this.background.getContext('2d')!,this.carriedIds());this.backgroundDirty=false;this.backgroundDrag=this.drag.id;
      }
      const c=this.ctx,dpr=Math.min(devicePixelRatio||1,2),{x,y,z}=this.camera;
      const rect=this.dragRect();
      // Restore only the old/new piece footprint. A full viewport bitmap copy on
      // every pointer frame is expensive on high-DPI phones, even with an atlas.
      c.setTransform(1,0,0,1,0,0);
      if(rebuild){c.clearRect(0,0,this.canvas.width,this.canvas.height);c.drawImage(this.background,0,0);}
      else for(const area of [this.previousDragRect,rect])if(area){
        c.clearRect(area.x,area.y,area.width,area.height);
        c.drawImage(this.background,area.x,area.y,area.width,area.height,area.x,area.y,area.width,area.height);
      }
      c.setTransform(dpr,0,0,dpr,0,0);c.save();c.translate(x,y);c.scale(z,z);
      if(rect&&!this.renderDraggedImage(c))for(const id of this.carriedIds()){const group=this.state.groups.find(g=>g.id===id);if(group)this.renderGroup(c,group);}
      c.restore();this.previousDragRect=rect;
    }else{this.dragImage?.clear();this.floatingDrag=null;this.renderScene(this.ctx);this.backgroundDirty=true;this.previousDragRect=null;}
  }
  private dragKey(){return this.carriedIds().join(',');}
  private carriedIds(){return this.dragIds.length||!this.drag?this.dragIds:[this.drag.id];}
  private renderDraggedImage(c:CanvasRenderingContext2D,floating=false){
    if(!this.drag)return false;
    this.dragImage??=new DragImage();
    const z=this.camera.z,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    const appearance=`${this.theme}:${this.selected}:${this.selectedExtra.size}:${this.edges}:${this.hintUntil}:${this.hintIds?.join(',')}`;
    const ids=(this.carriedIds()).map(id=>this.state.groups.find(g=>g.id===id)).filter((g):g is Group=>!!g);
    if(!ids.length)return false;
    // The compositor bitmap is anchored on the selection's own bounding box, so
    // its cache key is position-independent: moving a selection never re-rasterizes
    // it. Painters receive that origin and draw in that local space.
    return this.dragImage.draw(c,ids,this.pieces,w,h,z*Math.min(devicePixelRatio||1,2),Math.min(w,h)*.26+48/z,appearance,(context,origin)=>{context.translate(-this.board.x-origin.x,-this.board.y-origin.y);for(const group of ids)this.renderGroup(context,group,false);},floating?{host:this.canvas.parentElement!,camera:this.camera}:undefined);
  }
  // Dirty rectangle of everything the gesture carries, in device pixels.
  private dragRect(ids=this.carriedIds()){
    const {x,y,z}=this.camera,dpr=Math.min(devicePixelRatio||1,2),w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    const bounds=this.dragBounds(ids);if(!bounds)return null;
    // Include tabs, selected outlines, hints and the small-puzzle drop shadow.
    const margin=Math.min(w,h)*.26*z+48;
    const x1=Math.max(0,Math.floor((x+bounds.left*z-margin)*dpr));
    const y1=Math.max(0,Math.floor((y+bounds.top*z-margin)*dpr));
    const x2=Math.min(this.canvas.width,Math.ceil((x+bounds.right*z+margin)*dpr));
    const y2=Math.min(this.canvas.height,Math.ceil((y+bounds.bottom*z+margin)*dpr));
    return x2>x1&&y2>y1?{x:x1,y:y1,width:x2-x1,height:y2-y1}:null;
  }
  private renderScene(c:CanvasRenderingContext2D,exclude?:number|readonly number[]){
    const skip=exclude===undefined?null:new Set(typeof exclude==='number'?[exclude]:exclude);
    const palette=TABLE_PALETTES[this.theme];
    const dpr=Math.min(devicePixelRatio||1,2),{x,y,z}=this.camera,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,this.width,this.height);c.save();c.translate(x,y);c.scale(z,z);
    c.fillStyle=palette.board;c.strokeStyle=palette.border;c.lineWidth=1/z;c.beginPath();c.roundRect(this.board.x-9,this.board.y-9,this.board.width+18,this.board.height+18,8);c.fill();c.stroke();
    const underlay=this.underlayUntil>Date.now();
    if(underlay){c.save();c.globalAlpha=.38;c.drawImage(this.picture,this.board.x,this.board.y,this.board.width,this.board.height);c.restore();}
    c.save();c.setLineDash([4/z,7/z]);c.strokeStyle=palette.grid;c.lineWidth=.6/z;
    for(let i=1;i<this.state.cols;i++){c.beginPath();c.moveTo(this.board.x+i*w,this.board.y);c.lineTo(this.board.x+i*w,this.board.y+this.board.height);c.stroke();}
    for(let i=1;i<this.state.rows;i++){c.beginPath();c.moveTo(this.board.x,this.board.y+i*h);c.lineTo(this.board.x+this.board.width,this.board.y+i*h);c.stroke();}c.restore();
    if(!underlay&&!placedCount(this.state)){c.fillStyle=palette.hint;c.textAlign='center';c.font='22px "Microsoft YaHei", sans-serif';c.fillText(t('把喜欢的画面，一片片拼回来'),760,550);c.font='16px "Microsoft YaHei", sans-serif';c.fillText(t('从四个角开始，也许会更轻松'),760,582);}
    c.fillStyle=palette.caption;c.textAlign='left';c.font='14px "Segoe UI", sans-serif';c.fillText(`${this.state.cols*this.state.rows} PIECES  /  TAKE YOUR TIME`,this.board.x,this.board.y-26);
    const groups=[...this.state.groups.filter(g=>g.locked),...this.state.groups.filter(g=>!g.locked)];
    for(const g of groups)if(!skip?.has(g.id))this.renderGroup(c,g);
    if(this.hintUntil>Date.now())for(const id of this.hintIds){if(!this.state.groups.some(g=>!g.locked&&g.pieces.includes(id)))continue;const p=this.pieces[id];c.save();c.translate(this.board.x+p.col*w,this.board.y+p.row*h);this.hintMarker(c,id,true);c.restore();}
    c.restore();
  }
  private renderGroup(c:CanvasRenderingContext2D,g:Group,cull=true){
    if(!visibleGroup(g,this.pieces,this.edges)&&!g.pieces.some(id=>this.hintNumber(id)))return;
    const {x,y,z}=this.camera,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.26+10/z;
    const useSprites=!!this.sprites&&z*Math.min(devicePixelRatio||1,2)<=this.sprites.scale;
    const left=-x/z,right=(this.width-x)/z,top=-y/z,bottom=(this.height-y)/z,owner=this.remoteOwners[g.id];
    // Selected groups share one highlight colour whether or not they are being
    // carried, so the selection stays readable when the pointer is released.
    const marked=!g.locked&&(g.id===this.selected||this.selectedExtra.has(g.id));
    for(const id of g.pieces){
      const p=this.pieces[id],path=this.paths[id],px=this.board.x+p.col*w+g.dx,py=this.board.y+p.row*h+g.dy;
      if(cull&&(px+w+pad<left||px-pad>right||py+h+pad<top||py-pad>bottom))continue;
      if(useSprites)this.sprites!.draw(c,id,px,py);
      c.save();c.translate(px,py);
      if(!useSprites){
        const lifted=this.dragIds.includes(g.id);
        if(!this.sprites&&!g.locked){c.shadowColor='#60462a66';c.shadowBlur=lifted?14:7;c.shadowOffsetY=lifted?7:3;c.fillStyle='#d8d2c2';c.fill(path);c.shadowColor='transparent';}
        c.save();c.clip(path);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';drawPiecePicture(c,this.picture,p,this.state.cols,this.state.rows,this.board.width,this.board.height);c.restore();
      }
      if(!useSprites||((owner||marked)&&!g.locked)){
        c.strokeStyle=g.locked?'#5c493d66':owner?owner.color:marked?'#ac6246':'#fffbebbb';c.lineWidth=(owner||marked)&&!g.locked?2/z:.85/z;c.stroke(path);
      }
      if(!g.locked)this.hintMarker(c,id);c.restore();
    }
    if(owner){const p=this.pieces[g.pieces[0]];c.save();c.font=`${12/z}px "Microsoft YaHei",sans-serif`;c.fillStyle=TABLE_PALETTES[this.theme].owner;c.fillText(owner.name,this.board.x+p.col*w+g.dx,this.board.y+p.row*h+g.dy-12/z);c.restore();}
  }
  destroy(){this.stopLanguage();this.release();this.feedback?.destroy();this.snapAudio.destroy();this.dragImage?.clear();this.abort.abort();this.resize.disconnect();clearInterval(this.timer);if(this.hintTimer)clearTimeout(this.hintTimer);if(this.underlayTimer)clearTimeout(this.underlayTimer);cancelAnimationFrame(this.raf);this.sprites?.destroy();this.picture.width=0;this.picture.height=0;this.background.width=0;this.background.height=0;}
}

