import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {SqliteD1} from '../server/sqlite.mjs';
import {beijingDayStart,completionStats} from '../lib/completion-stats.ts';

const migrations=fileURLToPath(new URL('../drizzle/',import.meta.url));
function state(id,revision,placed,extras={}){
 return {id,revision,puzzle:{groups:[...(placed?[{id:0,pieces:Array.from({length:placed},(_,i)=>i),locked:true}]:[]),{id:placed,pieces:[placed],locked:false}]},...extras};
}
function insertRoom(db,room){db.sql.prepare('INSERT INTO puzzle_rooms(id,revision,data,expires_at) VALUES(?,?,?,?)').run(room.id,room.revision,JSON.stringify(room),Date.now()+86400000);}
async function commit(db,before,after,{reward=false}={}){
 const now=Date.now(),commands=[db.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(after),after.revision,after.id,before.revision)];
 if(reward)commands.push(db.prepare('INSERT OR IGNORE INTO puzzle_managed_reward_events(id,room_id,revision,occurred_at,payload) SELECT ?,?,?,?,? WHERE changes()=1').bind(after.id+':'+after.revision,after.id,after.revision,now,'{}'));
 return db.batch(commands);
}
const dailySum=db=>Number(db.sql.prepare('SELECT COALESCE(SUM(placed_delta),0) n FROM puzzle_piece_daily_events WHERE day_start=?').get(beijingDayStart(Date.now())).n);
const highest=(db,id)=>db.sql.prepare('SELECT placed_count,updated_at FROM puzzle_piece_progress WHERE room_id=?').get(id);

test('only accepted placement increments count; triggers preserve managed reward CAS changes()',async()=>{
 const db=new SqliteD1(':memory:',migrations),start=state('accepted',0,0);insertRoom(db,start);
 try{
  const first=state(start.id,1,4),success=await commit(db,start,first,{reward:true});
  assert.equal(success[0].meta.changes,1);assert.equal(success[1].meta.changes,1);
  assert.equal(dailySum(db),4);assert.equal(highest(db,start.id).placed_count,4);
  const event=db.sql.prepare('SELECT occurred_at,day_start FROM puzzle_piece_daily_events').get();
  assert.equal(event.occurred_at,highest(db,start.id).updated_at);assert.equal(event.day_start,beijingDayStart(event.occurred_at));
  const failed=await commit(db,start,state(start.id,1,99),{reward:true});
  assert.equal(failed[0].meta.changes,0);assert.equal(failed[1].meta.changes,0);assert.equal(dailySum(db),4);assert.equal(highest(db,start.id).placed_count,4);
  const replay=await commit(db,start,first,{reward:true});assert.equal(replay[0].meta.changes,0);assert.equal(replay[1].meta.changes,0);
  const wrong=state(start.id,2,4),wrongResult=await commit(db,first,wrong);assert.equal(wrongResult[0].meta.changes,1);assert.equal(dailySum(db),4);
  const moved=state(start.id,3,4);await commit(db,wrong,moved);assert.equal(dailySum(db),4);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_reward_events').get().n,1);
 }finally{db.close();}
});

test("old room baselines never become today's pieces, including missing or stale highest rows",async()=>{
 const db=new SqliteD1(':memory:',migrations);
 try{
  for(const [id,history] of [['missing',null],['stale',20],['present',90]]){
   const beforeToday=dailySum(db);
   const old=state(id,0,90);insertRoom(db,old);
   if(history!==null)db.sql.prepare('INSERT INTO puzzle_piece_progress VALUES(?,?,?)').run(id,history,Date.now()-86400000);
   await commit(db,old,state(id,1,90));assert.equal(highest(db,id).placed_count,90);assert.equal(dailySum(db),beforeToday);
   await commit(db,state(id,1,90),state(id,2,100));assert.equal(highest(db,id).placed_count,100);
  }
  assert.equal(dailySum(db),30);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_piece_daily_tracking').get().n,1);
 }finally{db.close();}
});

test('today counts only new increments, excludes yesterday and future, and survives room cleanup',async()=>{
 const db=new SqliteD1(':memory:',migrations),today=beijingDayStart(Date.now()),old=state('cross-day',3,90);insertRoom(db,old);
 try{
  db.sql.prepare('INSERT INTO puzzle_piece_progress VALUES(?,?,?)').run(old.id,90,today-1);
  db.sql.prepare('INSERT INTO puzzle_piece_daily_events VALUES(?,?,?,?,?)').run(old.id,1,today-86400000,90,today-1);
  db.sql.prepare('INSERT INTO puzzle_piece_daily_events VALUES(?,?,?,?,?)').run('future',1,today+86400000,999,today+86400000);
  await commit(db,old,state(old.id,4,100,{members:[{bot:true}]}));
  const stats=await completionStats(Date.now(),db);assert.equal(stats.completedPiecesToday,10);assert.equal(stats.completedPiecesTotal,100);
  db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(old.id);
  assert.equal(dailySum(db),10);assert.equal(highest(db,old.id).placed_count,100);
 }finally{db.close();}
});

test('a later statement failure rolls back room, piece counters and managed outbox together',async()=>{
 const db=new SqliteD1(':memory:',migrations),old=state('rollback',0,0);insertRoom(db,old);
 try{
  const next=state(old.id,1,7),id=next.id+':1';
  await assert.rejects(db.batch([
   db.prepare('UPDATE puzzle_rooms SET data=?,revision=1 WHERE id=? AND revision=0').bind(JSON.stringify(next),next.id),
   db.prepare('INSERT OR IGNORE INTO puzzle_managed_reward_events(id,room_id,revision,occurred_at,payload) SELECT ?,?,?,?,? WHERE changes()=1').bind(id,next.id,1,Date.now(),'{}'),
   db.prepare('INSERT INTO table_that_does_not_exist VALUES(1)')
  ]));
  assert.equal(db.sql.prepare('SELECT revision FROM puzzle_rooms WHERE id=?').get(next.id).revision,0);
  assert.equal(dailySum(db),0);assert.equal(highest(db,next.id),undefined);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_reward_events').get().n,0);
 }finally{db.close();}
});
