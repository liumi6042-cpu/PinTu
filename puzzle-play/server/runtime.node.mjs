import { isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { SqliteD1 } from './sqlite.mjs';
import { cleanupPublicRooms } from './public-room-cleanup.mjs';
import { createNodeManagedContent } from './managed-content.node.mjs';

let database;
const names = [
  'PUZZLE_PUBLIC_ORIGIN', 'PUZZLE_LOCAL_ORIGIN', 'PUZZLE_OPERATOR_NAME', 'PUZZLE_SUPPORT_EMAIL',
  'PUZZLE_ADMIN_IDS', 'PUZZLE_BETA_CAPACITY', 'PUZZLE_FEEDBACK_ADMIN_URL',
  'PUZZLE_PRIVACY_REVIEWED', 'PUZZLE_ASSETS_REVIEWED',
  'PUZZLE_REALTIME_ENABLED',
  'PUZZLE_DIAGNOSTIC_ACCOUNT_IDS',
  'FEEDBACK_URL', 'FEEDBACK_SITE_KEY', 'FEEDBACK_ORIGIN',
  'PUZZLE_BOT_SECRET', 'PUZZLE_BOTS_ENABLED',
];
// Server-only allowlist: never export the process environment to a client module.
export const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
// This function is evaluated once at each request entry; callers keep its immutable result.
// The standalone service uses the app root as WorkingDirectory, as migrations do.
// import.meta.url is unsuitable here because Vinext also bundles this module.
const managedContent=createNodeManagedContent({assetDir:existsSync(resolve('dist/client/puzzles'))?resolve('dist/client'):resolve('public')});
Object.defineProperty(env, 'PUZZLE_CONTENT_SNAPSHOT', { value: ()=>managedContent.read() });
Object.defineProperty(env, 'PUZZLE_DB', { get() {
  if (!database) {
    const filename = process.env.DATABASE_PATH;
    if (!filename || !isAbsolute(filename)) throw new Error('DATABASE_PATH must be absolute');
    database = new SqliteD1(filename, process.env.MIGRATIONS_DIR || resolve('drizzle'));
    const timer=setInterval(()=>{void cleanupPublicRooms(database).catch(()=>console.error('Public room maintenance failed'));},30000);
    timer.unref();
    // Bot rooms stay dormant while their placement logic is being redesigned.
    // The feature can be re-enabled later with PUZZLE_BOTS_ENABLED=true.
    if (process.env.PUZZLE_BOTS_ENABLED === 'true') {
      const botTimer=setInterval(()=>{
        const port=process.env.PORT||3000;
        const secret=process.env.PUZZLE_BOT_SECRET||'local-preview-bot-secret';
        const publicOrigin=process.env.PUZZLE_PUBLIC_ORIGIN;
        const headers=new Headers({'x-puzzle-bot-secret':secret});
        if(publicOrigin){
          const origin=new URL(publicOrigin);
          headers.set('host',origin.host);
          headers.set('x-forwarded-proto',origin.protocol.replace(':',''));
        }
        void fetch(`http://127.0.0.1:${port}/api/internal/bots/tick`,{method:'POST',headers}).catch(()=>{});
      },5000);
      botTimer.unref();
    }
  }
  return database;
} });
