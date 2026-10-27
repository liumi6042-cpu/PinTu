import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture,levels,artwork} from './mobile-level-card-fixture.mjs';

const bundle=await build({stdin:{contents:'export * from "./mobile/story-comic";export {Stage} from "./mobile/ui";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {comicFor,cropCover,comicLayout,comicLines,comicTextCount,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
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
 for(const [w,h]of [[844,390],[390,844],[568,320]]){
  const landscape=w>h,{page,panels,gutter}=comicLayout(w,h,landscape);inside(page,{x:0,y:0,w,h});assert.equal(panels.length,4);
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

test('comic wrapping keeps closing punctuation with the previous glyph without losing text',()=>{
 for(const text of ['爷爷想不起来早餐店开张那天了……','“回忆碎了，就把它拼回来。”','别哭，我们把它拼回来！']){
  const lines=comicLines(text,42,t=>[...t].length*7);assert.equal(lines.join(''),text);assert.ok(lines.every(line=>!/[。，、！？；：…）」』”’]/.test(line[0])));
 }
});

async function comicFixture({width=844,height=390,index=3,fromClear=false,sequence=false,cleared=6}={}){
 const f=fixture({width,height,data:levels(cleared)});await artwork(f);f.app.stopCheers=()=>{};f.app.openLevelComic('ch1-'+(index+1),{fromClear,sequence});return f;
}
function reveal(f){f.app.advanceComic(true);f.clear();f.app.drawModal();}

for(const [width,height]of [[844,390],[390,844]])test(`${width}×${height} renders four crops, reveals one segment per click and keeps controls in bounds`,async()=>{
 const f=await comicFixture({width,height,cleared:4});f.app.drawModal();assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.src==='/chapter-3.webp'));assert.equal(f.app.comicPage.fromClear,false);
 const comic=comicFor(chapter,3,{});assert.equal(f.app.comicPage.shown,0);assert.equal(f.texts.some(t=>t.includes('午后，')),false);
 for(let i=1;i<=comicTextCount(comic);i++){f.hits.find(hit=>hit.r===f.app.modalArea).fn();assert.equal(f.app.comicPage.shown,i);f.clear();f.app.drawModal();}
 assert.ok(f.texts.includes('下一格 · 傍晚'));assert.ok(f.texts.includes('午后，店门口的铃响了。'));assert.ok(f.texts.includes('别哭，我们把它拼回来！'));
 assert.ok(f.buttons.some(b=>b.label==='拼第 5 格（30 片）'));
 for(const b of f.buttons)inside(b.r,{x:0,y:0,w:width,h:height});for(let i=0;i<f.buttons.length;i++)for(const b of f.buttons.slice(i+1))assert.equal(overlap(f.buttons[i].r,b.r),false);
 const index=f.app.comicPage.index;f.app.advanceComic();assert.equal(f.app.comicPage.index,index,'single page stops after its last text');
 f.buttons.find(b=>b.label==='上一页').fn();assert.equal(f.app.comicPage.index,2);assert.equal(f.app.comicPage.shown,0);
});

test('sequence starts at one, reads all six pages, labels the ending and ends without opening a room',async()=>{
 const f=await comicFixture({index:4,sequence:true});assert.equal(f.app.comicPage.index,0);
 for(let index=0;index<6;index++){assert.equal(f.app.comicPage.index,index);reveal(f);assert.equal(f.images.length,4);assert.ok(!f.buttons.some(b=>b.label.startsWith('拼第')));if(index<5)f.app.advanceComic();}
 assert.ok(f.texts.includes('第 1 章 完'));f.app.advanceComic();assert.equal(f.app.comicPage.index,5);f.buttons.find(b=>b.label==='结束').fn();assert.equal(f.app.modal,null);assert.equal(f.created.length,0);
});

test('fromClear splits from the full-image crop projection, ordinary reopening only fades panels, reduced motion draws four immediately',async t=>{
 const previous=globalThis.matchMedia;let reduced=false,now=0;globalThis.matchMedia=()=>({matches:reduced});t.after(()=>{if(previous)globalThis.matchMedia=previous;else delete globalThis.matchMedia;});t.mock.method(Date,'now',()=>now);
 for(reduced of [false,true]){
  for(const fromClear of [false,true]){
   const f=await comicFixture({fromClear});const start=f.app.comicPage.started;now=start;f.app.drawModal();
   assert.equal(f.images.length,fromClear&&!reduced?5:4);
   if(fromClear&&!reduced){const full=f.images[0];assert.deepEqual(full.crop,[0,0,1,1]);assert.equal(f.images[1].zoom,0);f.clear();now=start+400;f.app.drawModal();assert.ok(f.images[1].zoom>0&&f.images[1].zoom<1);f.clear();now=start+900;f.app.drawModal();assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.alpha===1),'panels must stay visible after the split');}
   else{const {panels}=comicLayout(f.stage.w,f.stage.h,true);f.images.forEach((image,index)=>assert.deepEqual(image.r,panels[index]));}
   f.app.advanceComic(true);f.clear();f.app.drawModal();assert.ok(f.texts.includes('下一格 · 傍晚'));
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
