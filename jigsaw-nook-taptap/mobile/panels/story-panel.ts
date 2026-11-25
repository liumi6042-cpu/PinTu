import type {Input,Rect} from '../ports';
import {timeLabelFor,nodeState} from '../story-timeline';
import {comicFor,comicSource,comicCloseRect,comicPageRect,comicLayout,comicTextCount,drawComicPage,drawComicText,reducedComicMotion} from '../story-comic';
import {roomRoundPath} from '../room-chrome';
import {RoomClient,type RoomTicket} from '../../lib/room-client';
import {otherPlayersPresent} from '../../lib/solo-play';
import {storyVariantFor,variantIntroKey,variantIntroSentence,type StoryVariant} from '../story-variants';
import {type AppHost,clamp,inside} from './shared';

export function drawChapterPanel(this:AppHost,chapter=this.selectedChapter,view=this.storyView){
  if(!chapter){this.stage.text('小窝的故事',20,this.bodyTop+12,24,this.colors.ink,800,this.stage.w-40);this.stage.text('故事暂未开放，请稍后再来看看',20,this.bodyTop+54,14,this.colors.muted,600,this.stage.w-40);this.extent=0;return;}
  this.syncComicClear(chapter);
  const s=this.stage,ctx=s.ctx,portrait=this.layout==='phonePortrait',width=Math.min(1400,s.w-24),left=(s.w-width)/2,top=this.bodyTop,bottom=this.bodyBottom;
  const current=chapter.levels.find(level=>level.status==='unlocked'),cleared=chapter.levels.filter(level=>level.status==='cleared').length,total=chapter.levels.length,complete=total>0&&cleared===total,number=(view?.chapters.indexOf(chapter)??0)+1;
  const description='拼完一格，故事就往下走一格。'+(this.energyEnabled?'每格第一次拼完送 '+(view?.firstClearEnergy??0)+' 体力。':'');
  const mainLabel=complete?'从头看':current?'拼第 '+(chapter.levels.indexOf(current)+1)+' 格（'+current.pieces+' 片）':'暂未解锁';
  const mainAction=()=>{if(complete)this.openLevelComic(chapter.levels[0].id,{sequence:true});else if(current)void this.launch({mode:'level',levelId:current.id});};
  const progressWidth=portrait?width:Math.min(172,width*.26),chapterSwitch={x:left+width-progressWidth-128,y:top,w:120,h:40};
  const heading=(y:number)=>{
   const textWidth=portrait?width:chapterSwitch.x-left-12;
   s.text('小窝的故事',left,y,24,this.colors.ink,800,textWidth);
   const chapters=view?.chapters.filter(item=>item.status==='available')??[],switching=chapters.length>=2;
   s.text('第 '+number+' 章 · '+chapter.title,left,y+28,12,this.colors.muted,700,portrait&&switching?textWidth-80:textWidth);
   if(switching){
    const selected=chapters.findIndex(item=>item.id===chapter.id),x=portrait?left+width-72:chapterSwitch.x+24,sy=portrait?y+20:y+4;
    [-1,1].forEach((direction,index)=>{const r={x:x+index*40,y:sy,w:32,h:32},disabled=selected+direction<0||selected+direction>=chapters.length;
     const action=()=>{if(disabled)return;this.storyChapterId=chapters[selected+direction].id;this.scroll=0;this.invalidate();};
     s.hit(r,()=>{});ctx.save();if(disabled)ctx.globalAlpha=.35;s.button(r,index?'›':'‹',action,{disabled,fontSize:24});ctx.restore();
    });
   }
   const x=portrait?left:left+width-progressWidth,py=portrait?y+54:y;
   s.text(cleared+' / '+total+' 格',x,py,14,this.colors.ink,700,172);
   s.meter({x,y:py+23,w:progressWidth,h:6},total?cleared/total:0);
  };
  const fit=(value:string,width:number,size:number,weight=600)=>{if(s.measure(value,size,weight)<=width)return value;let text=value;while(text.length&&s.measure(text+'…',size,weight)>width)text=text.slice(0,-1);return text+'…';};
  const bubble=(line:string,r:Rect)=>{
   // Wrap at most once. Move closing punctuation with the previous character.
   const size=!portrait&&r.h<64?10:11,rowHeight=size+4,room=r.w-32,chars=[...line];let count=0;while(count<chars.length&&s.measure(chars.slice(0,count+1).join(''),size,600)<=room)count++;
   while(count>1&&count<chars.length&&/[。，、！？；：…）」』”’]/.test(chars[count]))count--;count=Math.max(1,count);
   const rows=(!portrait&&r.h<64?[line]:count<chars.length?[chars.slice(0,count).join(''),chars.slice(count).join('')]:[line]).map(row=>portrait?row:fit(row,room,size)),bw=Math.min(r.w-16,Math.max(...rows.map(row=>s.measure(row,size,600)))+18),bh=!portrait&&r.h<64?size+10:rows.length*rowHeight+10,bx=r.x+r.w-bw-8,by=r.y+r.h-bh-7;
   ctx.save();ctx.fillStyle=this.colors.cream;ctx.strokeStyle=this.colors.ink;ctx.lineWidth=2;roomRoundPath(ctx,{x:bx,y:by,w:bw,h:bh},7);ctx.fill();ctx.stroke();ctx.restore();
   rows.forEach((row,index)=>s.text(row,bx+8,by+5+index*rowHeight,size,this.colors.ink,600,bw-16));
  };
  const card=(index:number,r:Rect)=>{
   const level=chapter.levels[index],state=nodeState(level,current),done=state==='cleared',active=state==='current',src=this.levelPicture(level).src;
   ctx.save();ctx.fillStyle=done?this.colors.placeholder:this.colors.cream;ctx.fillRect(r.x,r.y,r.w,r.h);ctx.restore();
   if(src&&done)s.clip(r,()=>s.image(this.client.asset(src),r,'cover'));
   ctx.save();ctx.strokeStyle=active?'#cf9f52':done?this.colors.ink:'#b88f84';ctx.lineWidth=active?3:2;if(state==='locked')ctx.setLineDash?.([6,4]);ctx.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);ctx.restore();
   if(done){
    const badge=!portrait&&r.h<64?14:22;ctx.save();ctx.fillStyle=this.colors.ink;ctx.fillRect(r.x+3,r.y+3,badge,badge);ctx.restore();s.text(index+1,r.x+(badge===14?6:9),r.y+(badge===14?5:7),badge===14?9:12,this.colors.cream,800,badge-4);
    if(level.line&&!portrait)bubble(level.line,r);
    s.hit(r,()=>this.openLevelComic(level.id));
   }else if(active){
    const compact=!portrait&&r.h<72,size=portrait?16:compact?10:12,label=portrait?'第 '+(index+1)+' 格 · '+level.pieces+' 片':fit('第 '+(index+1)+' 格 · '+level.pieces+' 片',r.w-12,size,800),hint='拼完解锁这一页',hintSize=compact?9:11,cx=r.x+r.w/2,cy=r.y+r.h/2;
    if(!compact){ctx.save();ctx.fillStyle='#cf9f52';ctx.beginPath();ctx.moveTo(cx-5,cy-29);ctx.lineTo(cx-5,cy-15);ctx.lineTo(cx+7,cy-22);ctx.closePath();ctx.fill();ctx.restore();}
    s.text(label,cx-s.measure(label,size,800)/2,cy-(compact?12:8),size,this.colors.ink,800,r.w-12);
    const hintText=portrait?hint:fit(hint,r.w-12,hintSize);s.text(hintText,cx-s.measure(hintText,hintSize,portrait?500:600)/2,cy+(compact?5:15),hintSize,this.colors.muted,600,r.w-12);
    s.hit(r,()=>{if(!this.busy&&(this.client.profile||this.offline?.active))void this.launch({mode:'level',levelId:level.id});});
   }else{const raw=timeLabelFor(chapter,index,level)??'第 '+(index+1)+' 格',label=portrait?raw:fit(raw,r.w-40,12,700),w=s.measure(label,12,700),x=r.x+(r.w-w-28)/2;
    s.icon('lock',{x,y:r.y+(r.h-18)/2,w:18,h:18},this.colors.muted);s.text(label,x+28,r.y+(r.h-12)/2,12,this.colors.muted,700,r.w-40);
    s.hit(r,()=>this.note('先拼完前面的格子，就能解锁这里'));
   }
  };
  const node=(index:number,x:number,y:number)=>{
   const state=nodeState(chapter.levels[index],current),radius=state==='current'?13:11;
   ctx.save();ctx.lineWidth=2;ctx.strokeStyle=state==='current'?'#cf9f52':state==='cleared'?'#a85567':'#b88f84';
   if(state==='locked')ctx.setLineDash?.([3,3]);
   if(state==='current'){ctx.shadowColor='#cf9f52';ctx.shadowBlur=12;}
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
   if(state!=='locked'){ctx.fillStyle=state==='cleared'?'#a85567':this.colors.onAccent;ctx.fill();}if(state!=='cleared')ctx.stroke();
   if(state==='cleared'){ctx.strokeStyle=this.colors.onAccent;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x-5,y);ctx.lineTo(x-1,y+4);ctx.lineTo(x+6,y-4);ctx.stroke();}ctx.restore();
  };
  const track=(points:{x:number;y:number}[])=>{
   if(!points.length)return;const first=points[0],last=points[points.length-1],r=portrait?{x:first.x-3,y:first.y,w:6,h:Math.max(6,last.y-first.y)}:{x:first.x,y:first.y-3,w:Math.max(6,last.x-first.x),h:6};
   ctx.save();const gradient=ctx.createLinearGradient(first.x,first.y,last.x,last.y);
   ['#f3c7a0','#9cc9e6','#f0cf6e','#eba965','#d4776c','#3d4170'].forEach((color,index)=>gradient.addColorStop(index/5,color));
   roomRoundPath(ctx,r,3);ctx.fillStyle=gradient;ctx.fill();
   const active=current?chapter.levels.indexOf(current):complete?total-1:Math.max(0,chapter.levels.findIndex(level=>level.status!=='cleared')),point=points[active];
   if(point&&active<total-1){s.clip(r,()=>{ctx.fillStyle='rgba(251,243,232,.62)';if(portrait)ctx.fillRect(r.x,point.y,r.w,last.y-point.y);else ctx.fillRect(point.x,r.y,last.x-point.x,r.h);});}ctx.restore();
  };
  if(portrait){
   let y=top-this.scroll;const start=y;this.scrolled(()=>{
    heading(y);y+=98;
    const rows=chapter.levels.map((level,index)=>{const state=nodeState(level,current),h=state==='cleared'?92:state==='current'?128:46,r={x:left+38,y,w:width-38,h},point={x:left+14,y:y+h/2};y+=h+12;return {index,state,r,point};});
    track(rows.map(row=>row.point));
    for(const {index,state,r,point}of rows){
     const level=chapter.levels[index],label=timeLabelFor(chapter,index,level),meta=(label?label+' · ':'')+level.pieces+' 片';node(index,point.x,point.y);
     if(state==='cleared'){
      card(index,{x:r.x,y:r.y,w:116,h:76});const text={x:r.x+128,y:r.y+28,w:r.w-128,h:56};
      s.text(meta,text.x,r.y+2,12,this.colors.muted,700,text.w);if(level.line)bubble(level.line,text);
     }else{card(index,r);}
    }
    y=this.paragraph(description,left,y+6,width,13)+14;
    s.button({x:left,y,w:width,h:52},mainLabel,mainAction,{tone:'berrydark',fontSize:14,disabled:this.busy||(!this.client.profile&&!this.offline?.active)||(!current&&!complete)});y+=62;
    if(!this.offline?.active||this.ready){s.button({x:left,y,w:width,h:44},'去大厅逛逛',()=>this.navigate('lobby'),{fontSize:13});y+=56;}
   });this.extent=y-start;
  }else{
   // Alternating cards share horizontal space. Keep both rows visible without scrolling.
   this.scroll=0;this.extent=0;heading(top);
   // Reserve title/footer first. The 34px rail band includes the largest node.
   // A 36px gap between same-row cards also leaves a readable metadata slot.
   const headingBottom=top+40,railBand=34,minHeight=44,buttonH=26,stacked=bottom-headingBottom-16-42>=minHeight*2+railBand,footerTop=bottom-(stacked?42:buttonH),railTop=headingBottom+8,railBottom=footerTop-8;
   const heightLimit=Math.max(0,(railBottom-railTop-railBand)/2),widthLimit=total>1?(2*width-36*(total-1))/(total+1):width;
   // For an exceptionally small host, bounds win over the preferred 44px minimum.
   const ch=Math.min(92,heightLimit,Math.max(0,widthLimit)*92/168),cw=ch*168/92,cy=(railTop+railBottom)/2;
   const points=chapter.levels.map((_,index)=>({x:left+cw/2+(width-cw)*index/Math.max(1,total-1),y:cy}));track(points);
   chapter.levels.forEach((level,index)=>{
    const point=points[index],above=index%2===0,r={x:clamp(point.x-cw/2,left,left+width-cw),y:above?cy-railBand/2-ch:cy+railBand/2,w:cw,h:ch};card(index,r);node(index,point.x,point.y);
    const step=total>1?(width-cw)/(total-1):width,mw=Math.max(1,Math.min(80,total>1?2*step-cw-8:width,2*(point.x-left),2*(left+width-point.x))),label=timeLabelFor(chapter,index,level),size=Math.min(11,Math.max(8,mw/4)),rows=label&&ch>=44?[label,level.pieces+' 片']:[label??level.pieces+' 片'],metaH=rows.length*size+(rows.length-1)*4,my=above?cy+railBand/2+4:cy-railBand/2-4-metaH;
    rows.forEach((value,row)=>{const text=fit(value,mw,size,700);s.text(text,point.x-s.measure(text,size,700)/2,my+row*(size+4),size,this.colors.muted,700,mw);});
   });
   const showLobby=!this.offline?.active||this.ready,count=showLobby?2:1,bw=Math.min(stacked?240:132,(width-12)/2),by=bottom-buttonH,descriptionWidth=stacked?width:width-count*(bw+12),footerText=s.measure(description,10,500)<=descriptionWidth?description:'拼完一格，故事往下走一格';
   s.text(fit(footerText,descriptionWidth,10,500),left,stacked?footerTop:by+8,10,this.colors.muted,500,descriptionWidth);
   if(!this.offline?.active||this.ready)s.button({x:left+width-bw*2-12,y:by,w:bw,h:26},'去大厅逛逛',()=>this.navigate('lobby'),{fontSize:12});
   s.button({x:left+width-bw,y:by,w:bw,h:26},mainLabel,mainAction,{tone:'berrydark',fontSize:13,disabled:this.busy||(!this.client.profile&&!this.offline?.active)||(!current&&!complete)});
   return {chapterSwitch,cardSize:{w:cw,h:ch}};
  }
 }

export function openLevelComicPanel(this:AppHost,levelId:string,options:{sequence?:boolean;fromClear?:boolean}={}){
  const chapter=this.chapterForLevel(levelId);if(!chapter)return;this.syncComicClear(chapter);
  const index=options.sequence?0:chapter.levels.findIndex(level=>level.id===levelId),level=chapter.levels[index];
  if(!level||index<0||index>=this.comicLimit(chapter))return;
  const returnTo=this.modal==='completion'?'completion':this.modal==='levelComic'?this.comicPage?.returnTo??null:null,comic=comicFor(chapter,index,level)!;
  this.preloadComicPage(comic);
  this.stopStoryFrame();this.comicClosePress=null;this.comicGesture=null;this.comicDrag=0;this.comicSnap=undefined;this.comicHintUntil=0;
  if(!this.comicHintSeen){
   try{this.comicHintSeen=this.platform.storage.get('jigsaw:comic-hint:v1')==='1';}catch{}
   if(!this.comicHintSeen){this.comicHintUntil=Date.now()+2500;this.comicHintSeen=true;try{this.platform.storage.set('jigsaw:comic-hint:v1','1');}catch{}}
  }
  this.comicPage={chapterId:chapter.id,levelId:level.id,index,sequence:!!options.sequence,fromClear:!!options.fromClear,started:Date.now(),shown:this.comicRead?.has(this.comicReadKey(level.id))?comicTextCount(comic):0,returnTo};this.showModal('levelComic');
 }

export function turnComicPanel(this:AppHost,index:number){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter)return;
  const limit=this.comicLimit(chapter);if(index<0||index>limit||index===page.index)return;
  const ending=index===limit,level=chapter.levels[index],comic=!ending&&level?comicFor(chapter,index,level):null;
  if(!ending&&!comic)return;
  this.preloadComicPage(comic);
  this.comicPage={...page,index,levelId:ending?'':level.id,ending,fromClear:false,started:Date.now()-520,shown:comic&&this.comicRead?.has(this.comicReadKey(level.id))?comicTextCount(comic):0,turn:reducedComicMotion()?undefined:{started:Date.now(),direction:index>page.index?1:-1}};this.invalidate();
 }

export function advanceComicPanel(this:AppHost,all=false){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter||page.ending||page.index>=this.comicLimit(chapter))return;
  const comic=comicFor(chapter,page.index,chapter.levels[page.index]);if(!comic)return;const total=comicTextCount(comic);
  if(page.shown<total){page.shown=all?total:page.shown+1;page.started=Math.min(page.started,Date.now()-(page.fromClear?1320:520));}
  if(page.shown>=total)(this.comicRead??=new Set()).add(this.comicReadKey(page.levelId));this.invalidate();
 }

export function drawLevelComicPanel(this:AppHost){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter)return;this.syncComicClear(chapter);const limit=this.comicLimit(chapter);
  if(page.index>limit||(!page.ending&&page.index>=limit)){this.closeModal();return;}
  const s=this.stage,c=s.ctx,view=this.platform.viewport(),area=comicPageRect(s,view,view.menu),layout=comicLayout(area,s.w>s.h),now=Date.now(),reduced=reducedComicMotion();
  this.modalArea=area;this.modalExtent=0;c.fillStyle='#3d2129';c.fillRect(0,0,s.w,s.h);
  // The story page underneath stays drawn: margins and the dot strip must swallow taps, not reach its buttons.
  s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});
  if(this.comicSnap){const t=reduced?1:clamp((now-this.comicSnap.started)/150,0,1);this.comicDrag=this.comicSnap.offset*(1-t)*(1-t);if(t===1)this.comicSnap=undefined;else this.animateStory();}
  const level=chapter.levels[page.index],comic=!page.ending&&level?comicFor(chapter,page.index,level):null;
  const turn=page.turn&&!reduced?Math.max(0,1-(now-page.turn.started)/250):0;if(!turn)page.turn=undefined;
  // Clip to the capsule-free region even while the page follows a downward drag.
  s.clip(area,()=>{c.save();c.translate(turn*turn*area.w*(page.turn?.direction??1),this.comicDrag);c.globalAlpha*=Math.max(.4,1-this.comicDrag/Math.max(1,area.h)*.65);
   try{
    if(comic){
     const photo=this.levelPicture(level),pageImage=this.preloadComicPage(comic),pageSize=s.w>s.h&&pageImage?s.comicImageSize(pageImage.src,pageImage.thumb):null,usePage=!!pageSize;
     const source=comicSource(comic,s.w>s.h,usePage,{src:photo.src??'',thumb:photo.thumbSrc??''}),src=source.src?this.client.asset(source.src):'',thumb=source.thumb?this.client.asset(source.thumb):'',roomLevel=this.room?.snapshot.levelId??this.room?.snapshot.mobileResult?.levelClear?.levelId,decoded=!usePage&&roomLevel===level.id?this.board?.comicPicture:null;
     const drawing=usePage?{...comic,panels:comic.panels.map((panel,index)=>({...panel,crop:source.crops[index]}))}:comic;
     const result=drawComicPage(s,page,drawing,'',(r,crop,zoom)=>s.comicImage(src,thumb,r,crop,zoom,decoded),now,pageSize??s.comicImageSize(src,thumb,decoded),area);if(result.animating)this.animateStory();
     s.hit(area,()=>this.advanceComic());
    }else{
     c.fillStyle='#fffdf8';c.fillRect(area.x,area.y,area.w,area.h);
     const number=(this.storyView?.chapters.findIndex(item=>item.id===chapter.id)??0)+1,next=chapter.levels[limit],nextChapter=!next?this.storyView?.chapters[number]:null,crossChapter=nextChapter?.status==='available'&&nextChapter.levels[0]?.status==='unlocked'?nextChapter.levels[0]:null,playable=next?.status==='unlocked'?next:crossChapter;
     const title=playable?next?'下一页：拼完第 '+(limit+1)+' 格解锁':'本章完':'第 '+number+' 章 完',detail=playable?crossChapter?'轻点这里去第 '+(number+1)+' 章':'轻点这里去拼第 '+(limit+1)+' 格（'+playable.pieces+' 片）':'故事待续';
     const center=(text:string,y:number,size:number,weight:number)=>{size=Math.min(size,(area.w-24)/Math.max(1,[...text].length));s.text(text,area.x+(area.w-s.measure(text,size,weight))/2,y,size,'#642238',weight,area.w-24);};
     center(title,area.y+area.h/2-28,20,800);center(detail,area.y+area.h/2+16,14,700);
     if(playable)s.hit(area,()=>{if(this.busy)return;this.showModal(null);if(this.room)this.leaveRoom();void this.launch({mode:'level',levelId:playable.id});});
    }
   }finally{c.restore();}
  });
  if(turn)this.animateStory();
  const {dots}=layout,step=Math.min(16,dots.w/(limit+1)),start=dots.x+(dots.w-step*(limit+1))/2;
  c.save();c.globalAlpha*=.45;c.strokeStyle='#fff4cf';c.lineWidth=1;
  for(let index=0;index<=limit;index++){c.fillStyle=index===page.index?'#fff4cf':'#cf9f9f';c.beginPath();c.arc(start+(index+.5)*step,dots.y+7,2.5,0,Math.PI*2);if(index<limit)c.fill();else c.stroke();}c.restore();
  if(this.comicHintUntil>now){c.save();c.globalAlpha*=.45*Math.min(1,(this.comicHintUntil-now)/400);const text='左右滑动翻页 · 下滑关闭',size=Math.min(12,(area.w-24)/text.length);s.text(text,area.x+(area.w-s.measure(text,size,500))/2,area.y+area.h-30,size,'#fffdf8',500,area.w-24);c.restore();this.animateStory();}
  // Draw last, outside the animated/fading page and the first-open hint.
  const close=comicCloseRect(view),cx=close.x+close.w/2,cy=close.y+close.h/2;
  c.save();c.globalAlpha*=.55;c.fillStyle='#3d2129';c.beginPath();c.arc(cx,cy,20,0,Math.PI*2);c.fill();c.restore();
  // The button sits on the same dark backdrop, so a faint ring keeps its outline readable.
  c.save();c.strokeStyle='rgba(255,255,255,.4)';c.lineWidth=1.5;c.beginPath();c.arc(cx,cy,19.25,0,Math.PI*2);c.stroke();c.restore();
  c.save();c.strokeStyle='#ffffff';c.lineWidth=2.5;c.lineCap='round';c.beginPath();c.moveTo(cx-7,cy-7);c.lineTo(cx+7,cy+7);c.moveTo(cx+7,cy-7);c.lineTo(cx-7,cy+7);c.stroke();c.restore();
  s.hit(close,()=>this.closeModal());
 }

export function inputComicPanel(this:AppHost,input:Input){
  const point=input.changed[0]??input.points[0],now=Date.now();
  if(input.type==='down'){this.comicHintUntil=0;this.invalidate();}
  if(input.type==='cancel'||input.points.length>1){this.comicClosePress=null;this.comicGesture=null;this.snapComicBack();this.stage.input({type:'cancel',points:[],changed:[]});return true;}
  const close=comicCloseRect(this.platform.viewport());
  if(input.type==='down'&&point&&inside(close,point.x,point.y)){
   this.comicClosePress=point.id;this.comicGesture=null;this.stage.input({type:'cancel',points:[],changed:[]});return true;
  }
  if(this.comicClosePress!==null){
   if(input.type==='up'&&point?.id===this.comicClosePress){this.comicClosePress=null;if(inside(close,point.x,point.y))this.closeModal();}
   return true;
  }
  if(input.type==='down'){
   this.comicSnap=undefined;this.comicDrag=0;
   this.comicGesture=point&&inside(this.modalArea,point.x,point.y)?{id:point.id,x:point.x,y:point.y,lastY:point.y,lastAt:now,velocity:0}:null;
  }
  const gesture=this.comicGesture;
  if(gesture&&point&&point.id===gesture.id&&(input.type==='move'||input.type==='up')){
   const dx=point.x-gesture.x,dy=point.y-gesture.y;
   if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=16)gesture.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
   if(gesture.axis){
    this.stage.input({type:'cancel',points:[],changed:[]});
    if(now>gesture.lastAt&&point.y!==gesture.lastY)gesture.velocity=(point.y-gesture.lastY)/(now-gesture.lastAt);
    else if(now-gesture.lastAt>80)gesture.velocity=0;
    if(gesture.axis==='y'){this.comicDrag=Math.max(0,dy);this.invalidate();}
    if(input.type==='up'){
     this.comicGesture=null;
     if(gesture.axis==='x'&&Math.abs(dx)>=40&&this.comicPage)this.turnComic(this.comicPage.index+(dx>0?-1:1));
     else if(gesture.axis==='y'&&(dy>=90||dy>24&&gesture.velocity>.65))this.closeModal();
     else this.snapComicBack();
    }else if(point.y!==gesture.lastY){gesture.lastY=point.y;gesture.lastAt=now;}
    return true;
   }
  }
  if(input.type==='up')this.comicGesture=null;return this.stage.input(input);
 }

export function beginStoryIntroPanel(this:AppHost,levelId:string|undefined){
  this.storyIntro=null;const chapter=this.chapterForLevel(levelId),index=chapter?.levels.findIndex(level=>level.id===levelId)??-1;
  const intro=chapter&&index>=0?comicFor(chapter,index,chapter.levels[index])?.intro:undefined;
  // The first time a player meets each variant, its intro says what is different.
  const variant=this.roomVariant,key=variant?variantIntroKey(variant):'';let extra='';
  if(variant){let seen=false;try{seen=!!this.platform.storage.get(key);}catch{}if(!seen){extra=variantIntroSentence(variant);try{this.platform.storage.set(key,'1');}catch{}}}
  const text=intro&&extra?intro+'\n'+extra:intro||extra;if(text){this.storyIntro={text,until:0,ms:extra?4200:2000};this.invalidate();}
 }

export function storyRoomVariantPanel(this:AppHost,ticket:RoomTicket,room:RoomClient):StoryVariant|null{
  const levelId=(ticket.room as typeof ticket.room&{levelId?:string}).levelId;if(!levelId||this.nineGridRoom||room.snapshot.completedAt)return null;
  if(otherPlayersPresent(room.snapshot,ticket.playerId))return null;
  const level=this.chapterForLevel(levelId)?.levels.find(item=>item.id===levelId)??this.offline?.view?.chapters.flatMap(chapter=>chapter.levels).find(item=>item.id===levelId)??null;
  return storyVariantFor(levelId,level);
 }

export function drawStoryIntroPanel(this:AppHost){
  const intro=this.storyIntro;if(!intro||!this.imageReady||this.modal)return;
  if(!intro.until)intro.until=Date.now()+(intro.ms??2000);if(Date.now()>=intro.until){this.storyIntro=null;return;}
  const s=this.stage,r=this.roomArea;s.ctx.save();s.ctx.fillStyle='rgba(42,26,31,.48)';s.ctx.fillRect(r.x,r.y,r.w,r.h);drawComicText(s,{kind:'caption',at:'tl',text:intro.text},{x:r.x+16,y:r.y+70,w:Math.min(r.w-32,480),h:120});s.ctx.restore();this.animateStory();
 }
