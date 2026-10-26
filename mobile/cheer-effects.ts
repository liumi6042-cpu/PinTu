import type {Cheer,CheerEmote} from '../lib/room-realtime';

export type CheerBubble={playerId:string;emote:CheerEmote;own:boolean;count:number;born:number;updated:number};
export type CheerParticle={kind:'confetti'|'heart';playerId:string;start:number;duration:number;x:number;y:number;spin:number;color:number};
export class CheerEffects{
 bubbles:CheerBubble[]=[];
 particles:CheerParticle[]=[];
 hops=new Map<string,number>();
 starsUntil=0;
 tea:{start:number;players:string[]}|null=null;
 combo:{start:number;count:number;key:string}|null=null;
 private recent:{playerId:string;at:number}[]=[];
 private cups:{playerId:string;at:number}[]=[];
 private seed=0;
 private readonly now:()=>number;
 constructor(now:()=>number=Date.now){this.now=now;}
 clear(){this.bubbles=[];this.particles=[];this.hops.clear();this.starsUntil=0;this.tea=null;this.combo=null;this.recent=[];this.cups=[];}
 private burst(n:number,kind:CheerParticle['kind'],playerId:string,at:number){
  for(let i=0;i<n;i++){const seed=++this.seed;this.particles.push({kind,playerId,start:at,duration:kind==='heart'?1600:2000,x:(seed*.61803398875)%1,y:(seed*seed*.41421356237)%1,spin:seed%7,color:seed%6});}
  this.particles=this.particles.slice(-180);
 }
 receive(cheer:Cheer,own=false){
  const at=this.now();this.update(at);
  const bubble=this.bubbles.find(item=>item.playerId===cheer.playerId&&item.emote===cheer.emote&&at-item.updated<=2500);
  if(bubble){bubble.count++;bubble.updated=at;bubble.own ||= own;}else this.bubbles.push({playerId:cheer.playerId,emote:cheer.emote,own,count:1,born:at,updated:at});
  this.bubbles=this.bubbles.slice(-60);this.hops.set(cheer.playerId,at);
  if(cheer.emote==='popper')this.burst(60,'confetti',cheer.playerId,at);
  if(cheer.emote==='heart')this.burst(3,'heart',cheer.playerId,at);
  if(cheer.emote==='star')this.starsUntil=at+1200;
  if(cheer.emote==='tea'){
   const partner=this.cups.find(item=>item.playerId!==cheer.playerId);
   if(partner){this.tea={start:at,players:[partner.playerId,cheer.playerId]};this.cups=[];}
   else this.cups=[{playerId:cheer.playerId,at}];
  }
  this.recent.push({playerId:cheer.playerId,at});
  const players=[...new Set(this.recent.map(item=>item.playerId))].sort(),key=players.join('|');
  if(players.length>=3&&this.combo?.key!==key){const starting=!this.combo;this.combo={start:at,count:players.length,key};if(starting)this.burst(60,'confetti',cheer.playerId,at);}
 }
 update(at=this.now()){
  this.bubbles=this.bubbles.filter(item=>at-item.updated<2700);
  this.particles=this.particles.filter(item=>at-item.start<item.duration);
  for(const [id,start] of this.hops)if(at-start>=300)this.hops.delete(id);
  this.recent=this.recent.filter(item=>at-item.at<=3000);
  this.cups=this.cups.filter(item=>at-item.at<=2000);
  if(this.tea&&at-this.tea.start>=1000)this.tea=null;
  if(this.combo&&at-this.combo.start>=2000)this.combo=null;
 }
 alive(at=this.now()){this.update(at);return !!(this.bubbles.length||this.particles.length||this.hops.size||at<this.starsUntil||this.tea||this.combo);}
 bubbleAlpha(bubble:CheerBubble,at=this.now()){return Math.max(0,Math.min(1,(2700-(at-bubble.updated))/300));}
 bubbleScale(bubble:CheerBubble,at=this.now()){return Math.min(1,Math.max(0,(at-bubble.born)/120));}
 hop(playerId:string,at=this.now()){const start=this.hops.get(playerId);return start===undefined?0:-4*Math.sin(Math.PI*Math.min(1,(at-start)/300));}
 pressed(emote:CheerEmote,at=this.now()){return this.bubbles.some(item=>item.own&&item.emote===emote&&at-item.updated<150);}
 count(emote:CheerEmote){return [...this.bubbles].reverse().find(item=>item.own&&item.emote===emote)?.count??0;}
}
