import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';

test('production SQLite applies actual migrations once and preserves data on restart', async () => {
  const folder=mkdtempSync(resolve(tmpdir(),'puzzle-node-')),file=resolve(folder,'test.sqlite');
  let db=new SqliteD1(file,resolve('drizzle'));
  assert.equal(db.sql.prepare('SELECT count(*) AS count FROM app_migrations').get().count,11);
  db.sql.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY,value TEXT UNIQUE)');
  assert.equal(db.withSession('first-primary'),db);
  const inserted=await db.prepare('INSERT INTO fixture(value) VALUES(?) RETURNING id').bind('kept').run();
  assert.equal(inserted.meta.changes,1);
  assert.equal(inserted.results[0].id,1);
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO fixture(value) VALUES(?)').bind('rolled-back'),
    db.prepare('INSERT INTO fixture(value) VALUES(?)').bind('kept'),
  ]));
  assert.equal(await db.prepare('SELECT count(*) AS count FROM fixture').first('count'),1);
  db.close();db=new SqliteD1(file,resolve('drizzle'));
  assert.equal(await db.prepare('SELECT value FROM fixture').first('value'),'kept');
  assert.equal(Object.values(db.sql.prepare('PRAGMA integrity_check').get())[0],'ok');
  db.close();
});

test('applied migrations cannot change and failed migrations roll back', () => {
  const folder=mkdtempSync(resolve(tmpdir(),'puzzle-migrations-')),file=resolve(folder,'test.sqlite');
  writeFileSync(resolve(folder,'0000_test.sql'),'CREATE TABLE fixture(id INTEGER);');
  new SqliteD1(file,folder).close();
  writeFileSync(resolve(folder,'0001_invalid.sql'),'CREATE TABLE uncommitted(id INTEGER); INVALID SQL;');
  assert.throws(()=>new SqliteD1(file,folder));
  writeFileSync(resolve(folder,'0001_invalid.sql'),'CREATE TABLE uncommitted(id INTEGER);');
  new SqliteD1(file,folder).close();
  writeFileSync(resolve(folder,'0000_test.sql'),'CREATE TABLE replaced(id INTEGER);');
  assert.throws(()=>new SqliteD1(file,folder),/migration has changed/);
});
