import { boardFor,type Piece,type PuzzleState } from './puzzle-engine';
import { CONNECTION_GLOW_MS,connectionPath,type ConnectionGlow } from './connection-feedback';
type Flash={canvas:HTMLCanvasElement;anchor:number;left:number;top:number;timer:ReturnType<typeof setTimeout>};

// Each connection paints one small transparent stamp once. CSS handles the fade;
// no animation loop, React updates, or full-table redraws are needed.
export class ConnectionGlowRenderer{
 private flashes:Flash[]=[];
 private motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 private host:HTMLElement;private state:PuzzleState;private pieces:Piece[];private camera:()=>{x:number;y:number;z:number};
 constructor(host:HTMLElement,state:PuzzleState,pieces:Piece[],camera:()=>{x:number;y:number;z:number}){
  this.host=host;this.state=state;this.pieces=pieces;this.camera=camera;
  document.addEventListener('visibilitychange',this.visibility);
  this.motion.addEventListener('change',this.clear);
 }
 private visibility=()=>{if(document.hidden)this.clear();};
 show(glows:ConnectionGlow[]){
  if(document.hidden)return;
  const board=boardFor(this.state.cols,this.state.rows),w=board.width/this.state.cols,h=board.height/this.state.rows;
  for(const glow of glows){
   while(this.flashes.length>=3)this.remove(this.flashes[0]);
   const pad=Math.min(w,h)*.28+4,left=Math.min(...glow.seams.map(s=>this.pieces[s.pieceId].col*w))-pad,top=Math.min(...glow.seams.map(s=>this.pieces[s.pieceId].row*h))-pad;
   const width=Math.max(...glow.seams.map(s=>(this.pieces[s.pieceId].col+1)*w))+pad-left,height=Math.max(...glow.seams.map(s=>(this.pieces[s.pieceId].row+1)*h))+pad-top;
   const scale=Math.min(Math.max(1,this.camera().z)*(Math.min(devicePixelRatio||1,2)),768/Math.max(width,height));
   const canvas=document.createElement('canvas');canvas.className='connection-glow';canvas.setAttribute('aria-hidden','true');
   canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;canvas.style.animationDuration=`${CONNECTION_GLOW_MS}ms`;
   const c=canvas.getContext('2d');if(!c)continue;
   c.scale(scale,scale);c.translate(-left,-top);c.lineCap='round';c.lineJoin='round';
   const line=Math.min(w,h)*.055+.6;
   for(const seam of glow.seams){const p=this.pieces[seam.pieceId],path=new Path2D(connectionPath(p,this.state.cols,this.state.rows,seam.side));c.save();c.translate(p.col*w,p.row*h);
    for(const [size,color] of [[line*4,'#edbd6c22'],[line*2.1,'#ffdf9b66'],[line*.7,'#fff2c9cc']] as const){c.strokeStyle=color;c.lineWidth=size;c.stroke(path);}c.restore();}
   this.host.appendChild(canvas);
   const flash:Flash={canvas,anchor:glow.anchor,left,top,timer:setTimeout(()=>this.remove(flash),CONNECTION_GLOW_MS)};this.flashes.push(flash);
  }
  this.update();
 }
 update(){
  if(!this.flashes.length)return;
  const board=boardFor(this.state.cols,this.state.rows),camera=this.camera();
  for(const flash of [...this.flashes]){const group=this.state.groups.find(g=>g.pieces.includes(flash.anchor));if(!group){this.remove(flash);continue;}
   flash.canvas.style.transform=`translate(${camera.x+(board.x+group.dx+flash.left)*camera.z}px,${camera.y+(board.y+group.dy+flash.top)*camera.z}px) scale(${camera.z})`;
  }
 }
 private remove(flash:Flash){clearTimeout(flash.timer);flash.canvas.remove();flash.canvas.width=0;flash.canvas.height=0;this.flashes=this.flashes.filter(f=>f!==flash);}
 private clear=()=>{for(const flash of [...this.flashes])this.remove(flash);};
 destroy(){this.clear();document.removeEventListener('visibilitychange',this.visibility);this.motion.removeEventListener('change',this.clear);}
}
