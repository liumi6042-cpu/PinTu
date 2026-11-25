import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile} from '../lib/managed-economy-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__lobbyExtrasEnv={PUZZLE_LOCAL_ORIGIN:'http://localhost',PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {sharedClientApi} from "./lib/shared-client-api";export {sharedLobbyExtras} from "./lib/shared-lobby-extras";export {playerName} from "./lib/player-name";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__lobbyExtrasEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='a'.repeat(32),token='c'.repeat(64),hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=new SqliteD1(':memory:',root+'drizzle'),now=Date.now();
 globalThis.__lobbyExtrasEnv.PUZZLE_DB=db;
 db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(owner,owner,'自选昵称','hash','salt',now);
 db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(token),owner,now+86400000);
 const photos=api.RESTORABLE_PHOTOS.slice(0,2).map(p=>({...p,width:1200,height:900})),game=structuredClone(DEFAULT_GAME_SETTINGS);
 const album={id:'free',title:'免费',description:'',showOnPc:true,showOnMobile:true,purchasable:false,price:0,imageIds:photos.map(p=>p.id),milestones:[]};
 const snapshot={releaseId:'lobby-extras-test',gameSettings:game,taskRewards:structuredClone(DEFAULT_TASK_REWARD_SETTINGS),albums:{albums:[album]},photos,dailyRuntime:{select:()=>photos[0],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__lobbyExtrasEnv.PUZZLE_CONTENT_SNAPSHOT=()=>snapshot;
 const request=async(path,{body,cookie='puzzle_session='+token}={})=>{
  const response=await api.sharedClientApi(new Request('http://localhost/api/shared'+path,{method:body?'POST':'GET',headers:{Origin:'http://localhost',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),path.split('?')[0]);
  return {status:response.status,data:await response.json()};
 };
 const state=(id,extra)=>db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(id,JSON.stringify({...newManagedProfile(),...extra}),now);
 const result=(id,at,owners,imageId=photos[0].id)=>{
  db.sql.prepare('INSERT INTO puzzle_results VALUES(?,?,?,?,?,?,?,?)').run(id,'team',imageId,108,owners.length,1000,at,JSON.stringify(owners));
  for(const player of owners)db.sql.prepare('INSERT INTO puzzle_result_players VALUES(?,?)').run(id,player);
 };
 return {db,now,photos,game,request,state,result,close(){db.close();delete globalThis.__lobbyExtrasEnv.PUZZLE_DB;}};
}

test('shared lobby adds counters and four online seated members in seat order with managed level/cursor only',async()=>{
 const f=fixture();try{
  const made=await f.request('/api/rooms',{body:{imageId:f.photos[0].id,mode:'daily',pieces:108,visibility:'public'}});
  assert.equal(made.status,201,JSON.stringify(made.data));
  const id=made.data.room.id,room=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data),now=Date.now();
  const ids=Array.from({length:7},(_,i)=>(i+1).toString(16).repeat(32));
  const decoration=f.game.decorations.find(d=>d.kind==='cursor'&&d.enabled!==false);
  f.state(ids[0],{level:7,decorations:[decoration.id],equipped:decoration.id});
  room.members=ids.map((accountId,i)=>({id:'seat'+i,accountId,name:'玩家'+i,digest:'private-ticket',lastSeen:now-(i===1?30000:i===6?90001:0),joinedAt:now,color:'#fff'}));
  f.db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(room),id);
  // Same identity in a second open room must count once; completed/closed rooms and bots do not count.
  const insert=(n,members,extra={})=>{const other={...room,id:String(n).repeat(32),members,...extra};f.db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(other.id,0,JSON.stringify(other),other.expiresAt);return other.id;};
  insert(2,[room.members[0]]);
  insert(3,[{...room.members[0],accountId:owner}],{completedAt:now});
  const closed=insert(4,[{...room.members[0],accountId:owner}]);f.db.sql.prepare('INSERT INTO puzzle_room_moderation(room_id,closed) VALUES(?,1)').run(closed);
  insert(5,[{...room.members[0],accountId:owner}],{botRoom:true});
  f.result('today',now,[ids[0],ids[2]]);
  const lobby=await f.request('/api/lobby');assert.equal(lobby.status,200,JSON.stringify(lobby.data));
  assert.equal(lobby.data.online,6);assert.equal(lobby.data.dailyFinished,2);assert.ok(lobby.data.stats);assert.equal(typeof lobby.data.serverTime,'number');
  const seats=lobby.data.rooms.find(r=>r.id===id).members;
  assert.deepEqual(seats,[{name:'玩家0',level:7,decoration:{id:decoration.id,artKey:decoration.artKey,color:decoration.color}},...['玩家2','玩家3','玩家4'].map(name=>({name,level:0,decoration:null}))]);
  assert.ok(!JSON.stringify(seats).includes('private-ticket'));assert.deepEqual(Object.keys(seats[0]).sort(),['decoration','level','name']);
 }finally{f.close();}
});

test('shared lobby filters then sorts joinable tables by players, activity and id before offset pagination',async()=>{
 const f=fixture();try{
  const now=Date.now(),base=(await f.request('/api/rooms',{body:{imageId:f.photos[0].id,pieces:108}})).data.room,ids=[];
  const specs=[[1,0,9000,true],[2,1,8000,true],[3,3,1000,true],[4,8,10000,true],[5,4,10000,false],[6,1,9000,true],[7,1,9000,true]];
  f.db.sql.prepare('DELETE FROM puzzle_room_directory').run();f.db.sql.prepare('DELETE FROM puzzle_rooms').run();
  for(const [n,players,activity,acceptingNew] of specs){
   const id=n.toString().repeat(32),room={...base,id,createdAt:now-20000,acceptingNew,...(n===6?{}:{lastPlayedAt:now-10000+activity}),members:Array.from({length:players},(_,i)=>({id:'seat'+i,guestId:'guest:'+String(i).repeat(64),name:'玩家'+i,lastSeen:now,joinedAt:now,color:'#fff'}))};
   if(n===6)room.createdAt=now-1000;
   f.db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(id,0,JSON.stringify(room),now+86400000);
   f.db.sql.prepare('INSERT INTO puzzle_room_directory(room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'public',owner,'测试桌',f.photos[0].id,108,room.createdAt,now+86400000);ids.push(id);
  }
  const expected=[3,7,6,2,1,4,5].map(n=>String(n).repeat(32)),all=await f.request('/api/lobby');assert.equal(all.status,200);assert.deepEqual(all.data.rooms.map(r=>r.id),expected);
  const paged=[];let cursor='0';do{const page=await f.request('/api/lobby?limit=2&cursor='+cursor);assert.equal(page.status,200);paged.push(...page.data.rooms.map(r=>r.id));cursor=page.data.nextCursor;}while(cursor);assert.deepEqual(paged,expected);assert.equal(new Set(paged).size,ids.length);
  assert.deepEqual((await f.request('/api/lobby?open=1&active=1&limit=2')).data.rooms.map(r=>r.id),expected.slice(0,2));
  assert.deepEqual((await f.request('/api/lobby?pieces=300')).data.rooms,[]);
 }finally{f.close();}
});

test('daily finishers are distinct for the daily image and Beijing day, survive room deletion, and cache at most 30 seconds',async()=>{
 const f=fixture();try{
  const start=Date.parse('2026-10-23T00:00:00+08:00'),now=start+60000;
  f.result('yesterday',start-1,['old']);f.result('today1',start,['a','b']);f.result('today2',now,['b','c']);
  f.result('other-image',now,['wrong'],f.photos[1].id);f.result('tomorrow',start+86400000,['future']);
  assert.equal((await api.sharedLobbyExtras([],now)).dailyFinished,3);
  f.result('new',now+1,['d']);assert.equal((await api.sharedLobbyExtras([],now+29999)).dailyFinished,3);
  assert.equal((await api.sharedLobbyExtras([],now+30000)).dailyFinished,4);
  assert.equal((await api.sharedLobbyExtras([],start+86400000)).dailyFinished,1,'Beijing midnight bypasses cached day');
 }finally{f.close();}
 const fresh=fixture();try{assert.equal((await api.sharedLobbyExtras([],Date.parse('2026-10-23T00:01:00+08:00'))).dailyFinished,0,'database bindings never share cache');}finally{fresh.close();}
});

test('unnamed guests have stable identity names in profiles, creation and joins; chosen account names remain intact',async()=>{
 const f=fixture();try{
  const cookie='puzzle_guest='+'e'.repeat(64),options={cookie};
  const first=await f.request('/api/mobile/profile',options),again=await f.request('/api/mobile/profile',options);
  assert.equal(first.status,200);assert.equal(first.data.name,again.data.name);assert.ok(first.data.name);assert.ok(!/^游客/.test(first.data.name));
  const made=await f.request('/api/rooms',{cookie,body:{mode:'daily',pieces:108,visibility:'public'}});assert.equal(made.status,201,JSON.stringify(made.data));
  assert.equal(made.data.room.members.find(m=>m.id===made.data.playerId).name,first.data.name);
  const joined=await f.request('/api/rooms/'+made.data.room.id+'/join',{cookie,body:{}});assert.equal(joined.status,200);
  assert.equal(joined.data.room.members.find(m=>m.id===joined.data.playerId).name,first.data.name);
  assert.equal((await f.request('/api/mobile/profile')).data.name,'自选昵称');
  f.db.sql.prepare('UPDATE puzzle_users SET name=? WHERE id=?').run('',owner);
  const fallback=await f.request('/api/mobile/profile');assert.equal(fallback.data.name,api.playerName(null,owner));
  assert.equal(api.playerName('自己取的名','guest:'+hash('e'.repeat(64))),'自己取的名');
  assert.equal(api.playerName('游客 ABCD','guest:'+hash('e'.repeat(64))),first.data.name);
 }finally{f.close();}
});
