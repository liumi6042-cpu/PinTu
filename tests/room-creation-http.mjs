import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {createPuzzle,SAVED_LEVELS} from '../lib/puzzle-engine.ts';
import {createFixturePuzzle} from './legacy-fixtures.mjs';
import {HIGH_PIECES_PAUSED} from '../lib/piece-policy.ts';

const base=process.argv[2]||'http://127.0.0.1:3137';
const local=base.startsWith('http://127.0.0.1:');
const filename=process.argv[3];
if(filename&&(!local||!/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle\.sqlite$/.test(filename)))throw Error('Legacy fixtures require an isolated release database');
const database=filename?new DatabaseSync(resolve(filename)):null;
const headers=local?{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'}:{};
const secret=randomBytes(32).toString('hex');let cookie='';
async function request(path,body,token){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];
 const text=await response.text();return {status:response.status,data:JSON.parse(text),bytes:Buffer.byteLength(text)};
}
const rooms=[],legacyGridChecks=[];
try{
 for(const imageId of ['seaside-native-v2','mountain-lake-reflection-hd-v3'])for(const pieces of [2000,5000]){
  const rejected=await request('/api/rooms',{imageId,pieces,visibility:'public',guestSecret:secret});
  assert.equal(rejected.status,400);assert.equal(rejected.data.error,HIGH_PIECES_PAUSED);
 }
 for(const pieces of [1500,3000,4000])assert.equal((await request('/api/rooms',{imageId:'mountain-lake-reflection-hd-v3',pieces,visibility:'public',guestSecret:secret})).status,400);
 const create=await request('/api/rooms',{imageId:'mountain-lake-reflection-hd-v3',pieces:300,visibility:'public',guestSecret:secret,initialState:'seed-v1'});
 assert.equal(create.status,201);rooms.push(create.data);assert.ok(cookie.startsWith('puzzle_guest='));
 assert.ok(create.bytes<1500);assert.equal(create.data.initialState,'seed-v1');assert.equal(create.data.room.puzzle.groups,undefined);
 const initial=create.data.room.puzzle;
 const full=await request('/api/rooms/'+create.data.room.id,undefined,create.data.token);
 assert.equal(full.status,200);assert.deepEqual(full.data.puzzle,createPuzzle(initial.imageId,initial.cols,initial.rows,initial.seed));
 const firstName=create.data.room.members[0].name;
 // A candidate cannot replace an established cookie identity.
 const legacy=await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility:'public',guestSecret:randomBytes(32).toString('hex')});
 assert.equal(legacy.status,201);rooms.push(legacy.data);assert.equal(legacy.data.room.puzzle.groups.length,108);assert.equal(legacy.data.room.members[0].name,firstName);
 for(const [visibility,status] of [['solo',401],['private',403]])assert.equal((await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility,guestSecret:secret,initialState:'seed-v1'})).status,status);
 assert.equal((await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility:'public',guestSecret:'invalid',initialState:'seed-v1'})).status,400);
 const validCookie=cookie;cookie='puzzle_guest='+randomBytes(32).toString('hex');
 assert.equal((await request('/api/rooms/'+create.data.room.id,undefined,create.data.token)).status,401);cookie=validCookie;
 if(database){
  // Restore an earlier high-count save only in this disposable database. There
  // is deliberately no production request flag that bypasses new-room limits.
  const id=legacy.data.room.id,path='/api/rooms/'+id;
  for(const count of [1500,2000,3000,4000,5000]){
   const level=SAVED_LEVELS.find(level=>level.count===count),row=database.prepare('SELECT revision,data FROM puzzle_rooms WHERE id=?').get(id),room=JSON.parse(row.data),now=Date.now();
   const puzzle=createFixturePuzzle('mountain-lake-reflection-native-v2',level.cols,level.rows,42);
   puzzle.elapsed=123;puzzle.groups[0].locked=true;puzzle.groups[0].dx=0;puzzle.groups[0].dy=0;
   puzzle.groups[1].pieces.push(2);puzzle.groups[1].dx=300;puzzle.groups[1].dy=300;puzzle.groups.splice(2,1);
   room.puzzle=puzzle;room.revision=row.revision+1;room.syncHistory=[];room.startedAt=now-123000;room.completedAt=null;
   room.leases={};delete room.lastOrganizedAt;room.lastPlayedAt=now;room.publicLastSeenAt=now;room.expiresAt=now+86400000;
   for(const member of room.members)member.lastSeen=now;
   database.exec('BEGIN IMMEDIATE');
   try{
    database.prepare('UPDATE puzzle_rooms SET data=?,revision=?,expires_at=? WHERE id=?').run(JSON.stringify(room),room.revision,room.expiresAt,id);
    database.prepare('UPDATE puzzle_room_directory SET image_id=?,piece_count=?,expires_at=?,completed_at=NULL WHERE room_id=?').run(puzzle.imageId,count,room.expiresAt,id);
    database.exec('COMMIT');
   }catch(error){database.exec('ROLLBACK');throw error;}
   const joined=await request(path+'/join',{});assert.equal(joined.status,200);assert.equal(joined.data.room.puzzle.cols*joined.data.room.puzzle.rows,count);
   const currentToken=joined.data.token,restored=await request(path,undefined,currentToken);assert.equal(restored.status,200);
   assert.equal(restored.data.puzzle.imageId,puzzle.imageId);assert.deepEqual(restored.data.puzzle.groups,puzzle.groups);
   const heartbeat=await request(path,{type:'heartbeat'},currentToken);assert.equal(heartbeat.status,200);assert.deepEqual(heartbeat.data.puzzle.groups,puzzle.groups);
   assert.equal((await request(path,{type:'claim',groupId:3},currentToken)).status,200);
   const moved=await request(path,{type:'move',groupId:3,dx:133,dy:192,seq:1},currentToken);assert.equal(moved.status,200);assert.equal(moved.data.puzzle.groups.find(group=>group.id===3).dx,133);
   const delta=await request(path+'?since='+heartbeat.data.revision,undefined,currentToken);assert.equal(delta.status,200);assert.equal(delta.data.kind,'delta');assert.equal(delta.data.groups.length,1);
   const dropped=await request(path,{type:'drop',groupId:3,dx:0,dy:0,seq:2},currentToken);assert.equal(dropped.status,200);assert.ok(dropped.data.puzzle.groups.some(group=>group.locked&&group.pieces.includes(3)));
   const protectedGroups=dropped.data.puzzle.groups.filter(group=>group.locked||group.pieces.length>1);
   const arranged=await request(path,{type:'shuffle'},currentToken);assert.equal(arranged.status,200);
   assert.deepEqual(arranged.data.puzzle.groups.filter(group=>group.locked||group.pieces.length>1),protectedGroups);
   assert.equal(new Set(arranged.data.puzzle.groups.flatMap(group=>group.pieces)).size,count);assert.equal(arranged.data.puzzle.seed,42);assert.ok(arranged.data.puzzle.elapsed>=123);
   legacyGridChecks.push(count);
  }
 }
 console.log(JSON.stringify({compact300Bytes:create.bytes,full300Bytes:full.bytes,positionsMatch:true,legacySnapshotClientCompatible:true,legacyGridChecks,cookieIdentityPreserved:true,privateAndSoloProtected:true,highNewRoomsRejected:true}));
}finally{for(const room of rooms)await request('/api/rooms/'+room.room.id,{type:'leave'},room.token).catch(()=>{});database?.close();}
