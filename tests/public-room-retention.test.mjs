import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';
import { cleanupPublicRooms } from '../server/public-room-cleanup.mjs';
import { makeRoom,addMember,applyAction,ensureOpen,hasTableProgress,ONLINE_MS } from '../lib/room-engine.ts';
import { PUBLIC_ROOM_LIFETIME_MS,PUBLIC_ROOM_LARGE_LIFETIME_MS } from '../lib/public-room-retention.ts';

const HOUR=60*60*1000,DAY=24*HOUR;

test('cleanup keeps tables with progress after their lobby day, and reclaims the rest',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),now=Date.now();
  const seed=(id,{visibility='public',deadline=now+DAY,online=false,progress=false,merged=false,playedAt,createdAt=now-DAY*2}={})=>{
   const room=makeRoom(id,'seaside-native-v2',108,createdAt);room.visibility=visibility;room.expiresAt=deadline;
  if(playedAt!==undefined)room.lastPlayedAt=playedAt;
  if(online)room.members=[{id:'player',name:'QA',lastSeen:now,joinedAt:now,digest:'token',color:'#fff'}];
  if(progress)room.puzzle.groups[0].locked=true;
  if(merged){room.puzzle.groups[0].pieces.push(...room.puzzle.groups[1].pieces);room.puzzle.groups.splice(1,1);}
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(id,0,JSON.stringify(room),room.expiresAt);
  db.sql.prepare('INSERT INTO puzzle_room_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,visibility,null,id,'seaside',108,room.createdAt,room.expiresAt,null,null);
  db.sql.prepare('INSERT INTO puzzle_room_cursors VALUES(?,?,?,?,?,?,?)').run(id,'player','cursor',1,10,20,now);
  return room;
 };
 try{
  seed('unplayed-past',{deadline:now-1});
  seed('untouched',{deadline:now+DAY,createdAt:now});
  seed('played-past',{progress:true,deadline:now-1,playedAt:now-2*HOUR});
  seed('merged-past',{merged:true,deadline:now-DAY,playedAt:now-3*HOUR});
  seed('stale-progress',{progress:true,deadline:now-DAY*10,playedAt:now-DAY*31});
  seed('online-past',{progress:true,online:true,deadline:now-1,playedAt:now-2*HOUR});
  seed('online-stale',{progress:true,online:true,deadline:now-DAY*40,playedAt:now-DAY*40});
  seed('private',{visibility:'private',deadline:now-DAY*2});
  seed('solo',{visibility:'solo',deadline:now-DAY*2});
  db.sql.prepare('INSERT INTO puzzle_results VALUES(?,?,?,?,?,?,?,?)').run('played-past','team','seaside',108,2,1000,now,'[]');
  assert.equal(await cleanupPublicRooms(db,now),2,'only empty tables older than the one-hour grace and month-idle tables go');
  const ids=()=>db.sql.prepare('SELECT id FROM puzzle_rooms ORDER BY id').all().map(r=>r.id);
  assert.deepEqual(ids(),['merged-past','online-past','online-stale','played-past','private','solo','untouched'],'a fresh empty table gets a one-hour grace period');
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_directory WHERE room_id IN ('unplayed-past','stale-progress')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_room_cursors WHERE room_id IN ('unplayed-past','stale-progress')").get().n,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM puzzle_results WHERE room_id='played-past'").get().n,1,'finished results outlive their table');
  assert.equal(await cleanupPublicRooms(db,now+DAY*31),5,'the one-hour grace does not prevent later cleanup of a still-empty table');
  assert.deepEqual(ids(),['private','solo'],'only the private and solo rooms are left');
 }finally{db.close();}
});

test('the deadline is stamped once, never moves, and a large board gets half a day more',()=>{
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
 // A 500-piece table is rarely finished in one sitting, so it is shown for 36 hours.
 const big=makeRoom('big','seaside-native-v2',500,now);big.visibility='public';
 addMember(big,'p','QA','t',now,undefined,'guest:qa');
 assert.equal(big.expiresAt,now+PUBLIC_ROOM_LARGE_LIFETIME_MS,'a 500-piece board gets half a day more');
 assert.equal(room.expiresAt,deadline,'the small board kept its day');
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

test('a table past its lobby day can still be played while it has progress',()=>{
 const now=Date.now(),past=now-HOUR;
 const kept=makeRoom('kept','seaside-native-v2',108,now-DAY*2);kept.visibility='public';kept.expiresAt=past;kept.puzzle.groups[0].locked=true;
 assert.equal(hasTableProgress(kept.puzzle),true);
 assert.doesNotThrow(()=>ensureOpen(kept,now),'players can return to a table that has progress');
 const member=addMember(kept,'p','QA','token',now,undefined,'guest:qa');
 assert.ok(member);
 assert.equal(kept.lastPlayedAt,now,'the return counts as play, which shows the table in the lobby again');
 assert.equal(kept.expiresAt,past,'but the lobby deadline itself did not move');
 const merged=makeRoom('merged','seaside-native-v2',108,now-DAY*2);merged.visibility='public';merged.expiresAt=past;
 merged.puzzle.groups[0].pieces.push(...merged.puzzle.groups[1].pieces);merged.puzzle.groups.splice(1,1);
 assert.equal(hasTableProgress(merged.puzzle),true,'a connected group is progress too');
 assert.doesNotThrow(()=>ensureOpen(merged,now));
 const empty=makeRoom('empty','seaside-native-v2',108,now-DAY*2);empty.visibility='public';empty.expiresAt=past;
 assert.equal(hasTableProgress(empty.puzzle),false);
 assert.throws(()=>ensureOpen(empty,now),error=>error.status===410,'a table with nothing on it still expires');
 const privateRoom=makeRoom('private','seaside-native-v2',108,now-DAY*2);privateRoom.visibility='private';privateRoom.expiresAt=past;privateRoom.puzzle.groups[0].locked=true;
 assert.throws(()=>ensureOpen(privateRoom,now),error=>error.status===410,'private rooms keep their own expiry');
 const fresh=makeRoom('fresh','seaside-native-v2',108,now);fresh.visibility='public';
 assert.doesNotThrow(()=>ensureOpen(fresh,now));
});

test('cleanup rolls back the room deletion if related-row cleanup fails',async()=>{
 const db=new SqliteD1(':memory:',resolve('drizzle')),room=makeRoom('rollback','seaside-native-v2',108,Date.now()-2*HOUR);room.visibility='public';
 try{
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);
  db.sql.exec("INSERT INTO puzzle_room_directory VALUES('rollback','public',NULL,'QA','seaside',108,0,0,NULL,NULL); INSERT INTO puzzle_room_cursors VALUES('rollback','p','c',1,0,0,0); CREATE TRIGGER fixture_failure BEFORE DELETE ON puzzle_room_cursors BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(cleanupPublicRooms(db));assert.ok(db.sql.prepare("SELECT 1 FROM puzzle_rooms WHERE id='rollback'").get());
 }finally{db.close();}
});
