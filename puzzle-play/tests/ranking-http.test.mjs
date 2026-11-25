import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes } from 'node:crypto';
import { testDatabase,cleanupFixtureRooms } from './server-fixture-db.mjs';
import { makeRoom,addMember } from '../lib/room-engine.ts';
import { beijingWeek } from '../lib/ranking-policy.ts';
const base='http://localhost:3000',hash=value=>createHash('sha256').update(value).digest('hex'),id=()=>randomBytes(16).toString('hex');
async function call(path,{cookie,token,body}={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
test('weekly and personal rankings use verified identities, preserve scores outside top 50, and confirm real final drops',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
 const db=await testDatabase(),ids=[],secret=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex'),owner='guest:'+hash(secret),outsider='guest:'+hash(other),cookie='puzzle_guest='+secret,otherCookie='puzzle_guest='+other,now=Date.now(),week=beijingWeek(now),accountId=id(),session=randomBytes(32).toString('hex');
 const score=(elapsed,when,who,pieces=2000,visibility)=>{const roomId=id();ids.push(roomId);db.prepare('INSERT INTO puzzle_results VALUES (?,?,?,?,?,?,?,?)').run(roomId,'solo','seaside',pieces,1,elapsed,when,JSON.stringify(['同名玩家']));if(who)db.prepare('INSERT INTO puzzle_result_players VALUES (?,?)').run(roomId,who);if(visibility)db.prepare('INSERT INTO puzzle_room_directory VALUES (?,?,?,?,?,?,?,?,NULL,NULL)').run(roomId,visibility,owner,'测试','seaside',pieces,when,now+86400000);return roomId;};
 try{
  score(1000,week.start-1,owner);const weekly=score(2000,now-1000,owner,2000,'private');score(10,now-2000,undefined);score(5,week.end,outsider);for(let i=0;i<55;i++)score(100+i,now-3000,outsider);
  const query='/api/leaderboard?mode=solo&imageId=seaside&pieces=2000';
  const all=await call(query+'&period=all',{cookie}),current=await call(query+'&period=week',{cookie});assert.equal(all.status,200);assert.equal(all.data.myBest.elapsedMs,1000);assert.equal(current.data.myBest.elapsedMs,2000);assert.ok(current.data.myBest.rank>50);assert.equal(current.data.entries.length,50);assert.ok(!current.data.entries.some(row=>row.elapsedMs===5));assert.equal(current.data.myBest.roomId,'result:'+hash(weekly));
  const anonymous=await call(query+'&period=week');assert.equal(anonymous.data.myBest,null);assert.ok(anonymous.data.entries.every(row=>row.mine===false));assert.ok(!JSON.stringify(current.data).includes(owner));assert.ok(!JSON.stringify(current.data).includes(secret));
  const different=await call(query+'&period=week',{cookie:otherCookie});assert.equal(different.data.myBest.elapsedMs,100);assert.equal((await call(query+'&period=invalid')).status,400);
  // Complete one real final piece through the production API; only setup is pre-seeded.
  score(100000,now-86400000,owner,108);
  const room=makeRoom(id(),'seaside-native-v2',108,now);ids.push(room.id);room.visibility='solo';room.ownerId=owner;room.startedAt=now-10000;room.participants={};const token=id();addMember(room,id(),'同名玩家',hash(token),now,undefined,owner);
  room.puzzle.groups=[{id:0,pieces:Array.from({length:107},(_,i)=>i),dx:0,dy:0,locked:true},{id:107,pieces:[107],dx:200,dy:200,locked:false}];
  db.prepare('INSERT INTO puzzle_rooms VALUES (?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);db.prepare('INSERT INTO puzzle_room_directory VALUES (?,?,?,?,?,?,?,?,NULL,NULL)').run(room.id,'solo',owner,'测试','seaside',108,now,room.expiresAt);
  const path='/api/rooms/'+room.id;assert.equal((await call(path,{cookie,token,body:{type:'claim',groupId:107}})).status,200);assert.equal((await call(path,{cookie,token,body:{type:'drop',groupId:107,dx:0,dy:0,seq:1}})).status,200);
  const record=await call(path+'/record',{cookie,token});assert.equal(record.status,200);assert.equal(record.data.kind,'improved');assert.ok(record.data.improvedMs>0);assert.equal((await call(path+'/record',{cookie:otherCookie,token})).status,401);
  assert.deepEqual((await call(path+'/record',{cookie,token})).data,record.data);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM puzzle_result_players WHERE room_id=?').get(room.id).n,1);
  db.prepare('INSERT INTO puzzle_users VALUES (?,?,?,?,?,?)').run(accountId,'rank_'+accountId.slice(0,12),'同名玩家','unused-fixture-hash','unused-fixture-salt',now);db.prepare('INSERT INTO puzzle_sessions VALUES (?,?,?)').run(hash(session),accountId,now+3600000);score(50000,now-86400000,accountId,108);
  const combined=await call(path+'/record',{cookie:cookie+'; puzzle_session='+session,token});assert.equal(combined.status,200);assert.equal(combined.data.previousMs,50000,'completion and leaderboard combine the same verified guest and account identities');
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT room_id FROM puzzle_result_players WHERE owner_id=?').all(owner);assert.ok(plan.some(row=>row.detail.includes('puzzle_result_players_owner_idx')));
  console.log(JSON.stringify({weeklyBoundary:true,identityIsolation:true,personalRankOutsideTop50:current.data.myBest.rank,realCompletionRecord:record.data.kind}));
 }finally{cleanupFixtureRooms(db,ids,[owner,outsider,accountId]);db.prepare('DELETE FROM puzzle_sessions WHERE user_id=?').run(accountId);db.prepare('DELETE FROM puzzle_users WHERE id=?').run(accountId);db.close();}
});
