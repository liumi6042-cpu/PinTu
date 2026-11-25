import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate as turn} from 'node:timers/promises';
import {RoomClient} from '../lib/room-client.ts';
import {placedCount} from '../lib/puzzle-engine.ts';
import {readOfflineCatalog} from '../lib/offline-catalog-types.ts';
import {createOfflineRoomServer,offlineLevelsView,recordOfflineClear,pendingOfflineClears,removeOfflineClears,cacheServerLevels,readCachedServerLevels,syncOfflineClears,isNetworkFailure,preferOfflineLevelRoom} from '../lib/offline-play.ts';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const hex=n=>n.toString(16).padStart(32,'0');
const storage=()=>{const values=new Map();return {values,get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};};
function catalog(){
 const photo=id=>({id,title:'画作 '+id,category:'故事',src:`/puzzles/${id}.webp`,thumbSrc:`/puzzles/${id}-thumb.webp`,width:1600,height:1200,artwork:{revision:'room-revision',src:`/puzzles/${id}.webp`,thumbSrc:`/puzzles/${id}-thumb.webp`,width:1600,height:1200}});
 const level=(id,imageId)=>({id,imageId,title:id,pieces:12,cols:4,rows:3,line:'故事 '+id});
 return {schema:'jigsaw-offline/v1',seriesTitle:'拾光物语',firstClearEnergy:30,chapters:[{id:'ch-z',title:'第一章',albumId:'story-z',levels:[level('ch-z-1','a'),level('ch-z-2','b')]},{id:'ch-a',title:'第二章',albumId:'story-a',levels:[level('ch-a-1','c'),level('ch-a-2','d')]}],free:[{imageId:'free',title:'免费图',albumId:'gallery',grids:{48:{cols:8,rows:6},108:{cols:12,rows:9}}}],photos:Object.fromEntries(['a','b','c','d','free'].map(id=>[id,photo(id)]))};
}
const clear=(levelId,n=1)=>({levelId,roomId:hex(n),clearId:hex(n+1000),completedAt:10000+n,elapsedMs:5000,pieces:12});
function fixture(options={}){
 let time=100000,serial=10;
 const store=options.storage??storage(),book=options.catalog??catalog(),randomId=()=>hex(++serial),now=()=>time;
 const server=createOfflineRoomServer({catalog:book,storage:store,now,randomId,...options});
 return {server,store,book,now,randomId,advance:n=>time+=n};
}
const action=(server,id,body)=>server.fetch(`https://example.test/prefix/api/rooms/${id}?since=0`,{method:'POST',body:JSON.stringify(body)}).then(reply=>reply.json());
const solve=async(server,ticket)=>{
 let room=ticket.room;
 while(room.puzzle.groups.some(group=>!group.locked))room=await action(server,room.id,{type:'drop',groupId:room.puzzle.groups.find(group=>!group.locked).id,dx:0,dy:0});
 return room;
};
const until=async condition=>{for(let n=0;n<200;n++){if(condition())return;await turn();}assert.fail('RoomClient did not settle');};

test('offline level preference requires more placed pieces in the same unfinished level',()=>{
 const room={kind:'level',levelId:'ch-z-1',completed:false,placed:5};
 const rooms=Object.freeze([Object.freeze(room)]);
 assert.equal(preferOfflineLevelRoom(4,rooms,'ch-z-1'),true);
 for(const [online,entries,levelId] of [[5,rooms,'ch-z-1'],[6,rooms,'ch-z-1'],[0,[],'ch-z-1'],[0,rooms,'ch-z-2'],[0,[{...room,completed:true}],'ch-z-1'],[0,[{...room,kind:'free'}],'ch-z-1']])assert.equal(preferOfflineLevelRoom(online,entries,levelId),false);
 assert.equal(preferOfflineLevelRoom(4,[{...room,levelId:'other'},...rooms],'ch-z-1'),true);
});

function launchFixture(createRoom){
 const f=fixture(),notes=[],attached=[],requests=[],app=Object.create(GameApp.prototype);
 const online={...f.server.createRoom({kind:'level',levelId:'ch-z-1'}),room:{...f.server.createRoom({kind:'level',levelId:'ch-z-1'}).room,id:hex(900),offline:false}};
 Object.assign(app,{ready:true,attempts:new Map(),platform:{randomId:f.randomId},offline:{active:false,catalog:f.book,server:f.server,isRoom:id=>f.server.isOfflineRoom(id),createRoom:input=>f.server.createRoom(input)},client:{createRoom:async input=>{requests.push(input);return createRoom?createRoom(input,requests.length,online):online;}},run:fn=>fn(),note:message=>notes.push(message),attachTicket:async ticket=>attached.push(ticket)});
 return {...f,app,notes,attached,requests,online};
}

test('level launch retries at 800 and 2000 ms with one requestId before offline fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=launchFixture(()=>{throw new TypeError('network unavailable');}),pending=f.app.launch({mode:'level',levelId:'ch-z-1'});
 await until(()=>f.requests.length===1);await turn();assert.equal(f.attached.length,0);assert.equal(f.notes.length,0);
 t.mock.timers.tick(799);await turn();assert.equal(f.requests.length,1);
 t.mock.timers.tick(1);await until(()=>f.requests.length===2);await turn();assert.equal(f.attached.length,0);
 t.mock.timers.tick(1999);await turn();assert.equal(f.requests.length,2);
 t.mock.timers.tick(1);await pending;
 assert.equal(f.requests.length,3);assert.equal(new Set(f.requests.map(input=>input.requestId)).size,1);
 assert.equal(f.attached[0].room.offline,true);assert.deepEqual(f.notes,['网络不可用，先离线拼，联网后自动同步通关']);assert.equal(f.app.attempts.size,0);
});

test('level launch keeps the online ticket when a retry recovers the connection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=launchFixture((_input,n,ticket)=>{if(n===1)throw new TypeError('network unavailable');return ticket;}),pending=f.app.launch({mode:'level',levelId:'ch-z-1'});
 await until(()=>f.requests.length===1);await turn();t.mock.timers.tick(800);await pending;
 assert.equal(f.requests.length,2);assert.equal(f.requests[0].requestId,f.requests[1].requestId);assert.deepEqual(f.attached,[f.online]);assert.deepEqual(f.notes,[]);
 t.mock.timers.tick(2000);await turn();assert.equal(f.requests.length,2);
});

test('non-network level errors stop retries and preserve the attempt id without offline fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const denied=Object.assign(Error('locked'),{status:403}),f=launchFixture((_input,n)=>{if(n===1)throw new TypeError('network unavailable');throw denied;});
 const pending=assert.rejects(f.app.launch({mode:'level',levelId:'ch-z-1'}),error=>error===denied);
 await until(()=>f.requests.length===1);await turn();t.mock.timers.tick(800);await pending;
 assert.equal(f.requests.length,2);assert.equal(f.attached.length,0);assert.deepEqual(f.notes,[]);assert.equal(f.app.attempts.size,1);
 t.mock.timers.tick(2000);await turn();assert.equal(f.requests.length,2);
});

test('non-level launches do not retry or switch offline on network failures',async()=>{
 const f=launchFixture(()=>{throw new TypeError('network unavailable');});
 await assert.rejects(f.app.launch({mode:'daily'}),/network unavailable/);
 assert.equal(f.requests.length,1);assert.equal(f.attached.length,0);assert.deepEqual(f.notes,[]);
});

test('online level launch opens the existing offline room only when its placed count is higher',async()=>{
 for(const onlinePlaced of [0,1,2]){
  const f=launchFixture(),offline=f.server.createRoom({kind:'level',levelId:'ch-z-1'});
  await action(f.server,offline.room.id,{type:'drop',groupId:0,dx:0,dy:0});
  for(const group of f.online.room.puzzle.groups.slice(0,onlinePlaced))group.locked=true;
  await f.app.launch({mode:'level',levelId:'ch-z-1'});
  assert.equal(f.attached[0].room.id,onlinePlaced===0?offline.room.id:f.online.room.id);
  assert.deepEqual(f.notes,onlinePlaced===0?['继续你离线时拼的进度']:[]);
  if(onlinePlaced===0)assert.equal(placedCount(f.attached[0].room.puzzle),1);
 }
});

test('phone fit retains the whole-table camera and uses it as the opening 100 percent base',()=>{
 for(const [w,h,bottom] of [[390,844,72],[844,390,8]]){
  const app=Object.create(GameApp.prototype),camera={x:4,y:8,z:.25},calls=[];
  const board={camera:{z:1},openMobileView:insets=>{calls.push(insets);board.camera={...camera};},zoom(){assert.fail('extra target zoom');}};
  Object.assign(app,{stage:{w,h},platform:{config:{id:'taptap'},viewport:()=>({width:w,height:h})},board});
  app.fitRoom();assert.deepEqual(calls,[{bottom}]);assert.deepEqual(board.camera,camera);assert.equal(app.roomZoomBase,camera.z);
 }
});

test('level snapshot uses catalog artwork, exact grid, device identity and resumes unfinished rooms',async()=>{
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'}),room=ticket.room;
 for(const id of [room.id,ticket.playerId,ticket.token])assert.match(id,/^[a-f0-9]{32}$/);
 assert.equal(room.offline,true);assert.equal(room.levelId,'ch-z-1');assert.equal(room.requestedPieces,12);
 assert.equal(room.title,'ch-z-1');assert.equal(room.acceptingNew,false);assert.equal(room.visibility,'solo');
 assert.deepEqual(room.artwork,f.book.photos.a.artwork);assert.deepEqual(room.photo,f.book.photos.a);
 assert.deepEqual(room.members,[{id:ticket.playerId,name:'我',color:'#99caf4',lastSeen:f.now()}]);assert.deepEqual(room.leases,{});
 assert.equal(room.startedAt,null);assert.equal(room.completedAt,null);assert.equal(room.puzzle.elapsed,0);assert.equal(room.revision,0);
 assert.equal(room.serverTime,f.now());assert.equal(room.expiresAt,f.now()+30*86400000);
 assert.deepEqual([room.puzzle.cols,room.puzzle.rows],[4,3]);
 assert.equal(f.server.createRoom({kind:'level',levelId:'ch-z-1'}).room.id,room.id);
 const free=f.server.createRoom({kind:'free',imageId:'free',pieces:48});
 assert.equal(free.playerId,ticket.playerId);assert.equal(free.token,ticket.token);assert.equal('levelId' in free.room,false);
 assert.equal(f.server.createRoom({kind:'free',imageId:'free',pieces:48}).room.id,free.room.id);
 assert.notEqual(f.server.createRoom({kind:'free',imageId:'free',pieces:108}).room.id,free.room.id);
 assert.throws(()=>f.server.createRoom({kind:'level',levelId:'missing'}),/^Error: 关卡暂不可用$/);
 assert.throws(()=>f.server.createRoom({kind:'free',imageId:'a',pieces:48}));
 assert.throws(()=>f.server.createRoom({kind:'free',imageId:'free',pieces:300}));
 const read=await (await f.server.fetch(`/api/rooms/${room.id}`)).json();read.puzzle.groups.length=0;
 assert.ok((await (await f.server.fetch(`/api/rooms/${room.id}`)).json()).puzzle.groups.length>0);
});

test('single-player actions, ordered batches, elapsed time and completion enqueue exactly once',async()=>{
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'}),id=ticket.room.id;
 for(const type of ['claim','move','release','heartbeat','leave'])assert.equal((await action(f.server,id,{type,groupId:0,dx:0,dy:0})).revision,0);
 assert.equal((await action(f.server,id,{type:'drop',groupId:0,dx:NaN,dy:0})).revision,0);
 const first=await action(f.server,id,{type:'batch',ops:[{requestId:hex(100),groupId:0,dx:500,dy:400},{requestId:hex(101),groupId:0,dx:0,dy:0},{requestId:hex(102),groupId:0,dx:0,dy:0}]});
 assert.deepEqual(first.soloBatch,{applied:[hex(100),hex(101)],skipped:[{requestId:hex(102),code:'CONFLICT'}],stopped:null});
 assert.deepEqual(first.mobileContributions,[]);assert.equal(first.revision,2);assert.equal(first.startedAt,f.now());
 f.advance(5300);assert.equal((await (await f.server.fetch(`/api/rooms/${id}`)).json()).puzzle.elapsed,5);
 const done=await solve(f.server,ticket);assert.equal(done.completedAt,f.now());assert.equal(done.puzzle.elapsed,5);
 const queued=pendingOfflineClears(f.store);assert.equal(queued.length,1);assert.equal(queued[0].elapsedMs,5300);assert.equal(queued[0].levelId,'ch-z-1');assert.equal(queued[0].roomId,id);
 assert.match(queued[0].clearId,/^[a-f0-9]{32}$/);
 f.advance(10000);assert.equal((await action(f.server,id,{type:'heartbeat'})).puzzle.elapsed,5);
 assert.equal((await action(f.server,id,{type:'drop',groupId:done.puzzle.groups[0].id,dx:0,dy:0})).revision,done.revision);
 assert.deepEqual(pendingOfflineClears(f.store),queued);
 removeOfflineClears(f.store,[queued[0].clearId]);await action(f.server,id,{type:'heartbeat'});assert.deepEqual(pendingOfflineClears(f.store),[]);
 const summary=f.server.rooms()[0];assert.equal(summary.placed,12);assert.equal(summary.total,12);assert.equal(summary.completed,true);
 assert.notEqual(f.server.createRoom({kind:'level',levelId:'ch-z-1'}).room.id,id);
 const free=f.server.createRoom({kind:'free',imageId:'free',pieces:48});await solve(f.server,free);assert.deepEqual(pendingOfflineClears(f.store),[]);
});

test('shuffle preserves placed pieces and persisted rooms restore identity, timing and puzzle',async()=>{
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'}),id=ticket.room.id;
 await action(f.server,id,{type:'drop',groupId:0,dx:0,dy:0});f.advance(3100);
 const shuffled=await action(f.server,id,{type:'shuffle'});assert.equal(shuffled.revision,2);assert.equal(placedCount(shuffled.puzzle),1);assert.equal(shuffled.puzzle.elapsed,3);
 const next=createOfflineRoomServer({catalog:f.book,storage:f.store,now:f.now,randomId:f.randomId,playerName:'玩家'});
 assert.equal(next.isOfflineRoom(id),true);assert.equal(next.isOfflineRoom(hex(999)),false);
 const resumed=next.createRoom({kind:'level',levelId:'ch-z-1'});assert.equal(resumed.token,ticket.token);assert.equal(resumed.playerId,ticket.playerId);assert.deepEqual(resumed.room.puzzle,shuffled.puzzle);
 assert.equal(resumed.room.members[0].name,'玩家');assert.equal(next.rooms()[0].updatedAt,f.now());
 await solve(next,resumed);const clears=pendingOfflineClears(f.store);const again=createOfflineRoomServer({catalog:f.book,storage:f.store,now:f.now,randomId:f.randomId});
 await action(again,id,{type:'heartbeat'});assert.deepEqual(pendingOfflineClears(f.store),clears);
});

test('unknown urls, room ids and unsupported methods fail as offline network requests',async()=>{
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'});
 for(const url of ['/api/levels',`/api/rooms/${hex(999)}`,`/api/rooms/${ticket.room.id}/join`,`/api/rooms/${ticket.room.id.toUpperCase()}`.replace(/0/g,'A')])await assert.rejects(f.server.fetch(url),{name:'TypeError',message:'offline'});
 await assert.rejects(f.server.fetch(`/api/rooms/${ticket.room.id}`,{method:'DELETE'}),TypeError);
 await assert.rejects(action(f.server,ticket.room.id,{type:'unknown'}),TypeError);
});

test('the 25th room evicts the oldest completed room before an older unfinished room',async()=>{
 const f=fixture(),old=f.server.createRoom({kind:'free',imageId:'free',pieces:48});f.advance(1);
 const completed=[];
 for(let n=0;n<23;n++){const ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'});completed.push(ticket.room.id);await solve(f.server,ticket);f.advance(1);}
 assert.equal(f.server.rooms().length,24);
 f.server.createRoom({kind:'level',levelId:'ch-z-1'});
 assert.equal(f.server.rooms().length,24);assert.equal(f.server.isOfflineRoom(old.room.id),true);assert.equal(f.server.isOfflineRoom(completed[0]),false);
 assert.equal(f.store.get('jigsaw:offline-room:v1:'+completed[0]),null);
 assert.equal(JSON.parse(f.store.get('jigsaw:offline-room:index')).length,24);
});

test('without completed rooms, the 25th room evicts the oldest unfinished room',()=>{
 const book=catalog();book.chapters[0].levels=Array.from({length:25},(_,n)=>({...book.chapters[0].levels[0],id:'level-'+n}));
 const f=fixture({catalog:book}),ids=[];
 for(const level of book.chapters[0].levels){ids.push(f.server.createRoom({kind:'level',levelId:level.id}).room.id);f.advance(1);}
 assert.equal(f.server.rooms().length,24);assert.equal(f.server.isOfflineRoom(ids[0]),false);assert.equal(f.server.isOfflineRoom(ids[1]),true);
});

test('RoomClient uses instant local acquire, sends a batch, and solves against the offline server',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'}),requests=[],events=[];
 const client=new RoomClient(ticket,{fetch:async(url,init)=>{requests.push(init?.body?JSON.parse(init.body):null);return f.server.fetch(url,init);},randomId:f.randomId,emit:(name,detail)=>events.push({name,detail}),hidden:()=>false,now:f.now,performanceNow:f.now,solo:{enabled:()=>true,storage:f.store,energy:()=>null}});
 const table={network:null,networkReady:true,fit(){},cancelNetworkDrag(){},playConnectionSound(){},syncRemote(next){client.state=structuredClone(next);}};
 const detach=client.attach(table);t.after(detach);await until(()=>!client.polling);
 assert.equal(client.localPlay,true);const count=requests.length,pick=table.network.acquire(0);assert.equal(requests.length,count);assert.equal(await pick,true);
 const drop=table.network.drop(0,0,0);assert.equal(client.state.groups.find(group=>group.id===0).locked,true);assert.equal(requests.length,count);await drop;
 client.flushSoloNow();await until(()=>client.pendingSoloOps===0);assert.equal(requests.filter(action=>action?.type==='batch').length,1);
 while(client.state.groups.some(group=>!group.locked)){
  const group=client.state.groups.find(group=>!group.locked);assert.equal(await table.network.acquire(group.id),true);await table.network.drop(group.id,0,0);
 }
 client.flushSoloNow();await until(()=>client.pendingSoloOps===0&&client.snapshot.completedAt!==null);
 assert.equal(placedCount(client.snapshot.puzzle),12);assert.equal(pendingOfflineClears(f.store).length,1);
 assert.equal(events.filter(event=>event.name==='mobile:profile').length,0);
});

test('offline level view merges cached and queued clears, carries unlocks across chapters and preserves all story extras',()=>{
 const book=catalog(),store=storage(),extra={timeLabel:'清晨',intro:{text:'欢迎回来',panels:[1,2]},comic:[{src:'/story.webp',crop:{x:1,y:2},speech:['你好']}]};
 Object.assign(book.chapters[0].levels[0],extra,{futureStory:{arbitrary:[null,true,'value']}});
 assert.deepEqual(Object.keys(offlineLevelsView(book,null,store).current).sort(),['id','imageId','title','pieces','line','status',...Object.keys(extra),'futureStory'].sort());
 const cached=offlineLevelsView(book,null,store);cached.chapters[0].levels[0].status='cleared';cached.current=null;
 recordOfflineClear(store,clear('ch-z-2'));
 const view=offlineLevelsView(book,cached,store);assert.deepEqual(view.chapters.map(chapter=>chapter.levels.map(level=>level.status)),[['cleared','cleared'],['unlocked','locked']]);assert.equal(view.current.id,'ch-a-1');
 for(const [key,value] of Object.entries(extra))assert.deepEqual(view.chapters[0].levels[0][key],value);
 assert.deepEqual(view.chapters[0].levels[0].futureStory,{arbitrary:[null,true,'value']});assert.equal('cols' in view.chapters[0].levels[0],false);assert.equal('rows' in view.chapters[0].levels[0],false);
 assert.equal(view.chapters[0].coverSrc,book.photos.a.thumbSrc);assert.equal(view.firstClearEnergy,30);assert.equal(view.seriesTitle,book.seriesTitle);
});

test('RoomClient also supports offline claim/drop without solo local mode or leases',async t=>{
 const f=fixture(),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'}),cancelled=[];
 const client=new RoomClient(ticket,{fetch:f.server.fetch,randomId:f.randomId,emit(){},hidden:()=>false,now:f.now,performanceNow:f.now});
 const table={network:null,networkReady:true,fit(){},cancelNetworkDrag(id){cancelled.push(id);},playConnectionSound(){},syncRemote(next){client.state=structuredClone(next);}};
 const detach=client.attach(table);t.after(detach);await until(()=>!client.polling);
 assert.equal(client.localPlay,false);assert.equal(await table.network.acquire(0),true);
 await action(f.server,ticket.room.id,{type:'heartbeat'}).then(room=>client.receive(room));
 assert.deepEqual(cancelled,[]);await table.network.drop(0,0,0);
 assert.equal(placedCount(client.snapshot.puzzle),1);assert.deepEqual(client.snapshot.leases,{});
 while(client.state.groups.some(group=>!group.locked)){
  const group=client.state.groups.find(group=>!group.locked);assert.equal(await table.network.acquire(group.id),true);await table.network.drop(group.id,0,0);
 }
 assert.equal(client.snapshot.completedAt,f.now());assert.equal(pendingOfflineClears(f.store).length,1);
});

test('chapter-wide unavailability blocks the next chapter even when the previous level was cleared',()=>{
 const book=catalog(),store=storage(),cached=offlineLevelsView(book,null,store);
 for(const level of cached.chapters[0].levels)level.status='cleared';cached.current=null;
 delete book.photos.a;
 const view=offlineLevelsView(book,cached,store);assert.deepEqual(view.chapters.map(chapter=>chapter.levels.map(level=>level.status)),[['unavailable','unavailable'],['locked','locked']]);assert.equal(view.current,null);assert.equal(view.chapters[0].status,'unavailable');
 recordOfflineClear(store,clear('ch-a-1'));
 assert.equal(offlineLevelsView(book,cached,store).chapters[1].levels[1].status,'unlocked');
});

test('clears keep the first per level, cache validates reads, and storage failures never escape',async()=>{
 const store=storage(),book=catalog(),first=clear('ch-z-1');recordOfflineClear(store,first);recordOfflineClear(store,clear('ch-z-1',2));assert.deepEqual(pendingOfflineClears(store),[first]);
 recordOfflineClear(store,{...first,levelId:'bad',clearId:'invalid'});assert.equal(pendingOfflineClears(store).length,1);
 removeOfflineClears(store,[hex(999)]);assert.deepEqual(pendingOfflineClears(store),[first]);removeOfflineClears(store,[first.clearId]);assert.deepEqual(pendingOfflineClears(store),[]);
 const view=offlineLevelsView(book,null,store);cacheServerLevels(store,view);assert.deepEqual(readCachedServerLevels(store),view);
 for(const value of ['{','null','{}',JSON.stringify({...view,chapters:[{levels:[]}]}),JSON.stringify({...view,current:{id:'fake',status:'unlocked'}})]){store.set('jigsaw:levels-cache:v1',value);assert.equal(readCachedServerLevels(store),null);}
 const broken={get(){throw Error('denied');},set(){throw Error('quota');},remove(){throw Error('denied');}};
 recordOfflineClear(broken,first);removeOfflineClears(broken,[first.clearId]);cacheServerLevels(broken,view);assert.equal(readCachedServerLevels(broken),null);assert.deepEqual(pendingOfflineClears(broken),[]);
 const f=fixture({storage:broken}),ticket=f.server.createRoom({kind:'level',levelId:'ch-z-1'});await solve(f.server,ticket);assert.equal(f.server.rooms()[0].completed,true);
 store.set('jigsaw:offline-room:index','["not-a-room"]');assert.doesNotThrow(()=>fixture({storage:store}));
});

test('sync orders by catalog, removes final results, keeps deferred and sums accepted energy only',async()=>{
 const book=catalog(),store=storage(),entries=['ch-a-2','ch-a-1','ch-z-2','ch-z-1'].map((id,n)=>clear(id,n+1));for(const entry of entries)recordOfflineClear(store,entry);
 let input;
 const levels=offlineLevelsView(book,null,storage()),profile={energy:160};
 const result=await syncOfflineClears({storage:store,catalog:book,randomId:()=>hex(999),request:async(path,body)=>{
  assert.equal(path,'/api/levels/offline-clears');input=body;
  return {status:200,data:{results:body.clears.map((entry,n)=>({...entry,status:['accepted','duplicate','rejected','deferred'][n],energy:n===0?30:999})),energy:9999,levels,profile}};
 }});
 assert.deepEqual(input.clears.map(entry=>entry.levelId),['ch-z-1','ch-z-2','ch-a-1','ch-a-2']);assert.equal(input.requestId,hex(999));assert.equal('roomId' in input.clears[0],false);
 assert.deepEqual(result,{accepted:1,energy:30,levels,profile});assert.deepEqual(pendingOfflineClears(store),[entries[0]]);
});

test('sync uses cached order, sends at most 20, and preserves new clears and unrecognized results',async()=>{
 const store=storage(),book=catalog();book.chapters[0].levels=Array.from({length:22},(_,n)=>({...book.chapters[0].levels[0],id:'level-'+n}));book.chapters.length=1;
 cacheServerLevels(store,offlineLevelsView(book,null,store));for(let n=21;n>=0;n--)recordOfflineClear(store,clear('level-'+n,n+1));
 const result=await syncOfflineClears({storage:store,request:async(path,body)=>{
  assert.match(body.requestId,/^[a-f0-9]{32}$/);assert.equal(body.clears.length,20);assert.deepEqual(body.clears.map(entry=>entry.levelId),Array.from({length:20},(_,n)=>'level-'+n));
  recordOfflineClear(store,clear('new-level',99));
  return {status:200,data:{results:[{...body.clears[0],status:'accepted',energy:10},{...body.clears[0],status:'accepted',energy:10},{...body.clears[1],levelId:'wrong',status:'rejected',energy:0},{clearId:hex(888),levelId:'foreign',status:'accepted',energy:999}],levels:null,profile:null}};
 }});
 assert.equal(result.accepted,1);assert.equal(result.energy,10);assert.equal(pendingOfflineClears(store).length,22);assert.ok(pendingOfflineClears(store).some(entry=>entry.levelId==='new-level'));
});

test('404/405, server errors, malformed replies and network errors retain every pending clear',async()=>{
 const store=storage(),entry=clear('ch-z-1');recordOfflineClear(store,entry);
 for(const status of [404,405,500,503]){assert.equal(await syncOfflineClears({storage:store,request:async()=>({status,data:{}})}),null);assert.deepEqual(pendingOfflineClears(store),[entry]);}
 assert.equal(await syncOfflineClears({storage:store,request:async()=>{throw new TypeError('offline');}}),null);
 assert.equal(await syncOfflineClears({storage:store,request:async()=>({status:200,data:{}})}),null);assert.deepEqual(pendingOfflineClears(store),[entry]);
 removeOfflineClears(store,[entry.clearId]);assert.equal(await syncOfflineClears({storage:store,request:async()=>assert.fail('empty queue sent')}),null);
});

test('network failure classification keeps HTTP failures distinct from unavailable transport',()=>{
 for(const error of [undefined,null,new Error('network'),new TypeError('offline'),{status:0},{name:'AbortError'},{name:'TimeoutError'}])assert.equal(isNetworkFailure(error),true);
 for(const status of [400,401,403,404,409,429,500,503]){assert.equal(isNetworkFailure({status}),false);assert.equal(isNetworkFailure(Object.assign(new TypeError('HTTP'),{status})),false);}
 assert.equal(isNetworkFailure({status:200}),false);
});

test('real dry2 packaged catalog yields the packaged online artwork and grids without recomputing pieces',t=>{
 const file=new URL('../releases/jigsaw-nook-taptap-20261027-offline-dry2.zip.json',import.meta.url);
 let report;try{report=JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT'){t.skip('local dry2 artifact not present');return;}throw error;}
 const book=readOfflineCatalog(report.config.offlineCatalog);assert.ok(book);
 const f=fixture({catalog:book});
 for(const level of book.chapters.flatMap(chapter=>chapter.levels)){
  const room=f.server.createRoom({kind:'level',levelId:level.id}).room;
  assert.deepEqual([room.puzzle.cols,room.puzzle.rows],[level.cols,level.rows]);assert.equal(room.requestedPieces,level.pieces);assert.deepEqual(room.artwork,book.photos[level.imageId].artwork);
 }
 assert.equal(offlineLevelsView(book,null,f.store).current.id,book.chapters[0].levels[0].id);
});
