import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://localhost',owner='a'.repeat(32),peer='b'.repeat(32),token='c'.repeat(64),peerToken='d'.repeat(64),pieces=[12,16,20,24,30,35];
globalThis.__sharedLevelRoomsEnv={PUZZLE_LOCAL_ORIGIN:origin,PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {sharedClientApi} from "./lib/shared-client-api";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {levelProgress,recordLevelClear} from "./lib/shared-levels";export {ownedRoomCount,insertMemberRoom} from "./lib/membership-store";export {mutateRoom,readRoom} from "./lib/room-store";export {newPlayableRoom} from "./lib/lobby-store";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedLevelRoomsEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(t){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();globalThis.__sharedLevelRoomsEnv.PUZZLE_DB=db;
 for(const [id,secret] of [[owner,token],[peer,peerToken]]){db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(id,id,id===owner?'关卡房主':'帮忙玩家','hash','salt',now);db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(createHash('sha256').update(secret).digest('hex'),id,now+86400000);}
 const photos=api.RESTORABLE_PHOTOS.slice(0,6).map(p=>({...p,width:1200,height:900})),album={id:'album-4a197d4e',title:'付费图集',description:'',showOnPc:true,showOnMobile:true,purchasable:true,price:100,imageIds:photos.map(p=>p.id),coverImageId:null,milestones:[]};
 const content={releaseId:'shared-level-rooms-test',gameSettings:structuredClone(DEFAULT_GAME_SETTINGS),taskRewards:structuredClone(DEFAULT_TASK_REWARD_SETTINGS),photos,albums:{albums:[album]},dailyRuntime:{select:()=>photos[0],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__sharedLevelRoomsEnv.PUZZLE_CONTENT_SNAPSHOT=()=>content;
 t.after(()=>{db.close();delete globalThis.__sharedLevelRoomsEnv.PUZZLE_DB;delete globalThis.__sharedLevelRoomsEnv.PUZZLE_CONTENT_SNAPSHOT;});
 const request=async(path,{method='GET',body={},cookie='puzzle_session='+token,ticket}={})=>{
  const response=await api.sharedClientApi(new Request(origin+'/api/shared'+path,{method,headers:{Cookie:cookie,Origin:origin,...(method==='GET'?{}:{'Content-Type':'application/json'}),...(ticket?{Authorization:'Bearer '+ticket}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})}),path.split('?')[0]);
  return {status:response.status,data:await response.json(),headers:response.headers};
 };
 const create=(levelId='ch1-1',options={})=>request('/api/rooms',{method:'POST',body:{mode:'level',levelId},...options});
 const room=id=>JSON.parse(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data);
 const save=value=>{value.revision++;db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=?,expires_at=? WHERE id=?').run(JSON.stringify(value),value.revision,value.expiresAt,value.id);};
 const clear=(levelId)=>api.recordLevelClear(owner,levelId,'earlier-room',now);
 return {db,photos,album,content,request,create,room,save,clear};
}
async function finish(f,ticket,cookie='puzzle_session='+token){
 const room=f.room(ticket.room.id),ids=room.puzzle.groups.flatMap(group=>group.pieces),last=ids.pop();
 room.puzzle.groups=[{id:0,pieces:ids,dx:0,dy:0,locked:true},{id:999,pieces:[last],dx:30,dy:30,locked:false}];f.save(room);
 const path='/api/rooms/'+room.id,options={method:'POST',ticket:ticket.token,cookie};
 const claim=await f.request(path,{...options,body:{type:'claim',groupId:999}});assert.equal(claim.status,200,JSON.stringify(claim.data));
 const dropped=await f.request(path,{...options,body:{type:'drop',groupId:999,dx:0,dy:0,seq:1}});assert.equal(dropped.status,200,JSON.stringify(dropped.data));assert.ok(dropped.data.completedAt);return dropped.data;
}

test('level creation validates missing, locked and unavailable levels before ordinary piece options',async t=>{
 const f=fixture(t);
 for(const levelId of ['missing',null,{},''])assert.equal((await f.create(levelId)).status,404);
 const locked=await f.create('ch1-2');assert.equal(locked.status,403);assert.deepEqual(locked.data,{error:'先拼完上一格才能解锁这一格',code:'LEVEL_LOCKED'});
 f.album.imageIds.pop();assert.equal((await f.create()).status,409);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,0);
});

test('unlocked levels create private small fitted tables without buying the album or using membership slots',async t=>{
 const f=fixture(t),profile=(await f.request('/api/mobile/profile')).data;
 assert.deepEqual(profile.collection.ownedPackIds,[]);
 for(let n=1;n<=6;n++){
  if(n>1)await f.clear('ch1-'+(n-1));
  const created=await f.create('ch1-'+n,{body:{mode:'level',levelId:'ch1-'+n,pieces:500,visibility:'public',imageId:'ignored',title:'ignored'}});assert.equal(created.status,201,JSON.stringify(created.data));
  const {room}=created.data,stored=f.room(room.id);assert.equal(room.levelId,'ch1-'+n);assert.equal(room.visibility,'private');assert.equal(room.title,f.photos[n-1].title);assert.equal(stored.ownerId,owner);assert.equal(room.photo.id,f.photos[n-1].id);assert.equal(room.members[0].contribution,0);
  assert.equal(room.puzzle.scatterVersion,3);assert.ok(Math.abs(room.puzzle.cols*room.puzzle.rows-pieces[n-1])<=pieces[n-1]*.15);assert.equal(room.puzzle.imageId,f.photos[n-1].id);
  assert.equal(await api.ownedRoomCount(owner),0);
 }
 assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,6);
 assert.equal((await f.request('/api/lobby')).data.rooms.length,0);
 const after=(await f.request('/api/mobile/profile')).data;assert.deepEqual(after.collection.ownedPackIds,[]);assert.equal(after.collection.coins,profile.collection.coins);assert.equal(after.totalXp,profile.totalXp);
});

test('level tables do not consume any of the three ordinary private-room quota slots',async t=>{
 const f=fixture(t);for(let n=1;n<=4;n++){if(n>1)await f.clear('ch1-'+(n-1));assert.equal((await f.create('ch1-'+n)).status,201);}
 const now=Date.now();f.db.sql.prepare('INSERT INTO puzzle_memberships(user_id,plan,status,starts_at,expires_at,cancel_at_period_end) VALUES(?,?,?,?,?,0)').run(owner,'puzzle','active',now-1000,now+86400000);
 for(let n=1;n<=3;n++){await api.insertMemberRoom(api.newPlayableRoom(n.toString().repeat(32),f.photos[0].id,108,'private',owner),owner);assert.equal(await api.ownedRoomCount(owner),n);}
 await assert.rejects(api.insertMemberRoom(api.newPlayableRoom('4'.repeat(32),f.photos[0].id,108,'private',owner),owner),/3 个/);
 const ordinary=await f.request('/api/rooms',{method:'POST',body:{imageId:f.photos[4].id,pieces:108,visibility:'public'}});assert.equal(ordinary.status,403,'ordinary album locks remain active');
});

test('reentering an unfinished level rotates the ticket and preserves members, contributions and photo',async t=>{
 const f=fixture(t),first=await f.create();assert.equal(first.status,201);
 const room=f.room(first.data.room.id);room.acceptingNew=false;room.achievements={version:1,contributors:{[owner]:{count:3,days:[]}}};f.save(room);
 const again=await f.create();assert.equal(again.status,200,JSON.stringify(again.data));assert.equal(again.data.room.id,first.data.room.id);assert.notEqual(again.data.token,first.data.token);assert.equal(again.data.playerId,first.data.playerId);
 assert.equal(again.data.room.photo.id,room.puzzle.imageId);assert.equal(again.data.room.members[0].contribution,3);assert.equal(again.data.room.levelId,'ch1-1');assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,1);
 assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_shared_room_history WHERE owner_id=? AND room_id=?').get(owner,room.id).n,1);
});

test('concurrent creates reuse one level room while another owner receives a separate room',async t=>{
 const f=fixture(t),created=await Promise.all([f.create(),f.create()]);assert.ok(created.every(r=>[200,201].includes(r.status)));assert.equal(created[0].data.room.id,created[1].data.room.id);
 const other=await f.create('ch1-1',{cookie:'puzzle_session='+peerToken});assert.equal(other.status,201);assert.notEqual(other.data.room.id,created[0].data.room.id);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,2);
});

test('guest level creation preserves its first cookie identity and supports reuse',async t=>{
 const f=fixture(t),first=await f.create('ch1-1',{cookie:''});assert.equal(first.status,201,JSON.stringify(first.data));const cookie=first.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^puzzle_guest=/);
 const id='guest:'+createHash('sha256').update(cookie.split('=')[1]).digest('hex');assert.equal(f.room(first.data.room.id).ownerId,id);
 const reused=await f.create('ch1-1',{cookie});assert.equal(reused.status,200);assert.equal(reused.data.room.id,first.data.room.id);
 await finish(f,reused.data,cookie);assert.equal((await api.levelProgress(id)).length,1);assert.deepEqual(await api.levelProgress(owner),[]);
});

test('closed and expired level rooms are not reused',async t=>{
 const f=fixture(t),first=await f.create(),id=first.data.room.id;
 f.db.sql.prepare('INSERT INTO puzzle_room_moderation(room_id,closed) VALUES(?,1)').run(id);
 const second=await f.create();assert.equal(second.status,201);assert.notEqual(second.data.room.id,id);
 const expired=f.room(second.data.room.id);expired.expiresAt=Date.now()-1;f.save(expired);
 const third=await f.create();assert.equal(third.status,201);assert.notEqual(third.data.room.id,expired.id);
});

test('first completion records only the owner, excludes leaderboards and returns levelClear on drop, GET, delta and join',async t=>{
 const f=fixture(t),created=await f.create(),ticket=created.data,path='/api/rooms/'+ticket.room.id;
 const joined=await f.request(path+'/join',{method:'POST',cookie:'puzzle_session='+peerToken});assert.equal(joined.status,200);assert.equal(joined.data.room.levelId,'ch1-1');assert.ok(joined.data.room.photo);
 const done=await finish(f,ticket),expected={levelId:'ch1-1',energy:0,firstClear:true,nextLevelId:'ch1-2',chapterComplete:false};assert.deepEqual(done.mobileResult.levelClear,expected);
 const progress=await api.levelProgress(owner);assert.deepEqual(progress,[{level_id:'ch1-1',room_id:ticket.room.id,cleared_at:done.completedAt,energy:0}]);assert.deepEqual(await api.levelProgress(peer),[]);
 for(const suffix of ['', '?since='+done.revision]){const poll=await f.request(path+suffix,{ticket:ticket.token});assert.equal(poll.status,200);assert.equal(poll.data.levelId,'ch1-1');assert.deepEqual(poll.data.mobileResult.levelClear,expected);}
 const ownerJoin=await f.request(path+'/join',{method:'POST'});assert.deepEqual(ownerJoin.data.room.mobileResult.levelClear,expected);
 const helper=await f.request(path,{ticket:joined.data.token,cookie:'puzzle_session='+peerToken});assert.equal(helper.status,200);assert.equal(helper.data.levelId,'ch1-1');assert.equal(helper.data.mobileResult.levelClear,undefined);
 const helperJoin=await f.request(path+'/join',{method:'POST',cookie:'puzzle_session='+peerToken});assert.equal(helperJoin.data.room.mobileResult.levelClear,undefined);
 assert.deepEqual(await api.levelProgress(owner),progress);for(const table of ['puzzle_results','puzzle_result_players'])assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});

test('a helper can finish a level but only the owner unlocks the next level',async t=>{
 const f=fixture(t),created=await f.create(),joined=await f.request('/api/rooms/'+created.data.room.id+'/join',{method:'POST',cookie:'puzzle_session='+peerToken});
 const done=await finish(f,joined.data,'puzzle_session='+peerToken);assert.equal(done.mobileResult.levelClear,undefined);assert.equal((await api.levelProgress(owner)).length,1);assert.deepEqual(await api.levelProgress(peer),[]);
 const mine=await f.request('/api/rooms/'+created.data.room.id,{ticket:created.data.token});assert.equal(mine.data.mobileResult.levelClear.firstClear,true);
 assert.equal((await f.create('ch1-2')).status,201);assert.equal((await f.create('ch1-2',{cookie:'puzzle_session='+peerToken})).status,403);
});

test('replaying a completed level retains the first receipt and the sixth clear ends the chapter',async t=>{
 const f=fixture(t),first=await f.create();await finish(f,first.data);const progress=await api.levelProgress(owner);
 const replay=await f.create();assert.equal(replay.status,201);assert.notEqual(replay.data.room.id,first.data.room.id);const done=await finish(f,replay.data);assert.equal(done.mobileResult.levelClear.firstClear,false);assert.deepEqual(await api.levelProgress(owner),progress);
 for(let n=2;n<=5;n++)await f.clear('ch1-'+n);
 const last=await f.create('ch1-6'),end=await finish(f,last.data);assert.deepEqual(end.mobileResult.levelClear,{levelId:'ch1-6',energy:0,firstClear:true,nextLevelId:null,chapterComplete:true});
});

test('content-only level artwork is playable and undersized artwork returns a helpful conflict',async t=>{
 const f=fixture(t),photo={...f.photos[0],id:'content-only-level',src:'/puzzles/content-only.webp',optimizedSrc:'/puzzles/content-only.webp',thumbSrc:'/puzzles/content-only-thumb.webp',width:800,height:600};
 f.content.photos[0]=photo;f.album.imageIds[0]=photo.id;
 const made=await f.create();assert.equal(made.status,201,JSON.stringify(made.data));assert.equal(made.data.room.photo.id,photo.id);assert.equal(made.data.room.puzzle.scatterVersion,3);
 assert.equal((await f.request('/api/rooms/'+made.data.room.id,{ticket:made.data.token})).status,200);
 await finish(f,made.data);photo.width=10;photo.height=10;const bad=await f.create();assert.equal(bad.status,409);assert.match(bad.data.error,/片数/);
});

test('ordinary 108, 300 and 500 piece creation and results keep their existing shape',async t=>{
 const f=fixture(t);f.album.purchasable=false;f.album.price=0;
 for(const [count,mode] of [[108,'selected'],[300,'random'],[500,'daily']]){
  const created=await f.request('/api/rooms',{method:'POST',body:{mode,imageId:f.photos[0].id,pieces:count}});assert.equal(created.status,201,JSON.stringify(created.data));const ticket=created.data;
  assert.equal(Object.hasOwn(ticket.room,'levelId'),false);assert.equal(ticket.room.visibility,'public');assert.equal(ticket.room.puzzle.scatterVersion,3);assert.ok(Math.abs(ticket.room.puzzle.cols*ticket.room.puzzle.rows-count)<=count*.15);assert.ok(ticket.room.photo);assert.equal(ticket.room.members[0].contribution,0);
  const done=await finish(f,ticket);assert.equal(Object.hasOwn(done,'levelId'),false);assert.equal(Object.hasOwn(done.mobileResult,'levelClear'),false);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_results WHERE room_id=?').get(ticket.room.id).n,1);
 }
 assert.deepEqual(await api.levelProgress(owner),[]);
});
