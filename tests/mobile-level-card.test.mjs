import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,levels,tick,lobby,artwork} from './mobile-level-card-fixture.mjs';

test('unfinished chapter draws a 34px gold book strip above the daily puzzle and opens the chapter in every layout',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height}),heroes=lobby(f),strip=f.frames.find(frame=>frame.key==='button-gold-normal');assert.ok(strip);assert.equal(strip.r.h,34);assert.ok(strip.r.y+34<heroes[0].y);assert.ok(f.icons.some(icon=>icon.key==='book'));assert.ok(f.texts.includes('拾光物语 3/6'));assert.ok(f.texts.includes('继续第 4 关 ›'));assert.equal(f.frames.filter(frame=>frame.key.startsWith('button-')).length,1);
  f.hits.find(hit=>hit.r===strip.r).fn();await tick();assert.equal(f.app.route,'chapter');assert.equal(f.app.navVisible,false);assert.equal(f.created.length,0);
 }
});

test('all-cleared and unavailable chapters preserve the lobby layout without a strip',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const draw=data=>{const f=fixture({width,height,data}),heroes=lobby(f);return {heroes,frames:f.frames,texts:f.texts,buttons:f.buttons.map(({r,label})=>({r,label}))};},baseline=draw(null);
  for(const data of [levels(6),levels(0,'unavailable')])assert.deepEqual(draw(data),baseline);
 }
});

test('landscape daily artwork uses the height left by the strip and keeps normal daily actions',()=>{
 for(const previous of [false,true]){
  const f=fixture({width:844,height:390});f.app.dailyPhoto={id:'daily',title:'窗边',src:'/daily.webp',thumbSrc:'/daily-thumb.webp'};if(previous)f.app.historyRooms=[{id:'previous',pieces:48,placed:5,title:'上次的拼图'}];f.app.drawRoomHeader=(_x,y)=>y+40;f.app.drawRoomGrid=(_x,y)=>y;f.app.drawLobby();
  const card=f.frames.find(frame=>frame.key==='panel-cream').r,image=f.images.find(image=>image.src==='/daily.webp'),button=f.buttons.find(button=>button.label==='开始拼 · 108 片');assert.ok(image);assert.equal(button.r.h,34);assert.equal(card.h,390-20-80-44-(previous?62:0)-48);assert.equal(image.r.h,card.h-f.app.heroTextHeight(true)-8);assert.ok(button.r.y>=image.r.y+image.r.h);assert.ok(button.r.y+button.r.h<=card.y+card.h);
 }
});

test('chapter pages show 0/6 and 3/6 states on the timeline and both current actions launch the configured level',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const cleared of [0,3]){
  const f=fixture({width,height,data:levels(cleared)});await artwork(f);f.app.drawChapter();assert.ok(f.texts.includes('小窝的故事'));assert.ok(f.texts.includes('第 1 章 · 开张'));assert.ok(f.texts.includes(cleared+' / 6 格'));assert.ok(f.texts.includes('第 '+(cleared+1)+' 格'));assert.ok(f.texts.includes(f.app.levels.current.pieces+' 片 · 拼完揭晓'));assert.equal(f.texts.filter(text=>text==='?').length,5-cleared);
  assert.equal(f.images.length,cleared+1);assert.ok(f.images.slice(0,cleared).every(image=>image.alpha===1));const current=f.images.at(-1);assert.equal(current.alpha,.28);assert.equal(current.filter,'grayscale(1) blur(2px)');assert.equal(f.stage.ctx.globalAlpha,1);assert.equal(f.stage.ctx.filter,'none');assert.equal(f.dashes.length,2*(5-cleared));assert.equal(f.strokes.filter(stroke=>stroke.color==='#cf9f52').length,1);
  const cells=f.strokes;assert.equal(cells.length,6);
  const button=f.buttons.find(button=>button.label==='\u62fc\u7b2c '+(cleared+1)+' \u683c\uff08'+f.app.levels.current.pieces+' \u7247\uff09');assert.ok(button);
  if(width>height){assert.equal(f.app.extent,0);assert.ok(button.r.y+button.r.h<=f.app.bodyBottom);}else assert.ok(f.app.extent>0);
  button.fn();await tick();assert.deepEqual(f.created,[{mode:'level',levelId:'ch1-'+(cleared+1),requestId:'request'}]);f.app.route='chapter';f.app.room=null;f.hits.at(-1).fn();await tick();assert.equal(f.created.length,2);assert.equal(f.created[1].levelId,'ch1-'+(cleared+1));
 }
});

test('chapter fallback title, reward text, speech bubbles and scrolling use the configured values',()=>{
 const f=fixture({height:600});f.app.levels.seriesTitle=null;f.client.config.capabilities.energy=false;f.app.levels.chapters[0].levels[0].line='欢迎来小店';f.app.levels.chapters[0].levels[4].line='不能提前看到';f.app.drawChapter();assert.ok(f.texts.includes('小窝的故事'));assert.ok(f.texts.includes('欢迎来小店'));assert.ok(!f.texts.includes('不能提前看到'));assert.ok(!f.texts.some(text=>text.includes('体力')));assert.ok(f.app.extent>f.app.bodyBottom-f.app.bodyTop);const top=f.strokes[0].r.y;f.clear();f.app.scroll=50;f.app.drawChapter();assert.equal(f.strokes[0].r.y,top-50);
 f.client.config.capabilities.energy=true;f.app.levels.firstClearEnergy=17;f.clear();f.app.drawChapter();assert.ok(f.texts.join('').includes('17 体力'));f.clear();f.app.drawChapterStrip({x:12,y:80,w:366,h:34});assert.ok(f.texts.includes('新手章节 3/6'));
});

test('speech bubbles wrap to at most two lines and only then ellipsize',()=>{
 const f=fixture({width:844,height:390}),bubble=line=>{f.clear();f.app.levels.chapters[0].levels[0].line=line;f.app.drawChapter();return f.glyphs.filter(glyph=>glyph.size===11&&glyph.weight===600&&line.startsWith(glyph.value.slice(0,1))&&glyph.value!=='1');};
 const short=bubble('这就是奶奶的店');assert.deepEqual(short.map(glyph=>glyph.value),['这就是奶奶的店']);
 const long='爷'.repeat(30),wrapped=bubble(long);assert.equal(wrapped.length,2);assert.equal(wrapped.map(glyph=>glyph.value).join(''),long);assert.ok(wrapped[1].y>wrapped[0].y);
 const longer='爷'.repeat(60),capped=bubble(longer);assert.equal(capped.length,2);assert.ok(capped[0].value.length<60);
 const fits=wrapped[0].value.length,punct=bubble('爷'.repeat(fits)+'。');assert.equal(punct.length,2);assert.ok(!punct[1].value.startsWith('。'));assert.equal(punct[1].value,'爷。');assert.equal(punct.map(glyph=>glyph.value).join(''),'爷'.repeat(fits)+'。');
});
test('chapter uses the lobby header without phone navigation and handles canvas filter and dash support being absent in a dark palette',async()=>{
 for(const [width,height]of [[390,844],[844,390]]){
  const f=fixture({width,height});f.stage.color=value=>value;f.platform.setOrientation=()=>{};f.app.drawHeader();const header={texts:[...f.texts],icons:[...f.icons],top:f.app.bodyTop,buttons:f.buttons.map(({r,label,opts})=>({r,label,opts}))};f.clear();f.app.route='chapter';f.app.drawHeader();assert.deepEqual({texts:f.texts,icons:f.icons,top:f.app.bodyTop,buttons:f.buttons.map(({r,label,opts})=>({r,label,opts}))},header);assert.equal(f.app.navVisible,false);
 }
 const f=fixture({data:levels(0)});await artwork(f);delete f.stage.ctx.filter;f.stage.ctx.setLineDash=undefined;Object.assign(f.stage.palette,{ink:'#fff2e3',cream:'#332a34',placeholder:'#463644',line:'#85616c'});f.app.drawChapter();assert.equal(f.images.length,1);assert.equal(f.dashes.length,0);const label=f.glyphs.find(glyph=>glyph.value==='第 1 格');assert.equal(label.color,f.stage.palette.cream);assert.notEqual(label.color,f.stage.palette.ink);assert.equal(f.stage.ctx.globalAlpha,1);
});

test('cleared cells open their comic without requests and close directly with Escape or the cross',async()=>{
 const f=fixture();await artwork(f);f.app.stopCheers=()=>{};f.app.drawChapter();const reads=f.reads.length;f.hits[1].fn();assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicPage.levelId,'ch1-2');assert.equal(f.app.comicPage.index,1);assert.equal(f.reads.length,reads);
 f.clear();f.app.drawModal();assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.src==='/chapter-1.webp'));assert.ok(!f.buttons.some(button=>button.label.includes('解锁')||button.label.includes('建房')));
 f.app.input({type:'key',key:'Escape',keyDown:true,points:[],changed:[]});assert.equal(f.app.modal,null);assert.equal(f.app.route,'lobby');
 f.app.openLevelComic('ch1-1');f.clear();f.app.drawModal();f.buttons.find(button=>button.label==='关闭').fn();assert.equal(f.app.modal,null);
 const noPhoto=fixture();noPhoto.app.drawChapter();assert.equal(noPhoto.hits.length,1);noPhoto.app.openLevelComic('ch1-1');assert.equal(noPhoto.app.modal,'levelComic');assert.equal(noPhoto.reads.length,0);
});

test('returning players enter the chapter once, while complete, unavailable, invited, busy and modal starts stay in place',async()=>{
 for(const data of [levels(0),levels(3),levels(6),levels(0,'unavailable')]){
  const f=fixture({data});await f.app.loadInitialContent({});const expected=data.chapters[0].status==='available'&&data.current?'chapter':'lobby';assert.equal(f.app.route,expected);assert.equal(f.created.length,0);f.app.navigate('lobby');await tick();await f.app.loadInitialContent({});assert.equal(f.app.route,'lobby');
 }
 for(const state of [{modal:'settings'},{busy:true},{route:'gallery'},{room:{}}]){const f=fixture();Object.assign(f.app,state);await f.app.loadInitialContent({});assert.equal(f.app.route,state.route??'lobby');assert.equal(f.created.length,0);}
});

test('switching accounts resets entry, completed chapters stay readable and unavailable chapters redirect',async()=>{
 const f=fixture();f.app.ensureListOwner();await f.app.loadInitialContent({});assert.equal(f.app.route,'chapter');f.app.navigate('lobby');await tick();f.client.account={id:'owner-b'};f.app.ensureListOwner();await tick();assert.equal(f.app.route,'chapter');assert.equal(f.app.levelsOwner,'owner-b');assert.equal(f.created.length,0);
 f.app.route='chapter';f.client.json=async()=>levels(6);await f.app.loadLevels();assert.equal(f.app.route,'chapter');assert.equal(f.app.beginnerChapter,null);
 for(const data of [levels(0,'unavailable')]){f.app.route='chapter';f.client.json=async()=>data;await f.app.loadLevels();assert.equal(f.app.route,'lobby');await tick();}
 f.app.route='chapter';f.client.json=async()=>{throw Error('offline');};await f.app.loadLevels();assert.equal(f.app.route,'lobby');await tick();
});

test('level room back returns to the chapter except after the last level or when unavailable; ordinary rooms restore their origin',async()=>{
 for(const [levelId,complete,data,expected]of [['ch1-1',false,levels(),'chapter'],['ch1-6',true,levels(),'lobby'],['ch1-1',false,levels(6),'lobby'],['ch1-1',false,levels(0,'unavailable'),'lobby'],[null,false,levels(),'gallery']]){
  const f=fixture({data});f.app.route='room';f.app.room={snapshot:{...(levelId?{levelId}:{}),mobileResult:{levelClear:{chapterComplete:complete}}}};f.app.roomReturn=f.app.defaultListView('gallery');let left=0;f.app.leaveRoom=()=>{left++;f.app.room=null;};f.app.exitRoom();await tick();assert.equal(left,1);assert.equal(f.app.room,null);assert.equal(f.app.route,expected);assert.equal(f.created.length,0);
 }
});

test('startup fetches levels after ready and auto-launches the first unlocked level only once per account',async t=>{
 t.mock.method(globalThis,'setInterval',()=>1);const f=fixture({data:levels(0),newcomer:true});f.app.ready=false;f.app.levels=null;
 await f.app.start();assert.deepEqual(f.reads.filter(path=>path==='/api/levels'),['/api/levels']);assert.equal(f.events[0],'ready');assert.equal(f.app.route,'room');assert.equal(f.created.length,1);assert.equal(f.storage.get(f.app.chapterStorageKey('auto')),'1');
 const again=fixture({storage:f.storage,data:levels(0),newcomer:true});await again.app.loadInitialContent({});assert.equal(again.created.length,0);
 const other=fixture({owner:'owner-b',storage:f.storage,data:levels(0),newcomer:true});await other.app.loadInitialContent({});assert.equal(other.created.length,1);
});

test('invitation and room links always take priority even if joining fails back to the lobby',async()=>{
 for(const query of [{invite:'ABCDEF'},{inviteCode:'ABCDEF'},{friend:'ABCDEF'},{ref:'ABCDEF'},{room:'a'.repeat(32)},{roomId:'a'.repeat(32)}]){
  const f=fixture({data:levels(0),newcomer:true}),handled=[];f.app.handleQuery=async value=>{assert.equal(f.reads.includes('/api/levels'),false);handled.push(value);};await f.app.loadInitialContent(query);
  assert.deepEqual(handled,[query]);assert.equal(f.app.route,'lobby');assert.equal(f.created.length,0);assert.equal(f.reads.includes('/api/levels'),true);assert.equal(f.storage.has(f.app.chapterStorageKey('auto')),false);await f.app.autoLaunchLevel();assert.equal(f.created.length,0);
 }
});

test('auto entry requires newcomer, no cleared levels anywhere, and an available unlocked ch1-1',async()=>{
 const cases=[{newcomer:false},{newcomer:undefined},{data:levels(1)},{data:levels(0,'unavailable')},{data:levels(6)},{edit:data=>{data.chapters[0].levels[0].status='locked';}},{edit:data=>{data.chapters.push({...levels(1).chapters[0],id:'ch2'});}}];
 for(const item of cases){const data=item.data??levels(0);item.edit?.(data);const f=fixture({data,newcomer:true});if('newcomer'in item)f.client.profile.newcomer=item.newcomer;await f.app.loadInitialContent({});assert.equal(f.created.length,0);assert.equal(f.storage.has(f.app.chapterStorageKey('auto')),false);}
});

test('failed first entry stays in the lobby and consumes the automatic attempt before making the request',async()=>{
 const f=fixture({data:levels(0),newcomer:true});f.client.createRoom=async input=>{assert.equal(f.storage.get(f.app.chapterStorageKey('auto')),'1');f.created.push(input);throw Error('开房失败');};await f.app.loadInitialContent({});assert.equal(f.app.route,'lobby');assert.equal(f.app.busy,false);assert.equal(f.created.length,1);
 await f.app.autoLaunchLevel();f.app.refreshRoute();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.created.length,1);
 const again=fixture({storage:f.storage,data:levels(0),newcomer:true});await again.app.loadInitialContent({});assert.equal(again.created.length,0);
});

test('level launches bypass the ordinary three-room limit while ordinary launches keep it',async()=>{
 const f=fixture();f.client.profile.ownedRooms=Array.from({length:3},()=>({completed:false}));let managed=0;f.app.showModal=()=>managed++;
 await f.app.launch({mode:'level',levelId:'ch1-4'});assert.equal(f.created.length,1);assert.equal(managed,0);await f.app.launch({mode:'random',pieces:108});assert.equal(managed,1);assert.equal(f.created.length,1);
});

test('returning to the lobby refreshes chapter progress, including after room completion',async()=>{
 const f=fixture();f.app.levels=null;f.app.navigate('gallery');assert.equal(f.reads.includes('/api/levels'),false);f.app.navigate('lobby');await new Promise(resolve=>setImmediate(resolve));assert.ok(f.app.beginnerChapter);assert.equal(f.reads.filter(path=>path==='/api/levels').length,1);
 f.app.route='room';f.app.room={snapshot:{}};f.app.roomReturn=f.app.defaultListView('lobby');f.app.leaveRoom=()=>{f.app.room=null;};f.client.json=async path=>{f.reads.push(path);return path==='/api/levels'?levels(6):{rooms:[]};};f.app.exitRoom();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.app.beginnerChapter,null);assert.equal(f.reads.filter(path=>path==='/api/levels').length,2);assert.equal(f.created.length,0);
});

test('level fetch failure is silent and stale account or superseded responses cannot show a card',async()=>{
 const f=fixture();f.client.json=async()=>{throw Error('关卡离线');};await f.app.loadLevels();assert.equal(f.app.beginnerChapter,null);assert.equal(f.app.message,'');
 let resolve;f.client.json=()=>new Promise(yes=>resolve=yes);const old=f.app.loadLevels();f.client.account={id:'owner-b'};resolve(levels());await old;assert.equal(f.app.beginnerChapter,null);
 f.client.account={id:'owner-a'};const stale=f.app.loadLevels(),finish=resolve;f.client.json=async()=>levels(6);await f.app.loadLevels();finish(levels());await stale;assert.equal(f.app.beginnerChapter,null);
 const fresh=fixture({newcomer:true,data:levels(0)});fresh.client.json=async()=>{throw Error('离线');};await fresh.app.loadInitialContent({});assert.equal(fresh.app.route,'lobby');assert.equal(fresh.created.length,0);assert.equal(fresh.app.message,'');
});
