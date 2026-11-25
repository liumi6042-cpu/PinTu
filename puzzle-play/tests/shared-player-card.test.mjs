import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile} from '../lib/managed-economy-model.mjs';

import {playerName} from '../lib/player-name.ts';
import {isRetiredDecoration} from '../lib/decoration-policy.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__sharedClientEnv={PUZZLE_LOCAL_ORIGIN:'http://localhost',PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {sharedClientApi} from "./lib/shared-client-api";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedClientEnv;',loader:'js'}));}}]});
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


const code='abcdef123456',selfCode='aaaaaaaaaaaa',roomId='1'.repeat(32);
function seed(f){
 const now=Date.now(),state=newManagedProfile();
 const decoration=f.snapshot.gameSettings.decorations.find(d=>d.kind==='cursor'&&!isRetiredDecoration(d.id));
 assert.ok(decoration);
 Object.assign(state,{level:8,artworks:{[f.photos[0].id]:[108,300],[f.photos[1].id]:[108]},ownedAlbums:{paid:{at:now}},decorations:[decoration.id],equipped:decoration.id});
 f.db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(other,JSON.stringify(state),now);
 for(const [id,c] of [[owner,selfCode],[other,code]])f.db.sql.prepare('INSERT INTO puzzle_managed_invitation_codes(owner,code) VALUES(?,?)').run(id,c);
 const base=f.snapshot.albums.albums[0];
 f.snapshot.albums.albums.push({...base,id:'hidden',showOnPc:false}, {...base,id:'empty',imageIds:[]}, {...base,id:'partial',imageIds:[f.photos[0].id,f.photos[2].id]});
 const room={id:roomId,members:[{id:'seat',accountId:owner}],achievements:{version:1,contributors:{[other]:{count:17}}},completedAt:now};
 f.db.sql.prepare('INSERT INTO puzzle_rooms(id,revision,data,expires_at) VALUES(?,?,?,?)').run(roomId,0,JSON.stringify(room),now+3600000);
 return {decoration,room,state};
}
const card=(f,c=code,suffix='',options={})=>f.request('/api/mobile/players/'+c+'/card'+suffix,options);
function databaseSnapshot(f){
 const tables=f.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
 return {changes:f.db.sql.prepare('SELECT total_changes() n').get().n,tables:tables.map(({name})=>({name,rows:f.db.sql.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()}))};
}

test('card returns collected-image stats, visible completed albums, equipped decoration and all relationships without writes',async()=>{
 const f=fixture();try{
  const {decoration}=seed(f),before=databaseSnapshot(f);
  const response=await card(f,code.toUpperCase(),'?room='+roomId);
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.deepEqual(response.data,{player:{code,name:'另一个账号',level:8,decoration:{id:decoration.id,artKey:decoration.artKey,color:decoration.color}},stats:{completedPuzzles:2,ownedPacks:1,completedAlbums:2,roomContribution:17},relationship:'none'});
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal((await card(f,selfCode)).data.relationship,'self');
  assert.deepEqual(databaseSnapshot(f),before);
  for(const [relationship,table,from,to] of [['outgoing','puzzle_managed_friend_requests',owner,other],['incoming','puzzle_managed_friend_requests',other,owner],['friend','puzzle_managed_friends',owner,other]]){
   f.db.sql.prepare('INSERT INTO '+table+' VALUES(?,?,?)').run(from,to,Date.now());
   const saved=databaseSnapshot(f);
   assert.equal((await card(f)).data.relationship,relationship);
   assert.deepEqual(databaseSnapshot(f),saved);
  }
 }finally{f.close();}
});

test('guest and code-only players use public names and defaults without allocating profiles',async()=>{
 const f=fixture();try{
  seed(f);
  const secret='9'.repeat(64),guest='guest:'+hash(secret),guestCode='999999999999';
  f.db.sql.prepare('INSERT INTO puzzle_managed_invitation_codes(owner,code) VALUES(?,?)').run(guest,guestCode);
  const before=databaseSnapshot(f),response=await card(f,guestCode);
  assert.equal(response.status,200);
  assert.deepEqual(response.data,{player:{code:guestCode,name:playerName(null,guest),level:0,decoration:null},stats:{completedPuzzles:0,ownedPacks:0,completedAlbums:0,roomContribution:0},relationship:'none'});
  assert.equal((await card(f,guestCode,'',{headers:{Cookie:'puzzle_guest='+secret}})).data.relationship,'self');
  const anonymous=await card(f,guestCode,'',{headers:{Cookie:''}});
  assert.equal(anonymous.status,200);assert.match(anonymous.headers.get('set-cookie'),/puzzle_guest=/);
  assert.deepEqual(databaseSnapshot(f),before);
 }finally{f.close();}
});

test('room contribution is private to current member identities, including guests',async()=>{
 const f=fixture();try{
  const {room}=seed(f),before=databaseSnapshot(f);
  for(const suffix of ['', '?room=bad','?room='+'2'.repeat(32)])assert.equal((await card(f,code,suffix)).data.stats.roomContribution,0);
  assert.equal((await card(f,code,'?room='+roomId,{cookie:otherToken})).data.stats.roomContribution,0);
  assert.deepEqual(databaseSnapshot(f),before);
  const secret='8'.repeat(64),guest='guest:'+hash(secret);
  room.members=[{id:'guest-seat',guestId:guest}];
  f.db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(room),roomId);
  const saved=databaseSnapshot(f);
  assert.equal((await card(f,code,'?room='+roomId,{headers:{Cookie:'puzzle_guest='+secret}})).data.stats.roomContribution,17);
  assert.equal((await card(f,code,'?room='+roomId)).data.stats.roomContribution,0);
  assert.deepEqual(databaseSnapshot(f),saved);
 }finally{f.close();}
});

test('invalid/unknown codes and wrong methods are read-only errors',async()=>{
 const f=fixture();try{
  seed(f);const before=databaseSnapshot(f);
  for(const c of ['short','zzzzzzzzzzzz','abc%20def',''])assert.equal((await card(f,c)).status,400);
  assert.equal((await card(f,'000000000000')).status,404);
  assert.equal((await card(f,code,'',{method:'POST'})).status,405);
  assert.deepEqual(databaseSnapshot(f),before);
 }finally{f.close();}
});

test('120-per-minute card budget rejects excess reads without persistent counters',async()=>{
 const f=fixture();try{
  seed(f);const secret='7'.repeat(64),options={headers:{Cookie:'puzzle_guest='+secret}},before=databaseSnapshot(f);
  for(let i=0;i<120;i++)assert.equal((await card(f,code,'',options)).status,200);
  assert.equal((await card(f,code,'',options)).status,429);
  assert.deepEqual(databaseSnapshot(f),before);
 }finally{f.close();}
});
