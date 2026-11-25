import './ts-register.mjs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the production deletion function against isolated SQLite data.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './local-db' && context.parentURL?.endsWith('/user-image-store.ts'))
    return { url: 'data:text/javascript,export function localDb(){return globalThis.imageDeletionDb}', shortCircuit: true };
  return next(specifier, context);
} });
const { removeUserImage } = await import('../lib/user-image-store.ts');
const id = 'custom-' + 'a'.repeat(32);

test('uploaded image deletion protects unfinished puzzles but allows completed rooms immediately', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE puzzle_user_images(id TEXT PRIMARY KEY,owner_id TEXT,title TEXT,width INTEGER,height INTEGER,byte_size INTEGER,created_at INTEGER);
    CREATE TABLE puzzle_room_directory(room_id TEXT,image_id TEXT,expires_at INTEGER,completed_at INTEGER);`);
  globalThis.imageDeletionDb = { prepare(sql) { return { bind(...args) { return {
    async first() { return db.prepare(sql).get(...args); },
    async run() { return { meta: db.prepare(sql).run(...args) }; },
  }; } }; } };
  const reset = () => {
    db.exec('DELETE FROM puzzle_user_images; DELETE FROM puzzle_room_directory;');
    db.prepare('INSERT INTO puzzle_user_images VALUES(?,?,?,?,?,?,?)').run(id,'owner','Picture',800,600,100,Date.now());
  };
  const room = (name, completed, expires = Date.now()+86400000, image = id) =>
    db.prepare('INSERT INTO puzzle_room_directory VALUES(?,?,?,?)').run(name,image,expires,completed);
  const exists = () => !!db.prepare('SELECT id FROM puzzle_user_images WHERE id=?').get(id);
  try {
    reset(); room('finished',Date.now());
    await removeUserImage('owner',id); assert.equal(exists(),false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM puzzle_room_directory').get().n,1,'deleting a picture does not delete room records');

    reset(); room('unfinished',null);
    await assert.rejects(removeUserImage('owner',id),e=>e.status===409); assert.equal(exists(),true);

    room('finished',Date.now());
    await assert.rejects(removeUserImage('owner',id),e=>e.status===409); assert.equal(exists(),true);
    db.prepare('UPDATE puzzle_room_directory SET completed_at=? WHERE room_id=?').run(Date.now(),'unfinished');
    await removeUserImage('owner',id); assert.equal(exists(),false);

    reset(); room('expired',null,Date.now()-1000);
    await removeUserImage('owner',id); assert.equal(exists(),false);

    reset(); room('other-picture',null,Date.now()+86400000,'custom-other');
    await assert.rejects(removeUserImage('stranger',id),e=>e.status===404); assert.equal(exists(),true);
    await removeUserImage('owner',id); assert.equal(exists(),false);
  } finally { delete globalThis.imageDeletionDb; db.close(); }
});
