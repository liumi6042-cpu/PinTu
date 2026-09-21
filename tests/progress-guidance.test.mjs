import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PHOTOS } from '../lib/puzzle-catalog.ts';
import { createPuzzle, restartPuzzle } from '../lib/puzzle-engine.ts';
import { readLocalProgress, writeLocalProgress, saveKey } from '../lib/local-progress.ts';
import { nextResume,resumeProgress } from '../lib/resume-progress.ts';
import { photoGuidance, recommendedPieces, pixelsPerPiece, puzzleDifficulty, limitedDetail } from '../lib/play-guidance.ts';
import { setLanguage, t } from '../lib/i18n.ts';
import { makeRoom, addMember, applyAction, ROOM_LIFETIME } from '../lib/room-engine.ts';

test('local progress discovers old archived/legacy saves, rejects corrupt or misplaced slots, and preserves state', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const old = restartPuzzle({ ...createPuzzle('coral-garden',12,9,42), cols:100, rows:50 },42);
  old.elapsed=321; const serialized=JSON.stringify(old);
  values.set(saveKey(old.imageId,5000),serialized);
  const current=createPuzzle('mountain-lake-reflection',12,9,8);
  writeLocalProgress(storage,current,123456);
  values.set(saveKey('sleepy-cat',108),JSON.stringify(current));
  values.set(saveKey('seaside',108),'invalid');
  const entries=readLocalProgress(storage);
  assert.equal(entries.length,2);assert.equal(entries[0].savedAt,123456);
  assert.equal(entries[1].state.cols*entries[1].state.rows,5000);
  assert.equal(values.get(saveKey(old.imageId,5000)),serialized);
  const room={id:'server',title:'山湖倒影',imageId:current.imageId,pieces:108,placed:1,elapsed:30,completed:false,lastPlayedAt:234567,expiresAt:987654,visibility:'solo',players:1,started:true,startedAt:0};
  const merged=resumeProgress(entries,[room,room]);assert.equal(merged.length,3);assert.equal(merged[0].source,'server');
  assert.equal(merged.filter(entry=>entry.imageId===current.imageId).length,2,'independent server/local games must not overwrite each other');
});

test('every published picture has real resolution, translated guidance and an eligible recommendation',()=>{
  try { setLanguage('en'); for(const photo of PHOTOS){
    const guide=photoGuidance(photo.id),record=JSON.parse(readFileSync(new URL('../content/image-provenance/'+photo.id+'.json',import.meta.url),'utf8'));
    assert.equal(guide.width,record.width);assert.equal(guide.height,record.height);
    assert.ok([108,300,500,1000,1500,2000].includes(recommendedPieces(photo.id)));
    assert.ok(pixelsPerPiece(photo.id,recommendedPieces(photo.id))>=48);
    assert.notEqual(t(guide.reason),guide.reason);
  }}finally{setLanguage('zh');}
  assert.equal(pixelsPerPiece('mountain-lake-reflection',2000),28);
  assert.equal(limitedDetail('mountain-lake-reflection',2000),true);
  assert.equal(limitedDetail('mountain-lake-reflection',108),false);
  assert.equal(puzzleDifficulty('lone-pine-snow',108),'挑战');
  assert.equal(puzzleDifficulty('lemon-still-life',108),'轻松');
  assert.equal(puzzleDifficulty('lemon-still-life',2000),'挑战');
});

test('playing extends a room for 30 days; idle heartbeats and finished-room visits do not',()=>{
  const now=100000,room=makeRoom('r','seaside-native-v2',108,now),member=addMember(room,'a','甲','hash',now);
  assert.equal(ROOM_LIFETIME,30*86400000);
  applyAction(room,member,{type:'claim',groupId:0},now+86400000);
  assert.equal(room.expiresAt,now+86400000+ROOM_LIFETIME);
  const expiry=room.expiresAt,lastPlayed=room.lastPlayedAt;
  // An older request that commits later cannot shorten retention.
  addMember(room,'older','较早请求','older-hash',now+86400000-1000);
  assert.equal(room.expiresAt,expiry);
  applyAction(room,member,{type:'heartbeat',groupId:0},now+86400000+1000);
  assert.equal(room.expiresAt,expiry);assert.equal(room.lastPlayedAt,lastPlayed);
  room.completedAt=now+86400000;
  addMember(room,'b','乙','other',now+86400000+2000);
  assert.equal(room.expiresAt,expiry);
  assert.throws(()=>addMember(room,'c','丙','third',expiry),/过期/);
});

test('local retention upgrade is idempotent and preserves puzzle, tickets, and expired records',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(readFileSync(new URL('../drizzle/0000_puzzle_rooms.sql',import.meta.url),'utf8'));
    db.exec(readFileSync(new URL('../drizzle/0001_lobby_accounts.sql',import.meta.url),'utf8'));
    const now=Date.now(),active=makeRoom('active','seaside-native-v2',108,now),expired=makeRoom('expired','seaside-native-v2',108,now-86400000*2);
    delete active.retentionVersion;delete expired.retentionVersion;
    active.expiresAt=now+86400000;expired.expiresAt=now-1000;
    const insert=db.prepare('INSERT INTO puzzle_rooms VALUES (?,0,?,?)');
    for(const room of [active,expired])insert.run(room.id,JSON.stringify(room),room.expiresAt);
    const sql=readFileSync(new URL('../scripts/upgrade-room-retention.sql',import.meta.url),'utf8');db.exec(sql);
    const read=id=>db.prepare('SELECT * FROM puzzle_rooms WHERE id=?').get(id);
    const upgraded=read('active');assert.ok(upgraded.expires_at>now+29*86400000);assert.equal(JSON.parse(upgraded.data).expiresAt,upgraded.expires_at);
    assert.deepEqual(JSON.parse(upgraded.data).puzzle,active.puzzle);
    assert.equal(read('expired').data,JSON.stringify(expired));
    db.exec(sql);assert.deepEqual(read('active'),upgraded);
  }finally{db.close();}
});

test('the home reminder offers the newest unfinished game and nothing else', () => {
  const room = (id, placed, completed, lastPlayedAt) => ({ id, title: '山湖倒影', imageId: 'mountain-lake-reflection', pieces: 300, placed, elapsed: 60, completed, lastPlayedAt, expiresAt: 0, visibility: 'public', players: 2, started: true, startedAt: 0 });
  const entries = resumeProgress([], [
    room('opened', 0, false, 900),      // opened and abandoned
    room('finished', 300, true, 800),
    room('halfway', 120, false, 700),
    room('newer-thin', 3, false, 950),
  ]);
  const pick = nextResume(entries);
  // Newest wins, but only among games that actually have pieces placed.
  assert.equal(pick.id, 'newer-thin');
  assert.equal(pick.pieces - pick.placed, 297);
  assert.equal(nextResume(entries.filter(entry => entry.id !== 'newer-thin')).id, 'halfway');
  // Finished and untouched games are never a reason to come back.
  assert.equal(nextResume([room('finished', 300, true, 800)]), undefined);
  assert.equal(nextResume([room('opened', 0, false, 900)]), undefined);
  assert.equal(nextResume([]), undefined);
});
