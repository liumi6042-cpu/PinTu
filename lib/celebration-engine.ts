import { random } from './puzzle-engine';

export const CELEBRATION_DURATION = 3500;
export type CelebrationBounds = { x:number; y:number; width:number; height:number };
export type CelebrationParticle = {
  kind:'puzzle'|'foil'|'ribbon'|'dust'; depth:number; side:number; delay:number;
  size:number; speedX:number; speedY:number; gravity:number;
  rotation:number; spin:number; phase:number; color:number; metallic:boolean;
};
export const CELEBRATION_COLORS=['#ffd46d','#f79eac','#b8a0e7','#81dace','#fff0ca','#8fcdec'];

export function celebrationParticles(width:number,seed:number):CelebrationParticle[] {
  const rand=random(seed),small=width<640,count=small?620:1200,dustCount=small?850:1800;
  const particles:CelebrationParticle[]=[];
  for(let i=0;i<count;i++){
    const hero=i<(small?12:22),ribbon=!hero&&i<(small?26:46);
    const kind=ribbon?'ribbon':hero||rand()>.20?'puzzle':'foil';
    const depth=hero?2:rand()>.37?1:0;
    particles.push({kind,depth,side:i%2===0?1:-1,delay:(i%3)*320+rand()*360,
      size:ribbon?80+rand()*110:hero?70+rand()*42:kind==='foil'?3+rand()*6:13+rand()*23,
      speedX:.12+rand()*.43,speedY:.70+rand()*.23,gravity:.57+rand()*.23,
      rotation:rand()*Math.PI*2,spin:(rand()-.5)*7,phase:rand()*Math.PI*2,
      color:Math.floor(rand()*CELEBRATION_COLORS.length),metallic:ribbon||rand()<.42});
  }
  for(let i=0;i<dustCount;i++){
    particles.push({kind:'dust',depth:rand()>.6?1:0,side:i%2===0?1:-1,delay:rand()*1100,
      size:1.3+rand()*3.2,speedX:.08+rand()*.72,speedY:.40+rand()*.42,gravity:.12+rand()*.12,
      rotation:0,spin:0,phase:rand()*Math.PI*2,color:0,metallic:true});
  }
  return particles.sort((a,b)=>a.depth-b.depth);
}

// Closed-form motion gives the same trajectory at 30, 60 or 120 fps.
export function celebrationFrame(p:CelebrationParticle,elapsed:number,viewport:CelebrationBounds,board:CelebrationBounds){
  const age=(elapsed-p.delay)/1000;
  if(age<0||elapsed>=CELEBRATION_DURATION)return null;
  const dust=p.kind==='dust',drag=dust?1.25:.65,travel=(1-Math.exp(-drag*age))/drag;
  const originX=board.x+board.width*(p.side===1?.06:.94),originY=board.y+board.height*.93;
  const x=originX+p.side*viewport.width*p.speedX*travel+Math.sin(age*3+p.phase)*age*13;
  const verticalTravel=dust?(1-Math.exp(-.7*age))/.7:age;
  const y=originY-viewport.height*p.speedY*verticalTravel+.5*viewport.height*p.gravity*age*age;
  const fade=Math.min(1,Math.max(0,(CELEBRATION_DURATION-elapsed)/750));
  return {x,y,age,alpha:fade*(p.depth===0?.68:1)*(dust?.72+.28*Math.sin(age*3.2+p.phase):1),rotation:p.rotation+p.spin*age,
    flip:Math.cos(age*4+p.phase),size:p.size*Math.max(dust?.65:0,Math.min(1,viewport.width/1050))};
}

export class CompletionGate {
  private seen=false;
  observe(placed:number,total:number,ready:boolean){
    if(!ready||total<=0||placed<total||this.seen)return false;
    this.seen=true;return true;
  }
}
