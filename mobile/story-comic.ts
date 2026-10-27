import type {MobileChapter,MobileLevel} from '../h5/mobile-api';
import type {Rect} from './ports';
import type {Stage} from './ui';
import {roomRoundPath} from './room-chrome';
import story from './story-comics-ch1.json';

export type ComicCrop=[number,number,number,number];
export type ComicText={kind:'caption'|'say'|'sfx';at:'tl'|'tr'|'bl'|'br';text:string};
export type ComicPanel={crop:ComicCrop;texts:ComicText[]};
export type Comic={intro:string;panels:ComicPanel[]};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
function panelsFrom(value:unknown):ComicPanel[]|null{
 const panels=(value as {panels?:unknown})?.panels;
 if(!Array.isArray(panels)||panels.length!==4)return null;
 if(!panels.every(p=>p&&Array.isArray(p.crop)&&p.crop.length===4&&p.crop.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&p.crop[2]>0&&p.crop[3]>0&&p.crop[0]+p.crop[2]<=1.0001&&p.crop[1]+p.crop[3]<=1.0001&&Array.isArray(p.texts)&&p.texts.every((t:ComicText)=>t&&['caption','say','sfx'].includes(t.kind)&&['tl','tr','bl','br'].includes(t.at)&&typeof t.text==='string')))return null;
 return panels.map(p=>({crop:[...p.crop] as ComicCrop,texts:p.texts.map((t:ComicText)=>({...t}))}));
}
/** Server fields are optional and independently fall back on old servers. */
export function comicFor(chapter:Pick<MobileChapter,'id'|'albumId'>,index:number,level:Pick<MobileLevel,'comic'|'intro'>):Comic|null{
 const bundled=chapter.id==='ch1'||chapter.albumId===story.chapter?story.levels[index]:undefined;
 const panels=panelsFrom(level.comic)??panelsFrom(bundled?.comic);if(!panels)return null;
 return {intro:typeof level.intro==='string'&&level.intro.trim()?level.intro:bundled?.intro??'',panels};
}
/** Cover the crop, centred on it; translate the source at image edges. */
export function cropCover(imageW:number,imageH:number,crop:ComicCrop,panel:Pick<Rect,'w'|'h'>):Rect{
 const iw=Math.max(1,imageW),ih=Math.max(1,imageH),cw=clamp(crop[2],.0001,1)*iw,ch=clamp(crop[3],.0001,1)*ih,ratio=Math.max(.0001,panel.w)/Math.max(.0001,panel.h);
 let w=cw,h=ch;if(w/h>ratio)w=h*ratio;else h=w/ratio;
 return {x:clamp((crop[0]+crop[2]/2)*iw-w/2,0,iw-w),y:clamp((crop[1]+crop[3]/2)*ih-h/2,0,ih-h),w,h};
}
export function comicLayout(stageW:number,stageH:number,landscape:boolean){
 const gutter=Math.min(10,stageW*.022,stageH*.022),page:Rect={x:44,y:56,w:stageW-88,h:stageH-144};
 const inner={x:page.x+gutter,y:page.y+gutter,w:page.w-2*gutter,h:page.h-2*gutter};let panels:Rect[];
 if(landscape){const left=(inner.w-gutter)*.48,right=inner.w-left-gutter,top=(inner.h-gutter)*.46,x=inner.x+left+gutter;
  panels=[{x:inner.x,y:inner.y,w:left,h:inner.h},{x,y:inner.y,w:(right-gutter)/2,h:top},{x:x+(right+gutter)/2,y:inner.y,w:(right-gutter)/2,h:top},{x,y:inner.y+top+gutter,w:right,h:inner.h-top-gutter}];
 }else{const unit=(inner.h-2*gutter)/3;
  panels=[{x:inner.x,y:inner.y,w:inner.w,h:unit},{x:inner.x,y:inner.y+unit+gutter,w:(inner.w-gutter)/2,h:unit},{x:inner.x+(inner.w+gutter)/2,y:inner.y+unit+gutter,w:(inner.w-gutter)/2,h:unit},{x:inner.x,y:inner.y+2*(unit+gutter),w:inner.w,h:unit}];
 }
 return {page,panels,gutter};
}
/** Closing punctuation travels with the preceding glyph, as on the timeline. */
export function comicLines(text:string,width:number,measure:(text:string)=>number):string[]{
 const rows:string[]=[];for(const paragraph of text.split('\n')){const chars=[...paragraph];if(!chars.length){rows.push('');continue;}
  while(chars.length){let n=1;while(n<chars.length&&measure(chars.slice(0,n+1).join(''))<=width)n++;
   while(n>1&&n<chars.length&&/[。，、！？；：…）」』”’]/.test(chars[n]))n--;
   // Extremely narrow boxes still keep a closing mark attached to its glyph.
   if(n===1)while(n<chars.length&&/[。，、！？；：…）」』”’]/.test(chars[n]))n++;
   rows.push(chars.splice(0,n).join(''));
  }
 }return rows;
}
export function drawComicText(s:Stage,item:ComicText,panel:Rect,reserveBottom=0){
 const c=s.ctx,pad=7,availableW=panel.w-pad*2,availableH=panel.h-pad*2-reserveBottom;
 let size=item.kind==='sfx'?20:14,rows:string[]=[],width=availableW;
 // Fit complete copy in the box instead of truncating dialogue.
 for(;;){width=Math.min(availableW,Math.max(60,panel.w*(item.kind==='sfx'?.62:.86)));rows=comicLines(item.text,width-16,t=>s.measure(t,size,700));if(rows.length*(size+3)+12<=availableH||size<=7)break;size--;}
 const w=Math.min(width,Math.max(...rows.map(t=>s.measure(t,size,700)),1)+16),h=Math.min(availableH,rows.length*(size+3)+12),right=item.at.endsWith('r'),bottom=item.at.startsWith('b'),r={x:right?panel.x+panel.w-pad-w:panel.x+pad,y:bottom?panel.y+panel.h-pad-reserveBottom-h:panel.y+pad,w,h};
 s.clip(panel,()=>{c.save();c.strokeStyle='#2a1a1f';c.lineWidth=1.7;
  if(item.kind==='sfx'){c.translate(r.x+r.w/2,r.y+r.h/2);c.rotate(right?.055:-.055);c.translate(-r.x-r.w/2,-r.y-r.h/2);}
  else{c.fillStyle=item.kind==='caption'?'#fff4cf':'#ffffff';if(item.kind==='say')roomRoundPath(c,r,9);else{c.beginPath();c.rect(r.x,r.y,r.w,r.h);}c.fill();c.stroke();
   if(item.kind==='say'){const y=bottom?r.y:r.y+r.h,dir=bottom?-1:1,x=right?r.x+12:r.x+r.w-20;c.beginPath();c.moveTo(x,y);c.lineTo(x+(right?-6:14),y+dir*6);c.lineTo(x+9,y);c.fill();c.stroke();}
  }
  rows.forEach((line,index)=>{const x=r.x+8,y=r.y+6+index*(size+3);if(item.kind==='sfx'){c.font=`900 ${size}px ${s.font}`;c.textBaseline='top';c.strokeStyle='#fffdf8';c.lineWidth=3;c.strokeText(line,x,y);}s.text(line,x,y,size,item.kind==='sfx'?'#a85567':'#2a1a1f',item.kind==='sfx'?900:700);});c.restore();
 });
}

export type ComicPageState={levelId:string;index:number;sequence:boolean;fromClear:boolean;started:number;shown:number;returnTo:'completion'|null;ending?:boolean;turn?:{started:number;direction:number}};
export function reducedComicMotion(){return typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;}
export function comicTextCount(comic:Comic){return comic.panels.reduce((n,p)=>n+p.texts.length,0);}
/** Drawing uses a synchronous image painter, so a page never waits for an API. */
export function drawComicPage(s:Stage,state:ComicPageState,comic:Comic,ending:string,paint:(r:Rect,crop:ComicCrop,zoom:number)=>void,now=Date.now(),imageSize:{w:number;h:number}|null=null){
 const layout=comicLayout(s.w,s.h,s.w>s.h),{page,panels}=layout,c=s.ctx,reduced=reducedComicMotion(),elapsed=now-state.started,split=state.fromClear&&!reduced&&elapsed<800,t=split?clamp(elapsed/800,0,1):1,ease=t*t*(3-2*t);
 c.fillStyle='#fffdf8';c.fillRect(page.x,page.y,page.w,page.h);
 if(split){c.save();c.globalAlpha=1-ease;paint(page,[0,0,1,1],1);c.restore();}
 const iw=imageSize?.w??page.w,ih=imageSize?.h??page.h,full=cropCover(iw,ih,[0,0,1,1],page),scale=page.w/full.w;
 let textIndex=0;
 s.clip(page,()=>comic.panels.forEach((panel,index)=>{
  const target=panels[index],source={x:page.x+(panel.crop[0]*iw-full.x)*scale,y:page.y+(panel.crop[1]*ih-full.y)*scale,w:panel.crop[2]*iw*scale,h:panel.crop[3]*ih*scale},r=split?{x:source.x+(target.x-source.x)*ease,y:source.y+(target.y-source.y)*ease,w:source.w+(target.w-source.w)*ease,h:source.h+(target.h-source.h)*ease}:target;
  const fade=reduced||state.fromClear||state.shown>0?1:clamp((elapsed-index*100)/220,0,1);c.save();c.globalAlpha=split?1:fade;
  paint(r,panel.crop,ease);c.globalAlpha*=split?ease:1;c.lineWidth=2.5;c.strokeStyle='#2a1a1f';c.strokeRect(r.x+1.25,r.y+1.25,r.w-2.5,r.h-2.5);
  for(const text of panel.texts){if(!split&&textIndex<state.shown)drawComicText(s,text,target,index===3?24:0);textIndex++;}
  if(ending&&index===3&&!split&&state.shown>=comicTextCount(comic)){c.fillStyle='#fffdf8';c.fillRect(target.x+2,target.y+target.h-25,target.w-4,23);s.text(ending,target.x+9,target.y+target.h-20,12,'#2a1a1f',800,target.w-18);}
  c.restore();
 }));
 return {page,animating:!reduced&&elapsed<(state.fromClear?800:520)};
}
