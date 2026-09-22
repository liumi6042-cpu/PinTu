import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';
import { cleanupPublicRooms } from '../server/public-room-cleanup.mjs';
import { makeRoom,addMember,applyAction,ONLINE_MS } from '../lib/room-engine.ts';
import { PUBLIC_ROOM_LIFETIME_MS } from '../lib/public-room-retention.ts';

test('cleanup keeps rooms inside their one-day window, removes rooms past it, and never touches private work',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),now=Date.now(),day=PUBLIC_ROOM_LIFETIME_MS;
 const seed=(id,{visibility='public',deadline=now+day,online=false,progress=false,merged=false}={})=>{
  const room=makeRoom(id,'seaside-native-v2',108,now-day*2);room.visibility=visibility;room.expiresAt=deadline;
  if(online)room.members=[{id:'player',name:'QA',lastSeen:now,joinedAt:now,digest:'token',color:'#fff'}];
  if(progress)room.puzzle.groups[0].locked=true;
  if(merged){room.puzzle.groups[0].pieces.push(...room.puzzle.groups[1].pieces);room.puzzle.groups.splice(1,1);}
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(id,0,JSON.stringify(room),room.expiresAt);
  db.sql.prepare('INSERT INTO puzzle_room_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,visibility,null,id,'seaside',108,room.createdAt,room.expiresAt,null,null);
  db.sql.prepare('INSERT INTO puzzle_room_cursors VALUES(?,?,?,?,?,?,?)').run(id,'player','cursor',1,10,20,now);
  return room;
 };
 try{
  seed('untouched',{deadline:now+day});
  seed('placed-live',{progress:true,deadline:now+day-1});
  seed('merged-live',{merged:true,deadline:now+day-1});
  seed('played-past',{progress:true,deadline:now-1});
  seed('merged-past',{merged:true,deadline:now-day});
  seed('online-past',{progress:true,online:true,deadline:now-1});
  seed('online-past-empty',{online:true,deadline:now-day});
  seed('private',{visibility:'private',deadline:now-day*2});
  seed('solo',{visibility:'solo',deadline:now-day*2});
  db.sql.prepare('INSERT INTO puzzle_results VALUES(?,?,?,?,?,?,?,?)').run('played-past','team','seaside',108,2,1000,now,'[]');
  assert.equal(await cleanupPublicRooms(db,now),3,'untouched, played-past and merged-past go');
  const ids=()=>db.sql.prepare('SELECT id FROM puzzle_rooms ORDER BY id').all().map(r=>r.id);
  assert.deepEqual(ids(),['merged-live','online-past','online-past-empty','placed-live','private','solo']);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_directory WHERE room_id IN ('untouched','played-past','merged-past')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_cursors WHERE room_id IN ('untouched','played-past','merged-past')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_results WHERE room_id='played-past'").get().n,1,'finished results outlive their table');
  assert.equal(await cleanupPublicRooms(db,now+day),4,'a day later every public table has reached its deadline');
  assert.deepEqual(ids(),['private','solo'],'only the private and solo rooms are left');
 }finally{db.close();}
});

test('the deadline is stamped once and playing again never extends it',()=>{
 const now=Date.now(),room=makeRoom('r','seaside-native-v2',108,now);room.visibility='public';
 const player=addMember(room,'p','QA','token',now,undefined,'guest:qa');
 const deadline=now+PUBLIC_ROOM_LIFETIME_MS;
 assert.equal(room.publicDeadline,deadline);
 assert.equal(room.expiresAt,deadline);
 applyAction(room,player,{type:'heartbeat'},now+10000);
 assert.equal(room.publicLastSeenAt,now+10000,'presence is still tracked');
 assert.equal(room.expiresAt,deadline,'a heartbeat did not push the deadline');
 applyAction(room,player,{type:'leave'},now+15000);assert.equal(player.lastSeen,0);
 const back=addMember(room,'p2','QA','token2',now+ONLINE_MS+20000,undefined,'guest:qa');
 assert.equal(back.id,player.id);
 assert.equal(room.expiresAt,deadline,'coming back did not push the deadline either');
 const privateRoom=makeRoom('private','seaside-native-v2',108,now);privateRoom.visibility='private';const p=addMember(privateRoom,'p','QA','t',now);
 const expiry=privateRoom.expiresAt;applyAction(privateRoom,p,{type:'heartbeat'},now+10000);assert.equal(privateRoom.expiresAt,expiry);
});

test('a room created before the deadline existed keeps the earliest promise it already had',()=>{
 const now=Date.now(),legacy=makeRoom('legacy','seaside-native-v2',108,now-90*60*1000);legacy.visibility='public';
 legacy.publicLastSeenAt=now-60*60*1000;legacy.expiresAt=legacy.publicLastSeenAt+PUBLIC_ROOM_LIFETIME_MS;
 const storedExpiry=legacy.expiresAt;
 addMember(legacy,'p','QA','token',now,undefined,'guest:qa');
 assert.equal(legacy.publicDeadline,storedExpiry,'the stored expiry wins when it is sooner');
 assert.equal(legacy.expiresAt,legacy.publicDeadline);
 const stale=makeRoom('stale','seaside-native-v2',108,now-30*24*60*60*1000);stale.visibility='public';stale.expiresAt=now+30*24*60*60*1000;
 addMember(stale,'p','QA','token',now,undefined,'guest:qa');
 assert.equal(stale.publicDeadline,now+PUBLIC_ROOM_LIFETIME_MS,'an untouched legacy room gets one day from its first touch, not the old month');
});

test('cleanup rolls back the room deletion if related-row cleanup fails',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),room=makeRoom('rollback','seaside-native-v2',108,Date.now());room.visibility='public';
 try{
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);
  db.sql.exec("INSERT INTO puzzle_room_directory VALUES('rollback','public',NULL,'QA','seaside',108,0,0,NULL,NULL); INSERT INTO puzzle_room_cursors VALUES('rollback','p','c',1,0,0,0); CREATE TRIGGER fixture_failure BEFORE DELETE ON puzzle_room_cursors BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(cleanupPublicRooms(db));assert.ok(db.sql.prepare("SELECT 1 FROM puzzle_rooms WHERE id='rollback'").get());
 }finally{db.close();}
});
