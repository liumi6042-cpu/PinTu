import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMobileDataBackup, verifyMobileDataBackup, restoreMobileDataBackup } from '../scripts/mobile-data-backup.mjs';

const WORK = fileURLToPath(new URL('../work/public-test-prepare-20261017/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture() {
  await mkdir(WORK, { recursive: true });
  const root = await mkdtemp(path.join(WORK, 'backup-fixture-'));
  const mobileDatabase = path.join(root, 'players.sqlite'), sessionsDatabase = path.join(root, 'login.sqlite');
  const player = 'a'.repeat(64), token = 'b'.repeat(64), owner = digest(token);
  const mobile = new DatabaseSync(mobileDatabase), sessions = new DatabaseSync(sessionsDatabase);
  mobile.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=3;
    CREATE TABLE mobile_profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE mobile_rooms(id TEXT PRIMARY KEY,owner TEXT NOT NULL,visibility TEXT NOT NULL,pieces INTEGER NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,closed_at INTEGER,data TEXT NOT NULL);
    CREATE TABLE mobile_collection_wallets(owner TEXT PRIMARY KEY,coins INTEGER NOT NULL,fragments INTEGER NOT NULL,equipped TEXT);
    CREATE TABLE mobile_collection_owned(owner TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,kind,item_id));
    CREATE TABLE mobile_collection_artworks(owner TEXT NOT NULL,image_id TEXT NOT NULL,pieces INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,image_id,pieces));
    CREATE TABLE mobile_collection_ledger(owner TEXT NOT NULL,source TEXT NOT NULL,coins INTEGER NOT NULL,fragments INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,source));
    CREATE TABLE mobile_settlements(room_id TEXT NOT NULL,owner TEXT NOT NULL,energy INTEGER NOT NULL,contribution INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
    CREATE TABLE mobile_task_gifts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,energy INTEGER NOT NULL,xp INTEGER NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,opened_at INTEGER,opened_request TEXT);`);
  sessions.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=2; CREATE TABLE h5_sessions(token_hash TEXT PRIMARY KEY,cookies TEXT NOT NULL,expires_at INTEGER NOT NULL);');
  for (const id of [owner, player]) mobile.prepare('INSERT INTO mobile_profiles VALUES(?,?)').run(id, JSON.stringify({ id, level: 5, totalXp: 100, energy: 20 }));
  mobile.prepare('INSERT INTO mobile_collection_wallets VALUES(?,?,?,?)').run(owner, 500, 20, 'flower');
  mobile.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner, 'pack', 'paid-pack-preserved', 1);
  mobile.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner, 'decoration', 'flower', 1);
  mobile.prepare('INSERT INTO mobile_collection_artworks VALUES(?,?,?,?)').run(owner, 'stable-image-id', 108, 1);
  mobile.prepare('INSERT INTO mobile_collection_ledger VALUES(?,?,?,?,?)').run(owner, 'room:room-1', 100, 3, 1);
  mobile.prepare('INSERT INTO mobile_settlements VALUES(?,?,?,?,?)').run('room-1', owner, 10, 48, 1);
  mobile.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,?,?)').run('gift-1', owner, 'daily', 5, 10, 'daily:1', 1, null, null);
  mobile.prepare('INSERT INTO mobile_rooms VALUES(?,?,?,?,?,?,?,?)').run('room-1', owner, 'private', 108, 1, null, null, JSON.stringify({ id: 'room-1', ownerId: owner, puzzle: { imageId: 'stable-image-id', groups: [{ id: 'piece-1', locked: true }] }, members: [{ id: 'member-1', guestId: owner }] }));
  sessions.prepare('INSERT INTO h5_sessions VALUES(?,?,?)').run(owner, '', 9999999999999);
  return { root, mobileDatabase, sessionsDatabase, mobile, sessions, owner, token, close() { mobile.close(); sessions.close(); } };
}

async function clean(root) {
  const relative = path.relative(WORK, root);
  assert.ok(relative.startsWith('backup-fixture-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(root, { recursive: true, force: true });
}

test('online backup keeps committed WAL, versions, player progress, purchased rights, rooms and session links in an isolated restore', async () => {
  const f = await fixture();
  try {
    assert.ok((await lstat(f.mobileDatabase + '-wal')).size > 0);
    const saved = await createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.sessionsDatabase, destination: path.join(f.root, 'snapshot') });
    assert.equal(saved.manifest.consistency.crossDatabaseAtomic, false);
    assert.equal(saved.manifest.files[0].database.userVersion, 3);
    assert.equal(saved.manifest.files[1].database.userVersion, 2);
    assert.deepEqual((await readdir(saved.directory)).sort(), ['manifest.json', 'mobile-v3.sqlite', 'sessions.sqlite']);
    assert.ok(saved.manifest.associations.references.every(item => item.missingProfiles === 0));
    assert.equal(saved.manifest.associations.sessionsWithProfile, 1);
    f.mobile.prepare('UPDATE mobile_collection_wallets SET coins=coins+7 WHERE owner=?').run(f.owner);
    const restored = await restoreMobileDataBackup({ backupDirectory: saved.directory, destination: path.join(f.root, 'isolated-restore') });
    const players = new DatabaseSync(path.join(restored.directory, 'mobile-v3.sqlite'), { readOnly: true });
    const sessions = new DatabaseSync(path.join(restored.directory, 'sessions.sqlite'), { readOnly: true });
    try {
      assert.equal(JSON.parse(players.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(f.owner).data).level, 5);
      assert.equal(players.prepare('SELECT coins FROM mobile_collection_wallets WHERE owner=?').get(f.owner).coins, 500);
      assert.equal(f.mobile.prepare('SELECT coins FROM mobile_collection_wallets WHERE owner=?').get(f.owner).coins, 507);
      assert.equal(players.prepare("SELECT count(*) AS n FROM mobile_collection_owned WHERE owner=? AND kind='pack' AND item_id='paid-pack-preserved'").get(f.owner).n, 1);
      assert.equal(players.prepare('SELECT image_id FROM mobile_collection_artworks WHERE owner=?').get(f.owner).image_id, 'stable-image-id');
      assert.equal(players.prepare('SELECT contribution FROM mobile_settlements WHERE owner=?').get(f.owner).contribution, 48);
      assert.equal(players.prepare('SELECT source FROM mobile_task_gifts WHERE owner=?').get(f.owner).source, 'daily:1');
      const room = JSON.parse(players.prepare('SELECT data FROM mobile_rooms').get().data);
      assert.equal(room.puzzle.groups[0].locked, true);
      assert.equal(room.members[0].guestId, f.owner);
      assert.equal(sessions.prepare('SELECT token_hash FROM h5_sessions WHERE token_hash=?').get(digest(f.token)).token_hash, f.owner);
      assert.equal(restored.report.productionSwitched, false);
    } finally { sessions.close(); players.close(); }
    const result = { performedAt: new Date().toISOString(), scope: 'synthetic data only, no live databases', cases: ['committed-WAL', 'player-level-and-wallet', 'purchased-pack-and-decoration', 'stable-image-progress', 'room-member-and-piece-state', 'gift-and-settlement', 'session-token-to-profile', 'source-newer-write-preserved', 'schema-user-version', 'hash-and-quick-check'], status: 'passed', totalSnapshotBytes: saved.manifest.files.reduce((sum, item) => sum + item.bytes, 0), consistency: saved.manifest.consistency, associations: restored.report.associations, productionChanged: false, dailyOffsiteBackupDeployed: false, productionTimerDeployed: false, note: 'Temporary synthetic databases and copied restores are removed after this exercise; only this small evidence report remains.' };
    await writeFile(path.join(WORK, 'backup-drill.json'), JSON.stringify(result, null, 2) + '\n');
    await verifyMobileDataBackup(saved.directory);
  } finally { f.close(); await clean(f.root); }
});

test('restore and backup refuse existing destinations, shared sources, traversal and extra archive files', async () => {
  const f = await fixture();
  try {
    await assert.rejects(createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.mobileDatabase, destination: path.join(f.root, 'same-source') }), /different files/);
    await assert.rejects(createMobileDataBackup({ mobileDatabase: f.sessionsDatabase, sessionsDatabase: f.mobileDatabase, destination: path.join(f.root, 'swapped') }), /Database role players/);
    await assert.rejects(createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.sessionsDatabase, destination: path.join(f.root, 'nested', '..', 'escape') + '/../escape' }), /path traversal/);
    const destination = path.join(f.root, 'backup');
    await createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.sessionsDatabase, destination });
    await assert.rejects(createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.sessionsDatabase, destination }), /EEXIST/);
    await assert.rejects(restoreMobileDataBackup({ backupDirectory: destination, destination: f.root }), /EEXIST/);
    const mainBefore = digest(await readFile(f.mobileDatabase));
    await assert.rejects(restoreMobileDataBackup({ backupDirectory: destination, destination: f.mobileDatabase }), /EEXIST/);
    assert.equal(digest(await readFile(f.mobileDatabase)), mainBefore);
    await writeFile(path.join(destination, 'server.log'), 'never archive log data');
    await assert.rejects(verifyMobileDataBackup(destination), /only the two databases/);
  } finally { f.close(); await clean(f.root); }
});

test('tampered content, schema metadata and manifest paths are refused before creating a restore directory', async () => {
  const f = await fixture();
  try {
    const destination = path.join(f.root, 'backup');
    await createMobileDataBackup({ mobileDatabase: f.mobileDatabase, sessionsDatabase: f.sessionsDatabase, destination });
    const manifestFile = path.join(destination, 'manifest.json'), original = await readFile(manifestFile, 'utf8');
    const manifest = JSON.parse(original);
    manifest.files[0].name = '../players.sqlite';
    await writeFile(manifestFile, JSON.stringify(manifest));
    await assert.rejects(restoreMobileDataBackup({ backupDirectory: destination, destination: path.join(f.root, 'refused') }), /file path/);
    await assert.rejects(lstat(path.join(f.root, 'refused')), /ENOENT/);
    manifest.files[0].name = 'mobile-v3.sqlite';
    manifest.files[0].database.userVersion++;
    await writeFile(manifestFile, JSON.stringify(manifest));
    await assert.rejects(verifyMobileDataBackup(destination), /schema, row counts or version/);
    await writeFile(manifestFile, original);
    const databaseFile = path.join(destination, 'sessions.sqlite'), bytes = await readFile(databaseFile);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(databaseFile, bytes);
    await assert.rejects(verifyMobileDataBackup(destination), /SHA-256/);
  } finally { f.close(); await clean(f.root); }
});

test('symbolic-link or Windows-junction backup paths are rejected', async () => {
  const f = await fixture();
  try {
    const link = path.join(f.root, 'linked-directory');
    await symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(createMobileDataBackup({ mobileDatabase: path.join(link, 'players.sqlite'), sessionsDatabase: f.sessionsDatabase, destination: path.join(f.root, 'refused') }), /Symbolic links/);
  } finally { f.close(); await clean(f.root); }
});
