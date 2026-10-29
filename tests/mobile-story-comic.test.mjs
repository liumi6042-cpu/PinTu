import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture,levels,artwork} from './mobile-level-card-fixture.mjs';

const bundle=await build({stdin:{contents:'export * from "./mobile/story-comic";export {bundledStory} from "./mobile/bundled-story";export {Stage} from "./mobile/ui";export {createComicBack,createWebPlatform} from "./mobile/platform-web";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {comicFor,comicSource,bundledStory,cropCover,comicCloseRect,comicPageRect,comicLayout,comicLines,comicTextCount,Stage,createComicBack,createWebPlatform}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const chapter=levels().chapters[0];
const inside=(r,p)=>assert.ok(r.x>=p.x-.001&&r.y>=p.y-.001&&r.x+r.w<=p.x+p.w+.001&&r.y+r.h<=p.y+p.h+.001,JSON.stringify({r,p}));
const overlap=(a,b)=>a.x<b.x+b.w-.001&&b.x<a.x+a.w-.001&&a.y<b.y+b.h-.001&&b.y<a.y+a.h-.001;

test('cropCover covers the panel around the crop centre and translates at edges',()=>{
 assert.deepEqual(cropCover(1000,600,[0,0,1,1],{w:200,h:200}),{x:200,y:0,w:600,h:600});
 assert.deepEqual(cropCover(1000,600,[.2,.2,.4,.4],{w:200,h:100}),{x:200,y:140,w:400,h:200});
 for(const crop of [[0,0,.3,.4],[.9,.9,.1,.1],[0,0,1,1],[.2,.2,.4,.4]])for(const [w,h]of [[200,100],[100,400]]){
  const r=cropCover(1000,600,crop,{w,h});inside(r,{x:0,y:0,w:1000,h:600});assert.ok(Math.abs(r.w/r.h-w/h)<1e-8);assert.ok(Math.abs(r.x+r.w/2-(crop[0]+crop[2]/2)*1000)<1e-8);assert.ok(Math.abs(r.y+r.h/2-(crop[1]+crop[3]/2)*600)<1e-8);
 }
 // Defensive clamping of an out-of-image centre translates, never adds white space.
 const edge=cropCover(1000,600,[.95,.95,.2,.2],{w:100,h:100});assert.equal(edge.x+edge.w,1000);assert.equal(edge.y+edge.h,600);
});

test('comicLayout gives four contained, disjoint panels and consistent gutters',()=>{
 for(const [w,h,top,bottom,menu]of [[390,844,44,34,{x:282,y:48,w:100,h:32}],[793,360,8,21,{x:680,y:12,w:105,h:32}],[390,844,44,34,{x:282,y:48,w:100,h:100}],[793,360,8,21,{x:680,y:12,w:105,h:110}],[844,390,8,21],[667,375,0,0],[1280,800,0,0],[568,320,0,0]]){
  const landscape=w>h,{page,panels,gutter,dots}=comicLayout(comicPageRect({w,h},{top,bottom},menu),landscape);inside(page,{x:8,y:top+8,w:w-16,h:h-top-bottom-16});inside(dots,{x:8,y:top+8,w:w-16,h:h-top-bottom-16});assert.equal(panels.length,4);
  if(menu){assert.equal(overlap(page,menu),false);assert.equal(overlap(dots,menu),false);}
  const close=comicCloseRect({top});inside(close,{x:0,y:top,w,h:h-top-bottom});assert.ok(close.w>=44&&close.h>=44);assert.ok(page.y>=close.y+close.h+8);assert.equal(overlap(page,close),false);if(menu)assert.equal(overlap(close,menu),false);
  const readingTop=close.y+close.h+8,fullW=w-16,fullH=h-bottom-8-readingTop;
  const expected=menu&&menu.y+menu.h>readingTop?Math.max(fullW*(h-bottom-8-(menu.y+menu.h+8)),(menu.x-16)*fullH):fullW*fullH;
  assert.ok(Math.abs(page.w*(page.h+14)-expected)<.001,'choose the larger capsule-free area below the close control');
  assert.equal(dots.h,14);assert.equal(dots.y,page.y+page.h);panels.forEach(r=>assert.equal(overlap(r,dots),false));
  panels.forEach((r,i)=>{inside(r,page);assert.ok(r.w>0&&r.h>0);panels.slice(i+1).forEach(other=>assert.equal(overlap(r,other),false));});
  if(landscape){assert.ok(panels.every(p=>panels[0].w*panels[0].h>=p.w*p.h));assert.ok(panels[0].x<panels[1].x);assert.ok(Math.abs(panels[2].x-panels[1].x-panels[1].w-gutter)<.001);}
  else{assert.ok(panels[0].y<panels[1].y&&panels[1].y<panels[3].y);assert.ok(Math.abs(panels[1].y-panels[0].y-panels[0].h-gutter)<.001);}
  assert.ok(Math.abs(panels[3].y-panels[1].y-panels[1].h-gutter)<.001);
 }
});

test('comicFor independently prefers server fields, falls back, rejects malformed comics, and returns null without either source',()=>{
 const local=comicFor(chapter,3,{});assert.equal(local.panels.length,4);assert.ok(local.intro.includes('小客人'));
 const custom={panels:local.panels.map(p=>({...p,texts:[{kind:'say',at:'br',text:'服务器台词'}]}))};
 assert.deepEqual(comicFor(chapter,3,{comic:custom,intro:'服务器旁白'}),{intro:'服务器旁白',panels:custom.panels});
 assert.equal(comicFor(chapter,3,{comic:custom}).intro,local.intro);assert.deepEqual(comicFor(chapter,3,{intro:'旁白'}).panels,local.panels);
 assert.deepEqual(comicFor(chapter,3,{comic:{panels:[]}}),local);assert.equal(comicFor({id:'other',albumId:'other'},0,{}),null);assert.equal(comicFor(chapter,6,{}),null);
 assert.equal(comicFor({id:'other',albumId:'other'},0,{comic:custom,intro:'旁白'}).intro,'旁白');
 const copy=comicFor(chapter,3,{});copy.panels[0].crop[0]=.5;assert.equal(comicFor(chapter,3,{}).panels[0].crop[0],0);
});

const pageEntry=()=>({src:'/comic-page.webp',panels:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]]});
test('comicFor parses server and bundled pages independently of panels, prefers the server, and copies crops',()=>{
 const local=comicFor(chapter,3,{}),entry=bundledStory(chapter).levels[3],bundledPage={...pageEntry(),src:'/bundled-page.webp'},serverPage={...pageEntry(),src:'https://example.test/page.webp',thumbSrc:'/page-thumb.webp'};
 assert.ok(bundledStory(chapter).levels.every(level=>!Object.hasOwn(level,'comicPage')));
 try{
  entry.comicPage=bundledPage;
  assert.deepEqual(comicFor(chapter,3,{}),{...local,page:{...bundledPage,thumbSrc:bundledPage.src}});
  const comic=comicFor(chapter,3,{comicPage:serverPage});assert.deepEqual(comic,{...local,page:serverPage});
  comic.page.panels[0][0]=.1;assert.equal(serverPage.panels[0][0],0);assert.equal(comicFor(chapter,3,{comicPage:serverPage}).page.panels[0][0],0);
  assert.deepEqual(comicFor(chapter,3,{comicPage:{}}).page,{...bundledPage,thumbSrc:bundledPage.src});
 }finally{delete entry.comicPage;}
 const invalid=[null,[],{},'page',{...pageEntry(),extra:true}];
 for(const src of [undefined,'',' ','http://example.test/a.webp','javascript:alert(1)','a.webp','/../a.webp','/a b.webp','//example.test/a.webp','/\\example.test/a.webp','https://','/'+'x'.repeat(300)])invalid.push({...pageEntry(),src},{...pageEntry(),thumbSrc:src});
 for(const panels of [null,[],pageEntry().panels.slice(1),[...pageEntry().panels,[0,0,1,1]]])invalid.push({...pageEntry(),panels});
 for(const crop of [null,{},[0,0,1],['0',0,1,1],[NaN,0,1,1],[Infinity,0,1,1],[-.1,0,1,1],[1.1,0,.1,1],[0,0,0,1],[0,0,1,0],[.51,0,.5,1],[0,.51,1,.5]])invalid.push({...pageEntry(),panels:[crop,...pageEntry().panels.slice(1)]});
 const sparse=pageEntry();delete sparse.panels[0];invalid.push(sparse);
 for(const comicPage of invalid){const comic=comicFor(chapter,3,{comicPage});assert.equal(comic.page,undefined);assert.deepEqual(comic,local);}
 assert.equal(comicFor({id:'other',albumId:'other'},0,{comicPage:pageEntry()}),null);
});

test('comicSource uses page sources/crops only for landscape plus ready; all fallback states keep level crops',()=>{
 const local=comicFor(chapter,3,{}),comic=comicFor(chapter,3,{comicPage:{...pageEntry(),thumbSrc:'/page-thumb.webp'}}),level={src:'/level.webp',thumb:'/level-thumb.webp'};
 for(const landscape of [false,true])for(const pageReady of [false,true])for(const current of [local,comic]){
  const source=comicSource(current,landscape,pageReady,level);
  assert.deepEqual(source,landscape&&pageReady&&current.page?{src:current.page.src,thumb:current.page.thumbSrc,crops:current.page.panels}:{...level,crops:local.panels.map(p=>p.crop)});
 }
 // Loading and failed cache entries both report not ready.
 for(const state of ['loading','failed'])assert.deepEqual(comicSource(comic,true,state==='loaded',level).crops,local.panels.map(p=>p.crop));
});

test('app preloads pages on open/turn, uses them after readiness in landscape, and keeps level artwork/texts otherwise',async t=>{
 t.mock.method(Date,'now',()=>1000);
 for(const [width,height]of [[844,390],[390,844]]){
  const data=levels(6),comicPage={...pageEntry(),thumbSrc:'/comic-page-thumb.webp'};data.chapters[0].levels[3].comicPage=comicPage;data.chapters[0].levels[4].comicPage={...comicPage,src:'/next-page.webp'};
  const f=fixture({width,height,data});await artwork(f);const loads=[];let ready=false;
  f.stage.preloadComicImage=(src,thumb)=>loads.push({src,thumb});
  f.stage.comicImageSize=(src,thumb,decoded)=>src===comicPage.src?(ready?{w:2000,h:1000}:null):{w:1536,h:1024};
  f.app.room={snapshot:{levelId:'ch1-4'}};f.app.board={input(){},comicPicture:{width:1536,height:1024}};
  f.app.openLevelComic('ch1-4');assert.deepEqual(loads,[{src:comicPage.src,thumb:comicPage.thumbSrc}]);
  for(const state of ['loading','loaded','failed']){
   ready=state==='loaded';f.app.advanceComic(true);f.clear();f.app.drawModal();const usePage=width>height&&ready;
   assert.equal(f.images.length,4);f.images.forEach((image,index)=>{
    assert.equal(image.src,usePage?comicPage.src:'/chapter-3.webp');assert.deepEqual(image.crop,usePage?comicPage.panels[index]:comicFor(chapter,3,{}).panels[index].crop);
    assert.equal(image.decoded,usePage?null:f.app.board.comicPicture);
   });
   assert.ok(f.texts.includes('午后，店门口的铃响了。'));assert.ok(f.texts.includes('别哭，我们把它拼回来！'));
  }
  if(width>height){
   ready=true;f.app.openLevelComic('ch1-4',{fromClear:true});f.clear();f.app.drawModal();
   const area=f.app.modalArea,full=cropCover(2000,1000,[0,0,1,1],area),scale=area.w/full.w,crop=comicPage.panels[0];
   assert.equal(f.images.length,5);assert.deepEqual(f.images[1].r,{x:area.x+(crop[0]*2000-full.x)*scale,y:area.y+(crop[1]*1000-full.y)*scale,w:crop[2]*2000*scale,h:crop[3]*1000*scale});
  }
  f.app.turnComic(4);assert.equal(loads.at(-1).src,'/next-page.webp');
 }
});

test('Stage page preloading stays nonblocking, checks decoded cache only, and reuses either source or thumbnail',()=>{
 const f=fixture(),loads=[],draws=[],pending=new Map(),ctx=f.stage.ctx;ctx.drawImage=(...args)=>draws.push(args);
 const platform={config:{id:'web'},canvas:{width:100,height:100,getContext:()=>ctx},viewport:()=>({width:100,height:100,dpr:1}),createImage:()=>({width:2000,height:1000}),setImageSource:(image,src)=>{loads.push(src);pending.set(src,image);return ()=>{};}};
 const s=new Stage(platform,src=>src),r={x:0,y:0,w:100,h:100};
 try{
  assert.equal(s.comicImageSize('/page','/thumb'),null);assert.deepEqual(loads,[]);
  s.preloadComicImage('/page','/thumb');assert.deepEqual(loads,['/page','/thumb']);assert.equal(s.comicImageSize('/page','/thumb'),null);assert.equal(draws.length,0);
  pending.get('/page').onerror();assert.equal(s.comicImageSize('/page','/thumb'),null);
  pending.get('/thumb').onload();assert.deepEqual(s.comicImageSize('/page','/thumb'),{w:2000,h:1000});
  s.comicImage('/page','/thumb',r,[.5,0,.5,.5]);assert.equal(draws[0][0],pending.get('/thumb'));
  s.preloadComicImage('/full','/full');assert.equal(loads.filter(src=>src==='/full').length,1);pending.get('/full').onload();
  assert.deepEqual(s.comicImageSize('/full',''),{w:2000,h:1000});s.comicImage('/full','',r,[0,0,1,1]);assert.equal(draws.at(-1)[0],pending.get('/full'));
 }finally{s.destroy();}
});

test('comic wrapping keeps closing punctuation with the previous glyph without losing text',()=>{
 for(const text of ['爷爷想不起来早餐店开张那天了……','“回忆碎了，就把它拼回来。”','别哭，我们把它拼回来！']){
  const lines=comicLines(text,42,t=>[...t].length*7);assert.equal(lines.join(''),text);assert.ok(lines.every(line=>!/[。，、！？；：…）」』”’]/.test(line[0])));
 }
});

async function comicFixture({width=844,height=390,index=3,fromClear=false,sequence=false,cleared=6}={}){
 const f=fixture({width,height,data:levels(cleared)});await artwork(f);f.app.stopCheers=()=>{};f.app.openLevelComic('ch1-'+(index+1),{fromClear,sequence});return f;
}
function reveal(f){f.app.advanceComic(true);f.clear();f.app.drawModal();}

for(const [width,height]of [[844,390],[390,844],[1280,800],[320,640]])test(`${width}×${height} renders four crops, reveals one segment per click with only the close control`,async()=>{
 const f=await comicFixture({width,height,cleared:4});f.app.drawModal();assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.src==='/chapter-3.webp'));assert.equal(f.app.comicPage.fromClear,false);
 const comic=comicFor(chapter,3,{});assert.equal(f.app.comicPage.shown,0);assert.equal(f.texts.some(t=>t.includes('午后，')),false);
 for(let i=1;i<=comicTextCount(comic);i++){f.hits.find(hit=>hit.r===f.app.modalArea).fn();assert.equal(f.app.comicPage.shown,i);f.clear();f.app.drawModal();}
 assert.ok(!f.texts.some(t=>t.includes('下一格')));assert.ok(f.texts.includes('午后，店门口的铃响了。'));assert.ok(f.texts.includes('别哭，我们把它拼回来！'));
 assertCloseControl(f);f.app.advanceComic();assert.equal(f.app.comicPage.index,3);
 f.app.turnComic(4);assert.equal(f.app.comicPage.ending,true);f.clear();f.app.drawModal();assert.ok(f.texts.includes('下一页：拼完第 5 格解锁'));assert.ok(f.texts.includes('轻点这里去拼第 5 格（30 片）'));assertCloseControl(f);
 f.app.turnComic(3);assert.equal(f.app.comicPage.shown,comicTextCount(comic));
});

test('sequence starts at one, reads all six pages, labels the ending and ends without opening a room',async()=>{
 const f=await comicFixture({index:4,sequence:true});assert.equal(f.app.comicPage.index,0);
 for(let index=0;index<6;index++){assert.equal(f.app.comicPage.index,index);reveal(f);assert.equal(f.images.length,4);assertCloseControl(f);f.app.turnComic(index+1);}
 assert.equal(f.app.comicPage.index,6);assert.equal(f.app.comicPage.ending,true);f.clear();f.app.drawModal();assert.ok(f.texts.includes('第 1 章 完'));assert.equal(f.images.length,0);assertCloseControl(f);assert.equal(actions(f).length,0);f.app.closeModal();assert.equal(f.app.modal,null);assert.equal(f.created.length,0);
});

test('fromClear splits from the full-image crop projection, ordinary reopening only fades panels, reduced motion draws four immediately',async t=>{
 const previous=globalThis.matchMedia;let reduced=false,now=0;globalThis.matchMedia=()=>({matches:reduced});t.after(()=>{if(previous)globalThis.matchMedia=previous;else delete globalThis.matchMedia;});t.mock.method(Date,'now',()=>now);
 for(reduced of [false,true]){
  for(const fromClear of [false,true]){
   const f=await comicFixture({fromClear});const start=f.app.comicPage.started;now=start;f.app.drawModal();
   assert.equal(f.images.length,fromClear&&!reduced?5:4);
   if(fromClear&&!reduced){const full=f.images[0];assert.deepEqual(full.crop,[0,0,1,1]);assert.equal(f.images[1].zoom,0);f.clear();now=start+400;f.app.drawModal();assert.ok(f.images[1].zoom>0&&f.images[1].zoom<1);f.clear();now=start+900;f.app.drawModal();assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.alpha===1),'panels must stay visible after the split');}
   else{const {panels}=comicLayout(comicPageRect(f.stage,{top:0,bottom:0}),true);f.images.forEach((image,index)=>assert.deepEqual(image.r,panels[index]));}
   f.app.advanceComic(true);f.clear();f.app.drawModal();assert.ok(!f.texts.some(t=>t.includes('下一格')));
  }
 }
});

test('opening uses no API, completion close restores its rewards, Escape closes and stale owners cannot open',async()=>{
 const f=await comicFixture();f.client.json=()=>{throw Error('No network');};f.app.modal='completion';f.app.room={snapshot:{levelId:'ch1-4',mobileResult:{levelClear:{levelId:'ch1-4',nextLevelId:'ch1-5'}}}};f.app.board={input(){},comicPicture:{width:1536,height:1024}};
 f.app.openLevelComic('ch1-4',{fromClear:true});f.app.drawModal();assert.ok(f.images.every(image=>image.decoded===f.app.board.comicPicture));assert.equal(f.app.comicPage.returnTo,'completion');f.app.closeModal();assert.equal(f.app.modal,'completion');assert.ok(f.app.room);
 f.app.modal=null;f.app.room=null;f.app.openLevelComic('ch1-4');f.app.input({type:'key',key:'Escape',keyDown:true,points:[],changed:[]});assert.equal(f.app.modal,null);
 f.client.account={id:'different'};f.app.openLevelComic('ch1-1');assert.equal(f.app.modal,null);
});

test('story intro waits for image readiness, darkens the board, expires after two seconds, and first pointer down dismisses without swallowing input',async t=>{
 const f=await comicFixture();f.app.modal=null;f.app.imageReady=false;f.app.roomArea={x:0,y:80,w:390,h:600};f.app.beginStoryIntro('ch1-4');assert.ok(f.app.storyIntro.text.includes('小客人'));
 f.app.drawStoryIntro();assert.equal(f.app.storyIntro.until,0);f.app.imageReady=true;t.mock.method(Date,'now',()=>1000);f.app.drawStoryIntro();assert.equal(f.app.storyIntro.until,3000);assert.ok(f.fills.some(fill=>fill.color==='rgba(42,26,31,.48)'));
 Date.now.mock.mockImplementation(()=>3000);f.app.drawStoryIntro();assert.equal(f.app.storyIntro,null);f.app.beginStoryIntro('ch1-4');let inputs=0;f.stage.input=()=>{inputs++;return true;};f.app.input({type:'down',points:[],changed:[]});assert.equal(f.app.storyIntro,null);assert.equal(inputs,1);
 f.app.beginStoryIntro('ordinary');assert.equal(f.app.storyIntro,null);
});

test('Stage reuses a cached thumbnail or completed canvas synchronously without requesting the full image',()=>{
 const f=fixture(),loads=[],draws=[],ctx=f.stage.ctx;ctx.drawImage=(...args)=>draws.push(args);
 const platform={config:{id:'web'},canvas:{width:100,height:100,getContext:()=>ctx},viewport:()=>({width:100,height:100,dpr:1}),createImage:()=>({width:1000,height:600}),setImageSource:(image,src)=>{loads.push(src);image.onload();return ()=>{};}};
 const s=new Stage(platform,src=>src);s.image('/thumb',{x:0,y:0,w:100,h:100});assert.deepEqual(loads,['/thumb']);draws.length=0;
 s.comicImage('/full','/thumb',{x:0,y:0,w:100,h:100},[0,0,1,1]);assert.equal(draws.length,1);assert.deepEqual(loads,['/thumb']);assert.deepEqual(draws[0].slice(1,5),[200,0,600,600]);
 s.comicImage('/other','',{x:0,y:0,w:100,h:100},[0,0,1,1],1,{width:600,height:600});assert.deepEqual(loads,['/thumb']);s.destroy();
});

function redraw(f){f.clear();f.app.drawModal();}
function closeHit(f){const r=comicCloseRect(f.platform.viewport());return f.hits.find(hit=>Object.keys(r).every(key=>hit.r[key]===r[key]));}
function assertCloseControl(f){assert.equal(f.buttons.length,0,'no generic buttons');assert.ok(closeHit(f),'the fixed close control remains available');}
// Count page actions separately from the close control and the full-stage blocker.
const actions=f=>f.hits.filter(hit=>hit!==closeHit(f)&&!(hit.r.x===0&&hit.r.y===0&&hit.r.w===f.stage.w&&hit.r.h===f.stage.h));
function wireInput(f){
 f.stage.hits=f.hits;f.stage.input=input=>Stage.prototype.input.call(f.stage,input);
 const button=f.stage.button;f.stage.button=(r,label,fn,opts)=>{button(r,label,fn,opts);if(!opts?.disabled)f.stage.hit(r,fn);};
}
function pointInput(f,type,x,y){const p={id:1,x,y};return f.app.input({type,points:type==='up'?[]:[p],changed:[p]});}
function tap(f,x,y){pointInput(f,'down',x,y);pointInput(f,'up',x,y);}
function swipe(f,dx){const r=f.app.modalArea,x=r.x+r.w/2,y=r.y+r.h/2;pointInput(f,'down',x,y);pointInput(f,'move',x+dx,y+2);pointInput(f,'up',x+dx,y+2);}
function recordDots(f){
 const circles=[];let circle=null;const c=f.stage.ctx;c.beginPath=()=>{circle=null;};c.arc=(x,y,r)=>{circle={x,y,r};};
 c.fill=()=>{if(circle){circles.push({...circle,solid:true});circle=null;}};c.stroke=()=>{if(circle){circles.push({...circle,solid:false});circle=null;}};
 return ()=>circles.filter(dot=>dot.r===2.5&&dot.y===f.app.modalArea.y+f.app.modalArea.h+7);
}

test('3/6 exposes three unlocked dots and one hollow ending dot; no entry paints locked artwork',async()=>{
 const f=await comicFixture({index:2,cleared:3}),dots=recordDots(f);wireInput(f);f.app.drawModal();assert.equal(dots().length,4);assert.deepEqual(dots().map(d=>d.solid),[true,true,true,false]);assert.ok(!f.texts.includes('3 / 6'));assert.equal(actions(f).length,1);
 for(let index=4;index<=9;index++){f.app.turnComic(index);assert.equal(f.app.comicPage.index,2);}
 f.app.openLevelComic('ch1-4');assert.equal(f.app.comicPage.index,2);
 tap(f,dots()[0].x,dots()[0].y);assert.equal(f.app.comicPage.index,2);assert.equal(f.app.comicPage.shown,0);
 f.app.openLevelComic('ch1-6',{sequence:true});assert.equal(f.app.comicPage.index,0);
 for(let index=0;index<3;index++){assert.equal(f.app.comicPage.index,index);f.app.advanceComic(true);f.app.turnComic(index+1);}
 assert.equal(f.app.comicPage.ending,true);assert.equal(f.app.comicPage.index,3);redraw(f);assert.equal(f.images.length,0);assert.ok(f.texts.includes('下一页：拼完第 4 格解锁'));
 assertCloseControl(f);assert.equal(actions(f).length,1);assert.deepEqual(actions(f)[0].r,f.app.modalArea);tap(f,f.app.modalArea.x+12,f.app.modalArea.y+12);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.created[0].levelId,'ch1-4');
 const empty=await comicFixture({index:0,cleared:0});assert.equal(empty.app.modal,null);empty.app.openLevelComic('ch1-6',{sequence:true});assert.equal(empty.app.modal,null);
});

test('page taps reveal one segment, stop at the last segment, gestures turn, and read pages reopen in full',async()=>{
 const f=await comicFixture({index:0,cleared:3});wireInput(f);redraw(f);const r=f.app.modalArea,n=comicTextCount(comicFor(chapter,0,{}));
 swipe(f,80);assert.equal(f.app.comicPage.index,0);assert.equal(f.app.comicPage.shown,0);
 tap(f,r.x+r.w/2,r.y+r.h/2);assert.equal(f.app.comicPage.shown,1);assert.equal(f.app.comicPage.index,0);
 for(let i=1;i<n;i++)tap(f,r.x+r.w/2,r.y+r.h/2);assert.equal(f.app.comicPage.shown,n);redraw(f);assertCloseControl(f);
 swipe(f,-80);assert.equal(f.app.comicPage.index,1);assert.equal(f.app.comicPage.shown,0);assert.equal(f.app.comicPage.turn.direction,1);redraw(f);
 swipe(f,80);assert.equal(f.app.comicPage.index,0);assert.equal(f.app.comicPage.shown,n);assert.equal(f.app.comicPage.turn.direction,-1);redraw(f);
 tap(f,r.x+r.w/2,r.y+r.h/2);assert.equal(f.app.comicPage.index,0);swipe(f,-80);f.app.advanceComic(true);f.app.closeModal();f.app.openLevelComic('ch1-2');assert.equal(f.app.comicPage.shown,comicTextCount(comicFor(chapter,1,{})));
 f.app.closeModal();f.app.route='chapter';f.app.openLevelComic('ch1-1');redraw(f);f.app.closeModal();assert.equal(f.app.modal,null);assert.equal(f.app.route,'chapter');
 f.client.account={id:'owner-b'};f.app.levelsOwner='owner-b';f.app.openLevelComic('ch1-1');assert.equal(f.app.comicPage.shown,0,'read state is scoped to its owner');
});

test('left swipes turn before every line is shown and stop at the ending card',async()=>{
 const f=await comicFixture({index:0,cleared:3});wireInput(f);redraw(f);assert.equal(f.app.comicPage.shown,0);assertCloseControl(f);
 swipe(f,-80);assert.equal(f.app.comicPage.index,1);assert.equal(f.app.comicPage.shown,0);redraw(f);
 swipe(f,-80);assert.equal(f.app.comicPage.index,2);redraw(f);swipe(f,-80);assert.equal(f.app.comicPage.ending,true);assert.equal(f.app.comicPage.index,3);
 redraw(f);assert.ok(!f.texts.some(text=>/^\d+ \/ \d+$/.test(text)),'the ending card has no page counter');assertCloseControl(f);swipe(f,-80);assert.equal(f.app.comicPage.index,3,'nothing lies past the ending card');swipe(f,80);assert.equal(f.app.comicPage.index,2);
});

test('turn slides for 250ms; reduced-motion turns immediately without an animation frame',async t=>{
 const previous=globalThis.matchMedia;let reduced=false,now=1000;globalThis.matchMedia=()=>({matches:reduced});t.after(()=>{if(previous)globalThis.matchMedia=previous;else delete globalThis.matchMedia;});t.mock.method(Date,'now',()=>now);
 const f=await comicFixture({index:0,cleared:3}),translations=[];let frames=0;f.platform.frame=()=>{frames++;return frames;};f.platform.cancelFrame=()=>{};f.stage.ctx.translate=(x,y)=>translations.push([x,y]);
 f.app.comicHintUntil=0;f.app.advanceComic(true);f.app.turnComic(1);assert.ok(f.app.comicPage.turn);redraw(f);assert.ok(frames>0);assert.ok(translations.some(([x])=>x>0));
 now+=125;translations.length=0;redraw(f);assert.ok(translations.some(([x])=>x>0&&x<f.app.modalArea.w));now+=125;redraw(f);assert.equal(f.app.comicPage.turn,undefined);
 f.app.stopStoryFrame();reduced=true;frames=0;translations.length=0;f.app.turnComic(0);assert.equal(f.app.comicPage.turn,undefined);redraw(f);assert.equal(frames,0);assert.equal(translations[0][0],0);
});

test('completion receipt unlocks immediately and completion action splits the exact page; timeline reopens it without split',async()=>{
 const f=fixture({data:levels(3)});await artwork(f);f.client.config.capabilities.cheers=false;
 const snapshot={id:'completed-story',levelId:'ch1-4',completedAt:1,members:[],mobileResult:{levelClear:{levelId:'ch1-4',nextLevelId:'ch1-5',chapterComplete:false}}};
 f.app.room={snapshot,ticket:{playerId:'self'},state:{cols:6,rows:4}};f.app.drawCompletionPicture=()=>{};f.app.modal='completion';f.app.drawCompletionContent(12,80,366,false);
 f.buttons.find(b=>b.label==='翻开这一页').fn();assert.equal(f.app.comicPage.index,3);assert.equal(f.app.comicPage.fromClear,true);assert.equal(f.app.comicPage.returnTo,'completion');assert.equal(f.app.levels.chapters[0].levels[3].status,'cleared');
 f.app.closeModal();assert.equal(f.app.modal,'completion');f.app.room=null;f.app.modal=null;f.app.route='chapter';f.clear();f.app.drawChapter();f.hits[3].fn();assert.equal(f.app.comicPage.index,3);assert.equal(f.app.comicPage.fromClear,false);
 const pending=fixture({data:levels(3)});pending.app.room={snapshot};pending.app.completedId=snapshot.id;pending.app.syncCompletion(pending.app.room);assert.equal(pending.app.levels.chapters[0].levels[3].status,'cleared','receipt unlock does not wait for the story button');
});

test('safe areas and unavailable-next endings keep all controls inside the viewport without a launch action',async()=>{
 for(const [width,height,top,bottom]of [[390,844,44,34],[844,390,8,21],[1280,800,0,0]]){
  const f=await comicFixture({width,height,index:2,cleared:3});f.platform.viewport=()=>({width,height,top,bottom});f.app.levels.chapters[0].levels[3].status='locked';f.app.turnComic(3);redraw(f);
  assert.equal(f.images.length,0);assertCloseControl(f);assert.equal(actions(f).length,0);assert.ok(f.texts.includes('第 1 章 完'));assert.ok(f.texts.includes('故事待续'));inside(f.app.modalArea,{x:0,y:top,w:width,h:height-top-bottom});wireInput(f);tap(f,f.app.modalArea.x+20,f.app.modalArea.y+20);assert.equal(f.created.length,0);assert.equal(f.app.modal,'levelComic');
 }
});

test('downward drag follows the finger, fades, springs back in 150ms, and dismisses at 90px or on a flick',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const f=await comicFixture({index:0,cleared:3});wireInput(f);redraw(f);const r=f.app.modalArea,x=r.x+r.w/2,y=r.y+r.h/2,translations=[];f.stage.ctx.translate=(dx,dy)=>translations.push([dx,dy]);
 pointInput(f,'down',x,y);now+=100;pointInput(f,'move',x+4,y+50);redraw(f);
 assert.equal(f.app.comicDrag,50);assert.ok(translations.some(([,dy])=>dy===50));assert.ok(f.images.every(image=>image.alpha<1));assert.equal(f.app.comicPage.shown,0);
 now+=120;pointInput(f,'up',x+4,y+50);assert.equal(f.app.modal,'levelComic');assert.ok(f.app.comicSnap);now+=75;redraw(f);assert.ok(f.app.comicDrag>0&&f.app.comicDrag<50);now+=75;redraw(f);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicSnap,undefined);
 pointInput(f,'down',x,y);now+=200;pointInput(f,'up',x+10,y+100);assert.equal(f.app.modal,null);assert.equal(f.app.route,'lobby');
 f.app.route='chapter';f.app.openLevelComic('ch1-1');redraw(f);pointInput(f,'down',x,y);now+=30;pointInput(f,'up',x,y+35);assert.equal(f.app.modal,null);assert.equal(f.app.route,'chapter');
 f.app.room={snapshot:{levelId:'ch1-1'}};f.app.modal='completion';f.app.openLevelComic('ch1-1');redraw(f);pointInput(f,'down',x,y);now+=200;pointInput(f,'up',x,y+100);assert.equal(f.app.modal,'completion');assert.ok(f.app.room);
});

test('vertical gestures do not turn or reveal; cancelled and reduced-motion short drags return safely',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});t.after(()=>{if(previous)globalThis.matchMedia=previous;else delete globalThis.matchMedia;});
 const f=await comicFixture({index:0,cleared:3});wireInput(f);redraw(f);const r=f.app.modalArea,x=r.x+r.w/2,y=r.y+r.h/2;
 pointInput(f,'down',x,y);now+=200;pointInput(f,'move',x+48,y+60);now+=200;pointInput(f,'up',x+48,y+60);assert.equal(f.app.comicPage.index,0);assert.equal(f.app.comicPage.shown,0);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicSnap,undefined);
 pointInput(f,'down',x,y);pointInput(f,'move',x,y-100);pointInput(f,'up',x,y-100);assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicPage.shown,0);
 pointInput(f,'down',x,y);pointInput(f,'move',x,y+60);pointInput(f,'cancel',x,y+60);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicGesture,null);assert.equal(f.app.modal,'levelComic');
});

test('reader owns arrow keys and back handler only while open, including completion return and alternate close cleanup',async()=>{
 const f=fixture({data:levels(3)});let handler,registered=0,cleaned=0;f.platform.onBack=fn=>{handler=fn;registered++;return()=>{cleaned++;handler=null;};};
 f.app.openLevelComic('ch1-1');assert.equal(registered,1);f.app.openLevelComic('ch1-1');assert.equal(registered,1);
 const key=value=>f.app.input({type:'key',key:value,keyDown:true,points:[],changed:[]});
 key('ArrowLeft');assert.equal(f.app.comicPage.index,0);key('ArrowRight');assert.equal(f.app.comicPage.index,1);key('ArrowLeft');assert.equal(f.app.comicPage.index,0);key('Escape');assert.equal(f.app.modal,null);assert.equal(cleaned,1);assert.equal(handler,null);
 assert.equal(key('ArrowRight'),false);f.app.openLevelComic('ch1-1');assert.equal(handler(),true);assert.equal(cleaned,2);assert.equal(f.app.modal,null);
 f.app.room={snapshot:{levelId:'ch1-1'}};f.app.modal='completion';f.app.openLevelComic('ch1-1');handler();assert.equal(f.app.modal,'completion');assert.equal(cleaned,3);
});

test('first-open hint expires, touch dismisses without consuming the tap, and storage persists across app instances',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const f=await comicFixture({index:0});wireInput(f);redraw(f);const hint='左右滑动翻页 · 下滑关闭';assert.ok(f.texts.includes(hint));assert.equal(f.storage.get('jigsaw:comic-hint:v1'),'1');
 now+=2300;redraw(f);assert.ok(f.texts.includes(hint));now+=200;redraw(f);assert.ok(!f.texts.includes(hint));
 const fresh=await comicFixture({index:0});wireInput(fresh);redraw(fresh);const r=fresh.app.modalArea;tap(fresh,r.x+r.w/2,r.y+r.h/2);assert.equal(fresh.app.comicHintUntil,0);assert.equal(fresh.app.comicPage.shown,1);redraw(fresh);assert.ok(!fresh.texts.includes(hint));
 fresh.app.closeModal();fresh.app.openLevelComic('ch1-1');redraw(fresh);assert.ok(!fresh.texts.includes(hint));
 const again=fixture({storage:fresh.storage});again.app.openLevelComic('ch1-1');redraw(again);assert.ok(!again.texts.includes(hint));
});

function historyHost(){
 const host=new EventTarget(),stack=[{original:true}];let index=0,pushes=0,backs=0,pending=false;
 host.history={get state(){return stack[index];},pushState(state){stack.splice(++index);stack.push(structuredClone(state));pushes++;},back(){backs++;if(index>0){index--;pending=true;}}};
 return {host,counts:()=>({pushes,backs}),pop(){host.history.back();this.flush();},flush(){if(pending){pending=false;host.dispatchEvent(new Event('popstate'));}}};
}

for(const [width,height,top,bottom,menu]of [[390,844,44,34,{x:282,y:48,w:100,h:32}],[793,360,8,21,{x:680,y:12,w:105,h:32}],[1280,800,0,0,undefined]])test(`${width}×${height}: fixed close control is drawn and clickable in every reader state`,async t=>{
 t.mock.method(Date,'now',()=>1000);
 for(const state of ['normal','hint','ending','split','turn','drag']){
  const f=await comicFixture({width,height,index:0,cleared:3,fromClear:state==='split'});wireInput(f);
  f.platform.viewport=()=>({width,height,top,bottom,menu});
  if(state!=='hint')f.app.comicHintUntil=0;
  if(state==='ending')f.app.turnComic(3);
  if(state==='turn')f.app.turnComic(1);
  if(state==='drag')f.app.comicDrag=65;
  const circles=[];let arc;f.stage.ctx.arc=(x,y,r)=>{arc={x,y,r};};f.stage.ctx.fill=()=>{circles.push({...arc,color:f.stage.ctx.fillStyle,alpha:f.stage.ctx.globalAlpha});};
  redraw(f);assertCloseControl(f);const close=closeHit(f).r;
  assert.deepEqual(close,comicCloseRect({top}));inside(close,{x:0,y:top,w:width,h:height-top-bottom});assert.ok(close.w>=44&&close.h>=44);
  assert.equal(overlap(close,f.app.modalArea),false);if(menu)assert.equal(overlap(close,menu),false);
  assert.deepEqual(circles.at(-1),{x:close.x+22,y:close.y+22,r:20,color:'#3d2129',alpha:.55});
  assert.equal(f.hits.at(-1),closeHit(f),'close hit is above all page actions');
  const page=f.app.comicPage,shown=page.shown,index=page.index;
  tap(f,close.x+22,close.y+22);assert.equal(f.app.modal,null,state);assert.equal(page.shown,shown);assert.equal(page.index,index);assert.equal(f.app.comicPage,null);
 }
});

test('a close press owns the whole pointer sequence, even when dragged across the page or cancelled',async()=>{
 const f=await comicFixture({index:1,cleared:3});wireInput(f);redraw(f);const close=closeHit(f).r,x=close.x+22,y=close.y+22,page=f.app.comicPage;
 for(const [dx,dy]of [[180,0],[-100,0],[100,180]]){
  pointInput(f,'down',x,y);assert.equal(f.app.comicGesture,null);assert.equal(f.stage.down,null);
  pointInput(f,'move',x+dx,y+dy);pointInput(f,'up',x+dx,y+dy);
  assert.equal(f.app.modal,'levelComic');assert.equal(page.shown,0);assert.equal(page.index,1);assert.equal(page.turn,undefined);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicClosePress,null);
 }
 pointInput(f,'down',x,y);pointInput(f,'cancel',x,y);pointInput(f,'up',x,y);assert.equal(f.app.modal,'levelComic');
 pointInput(f,'down',x,y);f.app.input({type:'down',points:[{id:1,x,y},{id:2,x:x+5,y}],changed:[{id:2,x:x+5,y}]});pointInput(f,'up',x,y);assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicClosePress,null);
 pointInput(f,'down',x,y);pointInput(f,'move',x+180,y+100);pointInput(f,'up',x,y);assert.equal(f.app.modal,null);assert.equal(page.shown,0);assert.equal(page.index,1);
});

test('close from a completed room preserves its receipt and route, including the ending card',async()=>{
 for(const ending of [false,true]){
  const f=await comicFixture({index:0,cleared:3});wireInput(f);f.app.closeModal();
  const levelClear={levelId:'ch1-3',nextLevelId:'ch1-4'},room={snapshot:{levelId:'ch1-3',completedAt:123,mobileResult:{coins:20,levelClear}}};
  f.app.room=room;f.app.route='room';f.app.modal='completion';let cleaned=0;f.platform.onBack=()=>()=>cleaned++;
  f.app.openLevelComic('ch1-3',{fromClear:true});if(ending)f.app.turnComic(3);redraw(f);const close=closeHit(f).r;
  tap(f,close.x+22,close.y+22);assert.equal(f.app.modal,'completion');assert.equal(f.app.route,'room');assert.equal(f.app.room,room);assert.equal(f.app.room.snapshot.mobileResult.levelClear,levelClear);
  assert.equal(f.app.comicPage,null);assert.equal(f.app.comicBack,undefined);assert.equal(cleaned,1);assert.equal(f.app.comicGesture,null);assert.equal(f.app.comicClosePress,null);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicSnap,undefined);assert.equal(f.app.comicHintUntil,0);
 }
});

test('timeline card, replay and ending close preserve chapter/scroll and restore working story actions',async()=>{
 for(const entry of ['card','replay','ending']){
  const f=await comicFixture({width:390,height:844,index:0,cleared:6});wireInput(f);f.app.closeModal();f.app.route='chapter';f.app.storyChapterId='ch1';f.app.scroll=97;
  let cleaned=0;f.platform.onBack=()=>()=>cleaned++;f.clear();f.app.drawChapter();
  if(entry==='card')f.hits[0].fn();else f.buttons.find(button=>button.label==='从头看').fn();
  assert.equal(f.app.modal,'levelComic');if(entry==='ending')f.app.turnComic(6);
  f.app.comicDrag=35;f.app.comicSnap={started:Date.now(),offset:35};redraw(f);const close=closeHit(f).r;tap(f,close.x+22,close.y+22);
  assert.equal(f.app.modal,null);assert.equal(f.app.route,'chapter');assert.equal(f.app.storyChapterId,'ch1');assert.equal(f.app.scroll,97);
  assert.equal(f.app.comicPage,null);assert.equal(f.app.comicBack,undefined);assert.equal(cleaned,1);assert.equal(f.app.comicGesture,null);assert.equal(f.app.comicClosePress,null);assert.equal(f.app.comicDrag,0);assert.equal(f.app.comicSnap,undefined);assert.equal(f.app.comicHintUntil,0);assert.equal(f.stage.down,null);
  f.clear();f.app.drawChapter();assert.ok(!f.hits.some(hit=>hit.r.w===f.stage.w&&hit.r.h===f.stage.h),'no reader blocker remains after redraw');
  const replay=f.buttons.find(button=>button.label==='从头看').r;tap(f,replay.x+replay.w/2,replay.y+replay.h/2);assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicPage.sequence,true);
 }
});

test('native and history back share one close, unregister the same callback, and ignore stale native calls after reopening',()=>{
 for(const first of ['native','history','close']){
  const h=historyHost(),registered=[],removed=[],native={onBackPress(fn){registered.push(fn);},offBackPress(fn){removed.push(fn);}},onBack=createComicBack(h.host,()=>native);
  let calls=0;const off=onBack(()=>{calls++;off();return true;}),back=registered[0];assert.equal(registered.length,1);
  if(first==='native'){assert.equal(back(),true);h.flush();}else if(first==='history')h.pop();else{off();h.flush();}
  assert.deepEqual(removed,[back]);assert.equal(back(),false);assert.equal(calls,first==='close'?0:1);off();assert.equal(removed.length,1);
  const second=onBack(()=>{calls++;return true;});assert.equal(registered.length,2);assert.equal(back(),false);assert.equal(registered[1](),true);h.flush();assert.equal(calls,first==='close'?1:2);second();assert.deepEqual(removed,registered);
 }
 for(const native of [undefined,{}, {onBackPress(){throw Error('cannot clean up an incomplete API');}}]){
  const h=historyHost(),onBack=createComicBack(h.host,()=>native);let calls=0;const off=onBack(()=>{calls++;return true;});h.pop();assert.equal(calls,1);off();
 }
});

test('TapTap history pushes once, hardware back invokes once, alternate cleanup ignores its own pop, and fast reopen is safe',()=>{
 const h=historyHost(),onBack=createComicBack(h.host);let calls=0,off=onBack(()=>{calls++;off();return true;});assert.equal(h.host.history.state.jigsawComic,1);assert.deepEqual(h.counts(),{pushes:1,backs:0});h.pop();assert.equal(calls,1);assert.deepEqual(h.host.history.state,{original:true});off();assert.equal(h.counts().backs,1);
 off=onBack(()=>{calls++;return true;});off();assert.equal(h.counts().backs,2);h.flush();assert.equal(calls,1);
 off=onBack(()=>{calls++;return true;});off();const second=onBack(()=>{calls++;return true;});assert.equal(h.counts().pushes,3);h.flush();assert.equal(h.counts().pushes,4);assert.equal(calls,1);h.pop();assert.equal(calls,2);second();
 const third=onBack(()=>{calls++;return true;});h.host.history.pushState({other:1},'');const before=h.counts().backs;third();assert.equal(h.counts().backs,before,'do not remove an unrelated top entry');
});

test('web adapter forwards arrows and only prevents handled keys; history integration is TapTap-only',t=>{
 const h=historyHost(),window=h.host,document=new EventTarget(),canvas=new EventTarget();Object.assign(window,{innerWidth:800,innerHeight:600,devicePixelRatio:1});Object.assign(document,{baseURI:'https://game.test/',body:{},hidden:false});document.activeElement=document.body;
 Object.assign(canvas,{style:{},getAttribute:()=>null,setAttribute(){},removeAttribute(){},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})});
 const restore=[];for(const [key,value]of Object.entries({window,document,location:{href:'https://game.test/',origin:'https://game.test'}})){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});restore.push(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
 const config={apiBase:'/api',assetBase:'/assets',gameName:'test'},web=createWebPlatform({...config,id:'web'},canvas),wechat=createWebPlatform({...config,id:'wechat'},canvas),tap=createWebPlatform({...config,id:'taptap'},canvas);
 assert.equal(web.onBack,undefined);assert.equal(wechat.onBack,undefined);let calls=0,off=tap.onBack(()=>{calls++;off();return true;});assert.equal(h.counts().pushes,1);h.pop();assert.equal(calls,1);
 // The adapter discovers the current host when the reader opens, not when the platform is created.
 const registered=[],removed=[];window.tap={onBackPress:fn=>registered.push(fn),offBackPress:fn=>removed.push(fn)};
 const f=fixture({data:levels(3)});f.platform.onBack=tap.onBack;f.app.route='chapter';f.app.openLevelComic('ch1-1');assert.equal(registered.length,1);
 assert.equal(registered[0](),true);assert.equal(f.app.modal,null);assert.equal(f.app.comicPage,null);assert.equal(f.app.comicBack,undefined);assert.deepEqual(removed,registered);h.flush();assert.equal(registered[0](),false);
 f.app.openLevelComic('ch1-1');assert.equal(registered.length,2);f.app.closeModal();assert.deepEqual(removed,registered);h.flush();
 let handled=false;const inputs=[],stop=web.onInput(input=>{inputs.push(input);return handled;});t.after(()=>{stop();restore.forEach(fn=>fn());});
 for(const key of ['ArrowLeft','ArrowRight']){for(handled of [false,true]){const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,code:key});window.dispatchEvent(event);assert.equal(event.defaultPrevented,handled);assert.equal(inputs.at(-1).key,key);assert.equal(inputs.at(-1).keyDown,true);}}
 document.activeElement={tagName:'TEXTAREA'};const before=inputs.length,event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'ArrowRight',code:'ArrowRight'});window.dispatchEvent(event);assert.equal(inputs.length,before);assert.equal(event.defaultPrevented,false);
});

test('taps outside the comic page never reach the story page drawn underneath',async()=>{
 for(const [width,height]of [[844,390],[793,360],[360,793]]){
  const f=await comicFixture({width,height,index:0,cleared:3});wireInput(f);let reached=0;f.clear();f.stage.hit({x:0,y:0,w:f.stage.w,h:f.stage.h},()=>reached++);f.app.drawModal();const r=f.app.modalArea;
  for(const [x,y]of [[2,2],[r.x+r.w/2,r.y+r.h+7],[f.stage.w-2,f.stage.h-2],[2,r.y+r.h/2]])tap(f,x,y);
  assert.equal(reached,0,width+'x'+height);assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicPage.shown,0,'a margin tap does not reveal text');
 }
});
