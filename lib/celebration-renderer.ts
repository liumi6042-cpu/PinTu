import { CELEBRATION_COLORS, CELEBRATION_DURATION, celebrationFrame, celebrationParticles, type CelebrationBounds, type CelebrationParticle } from './celebration-engine';

const PUZZLE_SHAPE='M -21 -21 H -7 C -5 -17 -11 -16 -11 -11 C -11 -2 4 -2 4 -11 C 4 -16 -2 -17 0 -21 H 21 V -7 C 25 -5 26 -11 31 -11 C 40 -11 40 4 31 4 C 26 4 25 -2 21 0 V 21 H 7 C 5 25 11 26 11 31 C 11 40 -4 40 -4 31 C -4 26 2 25 0 21 H -21 V 7 C -17 5 -16 11 -11 11 C -2 11 -2 -4 -11 -4 C -16 -4 -17 2 -21 0 Z';

export class CelebrationRenderer {
  private ctx:CanvasRenderingContext2D;
  private particles:CelebrationParticle[]=[];
  private dustParticles:CelebrationParticle[]=[];
  private sprites=new Map<string,HTMLCanvasElement>();
  private raf=0;private started:number|null=null;private stopped=false;
  private width=0;private height=0;private board:CelebrationBounds={x:0,y:0,width:1,height:1};
  private observer:ResizeObserver;private motion:MediaQueryList;
  private canvas:HTMLCanvasElement;private getBoard:()=>CelebrationBounds|null;private finish:()=>void;
  private reducedTimer:ReturnType<typeof setTimeout>|null=null;

  constructor(canvas:HTMLCanvasElement,getBoard:()=>CelebrationBounds|null,finish:()=>void,seed=Date.now()){
    this.canvas=canvas;this.getBoard=getBoard;this.finish=finish;this.ctx=canvas.getContext('2d')!;
    this.motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resize();const particles=celebrationParticles(this.width,seed);
    this.particles=particles.filter(p=>p.kind!=='dust');this.dustParticles=particles.filter(p=>p.kind==='dust');
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    document.addEventListener('visibilitychange',this.visibility);
    this.motion.addEventListener('change',this.motionChanged);
    if(this.motion.matches)this.reducedTimer=setTimeout(()=>this.end(),600);
    else this.raf=requestAnimationFrame(this.tick);
  }
  private resize(){
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
    this.width=rect.width;this.height=rect.height;this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    const board=this.getBoard();this.board=board&&board.width>0?board:{x:this.width*.25,y:this.height*.2,width:this.width*.5,height:this.height*.55};
  }
  private visibility=()=>{if(document.hidden)this.end();};
  private motionChanged=()=>{if(this.motion.matches)this.end();};
  private dustSprite(){
    let canvas=this.sprites.get('gold-dust');if(canvas)return canvas;
    canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
    const c=canvas.getContext('2d')!,glow=c.createRadialGradient(16,16,0,16,16,16);
    glow.addColorStop(0,'#fff8d7');glow.addColorStop(.16,'#ffe9a0');glow.addColorStop(.3,'#f8c44ddd');
    glow.addColorStop(.6,'#efa82b55');glow.addColorStop(1,'#e99c2000');
    c.fillStyle=glow;c.fillRect(0,0,32,32);this.sprites.set('gold-dust',canvas);return canvas;
  }
  private dust(elapsed:number,viewport:CelebrationBounds){
    const c=this.ctx,sprite=this.dustSprite();
    // One cached halo and one blend-mode change for the entire powder layer.
    c.save();c.globalCompositeOperation='lighter';
    for(const p of this.dustParticles){
      const frame=celebrationFrame(p,elapsed,viewport,this.board);if(!frame)continue;
      const {x,y,size,alpha}=frame,radius=size*2;
      if(x< -radius||x>this.width+radius||y< -radius||y>this.height+radius)continue;
      c.globalAlpha=alpha;c.drawImage(sprite,x-radius,y-radius,radius*2,radius*2);
    }
    c.restore();
  }
  private sprite(p:CelebrationParticle){
    const key=`${p.kind}-${p.metallic?'gold':p.color}-${p.depth===2?'soft':'sharp'}`;
    let canvas=this.sprites.get(key);if(canvas)return canvas;
    canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const c=canvas.getContext('2d')!;c.translate(54,54);c.scale(1.4,1.4);
    if(p.depth===2)c.filter='blur(1px)';
    c.shadowColor='#0007';c.shadowBlur=p.depth===2?5:2;c.shadowOffsetY=2;
    const gradient=c.createLinearGradient(-26,-24,34,34);
    if(p.metallic){for(const [offset,color] of [[0,'#9e611f'],[.23,'#f7cf6b'],[.46,'#fff9d8'],[.58,'#cf942c'],[.8,'#ffe6a1'],[1,'#a87025']] as const)gradient.addColorStop(offset,color);}
    else{gradient.addColorStop(0,'#fffcf0');gradient.addColorStop(.25,CELEBRATION_COLORS[p.color]);gradient.addColorStop(1,CELEBRATION_COLORS[p.color]);}
    c.fillStyle=gradient;
    const shape=p.kind==='puzzle'?new Path2D(PUZZLE_SHAPE):new Path2D('M -18 -15 L 17 -22 L 22 15 L -15 21 Z');
    c.fill(shape);c.shadowColor='transparent';c.strokeStyle=p.metallic?'#fff0b9bb':'#ffffff80';c.lineWidth=.8;c.stroke(shape);
    this.sprites.set(key,canvas);return canvas;
  }
  private ribbon(p:CelebrationParticle,age:number,size:number){
    const c=this.ctx,phase=p.phase+age*2.8,segments=26;
    c.rotate(Math.sin(age+p.phase)*.45);c.shadowColor='#0005';c.shadowBlur=4;c.shadowOffsetY=3;
    const gold=c.createLinearGradient(-size*.35,-size*.5,size*.35,size*.5);
    for(let i=0;i<=8;i++)gold.addColorStop(i/8,['#a86d24','#fff0b0','#e8b94d','#fff8db'][i%4]);
    c.fillStyle=gold;c.beginPath();
    for(let side=0;side<2;side++)for(let j=0;j<=segments;j++){
      const t=(side===0?j:segments-j)/segments,angle=t*Math.PI*3.5+phase;
      const cx=Math.sin(angle)*size*.23,half=(.018+.055*Math.abs(Math.cos(angle)))*size;
      const x=cx+(side===0?-half:half),y=(t-.5)*size;
      if(side===0&&j===0)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.closePath();c.fill();c.shadowColor='transparent';c.strokeStyle='#fff0bb99';c.lineWidth=.6;c.stroke();
  }
  private tick=(now:number)=>{
    if(this.stopped)return;
    this.started??=now;const elapsed=now-this.started;
    if(elapsed>=CELEBRATION_DURATION){this.end();return;}
    const c=this.ctx;c.clearRect(0,0,this.width,this.height);
    const viewport={x:0,y:0,width:this.width,height:this.height};
    this.dust(elapsed,viewport);
    for(const p of this.particles){
      const frame=celebrationFrame(p,elapsed,viewport,this.board);if(!frame)continue;
      const {x,y,size,rotation,flip,alpha,age}=frame;
      if(x< -size||x>this.width+size||y< -size||y>this.height+size)continue;
      c.save();c.globalAlpha=alpha;c.translate(x,y);
      if(p.kind==='ribbon')this.ribbon(p,age,size);
      else{
        c.rotate(rotation);c.scale(1,.16+.84*Math.abs(flip));
        c.drawImage(this.sprite(p),-size*.5,-size*.5,size,size);
        if(p.metallic&&Math.cos(age*7+p.phase)>.95&&p.depth>0){c.fillStyle='#fff5c6';c.fillRect(-size*.24,-.65,size*.18,1.3);}
      }
      c.restore();
    }
    this.raf=requestAnimationFrame(this.tick);
  };
  private end(){if(this.stopped)return;this.destroy();this.finish();}
  destroy(){
    if(this.stopped)return;this.stopped=true;cancelAnimationFrame(this.raf);
    if(this.reducedTimer)clearTimeout(this.reducedTimer);this.observer.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);this.motion.removeEventListener('change',this.motionChanged);
    this.ctx.clearRect(0,0,this.width,this.height);
    for(const sprite of this.sprites.values()){sprite.width=0;sprite.height=0;}this.sprites.clear();this.particles=[];this.dustParticles=[];
  }
}
