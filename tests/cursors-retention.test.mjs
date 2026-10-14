import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {SqliteD1} from '../server/sqlite.mjs';
import {cursorInput} from '../lib/room-cursors.ts';

// Exercise the actual route and room CAS/batch with SQLite. Only authentication,
// platform access and unrelated reward delivery are injected into this fixture.
const env=globalThis.__cursorRetentionTest={};
class RoomError extends Error{constructor(message,status=400){super(message);this.status=status;}}
env.RoomError=RoomError;env.cursorInput=cursorInput;
async function compiled(source){return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));}
const roomSource=readFileSync(new URL('../lib/room-store.ts',import.meta.url),'utf8');
const store=await compiled(`
 const env=globalThis.__cursorRetentionTest,RoomError=env.RoomError;
 const db=()=>env.db,readRoom=id=>env.readRoom(id),writes={run:(_id,fn)=>fn()},roomCache={put(){}};
 const roomAchievementDays=()=>({}),recordRoomChange=()=>{},readManagedContent=()=>null;
 const prepareManagedRoomEvent=async(room,_base,_content,now)=>({id:room.id+':'+room.revision,roomId:room.id,revision:room.revision,occurredAt:now,payload:'{}'});
 const drainManagedRewards=async()=>{},saveCompletion=async()=>{},saveAchievementCompletion=async()=>{},saveAchievementActivity=async()=>{},settleGarden=async()=>{};
 const canCreateMemberRoom=()=>true,membershipFor=async()=>null,restartPublicLifetime=()=>{},touchPublicRoom=()=>{},MEMBER_ROOM_LIMIT=3,MEMBERSHIP_REQUIRED='membership';
 ${roomSource.slice(roomSource.indexOf('export async function mutateRoom'),roomSource.indexOf('export async function digestToken'))}
`);
const routeSource=readFileSync(new URL('../app/api/rooms/[id]/cursors/route.ts',import.meta.url),'utf8');
const route=await compiled(`
 const env=globalThis.__cursorRetentionTest,RoomError=env.RoomError,cursorInput=env.cursorInput,ONLINE_MS=22000;
 const localDb=()=>env.db,worldFor=()=>({width:1520,height:1120}),body=request=>request.json(),getDigest=async()=>'';
 const readRoom=id=>env.readRoom(id),json=value=>Response.json(value),failure=error=>Response.json({error:error.message},{status:error.status||503});
 const checkRoomAccount=async(request,room)=>{const member=room.members.find(m=>m.id===request.headers.get('x-test-player'));if(!member)throw new RoomError('missing member',401);await env.afterAuthorize?.();return member;};
 const readManagedContent=()=>null,ownedManagedCursors=async()=>new Map();
 ${routeSource.replace(/^import .*;\r?\n/gm,'')}
`);
const roomId='a'.repeat(32),clientId='b'.repeat(32),otherClientId='c'.repeat(32);
function setup(){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();env.db=db;env.afterAuthorize=null;
 const room={id:roomId,revision:0,visibility:'public',expiresAt:now+86400000,createdAt:now,completedAt:null,leases:{},puzzle:{imageId:'test',cols:2,rows:2,groups:[{id:0,pieces:[0],locked:false}]},members:[{id:'player',name:'玩家',color:'#fff',lastSeen:now},{id:'observer',name:'观察者',color:'#aaa',lastSeen:now}],achievements:{contributors:{}}};
 db.sql.prepare('INSERT INTO puzzle_rooms(id,revision,data,expires_at) VALUES(?,?,?,?)').run(roomId,room.revision,JSON.stringify(room),room.expiresAt);
 env.readRoom=async id=>{const row=db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(id);const value=JSON.parse(row.data);value.revision=row.revision;return value;};
 const write=value=>db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(value),value.revision,roomId);
 const row=()=>db.sql.prepare('SELECT * FROM puzzle_room_cursors WHERE room_id=? AND player_id=?').get(roomId,'player');
 const publish=async(seq,point,client=clientId)=>{const result=await route.POST(new Request('https://example.test/api/rooms/'+roomId+'/cursors',{method:'POST',headers:{'Content-Type':'application/json','x-test-player':'player'},body:JSON.stringify({clientId:client,seq,point})}),{params:Promise.resolve({id:roomId})});assert.equal(result.status,200,await result.clone().text());return result.json();};
 const view=async()=>{const result=await route.GET(new Request('https://example.test/api/rooms/'+roomId+'/cursors',{headers:{'x-test-player':'observer'}}),{params:Promise.resolve({id:roomId})});assert.equal(result.status,200);return result.json();};
 return {db,room,write,row,publish,view,close(){db.close();env.db=null;env.afterAuthorize=null;}};
}

test('legacy pointer-null keeps the point and sequence, and another tab cannot clear or take ownership',async()=>{
 const f=setup();try{
  await f.publish(1,{x:20,y:30});const movement=f.row().updated_at;
  await f.publish(3,null);assert.deepEqual([f.row().x,f.row().y,f.row().seq,f.row().updated_at],[20,30,3,movement]);
  await f.publish(2,{x:90,y:91});assert.equal(f.row().x,20,'a move overtaken by null remains stale');
  await f.publish(99,null,otherClientId);assert.equal(f.row().client_id,clientId);assert.equal(f.row().seq,3);
  await f.publish(4,{x:40,y:50});assert.equal(f.row().x,40);
  await f.publish(1,{x:60,y:70},otherClientId);assert.equal(f.row().client_id,otherClientId,'a real position retains the existing tab handoff behavior');
  await f.publish(100,null);assert.equal(f.row().client_id,otherClientId);assert.equal(f.row().x,60);
 }finally{f.close();}
});

test('an initial null is an empty tombstone, while stationary members remain fresh to old observers',async()=>{
 const f=setup();try{
  await f.publish(5,null);await f.publish(4,{x:90,y:91});assert.equal(f.row().x,null);
  await f.publish(6,{x:20,y:30});const old=Date.now()-180000;
  f.db.sql.prepare('UPDATE puzzle_room_cursors SET updated_at=?').run(old);
  f.room.members[0].lastSeen=old;f.write(f.room);
  const before=JSON.stringify(await env.readRoom(roomId)),view=await f.view(),point=view.cursors.find(c=>c.playerId==='player');
  assert.ok(point);assert.equal(point.updatedAt,view.serverTime,'legacy clients do not fade a retained point');
  assert.equal(f.row().updated_at,old,'presence reads do not pretend the player moved');
  assert.equal(JSON.stringify(await env.readRoom(roomId)),before,'cursor reads do not alter online seats or room state');
 }finally{f.close();}
});

test('actual room leave clears the point atomically, rejects in-flight writes, and does not revive it on rejoin',async()=>{
 const f=setup();try{
  await f.publish(1,{x:20,y:30});await f.publish(3,null);
  await store.mutateRoom(roomId,room=>{room.members[0].lastSeen=0;room.achievements.contributors.player={count:1};});
  assert.deepEqual([f.row().x,f.row().y,f.row().seq],[null,null,3]);assert.deepEqual((await f.view()).cursors,[]);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_reward_events').get().n,1,'cursor cleanup does not break reward CAS changes()');
  await store.mutateRoom(roomId,room=>{room.members[0].lastSeen=Date.now();});assert.deepEqual((await f.view()).cursors,[]);
  await f.publish(2,{x:90,y:91});assert.equal(f.row().x,null,'rejoin does not allow an older same-session move');
  await f.publish(4,{x:40,y:50});
  env.afterAuthorize=async()=>{env.afterAuthorize=null;await store.mutateRoom(roomId,room=>{room.members[0].lastSeen=0;});};
  await f.publish(5,{x:80,y:90});assert.equal(f.row().x,null,'a request authorized before leave must recheck membership when writing');
 }finally{f.close();}
});

test('a failed room CAS cannot clear an active member or enqueue that attempt reward',async()=>{
 const f=setup();try{
  await f.publish(1,{x:20,y:30});const original=f.db.batch.bind(f.db);let batches=0,attempts=0;
  f.db.batch=async commands=>{
   if(!batches++){const concurrent=await env.readRoom(roomId);concurrent.revision++;f.write(concurrent);}
   return original(commands);
  };
  await assert.rejects(store.mutateRoom(roomId,room=>{
   if(++attempts>1)throw new Error('stop after rejected CAS');
   room.members[0].lastSeen=0;room.achievements.contributors.player={count:1};
  }),/stop after rejected CAS/);
  assert.deepEqual([f.row().x,f.row().y],[20,30]);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_reward_events').get().n,0);
  assert.ok((await env.readRoom(roomId)).members[0].lastSeen>0);
 }finally{f.close();}
});
