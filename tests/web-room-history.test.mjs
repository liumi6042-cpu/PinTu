import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteD1} from '../server/sqlite.mjs';
import {WEB_ROOM_HISTORY_SCHEMA,webRecentRooms,webOwnedRooms,webRecordJoin,webRemoveOwned} from '../server/web-room-history.mjs';
const a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32),id=n=>n.toString(16).padStart(32,'0');
function fixture(){
 const db=new SqliteD1(':memory:','drizzle');db.sql.exec(WEB_ROOM_HISTORY_SCHEMA);
 const room=(n,owner=a)=>{const r={id:id(n),ownerId:owner,title:'测试'+n,visibility:'public',puzzle:{imageId:'test',cols:12,rows:9,groups:[{id:0,pieces:[0],locked:true}]},createdAt:n,expiresAt:1,completedAt:null,startedAt:1,members:[],admitted:{[owner]:true,[b]:true},participants:{}};db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(r.id,0,JSON.stringify(r),r.expiresAt);return r;};
 return {db,room,close:()=>db.sql.close()};
}
test('Web history tracks ten distinct admissions across cookie identities and updates recency only explicitly',async()=>{
 const f=fixture();try{for(let n=1;n<=12;n++){const r=f.room(n);await webRecordJoin(f.db,[b],r.id,100+n);}
  assert.equal((await webRecentRooms(f.db,[b])).length,10);assert.equal((await webRecentRooms(f.db,[b]))[0].id,id(12));
  await webRecordJoin(f.db,[b],id(1),200);assert.equal((await webRecentRooms(f.db,[b]))[0].id,id(1));
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_shared_room_history WHERE owner_id=?').get(b).n,10);
  assert.equal((await webRecentRooms(f.db,[c])).length,0);
 }finally{f.close();}
});
test('Web personal removal preserves both players history and room bytes, and blocks non-owners',async()=>{
 const f=fixture();try{const r=f.room(1);await webRecordJoin(f.db,[a],r.id);await webRecordJoin(f.db,[b],r.id);
  const before=f.db.sql.prepare('SELECT data FROM puzzle_rooms').get().data;
  await assert.rejects(webRemoveOwned(f.db,[b],r.id),error=>error.status===403);
  await webRemoveOwned(f.db,[a],r.id);await webRemoveOwned(f.db,[a],r.id);
  assert.equal((await webOwnedRooms(f.db,[a])).length,0);assert.equal((await webRecentRooms(f.db,[a]))[0].id,r.id);assert.equal((await webRecentRooms(f.db,[b]))[0].id,r.id);
  await webRecordJoin(f.db,[a],r.id);assert.equal((await webOwnedRooms(f.db,[a])).length,0);assert.equal(f.db.sql.prepare('SELECT data FROM puzzle_rooms').get().data,before);
 }finally{f.close();}
});
test('Web completion labels come from live rows and public cards contain no private identity or ticket fields',async()=>{
 const f=fixture();try{const r=f.room(1);await webRecordJoin(f.db,[a],r.id);r.completedAt=100;r.members=[{id:'member',accountId:a,digest:'secret',lastSeen:Date.now()}];f.db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(r),r.id);
  for(const entry of [...await webRecentRooms(f.db,[a]),...await webOwnedRooms(f.db,[a])]){assert.equal(entry.title,'已完成');assert.equal(entry.completed,true);assert.equal(entry.members,undefined);assert.equal(entry.ownerId,undefined);assert.equal(entry.token,undefined);assert.ok(!JSON.stringify(entry).includes('secret'));}
 }finally{f.close();}
});
test('Web history seeds legacy admission once without reviving evicted entries or inventing access',async()=>{
 const f=fixture();try{const r=f.room(1);assert.equal((await webRecentRooms(f.db,[b]))[0].id,r.id);f.db.sql.prepare('DELETE FROM puzzle_shared_room_history WHERE owner_id=?').run(b);assert.deepEqual(await webRecentRooms(f.db,[b]),[]);
  await webRecordJoin(f.db,[c],r.id);assert.deepEqual(await webRecentRooms(f.db,[c]),[]);
  assert.equal((await webOwnedRooms(f.db,[b])).length,0);
 }finally{f.close();}
});
