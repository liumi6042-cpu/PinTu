import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile,managedDay,managedGift,TASK_DEFINITIONS} from '../lib/managed-economy-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__sharedClientEnv={PUZZLE_LOCAL_ORIGIN:'http://localhost',PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {POST as createRoomRoute} from "./app/api/rooms/route";export {sharedClientApi} from "./lib/shared-client-api";export * from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {syncManagedRoom,managedPlayerView} from "./lib/managed-economy";export {applyRoomUpdate} from "./lib/room-sync";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedClientEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='a'.repeat(32),other='b'.repeat(32),token='c'.repeat(64),otherToken='d'.repeat(64),origin='http://localhost';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(filename=':memory:'){
 const db=new SqliteD1(filename,fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();
 globalThis.__sharedClientEnv.PUZZLE_DB=db;
 for(const [id,secret,name] of [[owner,token,'原账号'],[other,otherToken,'另一个账号']]){db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(id,id,name,'kept-password-hash','kept-salt',now);db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(secret),id,now+86400000);}
 const photos=api.RESTORABLE_PHOTOS.slice(0,3).map(p=>({...p,width:1200,height:900}));
 const paid={id:'paid',title:'原已购相册',description:'',showOnPc:true,showOnMobile:true,purchasable:true,price:20,imageIds:[photos[0].id],milestones:[]},free={...paid,id:'free',title:'免费相册',purchasable:false,price:0,imageIds:[photos[1].id]};
 const game=structuredClone(DEFAULT_GAME_SETTINGS),rewards=structuredClone(DEFAULT_TASK_REWARD_SETTINGS);
 rewards.tenGrid.coins=999;rewards.tenGrid.xp=999;
 const snapshot={releaseId:'shared-adapter-test',gameSettings:game,taskRewards:rewards,albums:{albums:[paid,free]},photos,dailyRuntime:{select:()=>photos[1],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT=()=>snapshot;
 const state=newManagedProfile();Object.assign(state,{level:4,xp:7,totalXp:900,coins:100,fragments:40,ownedAlbums:{paid:{imageIds:[photos[0].id,photos[2].id],price:20,at:now-10000}},ownedImages:{[photos[0].id]:true,[photos[2].id]:true},gifts:{'ten:1':{id:'ten:1',source:'ten:1',kind:'ten-grid',title:'旧礼包',coins:13,xp:5,createdAt:now-10000,openedAt:null},'ten:2':{id:'ten:2',source:'ten:2',kind:'ten-grid',title:'另一份礼包',coins:29,xp:11,createdAt:now-5000,openedAt:null}}});
 db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(owner,JSON.stringify(state),now);
 const legacy=JSON.stringify({balance:88,cosmetics:{cursors:['old-owned'],equipped:{cursor:'old-owned'}}});db.sql.prepare('INSERT INTO puzzle_courtyards(user_id,data) VALUES(?,?)').run(owner,legacy);
 const request=async(path,{method='GET',body,cookie=token,headers={}}={})=>{
  const response=await api.sharedClientApi(new Request(origin+'/api/shared'+path,{method,headers:{Cookie:'puzzle_session='+cookie,Origin:origin,...(method!=='GET'?{'Content-Type':'application/json'}:{}),...headers},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})}),path.split('?')[0]);
  return {status:response.status,data:await response.json(),headers:response.headers};
 };
 return {db,request,snapshot,state,photos,legacy,close(){db.close();delete globalThis.__sharedClientEnv.PUZZLE_DB;}};
}
const stored=f=>JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(owner).data);

function seed(f,count,id=owner){
 const state=newManagedProfile();state.contributionTotal=count;state.coins=100;
 f.db.sql.prepare('INSERT OR REPLACE INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(id,JSON.stringify(state),Date.now());
}
const tasks=async(f,options)=>{const r=await f.request('/api/mobile/tasks',options);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const beginners=data=>data.tasks.filter(t=>t.group==='beginner');
const receipts=f=>Object.keys(stored(f).receipts).filter(key=>key.startsWith('task:beginner-'));

for(const [before,after,coins,remaining] of [[9,10,10,[50,100]],[49,50,60,[100]],[99,100,160,[]]]){
 test(`${before}/${after} boundary uses committed single-player snaps, not XP or completed puzzles`,async()=>{
  const f=fixture();try{
   seed(f,before);
   const view=await tasks(f),pending=beginners(view);
   assert.ok(pending.some(t=>t.target===after&&t.progress===before));
   assert.equal(view.profile.collection.coins,100+(before>=50?60:before>=10?10:0));
   const now=Date.now(),previous={id:'1'.repeat(32),revision:0,puzzle:{imageId:f.photos[1].id,cols:12,rows:9},members:[{id:'seat',accountId:owner,lastSeen:now}],achievements:{contributors:{[owner]:{count:0,days:[]}}},createdAt:now,lastPlayedAt:now,completedAt:null};
   const room={...previous,revision:1,achievements:{contributors:{[owner]:{count:1,days:[]}}}};
   await api.syncManagedRoom(room,f.snapshot,previous);
   const balance=stored(f).coins;
   assert.equal(balance,100+coins+f.snapshot.gameSettings.collection.contributionCoins);
   assert.equal(stored(f).contributionTotal,after);
   await Promise.all([api.syncManagedRoom(room,f.snapshot,previous),api.syncManagedRoom(room,f.snapshot,previous)]);
   assert.equal(stored(f).coins,balance);
   const result=await tasks(f);
   assert.deepEqual(beginners(result).map(t=>t.target),remaining);
   assert.equal(result.profile.collection.coins,balance);
   assert.equal(result.tasks.filter(t=>t.group==='cooperation').length,3);
   for(const task of beginners(result))assert.deepEqual(task,{id:'beginner-'+task.target,kind:'beginner-'+task.target,group:'beginner',title:'累计拼合'+task.target+'次',target:task.target,energy:0,xp:0,coins:task.target,progress:after,earned:false});
  }finally{f.close();}
 });
}

test('105 historical snaps settle all 160 once under concurrent views; players remain isolated',async()=>{
 const f=fixture();try{
  seed(f,105);seed(f,9,other);
  const responses=await Promise.all(Array.from({length:6},()=>tasks(f)));
  for(const data of responses){assert.deepEqual(beginners(data),[]);assert.equal(data.profile.collection.coins,260);}
  assert.equal(stored(f).coins,260);assert.equal(receipts(f).length,3);
  assert.deepEqual(receipts(f).sort(),['task:beginner-10','task:beginner-100','task:beginner-50']);
  assert.equal(stored(f).totalXp,0);assert.deepEqual(stored(f).gifts,{});
  const peer=await tasks(f,{cookie:otherToken});assert.equal(peer.profile.collection.coins,100);assert.equal(beginners(peer).length,3);
  assert.equal((await tasks(f)).profile.collection.coins,260);
  const view=await api.managedPlayerView(owner,f.snapshot,origin);assert.equal('beginner' in view.tasks,false);
 }finally{f.close();}
});

test('wallet write failure leaves no receipt or coins and retry pays every tier',async()=>{
 const f=fixture();try{
  seed(f,105);const before=stored(f);
  f.db.sql.exec("CREATE TRIGGER fail_beginner_wallet BEFORE UPDATE ON puzzle_managed_players WHEN json_extract(NEW.data,'$.receipts.\"task:beginner-10\"') IS NOT NULL BEGIN SELECT RAISE(ABORT,'wallet unavailable'); END;");
  const failed=await f.request('/api/mobile/tasks');assert.equal(failed.status,503);
  assert.deepEqual(stored(f),before);assert.deepEqual(receipts(f),[]);
  f.db.sql.exec('DROP TRIGGER fail_beginner_wallet');
  assert.equal((await tasks(f)).profile.collection.coins,260);assert.equal(receipts(f).length,3);
 }finally{f.close();}
});

test('next multiplayer snap backfills history without a task view; unchanged counts and bots add nothing',async()=>{
 const f=fixture();try{
  seed(f,105);seed(f,9,other);
  const now=Date.now(),bot='guest:'+'f'.repeat(64),previous={id:'2'.repeat(32),revision:0,puzzle:{imageId:f.photos[1].id,cols:12,rows:9},members:[{id:'one',accountId:owner,lastSeen:now},{id:'two',accountId:other,lastSeen:now},{id:'bot',guestId:bot,bot:true,lastSeen:now}],achievements:{contributors:{}},createdAt:now,lastPlayedAt:now,completedAt:null};
  const room={...previous,revision:1,achievements:{contributors:{[owner]:{count:1,days:[]},[other]:{count:1,days:[]},[bot]:{count:100,days:[]}}}};
  await Promise.all([api.syncManagedRoom(room,f.snapshot,previous),api.syncManagedRoom(room,f.snapshot,previous)]);
  assert.equal(stored(f).coins,260+f.snapshot.gameSettings.collection.contributionCoins);
  assert.equal(receipts(f).length,3);assert.equal(stored(f).contributionTotal,106);
  const peer=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(other).data);
  assert.equal(peer.contributionTotal,10);assert.equal(peer.coins,110+f.snapshot.gameSettings.collection.contributionCoins);
  assert.equal(f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(bot),undefined);
  const before=stored(f);await api.syncManagedRoom({...room,revision:2},f.snapshot,room);assert.deepEqual(stored(f),before);
 }finally{f.close();}
});

test('durable receipts survive database reopen and the next Beijing day',async()=>{
 const dir=mkdtempSync(join(root,'work','beginner-test-')),filename=join(dir,'test.sqlite');
 let f;
 try{
  f=fixture(filename);seed(f,105);await tasks(f);f.close();
  const db=new SqliteD1(filename,fileURLToPath(new URL('../drizzle/',import.meta.url)));globalThis.__sharedClientEnv.PUZZLE_DB=db;
  try{
   const realNow=Date.now;Date.now=()=>realNow()+86400000;
   try{const view=await api.managedPlayerView(owner,f.snapshot,origin);assert.equal(view.profile.coins,260);assert.equal('beginner' in view.tasks,false);assert.equal(receipts({db}).length,3);}finally{Date.now=realNow;}
  }finally{db.close();}
 }finally{delete globalThis.__sharedClientEnv.PUZZLE_DB;rmSync(dir,{recursive:true,force:true});}
});

