import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';

// Keep the actual asynchronous store/CAS implementation. Only platform access,
// room error type and content reader are injected for this in-memory database.
const modelUrl=new URL('../lib/managed-economy-model.mjs',import.meta.url).href;
const managedContentUrl=new URL('../lib/managed-content.ts',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'test:managed-economy-env',shortCircuit:true};
 if(specifier.startsWith('.')&&!/\.[cm]?[jt]s$/.test(specifier)){try{return next(specifier+'.ts',context);}catch{}}
 return next(specifier,context);
},load(url,context,next){if(url==='test:managed-economy-env')return {format:'module',source:'export const env={};',shortCircuit:true};return next(url,context);}});
let source=readFileSync(new URL('../lib/managed-economy.ts',import.meta.url),'utf8');
source=source.replace(/import \{localDb\} from '\.\/local-db';/,"const localDb=()=>globalThis.__managedEconomyTestDatabase;")
 .replace(/import \{RoomError,type Room\} from '\.\/room-engine';/,"class RoomError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}")
 .replace(/import \{pieceBand\} from '\.\/piece-policy';/,"const pieceBand=(count:number)=>count;")
 .replace(/import \{readManagedContent,effectiveManagedAlbums,managedDailyPuzzle,type ManagedContentSnapshot\} from '\.\/managed-content';/,"import {effectiveManagedAlbums} from "+JSON.stringify(managedContentUrl)+";type ManagedContentSnapshot=any;const readManagedContent=()=>null;const managedDailyPuzzle=(snapshot:any)=>snapshot.photos.find((photo:any)=>photo.id==='daily');")
 .replace("from './managed-economy-model.mjs'",'from '+JSON.stringify(modelUrl))
 .replace("from './decoration-policy.mjs'",'from '+JSON.stringify(new URL('../lib/decoration-policy.mjs',import.meta.url).href));
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const store=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const owner='a'.repeat(32),guest='guest:'+'b'.repeat(64),bot='guest:'+'c'.repeat(64);
const game=structuredClone(DEFAULT_GAME_SETTINGS),rewards=structuredClone(DEFAULT_TASK_REWARD_SETTINGS);
game.collection.contributionCoins=2;game.energy.contributionXp=3;game.collection.catalogMinimumContributions=2;
rewards.tasks.forEach(task=>{task.coins=11;task.xp=5;});rewards.invitationFriend.coins=13;rewards.invitationFriend.xp=8;
const paid={id:'paid-album',title:'相册',description:'收藏',showOnPc:true,purchasable:true,price:10,imageIds:['a','b'],milestones:[{id:'stable',target:1,coins:17,decorationId:'cloud-moon'}]};
const free={id:'free-album',title:'免费相册',description:'自由拼图',showOnPc:true,purchasable:false,price:0,imageIds:['c'],milestones:[]};
const snapshot={releaseId:'test-local',gameSettings:game,taskRewards:rewards,albums:{albums:[paid,free]},dailyRuntime:{managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]},photos:[...['a','b','c','daily'].map(id=>({id,title:id,src:'/a.jpg',thumbSrc:'/a-thumb.jpg',width:1200,height:900}))]};
function makeRoom(id,count,now){return {id,revision:0,puzzle:{imageId:'a',cols:12,rows:9},members:[{id:'one',accountId:owner,name:'一',lastSeen:now},{id:'two',guestId:guest,name:'二',lastSeen:now}],achievements:{contributors:{[owner]:{count,days:[]}}},createdAt:now-1000,lastPlayedAt:now,completedAt:null};}
function createDb(){const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url)));globalThis.__managedEconomyTestDatabase=db;db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(owner,'owner','测试用户','placeholder','salt',Date.now());return db;}
function writeRoom(db,room){db.sql.prepare('INSERT OR REPLACE INTO puzzle_rooms(id,revision,data,expires_at) VALUES(?,?,?,?)').run(room.id,room.revision,JSON.stringify(room),Date.now()+86400000);}
const stateFor=(db,id=owner)=>JSON.parse(db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(id).data);

test('real store captures legacy baselines and counts the first new committed snap once',async()=>{
 const db=createDb(),now=Date.now(),previous=makeRoom('first',20,now),committed=makeRoom('first',21,now),historic=makeRoom('old',50,now-100000);
 historic.completedAt=now-100000;writeRoom(db,committed);writeRoom(db,historic);
 const legacy=JSON.stringify({balance:55,progress:90,cosmetics:{cursors:['9'],equipped:{cursor:'9'}}});db.sql.prepare('INSERT INTO puzzle_courtyards(user_id,data) VALUES(?,?)').run(owner,legacy);
 try{
  await Promise.all([store.syncManagedRoom(committed,snapshot,previous),store.syncManagedRoom(committed,snapshot,previous)]);
  assert.equal(stateFor(db).coins,2);assert.equal(stateFor(db).totalXp,3);assert.equal(stateFor(db).rooms.first.rewarded,1);
  await store.syncManagedRoom(historic,snapshot);assert.equal(stateFor(db).coins,2);assert.equal(stateFor(db).rooms.old.rewarded,0);
  assert.equal(db.sql.prepare('SELECT data FROM puzzle_courtyards WHERE user_id=?').get(owner).data,legacy);
  assert.equal(JSON.stringify(stateFor(db)).includes('energy'),false);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
test('real concurrent task claims, album purchases and permanent retained rights are atomic',async()=>{
 const db=createDb(),now=Date.now(),previous=makeRoom('task-room',0,now),committed=makeRoom('task-room',10,now);writeRoom(db,committed);
 db.sql.prepare('INSERT INTO puzzle_managed_recent_activity VALUES(?,?,?,?)').run(committed.id,guest,1,now);
 try{
  await store.syncManagedRoom(committed,snapshot,previous);const initial=stateFor(db).coins;assert.equal(initial,30);
  await Promise.all([store.managedPlayerAction(owner,{action:'claim-task',taskId:'cooperation-10'},snapshot),store.managedPlayerAction(owner,{action:'claim-task',taskId:'cooperation-10'},snapshot)]);
  assert.equal(stateFor(db).coins,initial+11);assert.equal(stateFor(db).totalXp,35);
  await Promise.all([store.managedPlayerAction(owner,{action:'purchase-album',albumId:paid.id},snapshot),store.managedPlayerAction(owner,{action:'purchase-album',albumId:paid.id},snapshot)]);
  assert.equal(stateFor(db).coins,initial+11-10);
  const moved={...snapshot,albums:{albums:[{...paid,imageIds:[]},free]}};
  assert.equal(await store.managedImageAllowed(owner,'a',moved,now),true);assert.equal(await store.managedImageAllowed(guest,'a',moved,now),false);
  const view=await store.managedPlayerView(owner,moved,'http://localhost',{recover:false});assert.deepEqual(view.retainedImages.map(photo=>photo.id),['a','b']);
  assert.deepEqual(view.albums.map(album=>album.id),[free.id],'empty purchased album is hidden while its images stay accessible');
  assert.deepEqual(stateFor(db).ownedAlbums[paid.id].imageIds,['a','b']);
  assert.equal((await store.managedAccessibleImageIds(owner,moved,now)).has('a'),true);
  await assert.rejects(store.managedPlayerAction(guest,{action:'purchase-album',albumId:paid.id},moved),/相册暂未开放购买/);
  assert.match(view.tasks.daily[0].goal,/有效拼合/);assert.ok(view.tasks.daily[0].goalEn.length>20);
  await assert.rejects(store.managedPlayerAction(guest,{action:'claim-task',taskId:'cooperation-10'},snapshot),/奖励不存在/);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
test('verified friend requests do not create task progress, bots are not eligible partners',async()=>{
 const db=createDb();
 try{
  const first=await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false}),second=await store.managedPlayerView(guest,snapshot,'http://localhost',{recover:false});
  await store.managedPlayerAction(owner,{action:'request-friend',code:second.friends.code},snapshot);
  await assert.rejects(store.managedPlayerAction(owner,{action:'accept-friend',code:second.friends.code},snapshot),/好友请求/);
  await store.managedPlayerAction(guest,{action:'accept-friend',code:first.friends.code},snapshot);
  const friends=await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false});assert.equal(friends.friends.list.length,1);assert.equal(friends.tasks.friends[0].progress,0);
  const now=Date.now(),committed=makeRoom('bot-room',1,now);committed.members[1]={id:'bot',guestId:bot,lastSeen:now,bot:true};writeRoom(db,committed);db.sql.prepare('INSERT INTO puzzle_managed_recent_activity VALUES(?,?,?,?)').run(committed.id,bot,1,now);
  await store.syncManagedRoom(committed,snapshot,makeRoom(committed.id,0,now));
  const after=await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false});assert.equal(after.tasks.daily[0].progress,0);assert.equal(after.tasks.friends[0].progress,0);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
test('invitation binds server codes, qualifies only after committed work and pays the gift snapshot once',async()=>{
 const db=createDb();
 try{
  const first=await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false});
  await assert.rejects(store.managedPlayerAction(owner,{action:'accept-invitation',code:first.friends.code},snapshot),/自己的邀请码/);
  await store.managedPlayerAction(guest,{action:'accept-invitation',code:first.friends.code},snapshot);
  assert.equal((await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false})).tasks.gifts.length,0);
  const now=Date.now(),committed=makeRoom('invited-room',0,now);committed.achievements.contributors={[guest]:{count:2,days:[]}};writeRoom(db,committed);
  await store.syncManagedRoom(committed,snapshot);assert.equal((await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false})).tasks.gifts.length,0);
  committed.achievements.contributors[guest].count=3;writeRoom(db,committed);await store.syncManagedRoom(committed,snapshot);
  const view=await store.managedPlayerView(owner,snapshot,'http://localhost',{recover:false}),gift=view.tasks.gifts.find(item=>item.kind==='invite-friend');assert.ok(gift);assert.equal(gift.coins,13);assert.equal(gift.xp,8);
  const changed={...snapshot,taskRewards:{...rewards,invitationFriend:{...rewards.invitationFriend,coins:999,xp:999}}};
  await Promise.all([store.managedPlayerAction(owner,{action:'claim-gift',giftId:gift.id},changed),store.managedPlayerAction(owner,{action:'claim-gift',giftId:gift.id},changed)]);
  assert.equal(stateFor(db).coins,13);assert.equal(stateFor(db).totalXp,8);assert.equal(stateFor(db,guest).invitation.contributions,3);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
async function enqueue(db,current,previous,content,occurredAt,unavailable=false){
 const event=await store.prepareManagedRoomEvent(current,previous,content,occurredAt,{unavailable});
 assert.ok(event);
 const results=await db.batch([
  db.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(current),current.revision,current.id,previous.revision),
  db.prepare('INSERT OR IGNORE INTO puzzle_managed_reward_events(id,room_id,revision,occurred_at,payload) SELECT ?,?,?,?,? WHERE changes()=1').bind(event.id,event.roomId,event.revision,event.occurredAt,event.payload)
 ]);return {event,results};
}
test('durable known-version recovery retains yesterday tasks and exact rewards after a newer release',async()=>{
 const db=createDb(),occurredAt=Date.now()-86400000,previous=makeRoom('night-room',0,occurredAt),current=makeRoom('night-room',10,occurredAt);current.revision=1;writeRoom(db,previous);
 const historic=makeRoom('finished-before-growth',50,occurredAt-10000);historic.completedAt=occurredAt-10000;writeRoom(db,historic);
 db.sql.prepare('INSERT INTO puzzle_managed_recent_activity VALUES(?,?,?,?)').run(current.id,guest,1,occurredAt);
 try{
  const original={...snapshot,releaseId:'night-original'},later={...snapshot,releaseId:'next-day-release',gameSettings:{...game,collection:{...game.collection,contributionCoins:99}},taskRewards:{...rewards,tasks:rewards.tasks.map(item=>({...item,coins:999,xp:999}))}};
  const {event,results}=await enqueue(db,current,previous,original,occurredAt);assert.equal(results[0].meta.changes,1);assert.equal(results[1].meta.changes,1);assert.equal(event.payload.includes('energy'),false);
  const pending=await store.managedRewardStatus(owner);assert.equal(pending.pendingEvents,1);assert.equal(pending.unknownSnapshot,0);
  const before=await store.managedPlayerView(owner,later,'http://localhost',{recover:false});assert.equal(before.settlement.status,'pending');assert.equal(before.profile.coins,0);
  await store.drainManagedRewards(later,owner);const state=stateFor(db),yesterday=new Date(occurredAt+8*3600000).toISOString().slice(0,10),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  assert.equal(state.coins,30);assert.equal(state.totalXp,30);assert.equal(state.daily[yesterday].cooperation,10);assert.equal(state.daily[today],undefined);
  assert.equal(state.gifts['daily:'+yesterday+':cooperation-10'].coins,11);assert.equal(state.rooms['finished-before-growth'],undefined);
  assert.deepEqual(state.settlements[event.id],{sourceReleaseId:'night-original',contentReleaseId:'night-original',policy:'original-release',occurredAt,settledAt:state.settlements[event.id].settledAt});
  await store.drainManagedRewards(later,owner);assert.equal(stateFor(db).coins,30);
  await assert.rejects(store.managedPlayerAction(owner,{action:'claim-task',taskId:'cooperation-10'},later),/奖励不存在/);
  await store.managedPlayerAction(owner,{action:'claim-gift',giftId:'daily:'+yesterday+':cooperation-10'},later);assert.equal(stateFor(db).coins,41);assert.equal(stateFor(db).totalXp,35);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
test('unknown configuration pins the first valid recovery release and reports that policy explicitly',async()=>{
 const db=createDb(),occurredAt=Date.now()-86400000,previous=makeRoom('unknown-room',0,occurredAt),current=makeRoom('unknown-room',1,occurredAt);current.revision=1;writeRoom(db,previous);
 try{
  const {event}=await enqueue(db,current,previous,null,occurredAt,true);assert.equal((await store.managedRewardStatus(owner)).unknownSnapshot,1);
  await store.drainManagedRewards(null,owner);assert.equal(db.sql.prepare('SELECT settled_at FROM puzzle_managed_reward_events WHERE id=?').get(event.id).settled_at,null);
  const chosen={...snapshot,releaseId:'recovery-picked',gameSettings:{...game,collection:{...game.collection,contributionCoins:7}}};
  await Promise.all([store.drainManagedRewards(chosen,owner),store.drainManagedRewards(chosen,owner)]);
  assert.equal(stateFor(db).coins,7);assert.equal(stateFor(db).settlements[event.id].sourceReleaseId,null);assert.equal(stateFor(db).settlements[event.id].policy,'first-valid-release');
  const recovered=await store.managedRewardStatus(owner);assert.equal(recovered.pending,0);assert.equal(recovered.lastRecovered.contentReleaseId,'recovery-picked');assert.match(recovered.notice,/recovery-picked/);assert.match(recovered.noticeEn,/original puzzle date/);
  await store.drainManagedRewards({...snapshot,releaseId:'later-again'},owner);assert.equal(stateFor(db).coins,7);assert.equal(stateFor(db).settlements[event.id].contentReleaseId,'recovery-picked');
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
test('failed room CAS does not enqueue a reward receipt',async()=>{
 const db=createDb(),now=Date.now(),previous=makeRoom('cas-room',0,now),current=makeRoom('cas-room',1,now);current.revision=1;writeRoom(db,previous);
 try{
  await enqueue(db,current,previous,snapshot,now);
  const stale=await enqueue(db,current,previous,snapshot,now);assert.equal(stale.results[0].meta.changes,0);assert.equal(stale.results[1].meta.changes,0);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_reward_events').get().n,1);
  await store.drainManagedRewards(snapshot,owner);assert.equal(stateFor(db).coins,2);
 }finally{db.close();delete globalThis.__managedEconomyTestDatabase;}
});
