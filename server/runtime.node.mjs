import { isAbsolute, resolve } from 'node:path';
import { SqliteD1 } from './sqlite.mjs';
import { cleanupPublicRooms } from './public-room-cleanup.mjs';

let database;
const names = [
  'PUZZLE_PUBLIC_ORIGIN', 'PUZZLE_OPERATOR_NAME', 'PUZZLE_SUPPORT_EMAIL',
  'PUZZLE_ADMIN_IDS', 'PUZZLE_BETA_CAPACITY', 'PUZZLE_FEEDBACK_ADMIN_URL',
  'PUZZLE_PRIVACY_REVIEWED', 'PUZZLE_ASSETS_REVIEWED',
  'FEEDBACK_URL', 'FEEDBACK_SITE_KEY', 'FEEDBACK_ORIGIN',
];
// Server-only allowlist: never export the process environment to a client module.
export const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
Object.defineProperty(env, 'PUZZLE_DB', { get() {
  if (!database) {
    const filename = process.env.DATABASE_PATH;
    if (!filename || !isAbsolute(filename)) throw new Error('DATABASE_PATH must be absolute');
    database = new SqliteD1(filename, process.env.MIGRATIONS_DIR || resolve('drizzle'));
    const timer=setInterval(()=>{void cleanupPublicRooms(database).catch(()=>console.error('Public room maintenance failed'));},30000);
    timer.unref();
  }
  return database;
} });
