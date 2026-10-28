import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {CheerEffects} from '../mobile/cheer-effects.ts';
import {createPuzzle} from '../lib/puzzle-engine.ts';

const bundled=await build({stdin:{contents:"export {GameApp} from './mobile/app.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const clear={levelId:'ch1-1',energy:30,firstClear:true,nextLevelId:'ch1-2',chapterComplete:false};
function fixture({width=844,height=390,levelClear=clear,energy=true,formalWeb=false,cheers}={}){
 const calls=[],events=[],created=[],measure=(value,size)=>Array.from(String(value)).reduce((sum,char)=>sum+(char.charCodeAt(0)>255?size:size*.6),0);
 const ctx=new Proxy({globalAlpha:1},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={ctx,w:width,h:height,palette:{ink:'#222',muted:'#666',berry:'#a35',gold:'#fc5',cream:'#fff',overlay:'#0008',onAccent:'#fff'},invalidate(){},input(){},frame(r,key){calls.push({kind:'frame',r:{...r},key});},panel(r){this.frame(r,'panel-cream');},text(value,x,y,size,color,weight,maxWidth){calls.push({kind:'text',label:String(value),r:{x,y,w:measure(value,size),h:size},maxWidth});},measure,icon(key,r){calls.push({kind:'icon',key,r});},ornaments(){},button(r,label,fn){calls.push({kind:'button',r:{...r},label,fn});},hit(r,fn){calls.push({kind:'hit',r:{...r},fn});},clip(_r,fn){fn();}};
 const app=Object.create(GameApp.prototype),snapshot={title:'窗边',puzzle:{imageId:'picture'},startedAt:1,completedAt:60001,members:Array.from({length:8},(_,index)=>({id:String(index),code:String(index),name:'同桌'+index,lastSeen:100,contribution:8-index})),mobileResult:{coins:20,fragments:2,energy:5,catalog:{newlyCollected:true,albumRewards:[{title:'相册阶段奖励',coins:100},{title:'集齐相册',coins:0}]},...(levelClear?{levelClear}:{})}};
 const client={profile:{code:'0',lastReward:{levelClear:clear}},cookieIdentity:formalWeb,config:{capabilities:{energy,cheers}},createRoom:async input=>{events.push('create');created.push(input);return {room:{id:'next-room'}};}};
 Object.assign(app,{stage,client,offline:{active:false,server:null,isRoom:()=>false},privacyAccepted:true,platform:{config:{id:width>=1000?'web':'taptap'},viewport:()=>({width,height,top:0,bottom:0}),randomId:()=> 'request'},room:{ticket:{playerId:'0'},state:{cols:4,rows:3},snapshot},board:{drawCompletedPicture:()=>true},levels:{chapters:[{id:'ch1',title:'\u5f00\u5f20',status:'available',levels:[{id:'ch1-1',status:'cleared'},{id:'ch1-2',status:'unlocked'}]}]},levelsOwner:'',route:'room',ready:true,busy:false,modal:'completion',modalScroll:0,modalExtent:0,completionSeatRects:new Map(),completionAvatarRects:new Map(),completionSlotRects:new Map(),completionBubbleRects:new Map(),cheerEffects:new CheerEffects(),cheerFrame:null,collection:{albums:[{id:'album',collected:6,total:6,images:[{id:'picture'}]}]},attempts:new Map(),cancelChatPress(){},clearRoomPointer(){},invalidate(){},social:{title:''},leaveRoom(){events.push('leave');this.room=null;},navigate(route){events.push(route);},attachTicket:async ticket=>{events.push('attach');app.room=ticket;}});
 // The story page reads levels only for the signed-in owner they were loaded for.
 app.levelsOwner=app.ownerKey();
 return {app,calls,events,created,draw:()=>app.drawModal(),button:label=>calls.find(call=>call.kind==='button'&&call.label===label),texts:()=>calls.filter(call=>call.kind==='text').map(call=>call.label)};
}

test('level primary action leaves then creates the configured next level in all layouts',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height,levelClear:{...clear,nextLevelId:'ch1-4'}});f.draw();assert.equal(f.button('再来一桌'),undefined);assert.ok(f.button('下一关'));
  f.button('下一关').fn();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.events,['leave','create','attach']);assert.deepEqual(f.created,[{mode:'level',levelId:'ch1-4',requestId:'request'}]);
 }
});

test('chapter completion shows the chapter message, launches the next chapter or returns to the lobby',async()=>{
 for(const levelClear of [{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:null},{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:'ch2-1'},{...clear,nextLevelId:null}]){
  const f=fixture({levelClear});f.app.levels.chapters[0].levels.push({id:'ch1-6'});f.draw();assert.ok(f.texts().includes('开张完成！'));assert.equal(f.button('下一关'),undefined);
  if(levelClear.nextLevelId){f.button('下一章').fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['leave','create','attach']);assert.equal(f.created[0].levelId,'ch2-1');}
  else{f.button('去大厅').fn();assert.deepEqual(f.events,['leave','lobby']);assert.deepEqual(f.created,[]);}
 }
});

test('first clear shows the lightning reward only with positive energy and an enabled energy system',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const [levelClear,energy,formalWeb,visible]of [[clear,true,false,true],[{...clear,firstClear:false,energy:0},true,false,false],[{...clear,firstClear:false},true,false,false],[{...clear,energy:0},true,false,false],[clear,false,false,false],[clear,true,true,false]]){
  const f=fixture({width,height,levelClear,energy,formalWeb});f.draw();const reward=f.calls.find(call=>call.label==='通关体力 +30');assert.equal(!!reward,visible);
  if(reward){assert.ok(reward.r.w<=reward.maxWidth+.01,'reward label fits its tile');const tile=f.calls.find(call=>call.kind==='frame'&&call.key==='button-linen-normal'&&call.r.x<=reward.r.x&&call.r.x+call.r.w>=reward.r.x+reward.r.w&&call.r.y<reward.r.y&&call.r.y+call.r.h>=reward.r.y+reward.r.h);assert.ok(tile);assert.ok(f.calls.some(call=>call.kind==='icon'&&call.key==='lightning'&&call.r.x>tile.r.x&&call.r.x<tile.r.x+tile.r.w));}
 }
});

test('level rewards fit all layouts with eight seats, album milestones, six cheers and the existing secondary actions',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const levelClear of [clear,{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:null}]){
  // The story action exists only for levels of the loaded chapter.
  const f=fixture({width,height,levelClear});if(!f.app.levels.chapters[0].levels.some(level=>level.id===levelClear.levelId))f.app.levels.chapters[0].levels.push({id:levelClear.levelId,status:'cleared'});f.draw();assert.equal(f.app.completionSeatRects.size,8);
  const cheers=f.calls.filter(call=>call.kind==='hit'&&call.r.y===f.app.completionBar.y&&call.r.h===f.app.completionBar.h);assert.equal(cheers.length,6);
  for(const label of ['翻开这一页','分享成品','查看图集','回大厅'])assert.ok(f.button(label));
  for(const call of f.calls.filter(call=>call.kind==='button'||call.kind==='frame')){assert.ok(call.r.w>0&&call.r.h>0);assert.ok(call.r.x>=0&&call.r.x+call.r.w<=width+.01);}
  if(width===844){for(const label of ['翻开这一页','下一关','去大厅','分享成品','查看图集','回大厅']){const button=f.button(label);if(button)assert.ok(button.r.y+button.r.h<=f.app.completionBar.y,label);}assert.ok(f.app.completionBar.y+f.app.completionBar.h+22<=382);}
  if(width===390)assert.ok(f.app.modalExtent>f.app.modalArea.h,'portrait content remains scrollable');
 }
});

test('completion story action opens the cleared level with fromClear without leaving or changing original actions',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height}),opened=[];f.app.openLevelComic=(...args)=>opened.push(args);f.draw();f.button('翻开这一页').fn();assert.deepEqual(opened,[['ch1-1',{fromClear:true}]]);assert.deepEqual(f.events,[]);
  const primary=f.button('下一关').r,comic=f.button('翻开这一页').r;assert.equal(primary.y,comic.y);assert.equal(primary.h,comic.h);// The completion hook places story actions left of the primary action.
  assert.ok(comic.x+comic.w<primary.x);
  for(const label of ['下一关','分享成品','查看图集','回大厅'])assert.ok(f.button(label));
 }
});

test('ordinary rooms and helpers retain the cheers completion even with a stale profile level reward',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height,levelClear:null});f.draw();assert.ok(f.button('再来一桌'));assert.equal(f.button('下一关'),undefined);assert.equal(f.button('去大厅'),undefined);assert.ok(!f.texts().some(text=>text.includes('通关体力')||text==='开张完成！'));
  assert.equal(f.app.completionSeatRects.size,8);assert.equal(f.calls.filter(call=>call.kind==='hit'&&call.r.y===f.app.completionBar.y&&call.r.h===f.app.completionBar.h).length,6);
  f.button('再来一桌').fn();assert.deepEqual(f.events,['leave','gallery']);
 }
});

test('completion close buttons and Escape leave level rooms for the chapter, with last-level and ordinary-room exceptions',()=>{
 for(const cheers of [undefined,false])for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const action of ['cross','escape'])for(const kind of ['level','last','unavailable','ordinary','helper']){
  const f=fixture({width,height,cheers,levelClear:kind==='helper'?null:kind==='last'?{...clear,chapterComplete:true,nextLevelId:null}:clear});f.app.platform.canvas={};f.app.platform.storage={get:()=>null};f.app.client.account={id:'owner'};f.app.levelsOwner='owner';f.app.social.close=()=>{};f.app.board.input=()=>false;f.app.route='room';if(kind!=='ordinary')f.app.room.snapshot.levelId='ch1-1';if(kind==='unavailable')f.app.levels=null;f.app.ensureListOwner=()=>{};
  f.draw();if(action==='cross')f.button('').fn();else f.app.input({type:'key',key:'Escape',keyDown:true,points:[],changed:[]});
  if(kind==='ordinary'){assert.deepEqual(f.events,[]);assert.equal(f.app.modal,null);assert.ok(f.app.room);}else{assert.deepEqual(f.events,['leave',kind==='last'||kind==='unavailable'?'lobby':'chapter']);assert.equal(f.app.room,null);}
 }
});

test('disabled cheers remove the bar, hint and reserved content space while retaining seats, rewards and actions',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const levelClear of [clear,{...clear,chapterComplete:true,nextLevelId:null},null]){
  const enabled=fixture({width,height,levelClear}),f=fixture({width,height,levelClear,cheers:false});enabled.draw();f.draw();
  assert.equal(f.app.completionSeatRects.size,8);assert.deepEqual([...f.app.completionSeatRects.values()],[...enabled.app.completionSeatRects.values()]);
  assert.ok(!f.calls.some(call=>call.kind==='hit'&&call.r.h===enabled.app.completionBar.h));assert.ok(!f.texts().some(text=>text.includes('点一下就能喝彩')||['鼓掌','撒花','比心','好耶','干杯','喵～'].includes(text)));
  const label=levelClear?levelClear.chapterComplete?'去大厅':'下一关':'再来一桌',offset=width===390?72:width===1280?60:0;
  assert.ok(Math.abs(f.button(label).r.y-enabled.button(label).r.y+offset)<.01);if(width!==844)assert.ok(Math.abs(f.app.modalExtent-enabled.app.modalExtent+offset)<.01);
  for(const label of ['分享成品','查看图集','回大厅'])assert.ok(f.button(label));assert.ok(f.texts().includes('金币 +20'));assert.ok(f.texts().includes('碎片 +2'));assert.ok(f.texts().includes('相册阶段奖励：金币 +100'));
  f.button(label).fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,levelClear?levelClear.chapterComplete?['leave','lobby']:['leave','create','attach']:['leave','gallery']);
 }
});

test('disabled cheers reject all six keyboard shortcuts and direct sends',()=>{
 const {app}=fixture({cheers:false}),sent=[];app.cheer={send:emote=>sent.push(emote)};app.sendCompletionCheer('clap');
 for(let key=1;key<=6;key++)assert.equal(app.input({type:'key',key:String(key),keyDown:true,points:[],changed:[]}),false);
 assert.deepEqual(sent,[]);
});

test('room attachment creates no cheer client or subscription when disabled and keeps mobile defaults',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const cheers of [false,undefined,true]){
  const {app}=fixture({cheers}),subscriptions=new Set(),realtime={connected:true,subscribeRoom:()=>()=>{},subscribeCursors:()=>()=>{},subscribeState:()=>()=>{},subscribeCheers(fn){subscriptions.add(fn);return()=>subscriptions.delete(fn);},setHidden(){},start(){},close(){}};
  Object.assign(app,{room:null,board:null,cheer:null,routeStack:[],routeFrames:[],nineTimings:new Map(),saveListView:()=>({route:'room'}),loadAssistance:async()=>{},note(){},leaveRoom:GameApp.prototype.leaveRoom,attachTicket:GameApp.prototype.attachTicket});
  Object.assign(app.platform,{createCanvas:()=>({getContext:()=>({})}),onHide:()=>()=>{},onShow:()=>()=>{}});Object.assign(app.client,{roomRealtime:()=>realtime,asset:()=>'',fetchLike:async()=>Response.json({})});app.social.close=()=>{};
  const ticket={token:'b'.repeat(32),playerId:'0',room:{id:'a'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),startedAt:null,completedAt:null,members:[{id:'0',name:'我',lastSeen:100}],leases:{}}};
  try{await app.attachTicket(ticket);assert.equal(app.cheer===null,cheers===false);assert.equal(subscriptions.size,cheers===false?0:1);assert.equal(app.route,'room');}finally{app.leaveRoom();}assert.equal(subscriptions.size,0);
 }
});
