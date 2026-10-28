import type {MobileChapter,MobileLevel} from '../h5/mobile-api';
import type {Rect} from './ports';
import type {Stage} from './ui';
import {roomRoundPath} from './room-chrome';
import {bundledStory} from './bundled-story';

export type ComicCrop=[number,number,number,number];
export type ComicText={kind:'caption'|'say'|'sfx';at:'tl'|'tr'|'bl'|'br';text:string};
export type ComicPanel={crop:ComicCrop;texts:ComicText[]};
export type Comic={intro:string;panels:ComicPanel[];page?:{src:string;thumbSrc:string;panels:ComicCrop[]}};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
function panelsFrom(value:unknown):ComicPanel[]|null{
 const panels=(value as {panels?:unknown})?.panels;
 if(!Array.isArray(panels)||panels.length!==4)return null;
 if(!panels.every(p=>p&&Array.isArray(p.crop)&&p.crop.length===4&&p.crop.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&p.crop[2]>0&&p.crop[3]>0&&p.crop[0]+p.crop[2]<=1.0001&&p.crop[1]+p.crop[3]<=1.0001&&Array.isArray(p.texts)&&p.texts.every((t:ComicText)=>t&&['caption','say','sfx'].includes(t.kind)&&['tl','tr','bl','br'].includes(t.at)&&typeof t.text==='string')))return null;
 return panels.map(p=>({crop:[...p.crop] as ComicCrop,texts:p.texts.map((t:ComicText)=>({...t}))}));
}
function pageFrom(value:unknown):Comic['page']{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const page=value as {src?:unknown;thumbSrc?:unknown;panels?:unknown};
 if(Object.keys(page).some(key=>!['src','thumbSrc','panels'].includes(key)))return;
 const source=(v:unknown):v is string=>{
  if(typeof v!=='string'||!v||v.length>300||/\s|\.\.|\\/.test(v))return false;
  if(v.startsWith('/'))return !v.startsWith('//');
  try{return v.startsWith('https://')&&new URL(v).protocol==='https:';}catch{return false;}
 };
 if(!source(page.src)||Object.prototype.hasOwnProperty.call(page,'thumbSrc')&&!source(page.thumbSrc)||!Array.isArray(page.panels)||page.panels.length!==4)return;
 const panels=Array.from(page.panels);
 if(!panels.every(crop=>Array.isArray(crop)&&crop.length===4&&Array.from(crop).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&crop[2]>0&&crop[3]>0&&crop[0]+crop[2]<=1.0001&&crop[1]+crop[3]<=1.0001))return;
 return {src:page.src,thumbSrc:typeof page.thumbSrc==='string'?page.thumbSrc:page.src,panels:panels.map(crop=>[...crop] as ComicCrop)};
}
/** Server fields are optional and independently fall back on old servers. */
export function comicFor(chapter:Pick<MobileChapter,'id'|'albumId'>,index:number,level:Pick<MobileLevel,'comic'|'intro'|'comicPage'>):Comic|null{
 const bundled=bundledStory(chapter)?.levels[index];
 const panels=panelsFrom(level.comic)??panelsFrom(bundled?.comic);if(!panels)return null;
 const page=pageFrom(level.comicPage)??pageFrom((bundled as {comicPage?:unknown}|undefined)?.comicPage);
 return {intro:typeof level.intro==='string'&&level.intro.trim()?level.intro:bundled?.intro??'',panels,...(page?{page}:{})};
}
/** Only an already decoded page may replace the level image, and only in landscape. */
export function comicSource(comic:Comic,landscape:boolean,pageReady:boolean,level:{src:string;thumb:string}){
 return landscape&&pageReady&&comic.page?{src:comic.page.src,thumb:comic.page.thumbSrc,crops:comic.page.panels}:{...level,crops:comic.panels.map(panel=>panel.crop)};
}
/** Cover the crop, centred on it; translate the source at image edges. */
export function cropCover(imageW:number,imageH:number,crop:ComicCrop,panel:Pick<Rect,'w'|'h'>):Rect{
 const iw=Math.max(1,imageW),ih=Math.max(1,imageH),cw=clamp(crop[2],.0001,1)*iw,ch=clamp(crop[3],.0001,1)*ih,ratio=Math.max(.0001,panel.w)/Math.max(.0001,panel.h);
 let w=cw,h=ch;if(w/h>ratio)w=h*ratio;else h=w/ratio;
 return {x:clamp((crop[0]+crop[2]/2)*iw-w/2,0,iw-w),y:clamp((crop[1]+crop[3]/2)*ih-h/2,0,ih-h),w,h};
}
/** Reserve the 14px dot strip, then choose the larger capsule-free reading area. */
export function comicPageRect(stage:{w:number;h:number},insets:{top:number;bottom:number},menu?:Rect):Rect{
 const x=8,y=Math.max(0,insets.top)+8,right=stage.w-8,bottom=stage.h-Math.max(0,insets.bottom)-8;
 const available={x,y,w:Math.max(0,right-x),h:Math.max(0,bottom-y)};
 let region=available;
 if(menu&&menu.x<right&&menu.x+menu.w>x&&menu.y<bottom&&menu.y+menu.h>y){
  const belowY=Math.min(bottom,Math.max(y,menu.y+menu.h+8)),leftRight=Math.max(x,Math.min(right,menu.x-8));
  const below={x,y:belowY,w:available.w,h:bottom-belowY},left={x,y,w:leftRight-x,h:available.h};
  region=below.w*below.h>=left.w*left.h?below:left;
 }
 return {...region,h:Math.max(0,region.h-14)};
}
export function comicLayout(page:Rect,landscape=page.w>page.h){
 const gutter=Math.min(10,page.w*.022,page.h*.022),dots={x:page.x,y:page.y+page.h,w:page.w,h:14};
 const inner={x:page.x+gutter,y:page.y+gutter,w:page.w-2*gutter,h:page.h-2*gutter};let panels:Rect[];
 if(landscape){const left=(inner.w-gutter)*.48,right=inner.w-left-gutter,top=(inner.h-gutter)*.46,x=inner.x+left+gutter;
  panels=[{x:inner.x,y:inner.y,w:left,h:inner.h},{x,y:inner.y,w:(right-gutter)/2,h:top},{x:x+(right+gutter)/2,y:inner.y,w:(right-gutter)/2,h:top},{x,y:inner.y+top+gutter,w:right,h:inner.h-top-gutter}];
 }else{const unit=(inner.h-2*gutter)/3;
  panels=[{x:inner.x,y:inner.y,w:inner.w,h:unit},{x:inner.x,y:inner.y+unit+gutter,w:(inner.w-gutter)/2,h:unit},{x:inner.x+(inner.w+gutter)/2,y:inner.y+unit+gutter,w:(inner.w-gutter)/2,h:unit},{x:inner.x,y:inner.y+2*(unit+gutter),w:inner.w,h:unit}];
 }
 return {page,panels,gutter,dots};
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

export type ComicPageState={chapterId:string;levelId:string;index:number;sequence:boolean;fromClear:boolean;started:number;shown:number;returnTo:'completion'|null;ending?:boolean;turn?:{started:number;direction:number}};
export function reducedComicMotion(){return typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;}
export function comicTextCount(comic:Comic){return comic.panels.reduce((n,p)=>n+p.texts.length,0);}
/** Drawing uses a synchronous image painter, so a page never waits for an API. */
export function drawComicPage(s:Stage,state:ComicPageState,comic:Comic,ending:string,paint:(r:Rect,crop:ComicCrop,zoom:number)=>void,now=Date.now(),imageSize:{w:number;h:number}|null=null,pageRect=comicPageRect(s,{top:0,bottom:0})){
 const layout=comicLayout(pageRect,s.w>s.h),{page,panels}=layout,c=s.ctx,reduced=reducedComicMotion(),elapsed=now-state.started,split=state.fromClear&&!reduced&&elapsed<800,t=split?clamp(elapsed/800,0,1):1,ease=t*t*(3-2*t);
 c.fillStyle='#fffdf8';c.fillRect(page.x,page.y,page.w,page.h);
 if(split){c.save();c.globalAlpha*=1-ease;paint(page,[0,0,1,1],1);c.restore();}
 const iw=imageSize?.w??page.w,ih=imageSize?.h??page.h,full=cropCover(iw,ih,[0,0,1,1],page),scale=page.w/full.w;
 let textIndex=0;
 s.clip(page,()=>comic.panels.forEach((panel,index)=>{
  const target=panels[index],source={x:page.x+(panel.crop[0]*iw-full.x)*scale,y:page.y+(panel.crop[1]*ih-full.y)*scale,w:panel.crop[2]*iw*scale,h:panel.crop[3]*ih*scale},r=split?{x:source.x+(target.x-source.x)*ease,y:source.y+(target.y-source.y)*ease,w:source.w+(target.w-source.w)*ease,h:source.h+(target.h-source.h)*ease}:target;
  const fade=reduced||state.fromClear||state.shown>0?1:clamp((elapsed-index*100)/220,0,1);c.save();c.globalAlpha*=split?1:fade;
  paint(r,panel.crop,ease);c.globalAlpha*=split?ease:1;c.lineWidth=2.5;c.strokeStyle='#2a1a1f';c.strokeRect(r.x+1.25,r.y+1.25,r.w-2.5,r.h-2.5);
  for(const text of panel.texts){if(!split&&textIndex<state.shown)drawComicText(s,text,target,index===3?24:0);textIndex++;}
  if(ending&&index===3&&!split&&state.shown>=comicTextCount(comic)){c.fillStyle='#fffdf8';c.fillRect(target.x+2,target.y+target.h-25,target.w-4,23);s.text(ending,target.x+9,target.y+target.h-20,12,'#2a1a1f',800,target.w-18);}
  c.restore();
 }));
 return {page,animating:!reduced&&elapsed<(state.fromClear?800:520)};
}
