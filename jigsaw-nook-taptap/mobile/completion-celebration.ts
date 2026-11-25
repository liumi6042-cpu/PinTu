import type {Rect} from './ports';
import {PAL} from './cheer-icons';

export const CELEBRATION_MAX_PARTICLES=400,COMPLETION_BURST_MS=[900,1150,1400] as const;
type Ink=keyof typeof PAL;
type Streak=Readonly<{angle:number;ring:'outer'|'inner'|'star';tip:Ink;color:Ink;mid:Ink;tail:Ink}>;
type Firework=Readonly<{delay:number;x:number;y:number;radius:number;streaks:readonly Streak[]}>;
type Confetti=Readonly<{kind:'jigsaw'|'foil'|'flower'|'streamer';delay:number;x:number;y:number;speed:number;drift:number;phase:number;spin:number;color:Ink;light:Ink;turn:number}>;
type Dust=Readonly<{delay:number;x:number;y:number}>;
export type CelebrationScene=Readonly<{start:number;end:number;fireworks:readonly Firework[];confetti:readonly Confetti[];stars:readonly Dust[]}>;
type View={picture:Rect;field:Rect;clip?:Rect};
type Context=Pick<CanvasRenderingContext2D,'fillStyle'|'globalAlpha'|'fillRect'|'save'|'restore'> & Partial<Pick<CanvasRenderingContext2D,'getTransform'|'setTransform'>>;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const hash=(seed:number)=>{let h=Math.imul(seed^(seed>>>16),0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);return ((h^(h>>>16))>>>0)/4294967296;};
const JIGSAW=['..oo....','..oo....','hhoooo..','hooooo..','oooooooo','oooooooo','oooooo..','oooooo..'],FLOWER=['...h...','..ooo..','hoooooh','ooocooo','.oocoo.','.oo.oo.','.h...h.'];
function firework(delay:number,x:number,y:number,radius:number,blue:boolean,small=false):Firework{
 const streaks:Streak[]=[],outer=small?16:24,inner=small?10:14,stars=small?4:6;
 for(let i=0;i<outer;i++)streaks.push({angle:i*Math.PI*2/outer,ring:'outer',tip:blue?'W':'R',color:blue?'B':'R',mid:blue?'B':'r',tail:blue?'y':'p'});
 for(let i=0;i<inner;i++)streaks.push({angle:(i+.5)*Math.PI*2/inner,ring:'inner',tip:i%2?'W':'Y',color:i%2?'W':'Y',mid:'Y',tail:'y'});
 for(let i=0;i<stars;i++)streaks.push({angle:(i+.3)*Math.PI*2/stars,ring:'star',tip:'Y',color:'Y',mid:'W',tail:'y'});
 return {delay,x,y,radius,streaks};
}
function confetti(seed:number,small:boolean):Confetti[]{
 const counts=small?[12,10,6,0]:[72,48,32,12],kinds=['jigsaw','foil','flower','streamer'] as const,colors:Ink[]=['R','B','G','P','Y'],lights:Ink[]=['r','W','W','p','y'],flowers:Ink[]=['R','P','W'],ribbons:Ink[]=['R','B','Y'],ribbonLights:Ink[]=['r','W','y'],out:Confetti[]=[];
 for(let k=0;k<counts.length;k++)for(let i=0;i<counts[k];i++){const s=Math.imul(seed,4099)+out.length+1,r=(salt:number)=>hash(s^salt),color=Math.floor(r(0x1b56c4e9)*5),ribbon=Math.floor(r(0x73145)*3),flower=Math.floor(r(0x4321)*3);out.push({kind:kinds[k],delay:Math.floor(r(0x967a889b)*(small?300:1100)),x:r(0x68bc21eb),y:-.02-r(0x02e5be93)*(small?.28:.13),speed:.8+r(0x368cc8b7)*.4,drift:(r(0xa734b)*2-1)*.06,phase:r(0x457)*Math.PI*2,spin:2+r(0xb5297a4d)*4,color:k===2?flowers[flower]:k===3?ribbons[ribbon]:colors[color],light:k===2?flower===0?'r':flower===1?'p':'y':k===3?ribbonLights[ribbon]:lights[color],turn:Math.floor(r(0x789)*4)});}
 return out;
}
// Count the centre pop as well as each independently moving streak/star.
export const celebrationCount=(scene:CelebrationScene)=>scene.fireworks.reduce((n,b)=>n+b.streaks.length+1,0)+scene.confetti.length+scene.stars.length;
function bounded(start:number,duration:number,fireworks:Firework[],pieces:Confetti[],stars:Dust[]):CelebrationScene{
 let remaining=CELEBRATION_MAX_PARTICLES;const bursts:Firework[]=[];for(const burst of fireworks){if(remaining<1)break;const streaks=burst.streaks.slice(0,remaining-1);bursts.push({...burst,streaks});remaining-=streaks.length+1;}const confetti=pieces.slice(0,remaining);remaining-=confetti.length;return {start,end:start+duration,fireworks:bursts,confetti,stars:stars.slice(0,remaining)};
}
export function completionCelebration(start:number):CelebrationScene{
 const centres=[[.14,.2],[.86,.2],[.5,.1]],fireworks=centres.map(([x,y],i)=>firework(COMPLETION_BURST_MS[i]-COMPLETION_BURST_MS[0],x,y,.3,i===1)),stars=Array.from({length:24},(_,i)=>({delay:100+Math.floor(hash(i^0x87a)*1901),x:-.1+hash(i^0x51b)*1.2,y:-.1+hash(i^0x631)*1.1}));return bounded(start,2300,fireworks,confetti(12345,false),stars);
}
export function popperCelebration(start:number,seed:number):CelebrationScene{return bounded(start,1600,[firework(0,.3+hash(seed^0x68bc21eb)*.4,.2+hash(seed^0x02e5be93)*.25,.34,!!(seed&1),true)],confetti(seed,true),[]);}
export function drawCelebration(ctx:Context,scene:CelebrationScene,now:number,view:View){
 const elapsed=now-scene.start;if(elapsed<0||now>=scene.end||view.picture.w<=0||view.picture.h<=0||view.field.w<=0||view.field.h<=0)return 0;
 const {picture:p,field:f}=view,clip=view.clip??f,u=clamp(Math.round(Math.min(p.w,p.h)/150),2,4),matrix=ctx.getTransform?.(),device=!!(matrix&&matrix.b===0&&matrix.c===0&&matrix.a>0&&matrix.d>0&&ctx.setTransform),a=device?matrix!.a:1,d=device?matrix!.d:1,e=device?matrix!.e:0,fy=device?matrix!.f:0,cell=device?Math.max(1,Math.round(u*a)):u,alpha=ctx.globalAlpha,fade=clamp((scene.end-now)/500,0,1);let drawn=0,calls=0,ink:Ink|null=null;
 ctx.save();try{if(device)ctx.setTransform!(1,0,0,1,0,0);
 // Snap each sprite's origin once, then step whole cells, so u·DPR rounding cannot open gaps inside a sprite.
 const snap=(x:number,y:number)=>[Math.round((a*x+e)/cell),Math.round((d*y+fy)/cell)] as const;
 const cells=(ix:number,iy:number,color:Ink,w=1,h=1)=>{if(color!==ink){ctx.fillStyle=PAL[color];ink=color;}ctx.fillRect(ix*cell,iy*cell,w*cell,h*cell);calls++;};
 const star=(x:number,y:number,size:number)=>{const [ix,iy]=snap(x,y);cells(ix,iy,'W');for(let j=1;j<size;j++){cells(ix-j,iy,'Y');cells(ix+j,iy,'Y');cells(ix,iy-j,'Y');cells(ix,iy+j,'Y');}};
 const bitmap=(grid:readonly string[],x:number,y:number,color:Ink,light:Ink,turn:number,squash=1)=>{const n=grid.length,height=squash<.22?1:squash<.65?Math.ceil(n/2):n,[ox,oy]=snap(x-n*u/2,y-height*u/2);for(let row=0;row<height;row++){const sy=height===1?Math.floor(n/2):height<n?row*2:row;let run:Ink|null=null,begin=0;for(let col=0;col<=n;col++){let ink:Ink|null=null;if(col<n){let ix=col,iy=sy;for(let j=0;j<turn;j++){const old=ix;ix=iy;iy=n-1-old;}const v=grid[iy]?.[ix];ink=v==='o'?color:v==='h'?light:v==='c'?'Y':null;}if(ink!==run){if(run)cells(ox+begin,oy+row,run,col-begin);run=ink;begin=col;}}}};
 for(const burst of scene.fireworks){const t=elapsed-burst.delay;if(t<0||t>=1200)continue;const r=Math.max(16*u,burst.radius*Math.min(p.w,p.h)),centre=(v:number,lo:number,length:number)=>clamp(v,lo+Math.min(length/2,r/2),lo+length-Math.min(length/2,r/2)),cx=centre(p.x+p.w*burst.x,clip.x,clip.w),cy=centre(p.y+p.h*burst.y,clip.y,clip.h),radius=r*(1-Math.exp(-t/150)),droop=.4*r*(t/1200)**2,opacity=t<=650?1:(1200-t)/550,thick=opacity>.5?2:1;ctx.globalAlpha=alpha*opacity*fade;
  if(t<160){const before=calls;star(cx,cy+droop,1+Math.floor(t/80));if(calls>before)drawn++;}
  for(const [i,s] of burst.streaks.entries()){if(t>650&&(Math.floor(t/50)+i)%4===0)continue;const before=calls,scale=s.ring==='inner'?.55:s.ring==='star'?1.2:1,x=cx+Math.cos(s.angle)*radius*scale,y=cy+Math.sin(s.angle)*radius*scale+droop;if(s.ring==='star')star(x,y,2);else{const trail=(s.ring==='inner'?.5:.55)*(t<650?1:Math.max(.2,opacity)),n=Math.max(1,Math.round(radius*scale*trail/u)),[ix,iy]=snap(x,y),cos=Math.cos(s.angle),sin=Math.sin(s.angle);for(let j=n-1;j>=0;j--){const q=j/n,size=q<.35?thick:1;cells(ix-Math.round(cos*j),iy-Math.round(sin*j),j===0?s.tip:q<.35?s.color:q<.7?s.mid:s.tail,size,size);}}if(calls>before)drawn++;}
 }
 ctx.globalAlpha=alpha*fade;
 for(const piece of scene.confetti){const age=(elapsed-piece.delay)/1000;if(age<0)continue;const slow=piece.kind==='flower'||piece.kind==='streamer',k=2.6,travel=(1-Math.exp(-k*age))/k,terminal=(slow?.25:.34)*piece.speed,vertical=terminal*age+(.95*piece.speed-terminal)*travel,x=f.x+f.w*(piece.x+piece.drift*travel+Math.sin(age*(slow?3.8:3)+piece.phase)*(slow?.035:.012)),y=f.y+f.h*(piece.y+vertical);if(y-8*u>f.y+f.h||y+8*u<f.y||x+8*u<clip.x||x-8*u>clip.x+clip.w)continue;const before=calls,flip=Math.cos(age*piece.spin+piece.phase),abs=Math.abs(flip),turn=(piece.turn+Math.floor(age*1.5))%4;
  if(piece.kind==='jigsaw')bitmap(JIGSAW,x,y,piece.color,piece.light,turn,abs);
  else if(piece.kind==='flower')bitmap(FLOWER,x,y,piece.color,piece.light,turn);
  else if(piece.kind==='foil'){const front=flip>0,width=abs<.25?1:2,[ix,iy]=snap(x-width*u/2,y-2*u);for(let row=0;row<5;row++)cells(ix,iy+row,front&&width===2?row===0?'y':'Y':'g',width);if(front&&abs>.92)cells(ix+width-1,iy+1,'W');}
  else{const [ix,iy]=snap(x,y-7*u);for(let j=0;j<14;j++)cells(ix+Math.round(Math.sin(j*.65-age*7+piece.phase)*2),iy+j,Math.floor(j/2)%2?piece.light:piece.color);}
  if(calls>before)drawn++;
 }
 for(const dust of scene.stars){const t=elapsed-dust.delay;if(t<0||t>=450)continue;star(p.x+p.w*dust.x,p.y+p.h*dust.y,[1,2,3,2,1][Math.min(4,Math.floor(t/90))]);drawn++;}
 }finally{ctx.restore();ctx.globalAlpha=alpha;}return drawn;
}
