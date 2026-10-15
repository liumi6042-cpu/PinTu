import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
import {insertOrReuseEmptyPublicRoom} from '../lib/public-room-admission.mjs';
const now=Date.now(),online=22000;
const room=(id,extra={})=>({id,visibility:'public',ownerId:'owner',title:'Same picture',createdAt:now,expiresAt:now+86400000,completedAt:null,startedAt:null,members:[],participants:{},puzzle:{imageId:'picture',cols:12,rows:9,scatterVersion:3,groups:[{pieces:[0],locked:false},{pieces:[1],locked:false}]},...extra});
const database=()=>new SqliteD1(':memory:',resolve('drizzle'));
test('concurrent public creation inserts one table and reuses its stable ID',async()=>{
 const db=database();try{
  const admissions=await Promise.all(Array.from({length:8},(_,i)=>insertOrReuseEmptyPublicRoom(db,room('room-'+i),108,now,online)));
  assert.equal(admissions.filter(r=>r.created).length,1);assert.equal(new Set(admissions.map(r=>r.id)).size,1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,1);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_room_directory').get().n,1);
 }finally{db.close();}
});
test('started, connected, full, closed, private and expired tables are never reused',async()=>{
 for(const kind of ['started','merged','locked','full','closed','private','expired','not-accepting','different-picture','different-pieces','different-layout','different-title']){
  const db=database();try{
   const original=room('original');await insertOrReuseEmptyPublicRoom(db,original,108,now,online);
   const edited=structuredClone(original);
   if(kind==='started')edited.startedAt=now-5000;
   if(kind==='merged')edited.puzzle.groups=[{pieces:[0,1],locked:false}];
   if(kind==='locked')edited.puzzle.groups[0].locked=true;
   if(kind==='full')edited.members=Array.from({length:8},()=>({lastSeen:now}));
   if(kind==='not-accepting')edited.acceptingNew=false;
   if(kind==='different-layout')edited.puzzle.scatterVersion=1;
   db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(edited),original.id);
   if(kind==='closed')db.sql.prepare('INSERT INTO puzzle_room_moderation VALUES(?,1)').run(original.id);
   if(kind==='private')db.sql.prepare("UPDATE puzzle_room_directory SET visibility='private' WHERE room_id=?").run(original.id);
   if(kind==='expired')db.sql.prepare('UPDATE puzzle_room_directory SET expires_at=? WHERE room_id=?').run(now-1,original.id);
   if(kind==='different-picture')db.sql.prepare("UPDATE puzzle_room_directory SET image_id='other' WHERE room_id=?").run(original.id);
   if(kind==='different-pieces')db.sql.prepare('UPDATE puzzle_room_directory SET piece_count=300 WHERE room_id=?').run(original.id);
   if(kind==='different-title')db.sql.prepare("UPDATE puzzle_room_directory SET title='Named table' WHERE room_id=?").run(original.id);
   const admission=await insertOrReuseEmptyPublicRoom(db,room('new'),108,now,online);assert(admission.created,kind);
   assert.equal(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(original.id).data,JSON.stringify(edited),kind+' preserves old state');
  }finally{db.close();}
 }
});
test('other owners can reuse an open table without changing the original owner',async()=>{
 const db=database();try{await insertOrReuseEmptyPublicRoom(db,room('original'),108,now,online);const result=await insertOrReuseEmptyPublicRoom(db,room('other',{ownerId:'other'}),108,now,online);assert.equal(result.id,'original');assert.equal(JSON.parse(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get('original').data).ownerId,'owner');}finally{db.close();}
});
