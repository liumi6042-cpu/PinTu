import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENTS,emptyBook,awardAchievements,achievementProgress,achievementDay } from '../lib/achievements.ts';
import { recordLocalPuzzle,readLocalAchievements,equipLocalAchievement,LOCAL_ACHIEVEMENTS_KEY } from '../lib/local-achievements.ts';
import { createPuzzle } from '../lib/puzzle-engine.ts';
import { makeRoom,addMember,applyAction,snapshot } from '../lib/room-engine.ts';
import { completionOwners } from '../lib/room-achievements.ts';
import { setLanguage,t } from '../lib/i18n.ts';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('every achievement name and condition has an English translation',()=>{
  try{setLanguage('en');for(const badge of ACHIEVEMENTS)for(const value of [badge.name,badge.description,badge.group])assert.ok(!/[\u3400-\u9fff]/.test(t(value)),value);}
  finally{setLanguage('zh');}
});
test('16 badges use distinct pictures, solo challenge sizes, unique days, and stable award dates',()=>{
  assert.equal(ACHIEVEMENTS.length,16);const book=emptyBook();
  book.facts=Array.from({length:10},(_,i)=>({key:''+i,imageId:'picture'+i,pieces:2000,mode:i<5?'team':'solo',category:'风景',completedAt:100}));
  book.facts.push({...book.facts[0],key:'repeat'});book.days=Array.from({length:7},(_,i)=>'2026-09-'+(10+i));book.days.push(book.days[0]);
  assert.equal(achievementProgress(book).pictures,10);assert.equal(achievementProgress(book).days,7);
  assert.equal(awardAchievements(book,1000).length,16);assert.deepEqual(awardAchievements(book,2000),[]);assert.equal(book.earned.first,1000);
  book.facts=book.facts.filter(f=>f.mode==='team');assert.equal(achievementProgress(book).soloPieces,0);
  assert.equal(achievementDay(Date.parse('2026-09-09T16:00:00Z')),'2026-09-10');
});
test('local completions survive restarts, do not farm repeats, and history does not invent active days',()=>{
  const store=storage(),puzzle=createPuzzle('seaside',12,9);recordLocalPuzzle(store,puzzle,1000);
  puzzle.groups.forEach(g=>{g.locked=true;g.dx=0;g.dy=0;});
  assert.deepEqual(recordLocalPuzzle(store,puzzle,2000),['first']);assert.deepEqual(recordLocalPuzzle(store,puzzle,3000),[]);
  let book=readLocalAchievements(store);assert.equal(book.facts.length,1);assert.equal(book.days.length,1);
  equipLocalAchievement(store,'first');assert.equal(readLocalAchievements(store).equipped,'first');assert.throws(()=>equipLocalAchievement(store,'team-first'));
  const archive=storage();recordLocalPuzzle(archive,structuredClone(puzzle),2000,true);book=readLocalAchievements(archive);assert.equal(book.facts.length,1);assert.equal(book.days.length,0);
  store.setItem(LOCAL_ACHIEVEMENTS_KEY,'bad json');assert.deepEqual(readLocalAchievements(store),emptyBook());
});
test('actual joins and first placements count once, not carried pieces, clicks, motion or duplicate drops',()=>{
  const room=makeRoom('room','seaside-native-v2',108,1000);room.visibility='private';
  const a=addMember(room,'a','A','token-a',1000,undefined,'guest:a'),b=addMember(room,'b','B','token-b',1000,undefined,'guest:b'),watcher=addMember(room,'c','C','token-c',1000,undefined,'guest:c');
  room.puzzle.groups.forEach(g=>{g.dx=600;g.dy=600;});room.puzzle.groups[0].dx=100;room.puzzle.groups[0].dy=100;room.puzzle.groups[1].dx=100;room.puzzle.groups[1].dy=100;
  applyAction(room,watcher,{type:'heartbeat'},1100);assert.equal(room.achievements,undefined);
  applyAction(room,a,{type:'claim',groupId:0},1200);assert.equal(room.achievements,undefined);
  applyAction(room,a,{type:'drop',groupId:0,seq:1,dx:100,dy:100},1300);
  assert.equal(room.achievements.contributors['guest:a'].count,1);
  const group=room.puzzle.groups.find(g=>g.pieces.includes(0));assert.equal(group.pieces.length,2);
  applyAction(room,b,{type:'claim',groupId:group.id},1400);applyAction(room,b,{type:'drop',groupId:group.id,seq:1,dx:0,dy:0},1500);
  assert.equal(room.achievements.contributors['guest:a'].count,1);assert.equal(room.achievements.contributors['guest:b'].count,1);
  assert.throws(()=>applyAction(room,b,{type:'drop',groupId:group.id,seq:1,dx:0,dy:0},1600));
  room.completedAt=2000;assert.deepEqual(completionOwners(room).map(o=>o.owner).sort(),['guest:a','guest:b']);
  const alone=structuredClone(room);delete alone.achievements.contributors['guest:b'];assert.equal(completionOwners(alone)[0].mode,'shared');
  const album=emptyBook();album.facts=[{key:'r',imageId:'seaside',pieces:2000,mode:'shared',category:'风景',completedAt:2000}];assert.deepEqual(awardAchievements(album,2000),['first']);
  assert.ok(!JSON.stringify(snapshot(room,2000)).includes('guest:a'),'snapshot must not reveal durable identity');
  delete room.achievements;assert.deepEqual(completionOwners(room),[],'historical team participation cannot prove contributions');
});
test('achievement records remain independent of room deletion and schema is idempotent',()=>{
  const db=new DatabaseSync(':memory:');try{
    const sql=readFileSync(new URL('../drizzle/0003_achievements.sql',import.meta.url),'utf8');db.exec(sql);db.exec(sql);
    const insert=db.prepare('INSERT OR IGNORE INTO puzzle_achievement_facts VALUES (?,?,?,?,?,?,?)');insert.run('u','room','photo',108,'solo','风景',1000);insert.run('u','room','photo',108,'solo','风景',2000);
    assert.equal(db.prepare('SELECT count(*) n FROM puzzle_achievement_facts').get().n,1);
    db.exec("CREATE TABLE puzzle_rooms(id TEXT); INSERT INTO puzzle_rooms VALUES ('room'); DELETE FROM puzzle_rooms;");assert.equal(db.prepare('SELECT count(*) n FROM puzzle_achievement_facts').get().n,1);
  }finally{db.close();}
});
