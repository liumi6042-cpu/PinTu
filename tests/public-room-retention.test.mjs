import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';
import { cleanupPublicRooms } from '../server/public-room-cleanup.mjs';
import { makeRoom,addMember,applyAction,ONLINE_MS } from '../lib/room-engine.ts';
import { PUBLIC_ROOM_IDLE_MS } from '../lib/public-room-retention.ts';

test('cleanup preserves online work and merged groups, expires idle progress after 24h, and keeps private/solo/history',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),now=Date.now(),day=PUBLIC_ROOM_IDLE_MS;
 const seed=(id,{visibility='public',age=1000,online=false,progress=false,merged=false}={})=>{
  const room=makeRoom(id,'seaside',108,now-day*2);room.visibility=visibility;room.publicLastSeenAt=now-age;room.expiresAt=now-age+day;
  if(online)room.members=[{id:'player',name:'QA',lastSeen:now,joinedAt:now,digest:'token',color:'#fff'}];
  if(progress)room.puzzle.groups[0].locked=true;
  if(merged){room.puzzle.groups[0].pieces.push(...room.puzzle.groups[1].pieces);room.puzzle.groups.splice(1,1);}
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(id,0,JSON.stringify(room),room.expiresAt);
  db.sql.prepare('INSERT INTO puzzle_room_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,visibility,null,id,'seaside',108,room.createdAt,room.expiresAt,null,null);
  db.sql.prepare('INSERT INTO puzzle_room_cursors VALUES(?,?,?,?,?,?,?)').run(id,'player','cursor',1,10,20,now);
  return room;
 };
 try{
  seed('untouched');seed('active-zero',{online:true,age:day+1});seed('active-progress',{online:true,progress:true,age:day+1});
  seed('placed',{progress:true,age:day-1});seed('merged-only',{merged:true,age:day-1});seed('expired',{progress:true,age:day});
  seed('private',{visibility:'private',age:day*2});seed('solo',{visibility:'solo',age:day*2});
  seed('reconnected',{age:day*2});
  // A new heartbeat arrives before the cleanup transaction; current state wins.
  db.sql.prepare("UPDATE puzzle_rooms SET data=json_set(data,'$.members',json(?)),revision=revision+1 WHERE id='reconnected'").run(JSON.stringify([{id:'p',lastSeen:now}]));
  db.sql.prepare('INSERT INTO puzzle_results VALUES(?,?,?,?,?,?,?,?)').run('expired','team','seaside',108,2,1000,now,'[]');
  assert.equal(await cleanupPublicRooms(db,now),2);
  const ids=()=>db.sql.prepare('SELECT id FROM puzzle_rooms ORDER BY id').all().map(r=>r.id);
  assert.deepEqual(ids(),['active-progress','active-zero','merged-only','placed','private','reconnected','solo']);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_directory WHERE room_id IN ('untouched','expired')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_cursors WHERE room_id IN ('untouched','expired')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_results WHERE room_id='expired'").get().n,1);
  assert.equal(await cleanupPublicRooms(db,now+1),2,'exact 24-hour boundary expires both placed and merged progress');
 }finally{db.close();}
});

test('public leave records a precise idle start and heartbeat renews it; private heartbeat retains its existing expiry',()=>{
 const now=Date.now(),room=makeRoom('r','seaside',108,now);room.visibility='public';
 const player=addMember(room,'p','QA','token',now,undefined,'guest:qa');
 applyAction(room,player,{type:'heartbeat'},now+10000);
 assert.equal(room.publicLastSeenAt,now+10000);assert.equal(room.expiresAt,now+10000+PUBLIC_ROOM_IDLE_MS);
 applyAction(room,player,{type:'leave'},now+15000);assert.equal(player.lastSeen,0);assert.equal(room.publicLastSeenAt,now+15000);
 const back=addMember(room,'p2','QA','token2',now+ONLINE_MS+20000,undefined,'guest:qa');
 assert.equal(room.publicLastSeenAt,now+ONLINE_MS+20000);assert.equal(back.id,player.id);
 const privateRoom=makeRoom('private','seaside',108,now);privateRoom.visibility='private';const p=addMember(privateRoom,'p','QA','t',now);
 const expiry=privateRoom.expiresAt;applyAction(privateRoom,p,{type:'heartbeat'},now+10000);assert.equal(privateRoom.expiresAt,expiry);
});

test('cleanup rolls back the room deletion if related-row cleanup fails',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),room=makeRoom('rollback','seaside',108,Date.now());room.visibility='public';
 try{
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);
  db.sql.exec("INSERT INTO puzzle_room_directory VALUES('rollback','public',NULL,'QA','seaside',108,0,0,NULL,NULL); INSERT INTO puzzle_room_cursors VALUES('rollback','p','c',1,0,0,0); CREATE TRIGGER fixture_failure BEFORE DELETE ON puzzle_room_cursors BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(cleanupPublicRooms(db));assert.ok(db.sql.prepare("SELECT 1 FROM puzzle_rooms WHERE id='rollback'").get());
 }finally{db.close();}
});
