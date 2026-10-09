import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localAddress } from './local-address.mjs';
import { parseEnv } from 'node:util';
import { createGateway } from './local-gateway.mjs';
import { monitorServer } from './local-health.mjs';
import { createBackup,pruneAutomatic } from './database-backup.mjs';
import { ensureLocalFeedback } from './ensure-local-feedback.mjs';
import { linkLocalAssets } from './link-local-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 3000;
const upstreamPort = 3002;
let activeServer,activeGateway,stopMonitor;
function stop(){stopMonitor?.();activeGateway?.close();activeServer?.kill('SIGTERM');}
const origin = `http://${localAddress()}:${port}`;
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: 'true',
  PUZZLE_LOCAL_BUILD: '1',
  PORT: String(upstreamPort),
  WRANGLER_WRITE_LOGS: 'false', MINIFLARE_REGISTRY_PATH: path.join(root,'.wrangler/registry'),
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
const wrangler = path.join(root,'node_modules/wrangler/bin/wrangler.js');

async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  await new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',code => code === 0 ? resolve() : reject(new Error(`本地准备失败（${code}）`)));
  });
}

async function main() {
  try { if(await ensureLocalFeedback(root))console.log('共用反馈后台已连接。');else console.warn('反馈后台尚未连接，拼图仍可正常游玩。'); }
  catch { console.warn('反馈后台未能启动，请检查本机反馈配置。拼图仍可正常游玩。'); }
  // Check this one fixed port; never silently connect to an unrelated server.
  const existing = await fetch(`http://127.0.0.1:${port}/api/connection`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
  if (existing?.ok) {
    const info = await existing.json().catch(() => null);
    if (info?.mode === 'local' && info?.app === 'together-puzzle') {
      console.log(`本地拼图已启动：${info.inviteOrigin}`);
      return;
    }
  }
  await new Promise((resolve,reject) => {
    const probe = createServer();
    probe.once('error',() => reject(new Error('3000 端口已被占用，请先关闭占用它的程序。')));
    probe.listen(port,'0.0.0.0',() => probe.close(resolve));
  });
  console.log('正在准备本地拼图，图片和房间数据都保存在这台电脑上…');
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(new Error('本地内部端口 3002 已被占用，请先关闭占用程序。')));probe.listen(upstreamPort,'127.0.0.1',()=>probe.close(resolve));});
  const firstBackup=await createBackup(root,{kind:'automatic'});if(firstBackup){await pruneAutomatic(root);console.log('更新前的数据库备份已校验。');}
  if (!process.argv.includes('--skip-build')) {
    await run([path.join(root,'node_modules/vinext/dist/cli.js'),'build']);
    await linkLocalAssets(root);
  }
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0000_puzzle_rooms.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0001_lobby_accounts.sql']);

  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0002_room_cursors.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0003_achievements.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0004_memberships.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0005_result_players.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0006_free_beta.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0008_personal_room_records.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0009_user_images.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0010_free_assistance.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0011_room_chat.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0014_piece_progress.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','scripts/upgrade-local-late-tables.sql']);
  // Node applies migration 0007 once through its ledger. Local startup uses an idempotent metadata backfill.
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','scripts/upgrade-public-retention.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','scripts/backfill-result-players.sql']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','scripts/upgrade-room-retention.sql']);

  const config = JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
  config.main = path.join(root,'dist/server/index.js');
  config.assets = { ...config.assets, directory: path.join(root,'dist/client') };
  config.vars = { ...config.vars, PUZZLE_LOCAL_ORIGIN: origin };
  try{const beta=parseEnv(await readFile(path.join(root,'.env.beta'),'utf8'));for(const key of ['PUZZLE_OPERATOR_NAME','PUZZLE_SUPPORT_EMAIL','PUZZLE_FEEDBACK_ADMIN_URL','PUZZLE_ADMIN_IDS','PUZZLE_BETA_CAPACITY','PUZZLE_PRIVACY_REVIEWED','PUZZLE_ASSETS_REVIEWED'])if(beta[key])config.vars[key]=beta[key];}catch{/* Optional local beta settings, never printed. */}
  try{const feedback=parseEnv(await readFile(path.join(root,'.env.feedback'),'utf8'));if(feedback.FEEDBACK_URL&&['localhost','127.0.0.1','[::1]'].includes(new URL(feedback.FEEDBACK_URL).hostname))config.vars={...config.vars,FEEDBACK_URL:feedback.FEEDBACK_URL,FEEDBACK_SITE_KEY:feedback.FEEDBACK_SITE_KEY};}catch{/* Feedback may be configured later without blocking local play. */}
  config.observability = { enabled: false };
  config.d1_databases = config.d1_databases.map(db => ({ ...db, remote: false }));
  await mkdir(path.join(root,'work/local-server'),{ recursive: true });
  const configPath = path.join(root,'work/local-server/wrangler.json');
  await writeFile(configPath,JSON.stringify(config,null,2));

  const server = spawn(process.execPath,[wrangler,'dev','--config',configPath,'--local','--ip','127.0.0.1','--port',String(upstreamPort),
    '--persist-to',path.join(root,'.wrangler/state'),'--log-level','warn'],{ cwd: root, env, stdio: 'inherit', windowsHide: true });
  activeServer=server;
  server.once('error',error => { console.error(error.message); process.exitCode = 1;stop(); });
  server.once('exit',code => { process.exitCode = code || 0;stopMonitor?.();activeGateway?.close(); });
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  for (let attempt=0;attempt<100;attempt++) {
    if (server.exitCode !== null) throw new Error('本地服务器未能启动。');
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/api/connection`,{ signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) {
      const gateway=createGateway({upstreamPort});activeGateway=gateway.server;
      await new Promise((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(port,'0.0.0.0',resolve);});
      stopMonitor=await monitorServer(root,gateway.metrics,server.pid,firstBackup);
      console.log(`\n本地拼图已就绪\n本机打开：http://localhost:${port}\n局域网邀请：${origin}\n在公开大厅加入拼图后，可将房间内的链接给同一局域网的朋友。\n保留此窗口即可游玩，按 Ctrl+C 停止服务器。`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve,300));
  }
  server.kill('SIGTERM');
  throw new Error('本地服务器启动超时，请查看上方提示。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1;stop(); });
