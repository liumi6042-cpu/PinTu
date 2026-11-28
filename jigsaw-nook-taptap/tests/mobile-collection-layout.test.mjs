import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({
 absWorkingDir:root,
 stdin:{
  contents:`
   export {GameApp} from "./mobile/app";
   export {ALBUM_FILTERS,albumCardHeight,albumMatchesFilter,isAlbumCompleted,isAlbumUnlocked,sortCollectionAlbums} from "./mobile/panels/collection-panel";
  `,
  resolveDir:root,
  loader:'ts',
 },
 bundle:true,
 write:false,
 format:'esm',
 platform:'node',
 target:'es2020',
});
const {
 GameApp,
 ALBUM_FILTERS,
 albumMatchesFilter,
 isAlbumCompleted,
 isAlbumUnlocked,
 sortCollectionAlbums,
}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

function sampleCollection({withCompleted=true,withAd=true}={}){
 const img=(id,title,collected=false)=>({id,title,src:'/'+id+'.webp',thumbSrc:'/'+id+'-t.webp',collected,difficulties:collected?[48]:[]});
 const albums=[
  {id:'coin-locked',title:'奇屋剖面图鉴',description:'切开建筑外墙',images:[img('q1','灯塔'),img('q2','钟楼')],collected:0,total:6,milestones:[{id:'m1',target:3,coins:30,earned:false,claimed:false,claimable:false}]},
  {id:'coin-reward-dec',title:'花间灯火',description:'花影与灯火',images:[img('f1','花窗'),img('f2','夜灯')],collected:1,total:6,milestones:[{id:'m1',target:3,coins:30,earned:false,claimed:false,claimable:false},{id:'m2',target:6,coins:60,decorationId:'blossom-lantern',earned:false,claimed:false,claimable:false}]},
  ...(withAd?[
   {id:'ad-unstarted',title:'四季食光手账',description:'看广告解锁',unlock:'ad',adRequired:2,dailyLimit:2,dailyUsed:0,dailyUnlocked:0,dailyUnlockLimit:1,images:[img('a1','早茶')],collected:0,total:6,milestones:[]},
   {id:'ad-started',title:'治愈时光',description:'看广告解锁',unlock:'ad',adRequired:2,dailyLimit:2,dailyUsed:1,dailyUnlocked:1,dailyUnlockLimit:1,images:[img('h1','小店',true)],collected:1,total:10,milestones:[{id:'m1',target:3,coins:30,earned:false,claimed:false,claimable:false}]},
  ]:[]),
  {id:'free-animals',title:'纸艺 · 动物世界',description:'纸艺小动物',images:[img('z1','狐狸'),img('z2','小鹿')],collected:1,total:6,milestones:[{id:'m1',target:3,coins:30,earned:false,claimed:false,claimable:false}]},
  ...(withCompleted?[
   {id:'coin-done',title:'缤纷假日',description:'假日集市',images:[img('d1','集市',true),img('d2','晚霞',true)],collected:2,total:2,milestones:[{id:'m1',target:2,coins:60,earned:true,claimed:true,claimable:false}]},
  ]:[]),
 ];
 const packs=[
  {id:'coin-locked',title:'奇屋剖面图鉴',description:'切开建筑外墙',imageIds:['q1','q2'],price:900,owned:false,images:albums[0].images,coverSrc:'/cover-q.webp'},
  {id:'coin-reward-dec',title:'花间灯火',description:'花影与灯火',imageIds:['f1','f2'],price:180,owned:false,images:albums[1].images,coverSrc:'/cover-f.webp'},
  ...(withAd?[
   {id:'ad-unstarted',title:'四季食光手账',description:'看广告解锁',imageIds:['a1'],price:1,owned:false,unlock:'ad',unlocked:0,adRequired:2,images:albums[2].images,coverSrc:'/cover-a.webp'},
   {id:'ad-started',title:'治愈时光',description:'看广告解锁',imageIds:['h1'],price:1,owned:false,unlock:'ad',unlocked:1,adRequired:2,images:albums[3].images,coverSrc:'/cover-h.webp'},
  ]:[]),
  ...(withCompleted?[
   {id:'coin-done',title:'缤纷假日',description:'假日集市',imageIds:['d1','d2'],price:120,owned:true,images:albums.at(-1).images,coverSrc:'/cover-d.webp'},
  ]:[]),
 ];
 const decorations=[{id:'blossom-lantern',title:'花间小灯',description:'灯火装饰',cost:0,owned:false,equipped:false,kind:'cursor',artKey:'lantern',color:'#ce788b',source:'album',albumId:'coin-reward-dec'}];
 return {profile:{code:'p1',name:'测试玩家',level:1},wallet:{coins:500,fragments:20},albums,packs,decorations,equipped:null,serverTime:1800000000000};
}

function collectionFixture({width=390,height=844,configId,collection=sampleCollection()}={}){
 const platformConfigId=configId??(width>=1000?'web':'taptap');
 const frames=[],images=[],glyphs=[],buttons=[],hits=[],icons=[],meters=[],panels=[],fills=[],saved=[];
 const ctx={
  fillStyle:'',strokeStyle:'',globalAlpha:1,font:'',
  createLinearGradient:()=>({addColorStop(){}}),
  save(){saved.push({fillStyle:this.fillStyle,globalAlpha:this.globalAlpha});},
  restore(){Object.assign(this,saved.pop()??{});},
  fillRect(x,y,w,h){fills.push({r:{x,y,w,h},color:this.fillStyle});},
  rect(){},beginPath(){},clip(){},
 };
 const clips=[],offset={x:0,y:0};
 const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.w,b.x+b.w),bot=Math.min(a.y+a.h,b.y+b.h);return {x,y,w:Math.max(0,r-x),h:Math.max(0,bot-y)};};
 const stage={
  w:width,h:height,theme:'light',font:'sans-serif',ctx,offset,
  palette:{gold:'#d7ad68',onAccent:'#fffaf0',ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c',berry:'#a85567',cream:'#fff9f0',placeholder:'#efdfcc',disabled:'#b8a39e'},
  color:value=>value,
  measure:(text,size=12)=>Array.from(String(text)).length*(size*0.75),
  text:(value,x,y,size,color,weight,maxWidth)=>glyphs.push({value:String(value),x,y,size,color,weight,maxWidth}),
  wrap:(value,x,y,maxW,size)=>size*1.4*Math.max(1,Math.ceil(Array.from(String(value)).length*(size*0.75)/Math.max(20,maxW))),
  frame:(r,key)=>frames.push({r:{...r},key}),
  panel:(r,tone='cream')=>panels.push({r:{...r},tone}),
  button:(r,label,fn,opts)=>buttons.push({r:{...r},label,fn,opts}),
  image:(src,r,mode)=>images.push({src,r:{...r},mode}),
  icon:(key,r)=>icons.push({key,r:{...r}}),
  decoration(){},
  meter:(r,value)=>meters.push({r:{...r},value}),
  ornaments(){},
  hit:(r,fn)=>{let clipped={...r};for(const c of clips)clipped=intersect(clipped,c);if(clipped.w>0&&clipped.h>0)hits.push({r:clipped,fn});},
  clip:(r,draw)=>{clips.push({...r});try{draw();}finally{clips.pop();}},
  retryImages(){},
  input(){},
  invalidate(){},
  setTheme(){},
 };
 const platform={
  canvas:{},
  config:{id:platformConfigId,apiBase:'https://game.test/api'},
  initialQuery:{},
  viewport:()=>({width,height,top:0,bottom:0}),
  storage:{get:()=>null,set(){},remove(){}},
  randomId:()=>'req-1',
  onHide:()=>()=>{},
  onShow:()=>()=>{},
 };
 const client={
  account:{id:'owner-1'},
  profile:{code:'self',collection:{coins:500,fragments:20}},
  config:{capabilities:{energy:false}},
  asset:value=>value,
  start:async()=>{},
 };
 const app=new GameApp(platform,client,stage);
 Object.assign(app,{
  ready:true,route:'collection',collectionTab:'albums',albumFilter:'all',collection,
  bodyTop:64,bodyBottom:height-24,contentOrigin:{x:0,y:0},scroll:0,extent:0,
  loadCollection:async()=>{},loadGallery:async()=>{},loadTasks:async()=>{},loadLevels:async()=>{},loadLobby:async()=>{},
 });
 const cardHits=[];
 const origDrawCard=app.drawAlbumCard;
 app.drawAlbumCard=(data,album,r,selected,compact)=>{
  const bottom=origDrawCard.call(app,data,album,r,selected,compact);
  cardHits.push({id:album.id,r:{...r,h:bottom-r.y},selected,compact});
  return bottom;
 };
 const clear=()=>{frames.length=images.length=glyphs.length=buttons.length=hits.length=icons.length=meters.length=panels.length=fills.length=cardHits.length=0;};
 const render=(startTop=64)=>{clear();app.bodyTop=startTop;app.bodyBottom=height-24;app.drawCollection();return {cards:[...cardHits],frames:[...frames],images:[...images],glyphs:[...glyphs],buttons:[...buttons],hits:[...hits],icons:[...icons],panels:[...panels],fills:[...fills]};};
 return {app,stage,render};
}

test('sortCollectionAlbums prioritizes free, unlocked/active, ad-unlock, completed, then unowned coin packs',()=>{
 const data=sampleCollection();
 const packFor=id=>data.packs.find(p=>p.id===id)??null;
 const sorted=sortCollectionAlbums(data.albums,packFor);
 assert.deepEqual(sorted.map(a=>a.id),[
  'free-animals',
  'coin-reward-dec',
  'ad-started',
  'ad-unstarted',
  'coin-done',
  'coin-locked',
 ]);
 assert.equal(isAlbumUnlocked(sorted[0],packFor('free-animals')),true);
 assert.equal(isAlbumUnlocked(sorted[3],packFor('ad-unstarted')),false);
 assert.equal(isAlbumCompleted(sorted[4]),true);
 assert.equal(albumMatchesFilter(sorted[3],packFor('ad-unstarted'),'ad'),true);
 assert.equal(albumMatchesFilter(sorted[1],packFor('coin-reward-dec'),'coin'),true);
 assert.equal(albumMatchesFilter(sorted[5],packFor('coin-locked'),'unlocked'),false);
});

test('collection album category filter chips filter cards, handle empty state, and preserve listView navigation',()=>{
 const {app,render}=collectionFixture({width:390,height:844});
 let out=render();

 // All 5 filter pills draw cleanly above bodyTop.
 const chipLabels=ALBUM_FILTERS.map(item=>item.label);
 assert.deepEqual(chipLabels,['全部','已解锁','看广告','金币包','已集齐']);
 for(const label of chipLabels){
  const g=out.glyphs.find(item=>item.value===label);
  assert.ok(g,'renders filter chip '+label);
  assert.ok(g.y<app.bodyTop,'chip bar sits above scrollable grid bodyTop');
 }
 assert.equal(out.cards.length,6);

 // Every card (including the free !pack album) renders its cover thumbnail cleanly inside card bounds.
 for(const card of out.cards){
  const cover=out.images.find(img=>img.r.x>=card.r.x&&img.r.y>=card.r.y&&img.r.x+img.r.w<=card.r.x+card.r.w&&img.r.y+img.r.h<=card.r.y+card.r.h);
  assert.ok(cover,'card '+card.id+' renders a contained cover artwork');
  assert.ok(cover.r.h>=80,'card '+card.id+' has balanced non-squished cover height');
 }
 assert.ok(out.glyphs.some(g=>g.value==='免费'),'free album shows 免费 badge');
 assert.ok(out.glyphs.some(g=>g.value==='赠装饰'),'decoration milestone album shows 赠装饰 badge');

 const tapChip=label=>{
  const g=out.glyphs.find(item=>item.value===label);
  assert.ok(g);
  const hit=out.hits.find(h=>g.x>=h.r.x&&g.x<=h.r.x+h.r.w&&g.y>=h.r.y&&g.y<=h.r.y+h.r.h);
  assert.ok(hit,'chip '+label+' has a matching hit box');
  hit.fn();
 };

 // Filter: 看广告 -> only ad albums; scroll resets cleanly; re-tapping toggles back to 'all'.
 app.scroll=140;
 tapChip('看广告');
 assert.equal(app.albumFilter,'ad');
 assert.equal(app.scroll,0,'switching album category resets scroll to top');
 out=render();
 assert.deepEqual(out.cards.map(c=>c.id),['ad-started','ad-unstarted']);

 tapChip('看广告');
 assert.equal(app.albumFilter,'all');
 out=render();
 assert.equal(out.cards.length,6);

 // Filter: 已解锁 -> free + collected coin + started ad + completed coin (excludes untouched ad & locked coin).
 tapChip('已解锁');
 assert.equal(app.albumFilter,'unlocked');
 out=render();
 assert.deepEqual(out.cards.map(c=>c.id),['free-animals','coin-reward-dec','ad-started','coin-done']);

 // Filter: 金币包 -> coin packs only.
 tapChip('金币包');
 assert.equal(app.albumFilter,'coin');
 out=render();
 assert.deepEqual(out.cards.map(c=>c.id),['coin-reward-dec','coin-done','coin-locked']);

 // Navigate away and return -> preserves albumFilter in saved ListView.
 app.navigate('help');
 app.back();
 assert.equal(app.route,'collection');
 assert.equal(app.albumFilter,'coin');

 // Empty filter state offers one-tap reset button back to 'all'.
 const emptyFix=collectionFixture({width:390,height:844,collection:sampleCollection({withCompleted:false})});
 emptyFix.app.albumFilter='completed';
 const emptyOut=emptyFix.render();
 assert.equal(emptyOut.cards.length,0);
 assert.ok(emptyOut.glyphs.some(g=>g.value==='还没有集齐的图集，先去拼完一本吧'));
 const resetBtn=emptyOut.buttons.find(b=>b.label==='查看全部图集');
 assert.ok(resetBtn);
 resetBtn.fn();
 assert.equal(emptyFix.app.albumFilter,'all');
});

test('album grids adapt cleanly across phone portrait (2-col), tablet portrait (3-col), landscape (3/4-col), and desktop (2-col + detail)',()=>{
 // 1. Phone portrait (390x844 and narrow 320x740): 2 balanced columns, no horizontal overflow.
 for(const [width,height]of [[390,844],[320,740]]){
  const {render}=collectionFixture({width,height});
  const out=render();
  const cols=new Set(out.cards.map(c=>Math.round(c.r.x)));
  assert.equal(cols.size,2,width+'px portrait renders 2 album columns');
  assert.ok(out.cards.every(c=>c.r.x>=12&&c.r.x+c.r.w<=width-12),width+'px cards fit within viewport');
  assert.equal(new Set(out.cards.map(c=>Math.round(c.r.h))).size,1,'row cards share identical uniform height');
 }

 // 2. Tablet portrait (768x1024): 3 columns.
 {
  const {render}=collectionFixture({width:768,height:1024});
  const out=render();
  assert.equal(new Set(out.cards.map(c=>Math.round(c.r.x))).size,3);
 }

 // 3. Phone landscape (844x390 -> 3 cols compact, 960x420 -> 4 cols compact).
 {
  const f=collectionFixture({width:844,height:390});
  const out=f.render(48);
  assert.equal(new Set(out.cards.map(c=>Math.round(c.r.x))).size,3);
  assert.ok(out.cards.every(c=>c.compact===true));
  // Open first album -> detail mode hides filter bar.
  f.app.openAlbum(out.cards[0].id);
  const detailOut=f.render(48);
  assert.equal(detailOut.cards.length,0);
  assert.ok(detailOut.buttons.some(b=>b.label==='‹ 图集'));
 }
 {
  const {render}=collectionFixture({width:960,height:420});
  const out=render(48);
  assert.equal(new Set(out.cards.map(c=>Math.round(c.r.x))).size,4);
 }

 // 4. Desktop (1280x800): 2-column grid in left column, detail pane on right, and graceful empty filter detail.
 {
  const f=collectionFixture({width:1280,height:800,configId:'web'});
  const out=f.render(12);
  assert.equal(new Set(out.cards.map(c=>Math.round(c.r.x))).size,2,'desktop left column uses 2 album columns');
  assert.ok(Math.max(...out.cards.map(c=>c.r.x+c.r.w))<640,'left grid stays left of right detail pane');
  assert.ok(out.glyphs.some(g=>g.value==='免费'&&g.y>f.app.bodyTop),'grid content sits below pinned chip bar');

  // Empty ad filter on desktop clears right pane cleanly without crashing.
  const emptyDesktop=collectionFixture({width:1280,height:800,configId:'web',collection:sampleCollection({withAd:false})});
  emptyDesktop.app.albumFilter='ad';
  const emptyOut=emptyDesktop.render(12);
  assert.equal(emptyOut.cards.length,0);
  assert.ok(emptyOut.glyphs.some(g=>g.value.includes('换个分类看看')));
 }
});
