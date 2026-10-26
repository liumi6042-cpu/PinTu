import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function levels(cleared=3,status='available'){
 const chapter={id:'ch1',title:'小窝的一天',albumId:'beginner',coverImageId:null,coverSrc:null,status,levels:[12,16,20,24,30,35].map((pieces,index)=>({id:'ch1-'+(index+1),imageId:null,title:null,pieces,status:status==='unavailable'?'unavailable':index<cleared?'cleared':index===cleared?'unlocked':'locked'}))};
 return {chapters:[chapter],current:chapter.levels.find(level=>level.status==='unlocked')??null,firstClearEnergy:30};
}
function fixture({width=390,height=844,owner='owner-a',storage=new Map(),data=levels(),newcomer=false}={}){
 const texts=[],glyphs=[],buttons=[],frames=[],images=[],fills=[],strokes=[],paint=[],saved=[],reads=[],created=[],events=[],ctx=new Proxy({globalAlpha:1,measureText:value=>({width:String(value).length*6}),save(){saved.push({globalAlpha:this.globalAlpha,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});},restore(){Object.assign(this,saved.pop());},fillRect(x,y,w,h){const fill={r:{x,y,w,h},color:this.fillStyle,alpha:this.globalAlpha};fills.push(fill);paint.push(fill);},strokeRect(x,y,w,h){strokes.push({r:{x,y,w,h},color:this.strokeStyle});}},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:height,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c',cream:'#fff9f0',placeholder:'#efdfcc'},text:(value,x,y,size,color,weight)=>{texts.push(String(value));const glyph={value:String(value),x,y,size,color,weight};glyphs.push(glyph);paint.push(glyph);},button:(r,label,fn,opts)=>buttons.push({r,label,fn,opts}),frame:(r,key)=>frames.push({r,key}),image:(src,r)=>{const image={src,r};images.push(image);paint.push(image);},panel(){},icon(){},meter(){},hit(){},ornaments(){},clip:(_r,fn)=>fn(),measure:value=>String(value).length*6,input(){},invalidate(){}};
 const app=Object.create(GameApp.prototype),client={account:{id:owner},profile:{code:owner,newcomer,ownedRooms:[],level:1,xp:0,xpToNext:20,energy:60,energyCap:60,supply:{energy:0,create:0}},config:{capabilities:{energy:true,ads:false}},asset:value=>value,start:async()=>{events.push('ready');},json:async path=>{reads.push(path);if(path==='/api/levels'){assert.equal(app.ready,true);return data;}if(path==='/api/room-history')return {rooms:[]};throw Error('unexpected '+path);},createRoom:async input=>{created.push(input);return {room:{id:'level-room'}};}};
 const platform={config:{id:'taptap',apiBase:'https://game.test/api'},initialQuery:{},viewport:()=>({width,height,top:0,bottom:0}),storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)},randomId:()=> 'request',onHide:()=>()=>{},onShow:()=>()=>{}};
 Object.assign(app,{stage,client,platform,privacyAccepted:true,privacyEpoch:0,ready:true,destroyed:false,busy:false,modal:null,route:'lobby',room:null,levels:data,levelsOwner:owner,levelsSerial:0,chapterFoldOwner:'',chapterFolded:false,autoLevelChecked:false,bodyTop:80,bodyBottom:height-20,scroll:0,extent:0,rooms:[],lobbyPieces:'all',lobbySerial:0,lobbyCursor:null,historyRooms:[],historySerial:0,historyLoading:false,direction:'all',filterCount:0,serverOffset:0,contentOrigin:{x:0,y:0},cleanups:[],timers:[],attempts:new Map(),routeStack:[],routeFrames:[],savedRoutes:new Map(),handledQueries:new Set(),message:'',social:{close(){},refresh:async()=>{},blockedCodes:[]},invalidate:()=>stage.invalidate(),loadLobby:async()=>{events.push('lobby');},loadGallery:async()=>{},loadTasks:async()=>{},attachTicket:async ticket=>{app.route='room';app.room=ticket;}});
 return {app,client,platform,stage,texts,glyphs,buttons,frames,images,fills,strokes,paint,reads,created,storage,events,clear:()=>{texts.length=glyphs.length=buttons.length=frames.length=images.length=fills.length=strokes.length=paint.length=0;}};
}

test('unfinished chapter draws progress, six nodes and a direct continue action above the daily puzzle in all layouts',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height});if(width===1280){f.platform.config.id='web';f.client.cookieIdentity=true;}
  const heroes=[],roomHeaders=[];f.app.drawDailyHero=(r)=>{heroes.push(r);return r.y+r.h;};f.app.drawRoomHeader=(_x,y)=>{roomHeaders.push(y);return y+40;};f.app.drawRoomGrid=(_x,y)=>y;f.app.drawRoomSection=(_x,y)=>y;
  f.app.drawLobby();assert.ok(f.texts.includes('新手章节 · 小窝的一天'));assert.ok(f.texts.includes('3/6'));assert.equal(f.texts.filter(text=>text==='✓').length,3);
  const nodes=f.frames.filter(frame=>frame.key.startsWith('button-'));assert.equal(nodes.length,6);assert.equal(nodes[3].key,'button-berry-selected');
  const next=f.buttons.find(button=>button.label==='继续 · 第 4 关（24 片）');assert.ok(next);assert.ok(next.r.y<heroes[0].y);if(width>height)assert.equal(roomHeaders[0],80,'public room header stays at its original top');
  next.fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.created,[{mode:'level',levelId:'ch1-4',requestId:'request'}]);
 }
});

test('all-cleared and unavailable chapters leave the existing lobby drawing unchanged',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const draw=data=>{const f=fixture({width,height,data}),heroes=[];if(width===1280){f.platform.config.id='web';f.client.cookieIdentity=true;}f.app.drawDailyHero=r=>{heroes.push(r);return r.y+r.h;};f.app.drawRoomHeader=(_x,y)=>y+40;f.app.drawRoomGrid=(_x,y)=>y;f.app.drawRoomSection=(_x,y)=>y;f.app.drawLobby();return{heroes,labels:f.buttons.map(button=>button.label),texts:f.texts};};
  const baseline=draw(null);for(const data of [levels(6),levels(0,'unavailable')])assert.deepEqual(draw(data),baseline);
 }
});

test('landscape keeps chapter, daily actions and the previous room inside the left column',()=>{
 const f=fixture({width:844,height:390}),actions=[];f.app.historyRooms=[{id:'previous',pieces:48,placed:5,title:'上次的拼图'}];f.app.drawLobbyActions=r=>actions.push(r);f.app.drawRoomHeader=(_x,y)=>y+40;f.app.drawRoomGrid=(_x,y)=>y;f.app.drawLobby();
 for(const label of ['继续 · 第 4 关（24 片）','去大厅逛逛','开始拼 · 108 片','叫上朋友','回到这桌']){const button=f.buttons.find(item=>item.label===label);assert.ok(button,label);assert.ok(button.r.y+button.r.h<=f.app.bodyBottom,label+' remains visible');}assert.ok(actions[0].y+actions[0].h<=f.app.bodyBottom);
 const chapter=f.buttons.find(button=>button.label==='去大厅逛逛'),daily=f.buttons.find(button=>button.label==='开始拼 · 108 片'),previous=f.buttons.find(button=>button.label==='回到这桌');assert.ok(chapter.r.y+chapter.r.h<daily.r.y);assert.ok(daily.r.y+daily.r.h<previous.r.y);
});

test('folding draws only a persisted account-specific strip and clicking it restores the card',()=>{
 const f=fixture(),draw=app=>app.drawBeginnerChapter({x:12,y:80,w:366,h:app.chapterCollapsed?38:152},false);
 draw(f.app);f.buttons.find(button=>button.label==='去大厅逛逛').fn();f.clear();draw(f.app);
 assert.deepEqual(f.texts,[]);assert.equal(f.frames.length,0);assert.deepEqual(f.buttons.map(button=>button.label),['新手章节 · 小窝的一天  3/6']);
 const again=fixture({storage:f.storage});draw(again.app);assert.equal(again.buttons.length,1);again.buttons[0].fn();again.clear();draw(again.app);assert.ok(again.texts.includes('3/6'));assert.ok(again.buttons.some(button=>button.label.startsWith('继续 ·')));
 const other=fixture({owner:'owner-b',storage:f.storage});assert.equal(other.app.chapterCollapsed,false);assert.equal(f.app.chapterCollapsed,true);
});

test('chapter nodes use catalog thumbnails when available and otherwise draw numbers',async()=>{
 const f=fixture({data:levels(0)}),photoId='__level_thumbnail__';
 // Populate the same metadata map that normal gallery loading updates.
 f.client.json=async()=>({imageIds:[photoId],packedImageIds:[],photos:[{id:photoId,title:'窗边',src:'/window.webp',thumbSrc:'/window-thumb.webp',category:'其他'}]});
 delete f.app.loadGallery;await f.app.loadGallery();f.app.levels.chapters[0].levels[0].imageId=photoId;f.app.drawBeginnerChapter({x:12,y:80,w:366,h:152},false);assert.deepEqual(f.images.map(image=>image.src),['/window-thumb.webp']);for(const number of ['2','3','4','5','6'])assert.ok(f.texts.includes(number));
});

test('chapter states use contrast badges, a highlighted current node and cream veils over locked thumbnails or numbers',async()=>{
 for(const compact of [false,true])for(const thumbnails of [false,true]){
  const f=fixture(),photoId='__state_thumbnail__';
  if(thumbnails){f.client.json=async()=>({imageIds:[photoId],packedImageIds:[],photos:[{id:photoId,title:'窗边',src:'/state.webp',thumbSrc:'/state-thumb.webp',category:'其他'}]});delete f.app.loadGallery;await f.app.loadGallery();for(const level of f.app.levels.chapters[0].levels)level.imageId=photoId;}
  f.app.drawBeginnerChapter({x:12,y:80,w:compact?300:366,h:compact?112:152},compact);
  const nodes=f.frames.map(frame=>frame.r),badges=f.fills.filter(fill=>fill.alpha===1),veils=f.fills.filter(fill=>fill.alpha===.55),ticks=f.glyphs.filter(glyph=>glyph.value==='✓');
  assert.equal(badges.length,3);assert.equal(ticks.length,3);assert.equal(f.strokes.length,3);assert.equal(veils.length,2);assert.equal(f.images.length,thumbnails?6:0);
  for(let i=0;i<3;i++){const badge=badges[i],tick=ticks[i],node=nodes[i];assert.equal(badge.color,f.stage.palette.cream);assert.equal(tick.color,f.stage.palette.ink);assert.equal(f.strokes[i].color,f.stage.palette.ink);assert.ok(tick.size>=(compact?13:17));assert.ok(tick.x>=badge.r.x&&tick.y>=badge.r.y&&tick.x+tick.size<=badge.r.x+badge.r.w&&tick.y+tick.size<=badge.r.y+badge.r.h);assert.equal(badge.r.x+badge.r.w,node.x+node.w);assert.equal(badge.r.y+badge.r.h,node.y+node.h);if(thumbnails)assert.ok(f.paint.indexOf(badge)>f.paint.indexOf(f.images[i]));}
  assert.equal(f.frames[3].key,'button-berry-selected');assert.ok(f.frames.filter((_,i)=>i!==3).every(frame=>frame.key==='button-linen-normal'));
  for(let i=0;i<2;i++){const veil=veils[i],node=nodes[i+4],content=thumbnails?f.images[i+4]:f.glyphs.find(glyph=>glyph.value===String(i+5));assert.equal(veil.color,f.stage.palette.cream);assert.deepEqual(veil.r,{x:node.x+3,y:node.y+3,w:node.w-6,h:node.h-6});assert.ok(content);assert.ok(f.paint.indexOf(veil)>f.paint.indexOf(content));}
  if(!thumbnails)for(const number of ['4','5','6'])assert.ok(f.texts.includes(number));assert.equal(f.stage.ctx.globalAlpha,1);
 }
});

test('landscape daily artwork fills the remaining height when folded or expanded and short cards shrink without blank space',()=>{
 for(const height of [320,390,430,480])for(const folded of [false,true])for(const previous of [false,true]){
  const f=fixture({width:844,height});f.app.setChapterCollapsed(folded);f.app.dailyPhoto={id:'daily',title:'窗边',src:'/daily.webp',thumbSrc:'/daily-thumb.webp'};if(previous)f.app.historyRooms=[{id:'previous',pieces:48,placed:5,title:'上次的拼图'}];
  f.app.drawRoomHeader=(_x,y)=>y+40;f.app.drawRoomGrid=(_x,y)=>y;f.app.drawLobby();
  const card=f.frames.find(frame=>frame.key==='panel-cream').r,photo=f.images.find(image=>image.src==='/daily.webp'),button=f.buttons.find(button=>button.label==='开始拼 · 108 片'),available=height-20-80-(folded?48:122)-(previous?62:0)-48;
  if(available>=126){assert.ok(photo,`${height} folded=${folded} previous=${previous}`);assert.equal(card.h,available);assert.deepEqual(photo.r,{x:card.x+8,y:card.y+8,w:card.w-16,h:card.h-f.app.heroTextHeight(true)-8});assert.ok(button.r.y>=photo.r.y+photo.r.h);}
  else{assert.equal(photo,undefined);assert.equal(card.h,58);assert.equal(button.r.h,24);}
  assert.ok(button.r.y+button.r.h<=card.y+card.h);assert.ok(card.y+card.h-button.r.y-button.r.h<=16,'no blank block below the daily actions');
  const invite=f.buttons.find(button=>button.label==='叫上朋友');assert.equal(invite.r.y,button.r.y);assert.equal(invite.r.h,button.r.h);if(previous){const last=f.buttons.find(button=>button.label==='回到这桌');assert.ok(last.r.y>=card.y+card.h+10);}
 }
});

test('landscape daily artwork threshold has no empty intermediate layout',()=>{
 for(const height of [58,109,110,125,126,127,141,142,240]){
  const f=fixture();f.app.dailyPhoto={id:'daily',title:'窗边',src:'/daily.webp',thumbSrc:'/daily-thumb.webp'};const end=f.app.drawDailyHero({x:12,y:80,w:300,h:height},true),card=f.frames[0].r,button=f.buttons[0];
  assert.equal(f.images.length,height>=126?1:0);assert.equal(card.h,height>=126?height:58);assert.equal(end,card.y+card.h);assert.ok(card.y+card.h-button.r.y-button.r.h<=16);assert.ok(button.r.y+button.r.h<=card.y+card.h);
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
  assert.deepEqual(handled,[query]);assert.equal(f.created.length,0);assert.equal(f.reads.includes('/api/levels'),true);assert.equal(f.storage.has(f.app.chapterStorageKey('auto')),false);await f.app.autoLaunchLevel();assert.equal(f.created.length,0);
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
 f.app.route='room';f.app.room={};f.app.roomReturn=f.app.defaultListView('lobby');f.app.leaveRoom=()=>{f.app.room=null;};f.client.json=async path=>{f.reads.push(path);return path==='/api/levels'?levels(6):{rooms:[]};};f.app.exitRoom();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.app.beginnerChapter,null);assert.equal(f.reads.filter(path=>path==='/api/levels').length,2);assert.equal(f.created.length,0);
});

test('level fetch failure is silent and stale account or superseded responses cannot show a card',async()=>{
 const f=fixture();f.client.json=async()=>{throw Error('关卡离线');};await f.app.loadLevels();assert.equal(f.app.beginnerChapter,null);assert.equal(f.app.message,'');
 let resolve;f.client.json=()=>new Promise(yes=>resolve=yes);const old=f.app.loadLevels();f.client.account={id:'owner-b'};resolve(levels());await old;assert.equal(f.app.beginnerChapter,null);
 f.client.account={id:'owner-a'};const stale=f.app.loadLevels(),finish=resolve;f.client.json=async()=>levels(6);await f.app.loadLevels();finish(levels());await stale;assert.equal(f.app.beginnerChapter,null);
 const fresh=fixture({newcomer:true,data:levels(0)});fresh.client.json=async()=>{throw Error('离线');};await fresh.app.loadInitialContent({});assert.equal(fresh.app.route,'lobby');assert.equal(fresh.created.length,0);assert.equal(fresh.app.message,'');
});
