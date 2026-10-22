import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'jigsaw-mobile-data-backup-v1';
const FILES = Object.freeze([{ role: 'players', name: 'mobile-v3.sqlite' }, { role: 'sessions', name: 'sessions.sqlite' }]);
const PROJECT = fileURLToPath(new URL('../', import.meta.url));
const CONSISTENCY = Object.freeze({
  perDatabase: 'SQLite online backup; committed WAL data is included',
  crossDatabaseAtomic: false,
  requirement: 'For one application-wide recovery point, pause all writers to both databases for the entire backup. This tool does not stop services or claim that writers were paused.',
});

function safePath(input, label) {
  if (typeof input !== 'string' || !input || input.includes('\0') || input.split(/[\\/]/).includes('..')) throw new Error(`${label}: invalid path or path traversal`);
  const target = path.resolve(input);
  if (target === path.parse(target).root) throw new Error(`${label}: filesystem root is not allowed`);
  return target;
}

// Reject junctions/symlinks before SQLite or a file copy can follow them.
async function checkedExisting(input, kind = 'file') {
  const target = safePath(input, kind);
  let current = path.parse(target).root;
  for (const segment of path.relative(current, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const item = await lstat(current);
    if (item.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed');
  }
  const item = await lstat(target);
  if (kind === 'directory' ? !item.isDirectory() : !item.isFile()) throw new Error(`Expected ${kind}`);
  return { filename: await realpath(target), item };
}

async function newDirectory(input) {
  const target = safePath(input, 'destination');
  await checkedExisting(path.dirname(target), 'directory');
  // Non-recursive mkdir is deliberately exclusive: no restore may reuse a directory.
  await mkdir(target, { mode: 0o700 });
  return target;
}

async function sha256(filename) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(filename)) digest.update(bytes);
  return digest.digest('hex');
}

function inspectDatabase(filename, role) {
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 5000 });
  try {
    const quickCheck = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
    if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') throw new Error('SQLite quick_check failed');
    const schema = db.prepare("SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const required = role === 'players' ? { mobile_profiles: ['id', 'data'], mobile_rooms: ['id', 'owner', 'data'] } : { h5_sessions: ['token_hash', 'cookies', 'expires_at'] };
    for (const [table, columns] of Object.entries(required)) {
      const found = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      if (columns.some(column => !found.has(column))) throw new Error(`Database role ${role} is missing ${table} columns`);
    }
    const tables = schema.filter(item => item.type === 'table').map(item => ({ name: item.name, rows: db.prepare(`SELECT count(*) AS n FROM "${item.name.replaceAll('"', '""')}"`).get().n }));
    return {
      quickCheck: 'ok',
      userVersion: db.prepare('PRAGMA user_version').get().user_version,
      schemaVersion: db.prepare('PRAGMA schema_version').get().schema_version,
      applicationId: db.prepare('PRAGMA application_id').get().application_id,
      schema, tables,
    };
  } finally { db.close(); }
}

function associationCounts(playersFile, sessionsFile) {
  const db = new DatabaseSync(playersFile, { readOnly: true });
  const sessions = new DatabaseSync(sessionsFile, { readOnly: true });
  try {
    const names = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    const report = { note: 'Counts only; expired sessions and profiles created before a session are not corruption. These observations are not a cross-database transaction.', profiles: null, sessions: null, sessionsWithProfile: null, references: [] };
    if (!names.has('mobile_profiles')) return report;
    report.profiles = db.prepare('SELECT count(*) AS n FROM mobile_profiles').get().n;
    for (const [table, column] of [
      ['mobile_rooms', 'owner'], ['mobile_collection_wallets', 'owner'], ['mobile_collection_owned', 'owner'],
      ['mobile_collection_artworks', 'owner'], ['mobile_collection_ledger', 'owner'], ['mobile_collection_completions', 'owner'],
      ['mobile_task_gifts', 'owner'], ['mobile_social_players', 'owner'], ['mobile_settlements', 'owner'],
    ]) if (names.has(table)) report.references.push({ table, column, missingProfiles: db.prepare(`SELECT count(*) AS n FROM ${table} r LEFT JOIN mobile_profiles p ON p.id=r.${column} WHERE p.id IS NULL`).get().n });
    const sessionTable = sessions.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='h5_sessions'").get();
    if (sessionTable) {
      report.sessions = sessions.prepare('SELECT count(*) AS n FROM h5_sessions').get().n;
      const findProfile = db.prepare('SELECT 1 FROM mobile_profiles WHERE id=?');
      report.sessionsWithProfile = 0;
      for (const row of sessions.prepare('SELECT token_hash FROM h5_sessions').iterate()) if (findProfile.get(row.token_hash)) report.sessionsWithProfile++;
    }
    return report;
  } finally { sessions.close(); db.close(); }
}

/** Only the two explicit SQLite files are read; no directory/log/config archive is made. */
export async function createMobileDataBackup({ mobileDatabase = path.join(PROJECT, 'data/mobile-v3.sqlite'), sessionsDatabase = path.join(PROJECT, 'data/sessions.sqlite'), destination } = {}) {
  const sources = await Promise.all([mobileDatabase, sessionsDatabase].map(filename => checkedExisting(filename)));
  if (sources[0].filename === sources[1].filename || (sources[0].item.ino && sources[0].item.ino === sources[1].item.ino && sources[0].item.dev === sources[1].item.dev)) throw new Error('The player and session databases must be different files');
  const folder = await newDirectory(destination);
  const manifest = { format: FORMAT, createdAt: new Date().toISOString(), consistency: CONSISTENCY, files: [] };
  for (let index = 0; index < FILES.length; index++) {
    const { role, name } = FILES[index], source = new DatabaseSync(sources[index].filename, { readOnly: true, timeout: 5000 });
    const target = path.join(folder, name), startedAt = new Date().toISOString();
    try { await backup(source, target, { rate: 100 }); } finally { source.close(); }
    // Only the new copy is changed. A standalone DELETE-journal snapshot avoids
    // carrying WAL/SHM sidecars and prevents read-only validation creating them.
    const snapshot = new DatabaseSync(target);
    try {
      const mode = snapshot.prepare('PRAGMA journal_mode=DELETE').get();
      if (String(Object.values(mode)[0]).toLowerCase() !== 'delete') throw new Error('Could not make a standalone snapshot');
    } finally { snapshot.close(); }
    await chmod(target, 0o600);
    const item = await lstat(target);
    manifest.files.push({ role, name, startedAt, finishedAt: new Date().toISOString(), bytes: item.size, sha256: await sha256(target), database: inspectDatabase(target, role) });
  }
  manifest.associations = associationCounts(path.join(folder, FILES[0].name), path.join(folder, FILES[1].name));
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await verifyMobileDataBackup(folder);
  return { directory: folder, manifest };
}

export async function verifyMobileDataBackup(input) {
  const { filename: folder } = await checkedExisting(input, 'directory');
  const manifestFile = await checkedExisting(path.join(folder, 'manifest.json'));
  if (manifestFile.item.size > 4 * 1024 * 1024) throw new Error('Backup manifest exceeds 4 MiB');
  const manifest = JSON.parse(await readFile(manifestFile.filename, 'utf8'));
  if (manifest.format !== FORMAT || manifest.consistency?.crossDatabaseAtomic !== false || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length) throw new Error('Invalid mobile backup manifest');
  const entries = await readdir(folder);
  const allowed = new Set(['manifest.json', ...FILES.map(file => file.name)]);
  if (entries.some(name => !allowed.has(name)) || entries.length !== allowed.size) throw new Error('Backup directory must contain only the two databases and manifest');
  for (const [index, expected] of FILES.entries()) {
    const file = manifest.files[index];
    // Exact names, not an arbitrary manifest path, are the restore allowlist.
    if (file?.name !== expected.name || file.role !== expected.role || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid backup file path or metadata');
    const source = await checkedExisting(path.join(folder, expected.name));
    if (source.item.size !== file.bytes || await sha256(source.filename) !== file.sha256) throw new Error('Backup SHA-256 or size mismatch');
    const actual = inspectDatabase(source.filename, expected.role);
    if (JSON.stringify(actual) !== JSON.stringify(file.database)) throw new Error('Backup schema, row counts or version mismatch');
  }
  const associations = associationCounts(path.join(folder, FILES[0].name), path.join(folder, FILES[1].name));
  if (JSON.stringify(associations) !== JSON.stringify(manifest.associations)) throw new Error('Backup association counts mismatch');
  return manifest;
}

/** Isolation only: never stop a server, replace a database, or alter the source backup. */
export async function restoreMobileDataBackup({ backupDirectory, destination } = {}) {
  const source = await checkedExisting(backupDirectory, 'directory');
  const manifest = await verifyMobileDataBackup(source.filename);
  const folder = await newDirectory(destination);
  for (const file of manifest.files) {
    const target = path.join(folder, file.name);
    await copyFile(path.join(source.filename, file.name), target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    if (await sha256(target) !== file.sha256 || JSON.stringify(inspectDatabase(target, file.role)) !== JSON.stringify(file.database)) throw new Error('Restored database verification failed');
  }
  const associations = associationCounts(path.join(folder, FILES[0].name), path.join(folder, FILES[1].name));
  if (JSON.stringify(associations) !== JSON.stringify(manifest.associations)) throw new Error('Restored association counts mismatch');
  const report = { format: 'jigsaw-mobile-isolated-restore-v1', restoredAt: new Date().toISOString(), consistency: manifest.consistency, files: manifest.files.map(({ name, bytes, sha256, database }) => ({ name, bytes, sha256, quickCheck: database.quickCheck, userVersion: database.userVersion })), associations, status: 'verified-isolated-copy', productionSwitched: false };
  await writeFile(path.join(folder, 'restore-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: folder, report };
}

function argumentsOf(values) {
  const allowed = new Set(['--mobile-db', '--sessions-db', '--out', '--from']);
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!allowed.has(key) || typeof value !== 'string' || value.startsWith('--') || options[key]) throw new Error('Invalid, duplicate or missing command option');
    options[key] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...values] = process.argv.slice(2), args = argumentsOf(values);
    let result;
    if (command === 'backup' && args['--out'] && !args['--from']) result = await createMobileDataBackup({ mobileDatabase: args['--mobile-db'], sessionsDatabase: args['--sessions-db'], destination: args['--out'] });
    else if (command === 'verify' && args['--from'] && Object.keys(args).length === 1) result = await verifyMobileDataBackup(args['--from']);
    else if (command === 'restore' && args['--from'] && args['--out'] && Object.keys(args).length === 2) result = await restoreMobileDataBackup({ backupDirectory: args['--from'], destination: args['--out'] });
    else throw new Error('Usage: backup [--mobile-db FILE --sessions-db FILE] --out NEW_DIRECTORY | verify --from BACKUP_DIRECTORY | restore --from BACKUP_DIRECTORY --out NEW_ISOLATED_DIRECTORY');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
