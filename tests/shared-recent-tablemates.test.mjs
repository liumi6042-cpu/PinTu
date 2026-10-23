import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile,managedDay,managedGift,TASK_DEFINITIONS} from '../lib/managed-economy-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__sharedClientEnv={PUZZLE_LOCAL_ORIGIN:'http://localhost',PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {recordRecentTablemates} from "./lib/shared-recent-tablemates";export {POST as createRoomRoute} from "./app/api/rooms/route";export {sharedClientApi} from "./lib/shared-client-api";export * from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {applyRoomUpdate} from "./lib/room-sync";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedClientEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='a'.repeat(32),other='b'.repeat(32),token='c'.repeat(64),otherToken='d'.repeat(64),origin='http://localhost';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();
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

const recent=async(f,cookie=token)=>(await f.request('/api/mobile/social/recent',{cookie})).data.players;
async function table(f){
 const created=await f.request('/api/rooms',{method:'POST',body:{imageId:f.photos[1].id,pieces:108,visibility:'public'}});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const path='/api/rooms/'+created.data.room.id;
 const joined=await f.request(path+'/join',{method:'POST',cookie:otherToken});
 assert.equal(joined.status,200,JSON.stringify(joined.data));
 return {path,created:created.data,joined:joined.data};
}

// Migrations are discovered by file name (server/sqlite.mjs); the drizzle journal is not used.
test('fresh migration is additive, indexed and idempotent',()=>{
 const f=fixture();try{
  assert.ok(f.db.sql.prepare('SELECT sha256 FROM app_migrations WHERE name=?').get('0022_shared_recent_tablemates.sql'));
  assert.ok(f.db.sql.prepare("PRAGMA index_list('puzzle_shared_recent_tablemates')").all().some(row=>row.name==='puzzle_shared_recent_tablemates_seen'));
  f.db.sql.exec(readFileSync(new URL('../drizzle/0022_shared_recent_tablemates.sql',import.meta.url),'utf8'));
 }finally{f.close();}
});

test('joining records both directions with Web person shape, outgoing requests and friend/self exclusion',async()=>{
 const f=fixture();try{
  const {created}=await table(f),a=await recent(f),b=await recent(f,otherToken);
  assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(a[0].name,'另一个账号');assert.equal(b[0].name,'原账号');
  assert.equal(a[0].roomTitle,created.room.title);assert.equal(typeof a[0].seenAt,'number');assert.equal(a[0].requested,false);
  const social=(await f.request('/api/mobile/social')).data;
  assert.equal(b[0].code,social.self.code);assert.equal(b[0].level,4);
  assert.equal(b[0].online,false);assert.equal(b[0].lastSeenAt,0);assert.equal(b[0].createdAt,0);
  f.db.sql.prepare('INSERT INTO puzzle_managed_friend_requests VALUES(?,?,?)').run(owner,other,Date.now());
  assert.equal((await recent(f))[0].requested,true);assert.equal((await recent(f,otherToken))[0].requested,false);
  f.db.sql.prepare('INSERT INTO puzzle_shared_recent_tablemates VALUES(?,?,?,?,?)').run(owner,owner,created.room.id,'self',Date.now()+1);
  assert.equal((await recent(f)).length,1);
  f.db.sql.prepare('INSERT INTO puzzle_managed_friends VALUES(?,?,?)').run(owner,other,Date.now());
  assert.deepEqual(await recent(f),[]);
 }finally{f.close();}
});

test('heartbeat records live peers once a minute and ignores departed seats',async()=>{
 const f=fixture();try{
  const {path,created,joined}=await table(f);
  // Remove the join records so this heartbeat must do the recording for the creator.
  f.db.sql.exec('DELETE FROM puzzle_shared_recent_tablemates');
  const beat=()=>f.request(path,{method:'POST',body:{type:'heartbeat'},headers:{Authorization:'Bearer '+created.token}});
  assert.equal((await beat()).status,200);assert.equal((await recent(f)).length,1);
  f.db.sql.exec('CREATE TABLE recent_writes(n INTEGER); CREATE TRIGGER recent_insert AFTER INSERT ON puzzle_shared_recent_tablemates BEGIN INSERT INTO recent_writes VALUES(1); END; CREATE TRIGGER recent_update AFTER UPDATE ON puzzle_shared_recent_tablemates BEGIN INSERT INTO recent_writes VALUES(1); END;');
  assert.equal((await beat()).status,200);assert.equal((await beat()).status,200);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM recent_writes').get().n,0);
  const room=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(created.room.id).data),now=Date.now()+61000;
  for(const member of room.members)member.lastSeen=now;
  await api.recordRecentTablemates(room,room.members.find(m=>m.accountId===owner),now);
  assert.ok(f.db.sql.prepare('SELECT COUNT(*) n FROM recent_writes').get().n>0);
  assert.equal((await f.request(path,{method:'POST',cookie:otherToken,body:{type:'leave'},headers:{Authorization:'Bearer '+joined.token}})).status,200);
  f.db.sql.exec('DELETE FROM puzzle_shared_recent_tablemates');
  room.members.find(m=>m.accountId===other).lastSeen=0;
  await api.recordRecentTablemates(room,room.members.find(m=>m.accountId===owner),now+61000);
  assert.deepEqual(await recent(f),[]);
 }finally{f.close();}
});

test('creating through public table reuse records the admitted player too',async()=>{
 const f=fixture();try{
  const body={imageId:f.photos[1].id,pieces:108,visibility:'public'};
  const a=await f.request('/api/rooms',{method:'POST',body});
  const b=await f.request('/api/rooms',{method:'POST',body,cookie:otherToken});
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(b.data.reused,true);
  assert.equal(a.data.room.id,b.data.room.id);
  assert.equal((await recent(f)).length,1);assert.equal((await recent(f,otherToken)).length,1);
 }finally{f.close();}
});

test('records prune to 50 per owner and return at most 20 newest first',async()=>{
 const f=fixture();try{
  const now=Date.now(),member={id:'seat',accountId:owner,lastSeen:now};
  for(let i=0;i<55;i++){
   const peer=(i+100).toString(16).padStart(32,'0'),at=now+i*61000;
   const room={id:(i+500).toString(16).padStart(32,'0'),title:'table '+i,members:[{...member,lastSeen:at},{id:'peer',accountId:peer,lastSeen:at}]};
   await api.recordRecentTablemates(room,room.members[0],at);
  }
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_shared_recent_tablemates WHERE owner_id=?').get(owner).n,50);
  assert.ok(f.db.sql.prepare('SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM puzzle_shared_recent_tablemates GROUP BY owner_id)').get().n<=50);
  const players=await recent(f);assert.equal(players.length,20);assert.equal(players[0].roomTitle,'table 54');assert.equal(players.at(-1).roomTitle,'table 35');
  assert.ok(players.every((p,i)=>!i||players[i-1].seenAt>=p.seenAt));
 }finally{f.close();}
});

test('guest identity matches shared social, and diagnostic/bot rooms never record',async()=>{
 const f=fixture();try{
  const {path,created}=await table(f),secret='e'.repeat(64),guest='guest:'+hash(secret);
  const joined=await f.request(path+'/join',{method:'POST',headers:{Cookie:'puzzle_guest='+secret}});
  assert.equal(joined.status,200,JSON.stringify(joined.data));
  const players=(await f.request('/api/mobile/social/recent',{headers:{Cookie:'puzzle_guest='+secret}})).data.players;
  assert.equal(players.length,2);
  assert.ok(f.db.sql.prepare('SELECT 1 FROM puzzle_shared_recent_tablemates WHERE owner_id=? AND peer_id=?').get(guest,owner));
  // Guests have no account row: they must appear under the same name the room shows, never a generic fallback.
  const seat=joined.data.room.members.find(m=>m.id===joined.data.playerId),seen=(await f.request('/api/mobile/social/recent')).data.players.find(p=>p.name===seat.name);
  assert.ok(seen,'account sees the guest by its room name');assert.notEqual(seat.name,'拼图朋友');
  const room=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(created.room.id).data);
  f.db.sql.exec('DELETE FROM puzzle_shared_recent_tablemates');
  const member=room.members.find(m=>m.accountId===owner);
  await api.recordRecentTablemates({...room,botRoom:true},member);
  await api.recordRecentTablemates({...room,diagnostic:true},member);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_shared_recent_tablemates').get().n,0);
 }finally{f.close();}
});
