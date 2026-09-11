import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {testDatabase} from './server-fixture-db.mjs';
import {applyRoomUpdate} from '../lib/room-sync.ts';
const base=process.env.PUZZLE_NODE_TEST_URL||'http://localhost:3000';
if(base!=='http://localhost:3000'&&base!=='http://127.0.0.1:3113')throw Error('Test server required');
if(base.includes('3113')&&!process.env.PUZZLE_NODE_TEST_DATABASE?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated database required');
const db=base.includes('3113')?new DatabaseSync(process.env.PUZZLE_NODE_TEST_DATABASE):await testDatabase();
const origin=base.includes('3113')?'https://jigsawnook.online':base,rooms=[],identities=[];
function guest(){const secret=randomBytes(32).toString('hex');identities.push('guest:'+createHash('sha256').update(secret).digest('hex'));return 'puzzle_guest='+secret;}
async function call(path,body,cookie='',token=''){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(base.includes('3113')?{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'198.51.100.68'}:{}),Origin:origin,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
try{
 for(const count of [300,2000]){
  const a=guest(),b=guest(),created=await call('/api/rooms',{visibility:'public',imageId:'seaside',pieces:count},a);
  assert.equal(created.status,201,JSON.stringify(created.data));const owner=created.data,id=owner.room.id,path='/api/rooms/'+id;rooms.push(id);
  // Only this new fixture is prepared with an already-placed piece and a joined pair.
  const fixture=JSON.parse(db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data);
  fixture.puzzle.groups.forEach((g,i)=>{g.dx=2000+i;g.dy=3000+i;});
  Object.assign(fixture.puzzle.groups[0],{locked:true,dx:0,dy:0});fixture.puzzle.groups[1].pieces.push(2);fixture.puzzle.groups.splice(2,1);fixture.revision++;fixture.syncHistory=[];
  db.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(fixture),fixture.revision,id);
  const joined=await call(path+'/join',{},b);assert.equal(joined.status,200,JSON.stringify(joined.data));const peer=joined.data;
  assert.equal((await call(path,{type:'claim',groupId:3},b,peer.token)).status,200);
  const held=await call(path,{type:'move',groupId:3,dx:150,dy:250,seq:1},b,peer.token);assert.equal(held.status,200);const before=held.data;
  assert.equal((await call(path,{type:'shuffle'},a)).status,401,'a cookie without a room ticket cannot arrange');
  const attempts=await Promise.all([call(path+'?since='+before.revision,{type:'shuffle'},a,owner.token),call(path+'?since='+before.revision,{type:'shuffle'},b,peer.token)]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409],'room-wide debounce is atomic across players');
  const update=attempts.find(r=>r.status===200).data,merged=applyRoomUpdate(before,update);
  assert.equal(update.kind,count===300?'delta':undefined);
  for(const groupId of [0,1,3])assert.deepEqual(merged.puzzle.groups.find(g=>g.id===groupId),before.puzzle.groups.find(g=>g.id===groupId));
  assert.deepEqual(merged.leases,before.leases);assert.equal(merged.startedAt,before.startedAt);assert.equal(merged.participantCount,before.participantCount);
  assert.equal(new Set(merged.puzzle.groups.flatMap(g=>g.pieces)).size,count);
  assert.equal(merged.puzzle.groups.filter(g=>g.dx!==before.puzzle.groups.find(old=>old.id===g.id).dx||g.dy!==before.puzzle.groups.find(old=>old.id===g.id).dy).length,count-4);
  const seen=await call(path,undefined,b,peer.token);assert.equal(seen.status,200);assert.deepEqual(seen.data.puzzle.groups,merged.puzzle.groups);
  const dropped=await call(path,{type:'drop',groupId:3,dx:0,dy:0,seq:2},b,peer.token);assert.equal(dropped.status,200);assert.equal(dropped.data.puzzle.groups.find(g=>g.pieces.includes(3)).locked,true);
  assert.equal((await call(path,undefined,a,owner.token)).status,200);
 }
 console.log('Multiplayer arrange HTTP passed at 300/2000 pieces: concurrent requests, live drag protection, groups/placements, delta/full sync, continued drop and authentication.');
}finally{
 for(const room of rooms){for(const table of ['puzzle_personal_hidden_rooms','puzzle_result_players','puzzle_achievement_settled','puzzle_achievement_facts','puzzle_room_cursors','puzzle_results','puzzle_room_directory'])db.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(room);db.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(room);}
 for(const identity of identities){for(const table of ['puzzle_achievement_profiles','puzzle_achievement_awards','puzzle_achievement_days'])db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).run(identity);db.prepare('DELETE FROM puzzle_beta_seats WHERE identity=?').run(identity);}
 db.close();
}
