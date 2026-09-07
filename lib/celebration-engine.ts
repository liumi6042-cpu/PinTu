import { random } from './puzzle-engine';

export const CELEBRATION_DURATION = 3500;
export type CelebrationBounds = { x:number; y:number; width:number; height:number };
export type CelebrationParticle = {
  kind:'puzzle'|'foil'|'ribbon'; depth:number; side:number; delay:number;
  size:number; speedX:number; speedY:number; gravity:number;
  rotation:number; spin:number; phase:number; color:number; metallic:boolean;
};
export const CELEBRATION_COLORS=['#ffd46d','#f79eac','#b8a0e7','#81dace','#fff0ca','#8fcdec'];

export function celebrationParticles(width:number,seed:number):CelebrationParticle[] {
  const rand=random(seed),small=width<640,count=small?320:600;
  const particles:CelebrationParticle[]=[];
  for(let i=0;i<count;i++){
    const hero=i<(small?8:14),ribbon=!hero&&i<(small?18:30);
    const kind=ribbon?'ribbon':hero||rand()>.38?'puzzle':'foil';
    const depth=hero?2:rand()>.37?1:0;
    particles.push({kind,depth,side:i%2===0?1:-1,delay:rand()*470,
      size:ribbon?70+rand()*100:hero?64+rand()*42:kind==='foil'?3+rand()*6:9+rand()*19,
      speedX:.12+rand()*.43,speedY:.70+rand()*.23,gravity:.57+rand()*.23,
      rotation:rand()*Math.PI*2,spin:(rand()-.5)*7,phase:rand()*Math.PI*2,
      color:Math.floor(rand()*CELEBRATION_COLORS.length),metallic:ribbon||rand()<.42});
  }
  return particles.sort((a,b)=>a.depth-b.depth);
}

// Closed-form motion gives the same trajectory at 30, 60 or 120 fps.
export function celebrationFrame(p:CelebrationParticle,elapsed:number,viewport:CelebrationBounds,board:CelebrationBounds){
  const age=(elapsed-p.delay)/1000;
  if(age<0||elapsed>=CELEBRATION_DURATION)return null;
  const travel=(1-Math.exp(-.65*age))/.65;
  const originX=board.x+board.width*(p.side===1?.06:.94),originY=board.y+board.height*.93;
  const x=originX+p.side*viewport.width*p.speedX*travel+Math.sin(age*3+p.phase)*age*13;
  const y=originY-viewport.height*p.speedY*age+.5*viewport.height*p.gravity*age*age;
  const fade=Math.min(1,Math.max(0,(CELEBRATION_DURATION-elapsed)/750));
  return {x,y,age,alpha:fade*(p.depth===0?.68:1),rotation:p.rotation+p.spin*age,
    flip:Math.cos(age*4+p.phase),size:p.size*Math.min(1,viewport.width/1050)};
}

export class CompletionGate {
  private seen=false;
  observe(placed:number,total:number,ready:boolean){
    if(!ready||total<=0||placed<total||this.seen)return false;
    this.seen=true;return true;
  }
}
