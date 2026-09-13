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
export type TableNetwork={canAcquire?:(id:number)=>boolean;acquire:(id:number)=>Promise<boolean>;move:(id:number,dx:number,dy:number)=>void;drop:(id:number,dx:number,dy:number)=>Promise<void>;release:(id:number)=>void};
export class PuzzleTable {
  canvas:HTMLCanvasElement; state:PuzzleState; ctx:CanvasRenderingContext2D; hit:CanvasRenderingContext2D;
  board:ReturnType<typeof boardFor>;
  image:HTMLImageElement; picture:HTMLCanvasElement; pieces; paths:Path2D[]; camera={x:0,y:0,z:1}; width=0; height=0;
  edges=false; paused=false; selected:number|null=null;
  private feedback:ConnectionGlowRenderer|null=null;private snapAudio=new SnapSound();
  private dragImage:DragImage|null=null;
  private floatingDrag:number|null=null;
  private hintIds:number[]=[]; private hintUntil=0; private underlayUntil=0;
  private underlayTimer:ReturnType<typeof setTimeout>|null=null;
  private sprites:PuzzleSprites|null=null; private background:HTMLCanvasElement;
  private backgroundDirty=true; private backgroundDrag:number|null=null;
  private previousDragRect:{x:number;y:number;width:number;height:number}|null=null;
  private theme:TableTheme='beige';
  network:TableNetwork|null=null; networkReady=true; private claimSerial=0;
  private remoteOwners:Record<string,{name:string;color:string}>={};
  private drag:{id:number;x:number;y:number;dx:number;dy:number}|null=null;
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
  private groupAt(x:number,y:number):Group|undefined {
    const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
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
      if(this.network){if(this.remoteOwners[g.id]){this.notice(`${this.remoteOwners[g.id].name} 正在移动这组拼块`);return;}
        if(this.network.canAcquire?.(g.id)===false){this.notice('这组拼块还在确认位置，可以先移动其他拼块');return;}
        const serial=++this.claimSerial;this.selected=g.id;raiseGroup(this.state,g.id);
        this.drag={id:g.id,x:wp.x,y:wp.y,dx:g.dx,dy:g.dy};this.canvas.style.cursor='grabbing';
        void this.network.acquire(g.id).then(ok=>{
          // Local pointer motion begins immediately. Only a denied claim cancels it.
          if(!ok&&serial===this.claimSerial){this.drag=null;this.canvas.style.cursor='grab';this.draw();}
        });
      }else{this.selected=g.id;raiseGroup(this.state,g.id);this.drag={id:g.id,x:wp.x,y:wp.y,dx:g.dx,dy:g.dy};this.canvas.style.cursor='grabbing';}
    }
    else{this.pan={x:p.x,y:p.y,cx:this.camera.x,cy:this.camera.y};this.canvas.style.cursor='grabbing';}
    this.draw();
  };
  private move=(e:PointerEvent)=>{
    const p=this.point(e);if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,p);
    if(this.pinch&&this.pointers.size>=2){const [a,b]=[...this.pointers.values()],z=this.clamp(this.pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance));this.camera={x:(a.x+b.x)/2-this.pinch.wx*z,y:(a.y+b.y)/2-this.pinch.wy*z,z};this.draw();return;}
    if(this.drag){const wp=this.world(p);const dx=this.drag.dx+wp.x-this.drag.x,dy=this.drag.dy+wp.y-this.drag.y;moveGroup(this.state,this.drag.id,dx,dy);this.network?.move(this.drag.id,dx,dy);this.draw(false);}
    else if(this.pan){this.camera.x=this.pan.cx+p.x-this.pan.x;this.camera.y=this.pan.cy+p.y-this.pan.y;this.draw();}
    else if(!this.paused){const wp=this.world(p);this.canvas.style.cursor=this.groupAt(wp.x,wp.y)?'grab':this.space?'grabbing':'default';}
  };
  private up=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);if(this.pinch){this.pinch=null;this.pan=null;}else this.release();if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);};
  private cancel=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);this.release();this.pinch=null;};
  private release(){
    this.claimSerial++;
    if(this.drag&&this.network){const id=this.drag.id;this.keepOnTable(id);const group=this.state.groups.find(g=>g.id===id);this.drag=null;if(group)void this.network.drop(id,group.dx,group.dy);}
    if(this.drag){this.keepOnTable(this.drag.id);const before=this.state.groups.map(g=>({...g,pieces:[...g.pieces]})),result=dropGroup(this.state,this.drag.id,snapTolerance(this.state));
      if(result.snapped){this.feedback?.show(newConnections(before,this.state));this.playConnectionSound();this.notice(placedCount(this.state)===this.pieces.length?'每一片，都找到了自己的位置。':result.placed?`拼对了！已归位 ${placedCount(this.state)} / ${this.pieces.length} 片`:'拼块连在一起了，可以整组拖动');}
      this.drag=null;this.update();}
    this.pan=null;this.canvas.style.cursor='grab';this.draw();
  }
  private keepOnTable(id:number){const g=this.state.groups.find(g=>g.id===id);if(!g||g.locked)return;const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    const minX=Math.min(...g.pieces.map(id=>this.board.x+this.pieces[id].col*w)),maxX=Math.max(...g.pieces.map(id=>this.board.x+(this.pieces[id].col+1)*w));
    const minY=Math.min(...g.pieces.map(id=>this.board.y+this.pieces[id].row*h)),maxY=Math.max(...g.pieces.map(id=>this.board.y+(this.pieces[id].row+1)*h));
    g.dx=Math.max(18-minX,Math.min(WORLD.width-18-maxX,g.dx));g.dy=Math.max(18-minY,Math.min(WORLD.height-18-maxY,g.dy));
  }
  private wheel=(e:WheelEvent)=>{e.preventDefault();if(this.drag||this.paused)return;this.zoom(Math.exp(-e.deltaY*.0014),this.point(e));};
  private keydown=(e:KeyboardEvent)=>{
    if(this.paused||!this.networkReady)return;
    if(e.code==='Space'){e.preventDefault();this.space=true;this.canvas.style.cursor='grabbing';return;}
    if(e.key==='+'||e.key==='='){e.preventDefault();this.zoom(1.2);return;}if(e.key==='-'){e.preventDefault();this.zoom(1/1.2);return;}
    if(e.key==='0'){e.preventDefault();this.fit();return;}
    if(e.key==='Tab'){return;}
    if(e.key.toLowerCase()==='n') {e.preventDefault();const visible=this.state.groups.filter(g=>!g.locked&&visibleGroup(g,this.pieces,this.edges)),idx=visible.findIndex(g=>g.id===this.selected);if(visible.length){this.selected=visible[(idx+1)%visible.length].id;this.draw();this.notice('已选中下一块。方向键移动，回车吸附。');}return;}
    if(this.selected===null)return;const g=this.state.groups.find(g=>g.id===this.selected);if(!g||g.locked)return;
    if(this.network&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'].includes(e.key)){e.preventDefault();this.notice('多人模式请拖动拼块，方向键移动暂用于单人模式');return;}
    const delta:Record<string,number[]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(delta[e.key]){e.preventDefault();const step=e.shiftKey?2:12;g.dx+=delta[e.key][0]*step;g.dy+=delta[e.key][1]*step;this.keepOnTable(g.id);raiseGroup(this.state,g.id);this.draw();this.update();}
    if(e.key==='Enter'){e.preventDefault();this.unlockSound();const before=this.state.groups.map(group=>({...group,pieces:[...group.pieces]})),r=dropGroup(this.state,g.id,snapTolerance(this.state));if(r.snapped){this.feedback?.show(newConnections(before,this.state));this.playConnectionSound();}this.update();this.draw();}
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
  cancelNetworkDrag(id?:number){if(id!==undefined&&this.drag?.id!==id)return;this.claimSerial++;this.drag=null;this.pan=null;this.canvas.style.cursor='default';this.draw();}
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
      const moving=this.state.groups.find(g=>g.id===this.drag!.id);
      if(moving&&this.canvas.parentElement&&this.renderDraggedImage(this.ctx,moving,true)){
        // The full table is painted once; subsequent frames move only a small
        // compositor layer. No background readback/copy while the pointer moves.
        if(this.backgroundDirty||this.floatingDrag!==this.drag.id)this.renderScene(this.ctx,this.drag.id);
        this.backgroundDirty=false;this.floatingDrag=this.drag.id;this.previousDragRect=null;return;
      }
      if(this.floatingDrag!==null){this.floatingDrag=null;this.backgroundDirty=true;}
      const rebuild=this.backgroundDirty||this.backgroundDrag!==this.drag.id||this.background.width!==this.canvas.width||this.background.height!==this.canvas.height;
      if(rebuild){
        if(this.background.width!==this.canvas.width)this.background.width=this.canvas.width;
        if(this.background.height!==this.canvas.height)this.background.height=this.canvas.height;
        this.renderScene(this.background.getContext('2d')!,this.drag.id);this.backgroundDirty=false;this.backgroundDrag=this.drag.id;
      }
      const c=this.ctx,dpr=Math.min(devicePixelRatio||1,2),{x,y,z}=this.camera;
      const group=this.state.groups.find(g=>g.id===this.drag!.id),rect=group?this.dragRect(group):null;
      // Restore only the old/new piece footprint. A full viewport bitmap copy on
      // every pointer frame is expensive on high-DPI phones, even with an atlas.
      c.setTransform(1,0,0,1,0,0);
      if(rebuild){c.clearRect(0,0,this.canvas.width,this.canvas.height);c.drawImage(this.background,0,0);}
      else for(const area of [this.previousDragRect,rect])if(area){
        c.clearRect(area.x,area.y,area.width,area.height);
        c.drawImage(this.background,area.x,area.y,area.width,area.height,area.x,area.y,area.width,area.height);
      }
      c.setTransform(dpr,0,0,dpr,0,0);c.save();c.translate(x,y);c.scale(z,z);
      if(group&&rect&&!this.renderDraggedImage(c,group))this.renderGroup(c,group);
      c.restore();this.previousDragRect=rect;
    }else{this.dragImage?.clear();this.floatingDrag=null;this.renderScene(this.ctx);this.backgroundDirty=true;this.previousDragRect=null;}
  }
  private renderDraggedImage(c:CanvasRenderingContext2D,group:Group,floating=false){
    this.dragImage??=new DragImage();
    const z=this.camera.z,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    const appearance=`${this.theme}:${this.selected}:${this.edges}:${this.hintUntil}:${this.hintIds?.join(',')}:${this.remoteOwners[group.id]?.color||''}`;
    return this.dragImage.draw(c,group,this.pieces,w,h,this.board,z*Math.min(devicePixelRatio||1,2),Math.min(w,h)*.26+48/z,appearance,context=>this.renderGroup(context,group,false),floating?{host:this.canvas.parentElement!,camera:this.camera}:undefined);
  }
  private dragRect(group:Group){
    const {x,y,z}=this.camera,dpr=Math.min(devicePixelRatio||1,2),w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const id of group.pieces){const p=this.pieces[id];left=Math.min(left,p.col*w);top=Math.min(top,p.row*h);right=Math.max(right,(p.col+1)*w);bottom=Math.max(bottom,(p.row+1)*h);}
    // Include tabs, selected outlines, hints and the small-puzzle drop shadow.
    const margin=Math.min(w,h)*.26*z+48;
    const x1=Math.max(0,Math.floor((x+(this.board.x+group.dx+left)*z-margin)*dpr));
    const y1=Math.max(0,Math.floor((y+(this.board.y+group.dy+top)*z-margin)*dpr));
    const x2=Math.min(this.canvas.width,Math.ceil((x+(this.board.x+group.dx+right)*z+margin)*dpr));
    const y2=Math.min(this.canvas.height,Math.ceil((y+(this.board.y+group.dy+bottom)*z+margin)*dpr));
    return x2>x1&&y2>y1?{x:x1,y:y1,width:x2-x1,height:y2-y1}:null;
  }
  private renderScene(c:CanvasRenderingContext2D,exclude?:number){
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
    for(const g of groups)if(g.id!==exclude)this.renderGroup(c,g);
    if(this.hintUntil>Date.now())for(const id of this.hintIds){if(!this.state.groups.some(g=>!g.locked&&g.pieces.includes(id)))continue;const p=this.pieces[id];c.save();c.translate(this.board.x+p.col*w,this.board.y+p.row*h);this.hintMarker(c,id,true);c.restore();}
    c.restore();
  }
  private renderGroup(c:CanvasRenderingContext2D,g:Group,cull=true){
    if(!visibleGroup(g,this.pieces,this.edges)&&!g.pieces.some(id=>this.hintNumber(id)))return;
    const {x,y,z}=this.camera,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.26+10/z;
    const useSprites=!!this.sprites&&z*Math.min(devicePixelRatio||1,2)<=this.sprites.scale;
    const left=-x/z,right=(this.width-x)/z,top=-y/z,bottom=(this.height-y)/z,owner=this.remoteOwners[g.id];
    for(const id of g.pieces){
      const p=this.pieces[id],path=this.paths[id],px=this.board.x+p.col*w+g.dx,py=this.board.y+p.row*h+g.dy;
      if(cull&&(px+w+pad<left||px-pad>right||py+h+pad<top||py-pad>bottom))continue;
      if(useSprites)this.sprites!.draw(c,id,px,py);
      c.save();c.translate(px,py);
      if(!useSprites){
        if(!this.sprites&&!g.locked){c.shadowColor='#60462a66';c.shadowBlur=this.drag?.id===g.id?14:7;c.shadowOffsetY=this.drag?.id===g.id?7:3;c.fillStyle='#d8d2c2';c.fill(path);c.shadowColor='transparent';}
        c.save();c.clip(path);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';drawPiecePicture(c,this.picture,p,this.state.cols,this.state.rows,this.board.width,this.board.height);c.restore();
      }
      if(!useSprites||((owner||g.id===this.selected)&&!g.locked)){
        c.strokeStyle=g.locked?'#5c493d66':owner?owner.color:g.id===this.selected?'#ac6246':'#fffbebbb';c.lineWidth=(owner||g.id===this.selected)&&!g.locked?2/z:.85/z;c.stroke(path);
      }
      if(!g.locked)this.hintMarker(c,id);c.restore();
    }
    if(owner){const p=this.pieces[g.pieces[0]];c.save();c.font=`${12/z}px "Microsoft YaHei",sans-serif`;c.fillStyle=TABLE_PALETTES[this.theme].owner;c.fillText(owner.name,this.board.x+p.col*w+g.dx,this.board.y+p.row*h+g.dy-12/z);c.restore();}
  }
  destroy(){this.stopLanguage();this.release();this.feedback?.destroy();this.snapAudio.destroy();this.dragImage?.clear();this.abort.abort();this.resize.disconnect();clearInterval(this.timer);if(this.hintTimer)clearTimeout(this.hintTimer);if(this.underlayTimer)clearTimeout(this.underlayTimer);cancelAnimationFrame(this.raf);this.sprites?.destroy();this.picture.width=0;this.picture.height=0;this.background.width=0;this.background.height=0;}
}

