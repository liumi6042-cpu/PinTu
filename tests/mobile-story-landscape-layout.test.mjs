import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,levels,artwork} from './mobile-level-card-fixture.mjs';
import {createWebPlatform,uiScale} from '../mobile/platform-web.ts';

const sizes=[[793,360],[800,360],[640,360],[844,390],[667,375],[1920,1080]];
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h;
function record(f){
 const texts=[],meters=[];
 // Conservative CJK em widths and Latin .6em widths, with Stage.text's ellipsis behavior.
 f.stage.measure=(value,size=14)=>[...String(value)].reduce((sum,char)=>sum+size*(/[^\x00-\x7f]/.test(char)?1:.6),0);
 f.stage.text=(value,x,y,size=14,_color,weight=500,maxWidth)=>{
  let text=String(value);if(maxWidth&&f.stage.measure(text,size,weight)>maxWidth){while(text.length>1&&f.stage.measure(text+'…',size,weight)>maxWidth)text=text.slice(0,-1);text+='…';}
  texts.push({value:String(value),text,r:{x,y,w:f.stage.measure(text,size,weight),h:size}});
 };
 f.stage.textMiddle=(value,x,cy,size=14)=>texts.push({value:String(value),r:{x,y:cy-size/2,w:f.stage.measure(value,size),h:size}});
 f.stage.meter=r=>meters.push({r});f.stage.isPressed=()=>false;
 return {texts,meters};
}

for(const [width,height]of sizes)for(const count of [4,6,8])for(const cleared of [0,3,count])test(`${width}×${height}, ${cleared}/${count}: story rectangles stay separate beside navigation`,async()=>{
 const f=fixture({width,height,data:levels(cleared)});await artwork(f);
 const chapter=f.app.levels.chapters[0],source=chapter.levels;
 chapter.levels=Array.from({length:count},(_,index)=>({...source[index%6],id:'chapter-two-'+index,timeLabel:'上午',line:'这是一句很长很长的台词，需要在小卡片内部显示。',status:index<cleared?'cleared':index===cleared?'unlocked':'locked'}));
 chapter.title='奶奶的小店与新的旅程';f.app.levels.chapters.unshift({...chapter,id:'previous',levels:[]});
 f.app.levels.current=chapter.levels.find(level=>level.status==='unlocked')??null;f.app.route='chapter';
 if(width<1000){f.stage.w=width-72;f.platform.setOrientation=async()=>{};f.app.drawHeader();f.app.bodyBottom=height-12;}
 else{f.app.drawDesktopShell();f.stage.w=f.app.sceneArea.w;f.stage.h=f.app.sceneArea.h;f.app.bodyTop=12;f.app.bodyBottom=f.stage.h-12;}
 f.clear();const {texts,meters}=record(f),result=f.app.drawChapter(chapter,f.app.levels);
 const cards=f.strokes.map(({r})=>({x:r.x-1,y:r.y-1,w:r.w+2,h:r.h+2})),bounds={x:(f.stage.w-Math.min(1400,f.stage.w-24))/2,y:f.app.bodyTop,w:Math.min(1400,f.stage.w-24),h:f.app.bodyBottom-f.app.bodyTop};
 assert.equal(cards.length,count);assert.ok(result.cardSize.h>=44);assert.ok(result.cardSize.h<=92);assert.ok(Math.abs(result.cardSize.w/result.cardSize.h-168/92)<1e-12);
 const external=texts.filter(text=>!cards.some(card=>inside(text.r,card)));
 assert.ok(external.some(text=>text.value==='第 2 章 · '+chapter.title));assert.ok(external.some(text=>text.value===`${cleared} / ${count} 格`));assert.ok(external.some(text=>text.value.startsWith('拼完一格')));
 // All card content, including truncated speech, must be contained by its card.
 const content=texts.filter(text=>!external.includes(text));assert.ok(content.length>0);
 for(const text of texts)if(!content.includes(text))assert.ok(!cards.some(card=>overlaps(text.r,card)),text.value+' crosses a card');
 const rectangles=[...cards.map((r,i)=>({r,value:'card '+i})),...external,...meters,...f.buttons];
 for(const item of rectangles)assert.ok(inside(item.r,bounds),JSON.stringify({item,bounds}));
 for(let i=0;i<rectangles.length;i++)for(let j=0;j<i;j++)assert.ok(!overlaps(rectangles[i].r,rectangles[j].r),JSON.stringify([rectangles[i],rectangles[j]]));
 const subtitle=external.find(text=>text.value.startsWith('第 2 章'));assert.ok(!overlaps(subtitle.r,result.chapterSwitch));
 assert.ok(!rectangles.filter(item=>!['‹','›'].includes(item.label)).some(item=>overlaps(item.r,result.chapterSwitch)));
 for(const button of f.buttons.filter(item=>['‹','›'].includes(item.label)))assert.ok(inside(button.r,result.chapterSwitch));
 for(let i=2;i<count;i++)assert.ok(cards[i].x-(cards[i-2].x+cards[i-2].w)>=8);
 assert.equal(f.app.extent,0);assert.equal(f.app.scroll,0);
});

test('short body uses a measured single footer row while keeping 44px cards',()=>{
 const f=fixture({width:793,height:360}),{texts}=record(f);f.stage.w=552;f.app.bodyTop=144;f.app.bodyBottom=348;
 const result=f.app.drawChapter();assert.ok(result.cardSize.h>=44);
 const description=texts.find(text=>text.value.startsWith('拼完一格'));assert.equal(description.value,'拼完一格，故事往下走一格');
 for(const {r}of f.buttons)assert.ok(!overlaps(r,description.r));
});

for(const portrait of [false,true])test(`${portrait?'portrait':'landscape'} menu clears shared headers and room chrome`,()=>{
 const [width,height]=portrait?[390,844]:[793,360],menu={x:width-102,y:8,w:94,h:40},f=fixture({width,height});
 f.platform.viewport=()=>({width,height,top:0,bottom:0,menu});f.platform.setOrientation=async()=>{};
 // Exercise the same local page width used by the real nav rail.
 const offset=portrait?0:72;f.stage.w=width-offset;
 for(const route of ['lobby','chapter','gallery','collection','friends','tasks','supplies']){
  f.app.route=route;f.clear();record(f);f.app.drawHeader();
  for(const {r}of [...f.buttons,...f.hits])assert.ok(!overlaps({...r,x:r.x+offset},menu),route+' header');
  if(portrait)assert.ok(f.buttons.every(({r})=>r.y>=menu.y+menu.h+8));
 }
 f.stage.w=width;f.app.route='room';f.app.room={state:{cols:4,rows:4,groups:[]},snapshot:{puzzle:{imageId:'test'},title:'一起拼图',visibility:'solo',members:[]}};f.app.board={};f.app.landscapeToolsOpen=true;
 f.clear();record(f);const top=f.app.roomHeaderTop();f.app.drawRoomTopBar({x:0,y:top,w:width,h:portrait?76:52},portrait?'portrait':'landscape');
 for(const {r}of [...f.buttons,...f.hits])assert.ok(!overlaps(r,menu),'room header '+JSON.stringify(r));
 if(portrait)assert.ok(top>=menu.y+menu.h+8);
 else{
  // Tall SDK menu also intersects the toolbar toggle's normal row.
  menu.h=108;f.clear();f.app.drawToolColumn({x:width-72,y:0,w:72,h:height});
  assert.ok(f.icons.find(icon=>icon.key==='edge').r.y>=menu.y+menu.h+8);
  for(const {r}of f.hits)assert.ok(!overlaps(r,menu),'tool hit '+JSON.stringify(r));
 }
});

test('TapTap menu SDK validation, CSS-to-stage conversion and mobile-only fallback',t=>{
 for(const [key,value]of Object.entries({window:{innerWidth:800,innerHeight:360,devicePixelRatio:3},document:{baseURI:'https://game.test/'},location:{href:'https://game.test/',origin:'https://game.test'}})){
  const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key]);
 }
 const config={id:'taptap',gameName:'拼图',apiBase:'https://game.test/api',assetBase:'https://game.test/assets'},canvas={style:{},getBoundingClientRect:()=>({left:0,top:0,width:window.innerWidth,height:window.innerHeight})},p=createWebPlatform(config,canvas);
 const sdk={left:690,top:10,width:100,height:32};window.tap={setDeviceOrientation(){},getSystemInfoSync:()=>({platform:'android'}),getMenuButtonBoundingClientRect:()=>sdk};
 assert.deepEqual(p.viewport().menu,{x:690,y:10,w:100,h:32});
 for(const size of ['small','large','xlarge']){p.setUiSize(size);const scale=uiScale(size);assert.deepEqual(p.viewport().menu,{x:690/scale,y:10/scale,w:100/scale,h:32/scale});}
 p.setUiSize('auto');
 for(const value of [undefined,{...sdk,width:0},{...sdk,height:-1},{...sdk,left:50},{...sdk,top:120},{...sdk,left:790},{...sdk,top:NaN}]){
  window.tap.getMenuButtonBoundingClientRect=()=>value;assert.deepEqual(p.viewport().menu,{x:700,y:0,w:100,h:48});
 }
 window.tap.getMenuButtonBoundingClientRect=()=>{throw Error('SDK unavailable');};assert.deepEqual(p.viewport().menu,{x:700,y:0,w:100,h:48});
 delete window.tap.getMenuButtonBoundingClientRect;assert.deepEqual(p.viewport().menu,{x:700,y:0,w:100,h:48});
 window.innerWidth=390;window.innerHeight=844;assert.equal(p.viewport().menu,undefined);
 window.tap.getMenuButtonBoundingClientRect=()=>({left:288,top:8,width:94,height:32});assert.deepEqual(p.viewport().menu,{x:288,y:8,w:94,h:32});
 delete window.tap.getMenuButtonBoundingClientRect;window.innerWidth=800;window.innerHeight=360;
 for(const platform of ['Windows','Mac','macOS','PC']){window.tap.getSystemInfoSync=()=>({platform});assert.equal(p.viewport().menu,undefined);}
 delete window.tap.setDeviceOrientation;assert.equal(p.viewport().menu,undefined);
 window.tap.getMenuButtonBoundingClientRect=()=>sdk;assert.equal(createWebPlatform({...config,id:'web'},canvas).viewport().menu,undefined);
});
