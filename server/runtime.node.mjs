import { isAbsolute, resolve } from 'node:path';
import { SqliteD1 } from './sqlite.mjs';
import { cleanupPublicRooms } from './public-room-cleanup.mjs';

let database;
const names = [
  'PUZZLE_PUBLIC_ORIGIN', 'PUZZLE_OPERATOR_NAME', 'PUZZLE_SUPPORT_EMAIL',
  'PUZZLE_ADMIN_IDS', 'PUZZLE_BETA_CAPACITY', 'PUZZLE_FEEDBACK_ADMIN_URL',
  'PUZZLE_PRIVACY_REVIEWED', 'PUZZLE_ASSETS_REVIEWED',
  'FEEDBACK_URL', 'FEEDBACK_SITE_KEY', 'FEEDBACK_ORIGIN',
  'PUZZLE_BOT_SECRET',
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
    const botTimer=setInterval(()=>{
      const port=process.env.PORT||3000;
      const secret=process.env.PUZZLE_BOT_SECRET||'local-preview-bot-secret';
      void fetch(`http://127.0.0.1:${port}/api/internal/bots/tick`,{method:'POST',headers:{'x-puzzle-bot-secret':secret}}).catch(()=>{});
    },5000);
    botTimer.unref();
  }
  return database;
} });
