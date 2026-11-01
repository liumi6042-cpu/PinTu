import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {build} from 'esbuild';
import {createMobileService} from '../server/mobile-service.mjs';
import {MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64),pieces=[12,16,20,24,30,35];
const chapter=id=>({id,title:'章节 '+id,albumId:catalog.packs[0].id,pieces:[...pieces]});
const configuration=()=>({schema:'jigsaw-levels/v1',firstClearEnergy:30,chapters:[chapter('ch1'),chapter('ch2')]});
const path='/api/levels/offline-clears';
function fixture(t,options={}){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-offline-clears-test-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const settings={databasePath,now:()=>now,randomInt:min=>min,levels:configuration(),...options};
 let service=createMobileService(settings);const db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(url,body,actor=owner,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(...args)=>{const reply=call(...args);assert.ok([200,201].includes(reply.status),JSON.stringify(reply));return reply.data;};
 const stored=(actor=owner)=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);
 const patch=(changes,actor=owner)=>db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...stored(actor),...changes}),actor);
 for(const actor of [owner,peer]){ok('/api/mobile/profile',undefined,actor);patch({level:50,xp:20,totalXp:12000,energy:200,energyAt:now,firstRoomCompleted:true,autoSupply:false,supply:{energy:0,create:0}},actor);}
 const clear=(levelId='ch1-1',changes={})=>({clearId:rid(),levelId,completedAt:now-10000,elapsedMs:pieces[Number(levelId.split('-').at(-1))-1]*200,pieces:pieces[Number(levelId.split('-').at(-1))-1],...changes});
 const sync=(clears,requestId=rid(),actor=owner)=>ok(path,{requestId,clears},actor);
 const events=()=>db.prepare("SELECT owner,room_id,data,created_at FROM mobile_events WHERE kind='level-clear' ORDER BY id").all().map(row=>({...row,data:JSON.parse(row.data)}));
 const finish=ticket=>{
  const room=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
  for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}
  db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),room.id);
  const groupId=room.puzzle.groups.find(group=>!group.locked).id,url='/api/rooms/'+room.id;
  ok(url,{type:'claim',groupId},owner,ticket.token);
  const result=ok(url,{type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()},owner,ticket.token);assert.ok(result.completedAt);return result;
 };
 return {db,call,ok,stored,patch,clear,sync,events,finish,get service(){return service;},get now(){return now;},advance:ms=>now+=ms,reopen:changes=>{service.close();service=createMobileService({...settings,...changes});}};
}

test('offline capability is additive, defaults on, and host/env/web kill switches return 503',t=>{
 const previous=process.env.MOBILE_OFFLINE_LEVEL_CLEARS;
 try{
  delete process.env.MOBILE_OFFLINE_LEVEL_CLEARS;
  const f=fixture(t,{soloLocalPlay:true,tapMultiplayerEnabled:false}),{offlineLevelClears,weeklyGift,dailyStreak,tuanziTravel,...existing}=f.service.capabilities;
  assert.equal(offlineLevelClears,true);assert.equal(weeklyGift,true);assert.equal(dailyStreak,true);assert.equal(tuanziTravel,true);
  assert.deepEqual(existing,{energy:true,ads:false,shareRewards:true,tapMultiplayer:false,soloLocalPlay:true,albumTarget:'mobile-shared',createTickets:true,customNames:false,cheers:true,privacyRequests:true,roomActionRevisionBody:true,social:{friends:true,privateMessages:false,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9'}});
  assert.equal(f.ok('/api/mobile/profile').capabilities.offlineLevelClears,true);
  const disabled=[fixture(t,{offlineLevelClears:false}),fixture(t,{runtimeProfile:'web',offlineLevelClears:true})];
  process.env.MOBILE_OFFLINE_LEVEL_CLEARS='false';disabled.push(fixture(t));
  assert.equal(fixture(t,{offlineLevelClears:true}).service.capabilities.offlineLevelClears,true);
  for(const off of disabled){
   assert.equal(off.service.capabilities.offlineLevelClears,false);assert.equal(off.ok('/api/mobile/profile').capabilities.offlineLevelClears,false);
   const reply=off.call(path,{requestId:rid(),clears:[off.clear()]});assert.equal(reply.status,503);assert.equal(reply.data.code,'OFFLINE_CLEARS_UNAVAILABLE');assert.equal(reply.data.error,'离线通关同步暂不可用');
  }
 }finally{if(previous===undefined)delete process.env.MOBILE_OFFLINE_LEVEL_CLEARS;else process.env.MOBILE_OFFLINE_LEVEL_CLEARS=previous;}
});

test('one clear grants only first-clear energy above cap and preserves all other rewards and ledgers',t=>{
 const f=fixture(t),entry=f.clear(),before=f.stored();
 const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'mobile_task_%' OR name LIKE 'mobile_collection_%' OR name IN ('mobile_rooms','mobile_settlements')) ORDER BY name").all().map(row=>row.name);
 const ledgers=()=>tables.map(name=>[name,f.db.prepare('SELECT * FROM '+name).all()]);const snapshot=ledgers();
 const result=f.sync([entry]);
 assert.deepEqual(Object.keys(result).sort(),['energy','levels','profile','results']);
 assert.deepEqual(result.results,[{clearId:entry.clearId,levelId:entry.levelId,status:'accepted',energy:30}]);assert.equal(result.energy,30);assert.equal(result.profile.energy,230);assert.ok(result.profile.energy>result.profile.energyCap);
 assert.deepEqual(f.stored(),{...before,energy:before.energy+30});assert.deepEqual(ledgers(),snapshot);
 assert.deepEqual(result.levels,f.ok('/api/levels'));assert.equal(result.levels.chapters[0].levels[0].status,'cleared');assert.equal(result.levels.current.id,'ch1-2');
 assert.deepEqual(f.events(),[{owner,room_id:null,data:{levelId:entry.levelId,firstClear:true,energy:30,offline:true,clearId:entry.clearId,elapsedMs:entry.elapsedMs},created_at:f.now}]);
 assert.deepEqual({...f.db.prepare('SELECT * FROM mobile_level_progress WHERE owner=?').get(owner)},{owner,level_id:entry.levelId,room_id:'offline:'+entry.clearId,cleared_at:entry.completedAt,energy:30});
 assert.equal(f.ok('/api/levels',undefined,peer).current.id,'ch1-1');
});

test('reversed first two levels are processed in configured order and each unlocks the next',t=>{
 const f=fixture(t),one=f.clear('ch1-1'),two=f.clear('ch1-2'),result=f.sync([two,one]);
 assert.deepEqual(result.results.map(r=>[r.levelId,r.status,r.energy]),[['ch1-1','accepted',30],['ch1-2','accepted',30]]);assert.equal(result.energy,60);assert.equal(result.levels.current.id,'ch1-3');
});

test('twenty entries sort across nonlexical chapters and numeric level indices',t=>{
 const chapters=['z','a','y','b'].map(chapter),f=fixture(t,{levels:{...configuration(),chapters}});
 const ordered=chapters.flatMap(ch=>ch.pieces.map((_,index)=>f.clear(ch.id+'-'+(index+1)))).slice(0,20),result=f.sync([...ordered].reverse());
 assert.deepEqual(result.results.map(r=>r.levelId),ordered.map(e=>e.levelId));assert.ok(result.results.every(r=>r.status==='accepted'));assert.equal(result.energy,600);assert.equal(result.levels.current.id,'b-3');
});

test('a missing predecessor defers a clear until a later fresh request, without consuming its clearId',t=>{
 const f=fixture(t);f.sync([f.clear()]);const third=f.clear('ch1-3'),requestId=rid(),deferred=f.sync([third],requestId);
 assert.equal(deferred.results[0].status,'deferred');assert.equal(deferred.energy,0);assert.equal(f.events().length,1);
 f.sync([f.clear('ch1-2')]);assert.deepEqual(f.sync([third],requestId),deferred,'the original request remains replayable');
 assert.equal(f.sync([third]).results[0].status,'accepted');assert.equal(f.events().length,3);
});

test('an unavailable chapter defers without granting energy or progress',t=>{
 const f=fixture(t,{levels:{...configuration(),chapters:[{...chapter('ch1'),albumId:'missing'}]}}),result=f.sync([f.clear()]);
 assert.equal(result.results[0].status,'deferred');assert.equal(result.energy,0);assert.equal(f.stored().energy,200);assert.equal(f.events().length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress').get().n,0);
});

test('a real online clear makes an offline submission duplicate without a second reward',t=>{
 const f=fixture(t),ticket=f.ok('/api/rooms',{mode:'level',levelId:'ch1-1',requestId:rid()});f.finish(ticket);const before=f.stored(),result=f.sync([f.clear()]);
 assert.equal(result.results[0].status,'duplicate');assert.equal(result.energy,0);assert.deepEqual(f.stored(),before);assert.equal(f.events().length,1);assert.equal(f.events()[0].data.offline,undefined);
});

test('a level cleared offline still creates and completes online with no second first-clear energy',t=>{
 const f=fixture(t);f.sync([f.clear()]);const ticket=f.ok('/api/rooms',{mode:'level',levelId:'ch1-1',requestId:rid()}),before=f.stored().energy,result=f.finish(ticket),reward=result.profile.lastReward;
 assert.deepEqual(reward.levelClear,{levelId:'ch1-1',firstClear:false,energy:0,nextLevelId:'ch1-2',chapterComplete:false});assert.equal(result.profile.energy,before-reward.energySpent+reward.completion.energy);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress').get().n,1);assert.deepEqual(f.events().map(e=>e.data.energy),[30,0]);
});

test('request replay survives restart, conflicts on body changes, and stays scoped to the owner',t=>{
 const f=fixture(t),entry=f.clear(),requestId=rid(),first=f.sync([entry],requestId);f.advance(1234);f.reopen({});
 assert.deepEqual(f.sync([entry],requestId),first);assert.equal(f.stored().energy,230);assert.equal(f.events().length,1);
 const conflict=f.call(path,{requestId,clears:[{...entry,elapsedMs:entry.elapsedMs+1}]});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'REQUEST_CONFLICT');
 assert.equal(f.sync([entry],requestId,peer).results[0].status,'accepted');assert.equal(f.stored(peer).energy,230);
 const again=f.sync([{...entry,clearId:rid()}]);assert.equal(again.results[0].status,'duplicate');assert.equal(again.energy,0);assert.equal(f.stored().energy,230);
 f.reopen({offlineLevelClears:false});assert.equal(f.call(path,{requestId,clears:[entry]}).status,503,'kill switch also blocks saved receipts');
});

test('duplicate clearIds or levelIds in a batch keep the first entry',t=>{
 const f=fixture(t),one=f.clear(),two=f.clear('ch1-2'),result=f.sync([one,{...two,clearId:one.clearId},{...one,clearId:rid()},two]);
 assert.deepEqual(result.results.map(r=>[r.clearId,r.levelId,r.status]),[[one.clearId,'ch1-1','accepted'],[two.clearId,'ch1-2','accepted']]);assert.equal(result.energy,60);
 const malformed=f.clear('ch1-3',{elapsedMs:-1}),kept=f.sync([malformed,{...malformed,elapsedMs:4000}]);assert.equal(kept.results.length,1);assert.equal(kept.results[0].code,'INVALID');
});

test('piece mismatch, too-fast and unknown entries reject independently and unknown levels sort last',t=>{
 const f=fixture(t),unknown=f.clear('missing',{pieces:12,elapsedMs:2400}),wrong=f.clear('ch1-1',{pieces:13}),fast=f.clear('ch1-2',{elapsedMs:3199}),result=f.sync([unknown,fast,wrong]);
 assert.deepEqual(result.results.map(r=>[r.levelId,r.status,r.code,r.energy]),[['ch1-1','rejected','PIECES_MISMATCH',0],['ch1-2','rejected','TOO_FAST',0],['missing','rejected','INVALID_LEVEL',0]]);assert.equal(result.energy,0);assert.equal(f.stored().energy,200);assert.equal(f.events().length,0);
});

test('malformed entry shapes reject locally while valid entries in the request still succeed',t=>{
 const f=fixture(t),base=f.clear();
 const invalid=[null,[],{},'entry',...[
  {clearId:'A'.repeat(32)},{clearId:'a'.repeat(31)},{clearId:123},{levelId:123},{levelId:'x'.repeat(101)},
  {completedAt:1.5},{completedAt:Number.MAX_SAFE_INTEGER+1},{completedAt:'1'},
  {elapsedMs:-1},{elapsedMs:1.5},{elapsedMs:Number.MAX_SAFE_INTEGER+1},{elapsedMs:'2400'},
  {pieces:0},{pieces:-1},{pieces:1.5},{pieces:Number.MAX_SAFE_INTEGER+1},{pieces:'12'},
 ].map(change=>({...base,...change}))];
 for(const entry of invalid){const result=f.sync([entry]);assert.equal(result.results.length,1);assert.equal(result.results[0].status,'rejected');assert.equal(result.results[0].code,'INVALID');assert.equal(result.energy,0);}
 const result=f.sync([null,base]);assert.equal(result.results[0].code,'INVALID');assert.equal(result.results[1].status,'accepted');
 const requestId=rid(),malformed=f.sync([{}],requestId);assert.deepEqual(f.sync([{}],requestId),malformed,'malformed replies also survive receipt serialization');
});

test('batch and requestId validation uses existing 400 codes and makes no progress',t=>{
 const f=fixture(t);
 for(const clears of [undefined,null,{},[],Array.from({length:21},()=>f.clear())]){
  const reply=f.call(path,{requestId:rid(),clears});assert.equal(reply.status,400);assert.equal(reply.data.code,'INVALID_OFFLINE_CLEARS');
 }
 for(const requestId of [undefined,'bad','A'.repeat(32)]){const reply=f.call(path,{requestId,clears:[f.clear()]});assert.equal(reply.status,400);assert.equal(reply.data.code,'REQUEST_ID_REQUIRED');}
 assert.equal(f.call(path,{requestId:rid(),clears:[f.clear()]},'invalid').status,401);assert.equal(f.events().length,0);assert.equal(f.stored().energy,200);
});

test('completion time is clamped to zero/now while events use server time and configured energy',t=>{
 const f=fixture(t,{levels:{...configuration(),firstClearEnergy:7}}),result=f.sync([f.clear('ch1-1',{completedAt:-1}),f.clear('ch1-2',{completedAt:f.now+1})]);
 assert.equal(result.energy,14);assert.deepEqual(f.db.prepare('SELECT cleared_at,energy FROM mobile_level_progress ORDER BY level_id').all().map(row=>({...row})),[{cleared_at:0,energy:7},{cleared_at:f.now,energy:7}]);assert.ok(f.events().every(event=>event.created_at===f.now));
 const zero=fixture(t,{levels:{...configuration(),firstClearEnergy:0}});assert.equal(zero.sync([zero.clear()]).results[0].status,'accepted');assert.equal(zero.stored().energy,200);
});

test('failed progress or replay receipt writes roll back the whole batch, profile and events',t=>{
 for(const table of ['mobile_level_progress','mobile_requests']){
  const f=fixture(t),before=f.stored(),input={requestId:rid(),clears:[f.clear(),f.clear('ch1-2')]};
  f.db.exec("CREATE TRIGGER reject_write BEFORE INSERT ON "+table+" BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
  assert.equal(f.call(path,input).status,500);assert.deepEqual(f.stored(),before);assert.equal(f.events().length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress').get().n,0);
  f.db.exec('DROP TRIGGER reject_write');assert.equal(f.ok(path,input).energy,60);
 }
});

test('GameClient parses the new capability like soloLocalPlay and syncOfflineClears consumes real server replies',async t=>{
 const bundled=await build({stdin:{contents:"export {GameClient} from './mobile/client.ts'; export {recordOfflineClear,pendingOfflineClears,syncOfflineClears} from './lib/offline-play.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
 const {GameClient,recordOfflineClear,pendingOfflineClears,syncOfflineClears}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+'\n//# sourceURL=offline-clears-client-test.mjs').toString('base64'));
 for(const [cookie,flag,expected]of [[false,true,true],[false,false,false],[false,undefined,false],[false,'true',false],[true,true,false]]){
  const values=new Map(),platform={config:{id:cookie?'web':'wechat',identityMode:cookie?'web-cookie':undefined,apiBase:'/h5'},storage:{get:key=>values.get(key)??null,set:(key,value)=>values.set(key,value)},request:async({url})=>({status:200,headers:{},data:url.endsWith('/config')?{mobileMode:cookie?'web-managed-shared':'mobile-v3-isolated',capabilities:{soloLocalPlay:flag,offlineLevelClears:flag}}:url.endsWith('/session')?{token:owner}:{level:1,energy:60,energyCap:60,supply:{}}})};
  const client=new GameClient(platform);await client.start();assert.equal(client.config.capabilities.offlineLevelClears,expected);assert.equal(client.config.capabilities.soloLocalPlay,expected);
 }
 const f=fixture(t),values=new Map(),storage={get:key=>values.get(key)??null,set:(key,value)=>values.set(key,value),remove:key=>values.delete(key)};
 recordOfflineClear(storage,{...f.clear(),roomId:rid()});recordOfflineClear(storage,{...f.clear('ch1-3'),roomId:rid()});
 const request=async(url,body)=>{assert.ok(body.clears.every(entry=>!Object.hasOwn(entry,'roomId')));return f.call(url,body);};
 const first=await syncOfflineClears({storage,request,randomId:rid});assert.equal(first.accepted,1);assert.equal(first.energy,30);assert.equal(first.profile.energy,230);assert.equal(first.levels.current.id,'ch1-2');assert.deepEqual(pendingOfflineClears(storage).map(e=>e.levelId),['ch1-3']);
 recordOfflineClear(storage,{...f.clear('ch1-2'),roomId:rid()});const second=await syncOfflineClears({storage,request,randomId:rid});assert.equal(second.accepted,2);assert.equal(second.energy,60);assert.deepEqual(pendingOfflineClears(storage),[]);
});
