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
const built=await build({absWorkingDir:root,stdin:{contents:'export {POST as createRoomRoute} from "./app/api/rooms/route";export {sharedClientApi} from "./lib/shared-client-api";export * from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {sharedContributionView} from "./lib/shared-contribution-ranking";export {applyRoomUpdate} from "./lib/room-sync";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedClientEnv;',loader:'js'}));}}]});
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
const stored=f=>JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(owner).data);

const third='e'.repeat(32),thirdToken='f'.repeat(64);
const roomRow=(f,id)=>JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data);
function saveRoom(f,room){f.db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(room),room.revision,room.id);}
async function table(f){
 const now=Date.now();f.db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(third,third,'第三位玩家','hash','salt',now);
 f.db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(thirdToken),third,now+86400000);
 const made=await f.request('/api/rooms',{method:'POST',body:{imageId:f.photos[1].id,pieces:108,visibility:'public'}});assert.equal(made.status,201);
 const id=made.data.room.id,path='/api/rooms/'+id;
 const tickets=[{cookie:token,headers:{Authorization:'Bearer '+made.data.token}}];
 for(const cookie of [otherToken,thirdToken]){const joined=await f.request(path+'/join',{method:'POST',cookie});assert.equal(joined.status,200);assert.ok(joined.data.room.members.every(m=>m.contribution===0));tickets.push({cookie,headers:{Authorization:'Bearer '+joined.data.token}});assert.equal((await f.request('/api/mobile/profile',{cookie})).status,200);}
 assert.equal(made.data.room.members[0].contribution,0);
 return {id,path,tickets};
}
async function snap(f,t,player,seq){
 const group=roomRow(f,t.id).puzzle.groups.find(g=>!g.locked);
 const send=body=>f.request(t.path,{method:'POST',...t.tickets[player],body});
 assert.equal((await send({type:'claim',groupId:group.id})).status,200);
 const placed=await send({type:'drop',groupId:group.id,dx:0,dy:0,seq,requestId:seq.toString(16).padStart(32,'0')});
 assert.equal(placed.status,200,JSON.stringify(placed.data));return placed.data;
}

test('three players expose actual snap counts immediately on drops, full and delta polls without changing wallets',async()=>{
 const f=fixture();try{
  const t=await table(f);
  for(const [player,count] of [[0,1],[1,2],[2,3]])for(let n=1;n<=count;n++){const placed=await snap(f,t,player,n);assert.equal(placed.members[player].contribution,n,'drop includes the just committed snap');}
  const room=roomRow(f,t.id),bytes=JSON.stringify(room),wallets=f.db.sql.prepare('SELECT owner,data FROM puzzle_managed_players ORDER BY owner').all();
  const expected=[1,2,3];
  assert.deepEqual((await api.sharedContributionView(room,owner)).ranking.map(r=>[r.name,r.contribution]),[['第三位玩家',3],['另一个账号',2],['原账号',1]]);
  for(const suffix of ['', '?since='+room.revision]){
   const polled=await f.request(t.path+suffix,t.tickets[0]);assert.equal(polled.status,200);
   assert.deepEqual(polled.data.members.map(m=>m.contribution),expected);
   assert.ok(polled.data.members.every(m=>typeof m.code==='string'));
   assert.equal(polled.data.mobileResult,undefined);
  }
  assert.equal(JSON.stringify(roomRow(f,t.id)),bytes,'derived fields never enter stored room JSON');
  assert.deepEqual(f.db.sql.prepare('SELECT owner,data FROM puzzle_managed_players ORDER BY owner').all(),wallets);
  assert.equal(stored(f).coins,100+f.snapshot.gameSettings.collection.contributionCoins);
  assert.equal(stored(f).totalXp,900+f.snapshot.gameSettings.energy.contributionXp);
 }finally{f.close();}
});

test('mobile ranking keeps insertion order on ties, excludes spectators, includes departed contributors and caps at eight',async()=>{
 const f=fixture();try{
  const t=await table(f),room=roomRow(f,t.id);
  const absent='0'.repeat(32),entries=[[other,4],[owner,4],[third,0],[absent,9],...Array.from({length:9},(_,i)=>[(i+1).toString(16).repeat(32),1])];
  room.achievements={version:1,contributors:Object.fromEntries(entries.map(([id,count])=>[id,{count,days:[]}]))};
  room.participants={[absent]:'离开的玩家'};
  const view=await api.sharedContributionView(room,owner);
  const expected=entries.filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
  assert.equal(view.ranking.length,8);assert.deepEqual(view.ranking.map(r=>r.contribution),expected.map(([,n])=>n));
  assert.deepEqual(view.ranking.slice(0,3).map(r=>[r.name,r.mine]),[['离开的玩家',false],['另一个账号',false],['原账号',true]]);
  assert.ok(view.ranking.every(r=>Object.keys(r).sort().join(',')==='code,contribution,mine,name'));
  assert.equal(view.member(room.members[2].id).contribution,0);
  room.achievements=undefined;assert.deepEqual((await api.sharedContributionView(room,owner)).ranking,[]);
 }finally{f.close();}
});

test('completion drop, reconnect, delta poll and spectator results carry mobile ranking and retain settlement totals',async()=>{
 const f=fixture();try{
  const t=await table(f);await snap(f,t,0,1);await snap(f,t,1,1);await snap(f,t,1,2);
  // Leave exactly one loose piece so the next real drop completes the board.
  const room=roomRow(f,t.id),pieces=room.puzzle.groups.flatMap(g=>g.pieces),last=pieces.pop();
  room.puzzle.groups=[{id:0,pieces,dx:0,dy:0,locked:true},{id:999,pieces:[last],dx:20,dy:20,locked:false}];room.revision++;saveRoom(f,room);
  const done=await snap(f,t,0,2);assert.ok(done.completedAt);
  assert.deepEqual(done.members.map(m=>m.contribution),[2,2,0]);
  const codes=new Map(done.members.map(m=>[m.name,m.code]));
  const ranking=[{name:'原账号',code:codes.get('原账号'),contribution:2,mine:true},{name:'另一个账号',code:codes.get('另一个账号'),contribution:2,mine:false}];
  assert.deepEqual(done.mobileResult.ranking,ranking);
  const settings=f.snapshot.gameSettings,completion=stored(f).receipts['completion:'+t.id];
  assert.equal(done.mobileResult.contribution,2);assert.equal(done.mobileResult.energy,0);
  assert.equal(done.mobileResult.coins,Math.ceil(2*settings.collection.completionCoinRatio));
  assert.equal(done.mobileResult.coins,completion.coins);assert.equal(done.mobileResult.fragments,completion.fragments);
  assert.equal(done.mobileResult.xp,2*settings.energy.contributionXp);
  assert.equal(stored(f).coins,100+2*settings.collection.contributionCoins+completion.coins);
  assert.equal(stored(f).totalXp,900+2*settings.energy.contributionXp);
  const wallets=f.db.sql.prepare('SELECT owner,data FROM puzzle_managed_players ORDER BY owner').all();
  for(const suffix of ['', '?since='+done.revision]){
   const poll=await f.request(t.path+suffix,t.tickets[0]);assert.equal(poll.status,200);assert.deepEqual(poll.data.mobileResult,done.mobileResult);
  }
  const joined=await f.request(t.path+'/join',{method:'POST'});assert.equal(joined.status,200);assert.deepEqual(joined.data.room.mobileResult,done.mobileResult);
  const spectator=await f.request(t.path,t.tickets[2]);assert.equal(spectator.status,200);
  assert.deepEqual(spectator.data.mobileResult.ranking,ranking.map(r=>({...r,mine:false})));
  assert.equal(spectator.data.mobileResult.contribution,0);assert.equal(spectator.data.mobileResult.coins,0);assert.equal(spectator.data.mobileResult.xp,0);
  assert.deepEqual(f.db.sql.prepare('SELECT owner,data FROM puzzle_managed_players ORDER BY owner').all(),wallets,'reading rankings cannot settle rewards twice');
 }finally{f.close();}
});

