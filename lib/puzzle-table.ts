import { BOARD, WORLD, piecesFor, pathFor, moveGroup, dropGroup, raiseGroup, placedCount, visibleGroup, shuffleLoose, snapTolerance, type PuzzleState, type Group } from './puzzle-engine';
import { PuzzleSprites } from './puzzle-sprites';
type Notice = (message:string)=>void;
export type TableNetwork={canAcquire?:(id:number)=>boolean;acquire:(id:number)=>Promise<boolean>;move:(id:number,dx:number,dy:number)=>void;drop:(id:number,dx:number,dy:number)=>Promise<void>;release:(id:number)=>void};
export class PuzzleTable {
  canvas:HTMLCanvasElement; state:PuzzleState; ctx:CanvasRenderingContext2D; hit:CanvasRenderingContext2D;
  image:HTMLImageElement; picture:HTMLCanvasElement; pieces; paths:Path2D[]; camera={x:0,y:0,z:1}; width=0; height=0;
  edges=false; sound=false; paused=false; selected:number|null=null; hintId:number|null=null;
  private sprites:PuzzleSprites|null=null; private background:HTMLCanvasElement;
  private backgroundDirty=true; private backgroundDrag:number|null=null;
  network:TableNetwork|null=null; networkReady=true; private claimSerial=0;
  private remoteOwners:Record<string,{name:string;color:string}>={};
  private drag:{id:number;x:number;y:number;dx:number;dy:number}|null=null;
  private pan:{x:number;y:number;cx:number;cy:number}|null=null;
  private pointers=new Map<number,{x:number;y:number}>(); private pinch:{distance:number;z:number;wx:number;wy:number}|null=null;
  private space=false; private raf=0; private timer:ReturnType<typeof setInterval>; private hintTimer:ReturnType<typeof setTimeout>|null=null;
  private resize:ResizeObserver; private abort=new AbortController(); private audio:AudioContext|null=null;
  private update:()=>void; private notice:Notice;
  constructor(canvas:HTMLCanvasElement,state:PuzzleState,image:HTMLImageElement,update:()=>void,notice:Notice) {
    this.canvas=canvas;this.state=state;this.image=image;this.update=update;this.notice=notice;
    this.ctx=canvas.getContext('2d')!;this.hit=document.createElement('canvas').getContext('2d')!;
    this.picture=document.createElement('canvas');this.background=document.createElement('canvas');
    const resolution=Math.max(1,Math.min(3,image.naturalWidth/800,image.naturalHeight/600));
    this.picture.width=Math.round(800*resolution);this.picture.height=Math.round(600*resolution);
    const scale=Math.max(800/image.naturalWidth,600/image.naturalHeight),sw=800/scale,sh=600/scale;
    this.picture.getContext('2d')!.drawImage(image,(image.naturalWidth-sw)/2,(image.naturalHeight-sh)/2,sw,sh,0,0,this.picture.width,this.picture.height);
    this.pieces=piecesFor(state.cols,state.rows,state.seed);this.paths=this.pieces.map(p=>new Path2D(pathFor(p,state.cols,state.rows)));
    if(this.pieces.length>=300)this.sprites=new PuzzleSprites(this.picture,this.pieces,this.paths,state.cols,state.rows);
    this.resize=new ResizeObserver(()=>this.resizeCanvas());this.resize.observe(canvas);
    const opts={signal:this.abort.signal};
    canvas.addEventListener('pointerdown',this.down,opts);canvas.addEventListener('pointermove',this.move,opts);canvas.addEventListener('pointerup',this.up,opts);canvas.addEventListener('pointercancel',this.cancel,opts);canvas.addEventListener('lostpointercapture',this.cancel,opts);
    canvas.addEventListener('wheel',this.wheel,{...opts,passive:false});canvas.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    canvas.addEventListener('keydown',this.keydown,opts);canvas.addEventListener('keyup',e=>{if(e.code==='Space'){this.space=false;this.canvas.style.cursor='grab';}},opts);
    canvas.addEventListener('blur',()=>{this.space=false;this.release();},opts);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();},opts);
    this.timer=setInterval(()=>{if(!this.network&&!this.paused&&!document.hidden&&placedCount(state)<this.pieces.length){state.elapsed++;this.update();}},1000);
  }
  private resizeCanvas(){const r=this.canvas.getBoundingClientRect(),oldW=this.width,oldH=this.height;this.width=r.width;this.height=r.height;const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);if(!oldW)this.fit();else{this.camera.x+=(this.width-oldW)/2;this.camera.y+=(this.height-oldH)/2;}this.draw();}
  private point(e:{clientX:number;clientY:number}){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  private world(p:{x:number;y:number}){return {x:(p.x-this.camera.x)/this.camera.z,y:(p.y-this.camera.y)/this.camera.z};}
  private groupAt(x:number,y:number):Group|undefined {
    const w=800/this.state.cols,h=600/this.state.rows;
    for(let i=this.state.groups.length-1;i>=0;i--){const g=this.state.groups[i];if(g.locked||!visibleGroup(g,this.pieces,this.edges))continue;
      for(const id of g.pieces){const p=this.pieces[id],lx=x-BOARD.x-p.col*w-g.dx,ly=y-BOARD.y-p.row*h-g.dy,pad=Math.min(w,h)*.24;
        if(lx>=-pad&&lx<=w+pad&&ly>=-pad&&ly<=h+pad&&this.hit.isPointInPath(this.paths[id],lx,ly))return g;}
    }
  }
  private down=(e:PointerEvent)=>{
    if(this.paused||!this.networkReady||e.button>2)return;e.preventDefault();this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(e.pointerId);const p=this.point(e);this.pointers.set(e.pointerId,p);
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
    if(this.drag){this.keepOnTable(this.drag.id);const result=dropGroup(this.state,this.drag.id,snapTolerance(this.state));
      if(result.snapped){this.playTone();this.notice(placedCount(this.state)===this.pieces.length?'每一片，都找到了自己的位置。':result.placed?`拼对了！已归位 ${placedCount(this.state)} / ${this.pieces.length} 片`:'拼块连在一起了，可以整组拖动');}
      this.drag=null;this.update();}
    this.pan=null;this.canvas.style.cursor='grab';this.draw();
  }
  private keepOnTable(id:number){const g=this.state.groups.find(g=>g.id===id);if(!g||g.locked)return;const w=800/this.state.cols,h=600/this.state.rows;
    const minX=Math.min(...g.pieces.map(id=>BOARD.x+this.pieces[id].col*w)),maxX=Math.max(...g.pieces.map(id=>BOARD.x+(this.pieces[id].col+1)*w));
    const minY=Math.min(...g.pieces.map(id=>BOARD.y+this.pieces[id].row*h)),maxY=Math.max(...g.pieces.map(id=>BOARD.y+(this.pieces[id].row+1)*h));
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
    if(e.key==='Enter'){e.preventDefault();const r=dropGroup(this.state,g.id,snapTolerance(this.state));if(r.snapped)this.playTone();this.update();this.draw();}
  };
  private clamp(z:number){const max=Math.max(3,Math.min(16,96/Math.min(800/this.state.cols,600/this.state.rows)));return Math.max(.15,Math.min(max,z));}
  zoom(factor:number,point={x:this.width/2,y:this.height/2}){const w=this.world(point),z=this.clamp(this.camera.z*factor);this.camera={x:point.x-w.x*z,y:point.y-w.y*z,z};this.draw();this.update();}
  fit(completed=false){const bounds=completed?BOARD:{x:0,y:0,...WORLD},z=Math.min(this.width/bounds.width,this.height/bounds.height)*(completed?.76:.94);this.camera={x:(this.width-bounds.width*z)/2-bounds.x*z,y:(this.height-bounds.height*z)/2-bounds.y*z,z};this.draw();this.update();}
  setEdges(v:boolean){this.release();this.edges=v;this.draw();}
  setPaused(v:boolean){this.release();this.paused=v;}
  shuffle(){if(this.network){this.notice('多人模式保留大家正在整理的桌面，请直接拖动散片');return;}this.release();const n=shuffleLoose(this.state);this.fit();this.draw();this.update();this.notice(n?`已整理 ${n} 块散片，组合保持完整`:'没有需要整理的散片');}
  syncRemote(next:PuzzleState,owners:Record<string,{name:string;color:string}>,protectIds:ReadonlySet<number>){
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
    if(after>before){this.playTone();this.notice(`一起拼对了！已归位 ${after} / ${this.pieces.length} 片`);}
    if(changed)this.draw();
  }
  cancelNetworkDrag(id?:number){if(id!==undefined&&this.drag?.id!==id)return;this.claimSerial++;this.drag=null;this.pan=null;this.canvas.style.cursor='default';this.draw();}
  hint(){const groups=this.state.groups.filter(g=>!g.locked&&visibleGroup(g,this.pieces,this.edges));if(!groups.length){this.notice(this.edges?'边缘已经拼完了，关闭「只看边缘」继续吧':'这幅拼图已经完成了');return;}
    const selected=groups.find(g=>g.id===this.selected)||groups[0];this.selected=selected.id;this.hintId=selected.pieces[0];raiseGroup(this.state,selected.id);this.draw();this.notice('发光拼块对应桌面上的绿色轮廓，试着把它拖过去');
    if(this.hintTimer)clearTimeout(this.hintTimer);this.hintTimer=setTimeout(()=>{this.hintId=null;this.draw();},6500);
  }
  private playTone(){if(!this.sound)return;try{this.audio??=new AudioContext();void this.audio.resume();const osc=this.audio.createOscillator(),gain=this.audio.createGain(),t=this.audio.currentTime;osc.type='sine';osc.frequency.setValueAtTime(640,t);osc.frequency.exponentialRampToValueAtTime(900,t+.08);gain.gain.setValueAtTime(.045,t);gain.gain.exponentialRampToValueAtTime(.001,t+.16);osc.connect(gain);gain.connect(this.audio.destination);osc.start();osc.stop(t+.17);}catch{/* Sound is optional. */}}
  draw(backgroundChanged=true){if(backgroundChanged)this.backgroundDirty=true;if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.render();});}
  private render(){
    if(this.sprites&&this.drag){
      if(this.backgroundDirty||this.backgroundDrag!==this.drag.id||this.background.width!==this.canvas.width||this.background.height!==this.canvas.height){
        this.background.width=this.canvas.width;this.background.height=this.canvas.height;
        this.renderScene(this.background.getContext('2d')!,this.drag.id);this.backgroundDirty=false;this.backgroundDrag=this.drag.id;
      }
      const c=this.ctx,dpr=Math.min(devicePixelRatio||1,2),{x,y,z}=this.camera;
      c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);c.drawImage(this.background,0,0);
      c.setTransform(dpr,0,0,dpr,0,0);c.save();c.translate(x,y);c.scale(z,z);
      const group=this.state.groups.find(g=>g.id===this.drag!.id);if(group)this.renderGroup(c,group);c.restore();
    }else{this.renderScene(this.ctx);this.backgroundDirty=true;}
  }
  private renderScene(c:CanvasRenderingContext2D,exclude?:number){
    const dpr=Math.min(devicePixelRatio||1,2),{x,y,z}=this.camera,w=800/this.state.cols,h=600/this.state.rows;
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,this.width,this.height);c.save();c.translate(x,y);c.scale(z,z);
    c.fillStyle='#121f30';c.strokeStyle='#516077';c.lineWidth=1/z;c.beginPath();c.roundRect(BOARD.x-9,BOARD.y-9,818,618,8);c.fill();c.stroke();
    c.save();c.setLineDash([4/z,7/z]);c.strokeStyle='#51607755';c.lineWidth=.6/z;
    for(let i=1;i<this.state.cols;i++){c.beginPath();c.moveTo(BOARD.x+i*w,BOARD.y);c.lineTo(BOARD.x+i*w,BOARD.y+600);c.stroke();}
    for(let i=1;i<this.state.rows;i++){c.beginPath();c.moveTo(BOARD.x,BOARD.y+i*h);c.lineTo(BOARD.x+800,BOARD.y+i*h);c.stroke();}c.restore();
    if(!placedCount(this.state)){c.fillStyle='#8291a788';c.textAlign='center';c.font='22px "Microsoft YaHei", sans-serif';c.fillText('把喜欢的画面，一片片拼回来',760,550);c.font='16px "Microsoft YaHei", sans-serif';c.fillText('从四个角开始，也许会更轻松',760,582);}
    c.fillStyle='#93a1b9';c.textAlign='left';c.font='14px "Segoe UI", sans-serif';c.fillText(`${this.state.cols*this.state.rows} PIECES  /  TAKE YOUR TIME`,BOARD.x,BOARD.y-26);
    const groups=[...this.state.groups.filter(g=>g.locked),...this.state.groups.filter(g=>!g.locked)];
    for(const g of groups)if(g.id!==exclude)this.renderGroup(c,g);
    if(this.hintId!==null){const p=this.pieces[this.hintId];c.save();c.translate(BOARD.x+p.col*w,BOARD.y+p.row*h);c.fillStyle='#d6e8b42a';c.strokeStyle='#d6e8b4';c.lineWidth=3/z;c.fill(this.paths[p.id]);c.stroke(this.paths[p.id]);c.restore();}
    c.restore();
  }
  private renderGroup(c:CanvasRenderingContext2D,g:Group){
    if(!visibleGroup(g,this.pieces,this.edges))return;
    const {x,y,z}=this.camera,w=800/this.state.cols,h=600/this.state.rows,pad=Math.min(w,h)*.26+10/z;
    const left=-x/z,right=(this.width-x)/z,top=-y/z,bottom=(this.height-y)/z,owner=this.remoteOwners[g.id];
    for(const id of g.pieces){
      const p=this.pieces[id],path=this.paths[id],px=BOARD.x+p.col*w+g.dx,py=BOARD.y+p.row*h+g.dy;
      if(px+w+pad<left||px-pad>right||py+h+pad<top||py-pad>bottom)continue;
      if(this.sprites)this.sprites.draw(c,id,px,py);
      c.save();c.translate(px,py);
      if(!this.sprites){
        if(!g.locked){c.shadowColor='#0009';c.shadowBlur=this.drag?.id===g.id?14:7;c.shadowOffsetY=this.drag?.id===g.id?7:3;c.fillStyle='#d8d2c2';c.fill(path);c.shadowColor='transparent';}
        c.save();c.clip(path);c.drawImage(this.picture,0,0,this.picture.width,this.picture.height,-p.col*w,-p.row*h,BOARD.width,BOARD.height);c.restore();
      }
      if(!this.sprites||((owner||g.id===this.selected)&&!g.locked)){
        c.strokeStyle=g.locked?'#17201966':owner?owner.color:g.id===this.selected?'#d6e8b4':'#fffbebbb';c.lineWidth=(owner||g.id===this.selected)&&!g.locked?2/z:.85/z;c.stroke(path);
      }
      if(id===this.hintId&&!g.locked){c.strokeStyle='#d6e8b4';c.lineWidth=4/z;c.shadowColor='#d6e8b4';c.shadowBlur=18;c.stroke(path);}c.restore();
    }
    if(owner){const p=this.pieces[g.pieces[0]];c.save();c.font=`${12/z}px "Microsoft YaHei",sans-serif`;c.fillStyle=owner.color;c.fillText(owner.name,BOARD.x+p.col*w+g.dx,BOARD.y+p.row*h+g.dy-12/z);c.restore();}
  }
  destroy(){this.release();this.abort.abort();this.resize.disconnect();clearInterval(this.timer);if(this.hintTimer)clearTimeout(this.hintTimer);cancelAnimationFrame(this.raf);this.sprites?.destroy();this.background.width=0;this.background.height=0;void this.audio?.close();}
}

