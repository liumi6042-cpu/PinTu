import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';
import { createPuzzle } from '../lib/puzzle-engine.ts';
import { makeRoom, addMember } from '../lib/room-engine.ts';
import { activeKey, saveKey, writeLocalProgress, readLocalProgress, removeLocalProgress, restoreRemovedLocalProgress } from '../lib/local-progress.ts';
import { hiddenPersonalRooms, setPersonalRoomHidden } from '../lib/personal-room-records.ts';

test('deleting one device save preserves other saves, identity and achievements; undo preserves exact progress', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const first = createPuzzle('seaside',12,9,17), other = createPuzzle('lone-pine-snow',12,9,19);
  first.elapsed = 123;
  writeLocalProgress(storage,other,100); writeLocalProgress(storage,first,200);
  values.set('puzzle:guest-fallback','identity'); values.set('unrelated','keep');
  const before = new Map(values), key = saveKey('seaside',108), removed = removeLocalProgress(storage,key);
  assert.equal(storage.getItem(key),null); assert.equal(storage.getItem(key+':saved-at'),null); assert.equal(storage.getItem(activeKey),null);
  assert.equal(readLocalProgress(storage).length,1);
  for (const [k,v] of before) if (![key,key+':saved-at',activeKey].includes(k)) assert.equal(values.get(k),v);
  restoreRemovedLocalProgress(storage,removed); assert.deepEqual(values,before);
  assert.throws(()=>removeLocalProgress(storage,'puzzle:guest-fallback'),/无效/);
  const deleted = removeLocalProgress(storage,key);
  writeLocalProgress(storage,{...first,elapsed:456},300);
  assert.throws(()=>restoreRemovedLocalProgress(storage,deleted),/新进度/);
  assert.equal(JSON.parse(storage.getItem(key)).elapsed,456);
});

test('server removal is private to verified identities, reversible and leaves rooms untouched', async () => {
  const folder=mkdtempSync(resolve(tmpdir(),'puzzle-records-')), db=new SqliteD1(resolve(folder,'test.sqlite'),resolve('drizzle'));
  try {
    const now=Date.now(), id='a'.repeat(32), room=makeRoom(id,'seaside-native-v2',108,now);
    room.visibility='public'; room.ownerId='owner';
    addMember(room,'member','Player','hash',now,undefined,'guest:friend');
    db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,0,?,?)').run(id,JSON.stringify(room),room.expiresAt);
    const before=db.sql.prepare('SELECT * FROM puzzle_rooms').all();
    await assert.rejects(setPersonalRoomHidden(db,[],id,true,now),e=>e.status===401);
    await assert.rejects(setPersonalRoomHidden(db,['stranger'],id,true,now),e=>e.status===404);
    await setPersonalRoomHidden(db,['guest:friend'],id,true,now);
    assert.deepEqual([...await hiddenPersonalRooms(db,['owner'])],[]);
    assert.deepEqual([...await hiddenPersonalRooms(db,['guest:friend'])],[id]);
    await setPersonalRoomHidden(db,['owner','guest:old-owner'],id,true,now);
    assert.deepEqual([...await hiddenPersonalRooms(db,['guest:old-owner','owner'])],[id]);
    await setPersonalRoomHidden(db,['owner','guest:old-owner'],id,false,now);
    assert.equal((await hiddenPersonalRooms(db,['owner','guest:old-owner'])).size,0);
    assert.equal((await hiddenPersonalRooms(db,['guest:friend'])).size,1);
    assert.deepEqual(db.sql.prepare('SELECT * FROM puzzle_rooms').all(),before);
    room.visibility='solo'; db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(room),id);
    await assert.rejects(setPersonalRoomHidden(db,['guest:friend'],id,false,now),e=>e.status===404);
    await setPersonalRoomHidden(db,['owner'],id,true,now);
    db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(id);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM puzzle_personal_hidden_rooms').get().n,0,'expired rooms do not leave orphan markers');
  } finally { db.close(); }
});
