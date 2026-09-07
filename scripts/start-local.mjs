import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localAddress } from './local-address.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 3000;
const origin = `http://${localAddress()}:${port}`;
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: 'true',
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
  if (!process.argv.includes('--skip-build')) await run([path.join(root,'node_modules/vinext/dist/cli.js'),'build']);
  await run([wrangler,'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file','drizzle/0000_puzzle_rooms.sql']);

  const config = JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
  config.main = path.join(root,'dist/server/index.js');
  config.assets = { ...config.assets, directory: path.join(root,'dist/client') };
  config.vars = { ...config.vars, PUZZLE_LOCAL_ORIGIN: origin };
  config.observability = { enabled: false };
  config.d1_databases = config.d1_databases.map(db => ({ ...db, remote: false }));
  await mkdir(path.join(root,'work/local-server'),{ recursive: true });
  const configPath = path.join(root,'work/local-server/wrangler.json');
  await writeFile(configPath,JSON.stringify(config,null,2));

  const server = spawn(process.execPath,[wrangler,'dev','--config',configPath,'--local','--ip','0.0.0.0','--port',String(port),
    '--persist-to',path.join(root,'.wrangler/state'),'--log-level','warn'],{ cwd: root, env, stdio: 'inherit', windowsHide: true });
  server.once('error',error => { console.error(error.message); process.exitCode = 1; });
  server.once('exit',code => { process.exitCode = code || 0; });
  process.once('SIGINT',() => server.kill('SIGINT'));
  process.once('SIGTERM',() => server.kill('SIGTERM'));
  for (let attempt=0;attempt<100;attempt++) {
    if (server.exitCode !== null) throw new Error('本地服务器未能启动。');
    const response = await fetch(`http://127.0.0.1:${port}/api/connection`,{ signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) {
      console.log(`\n本地拼图已就绪\n本机打开：http://localhost:${port}\n局域网邀请：${origin}\n创建房间后，将房间内的邀请链接给同一局域网的朋友。\n保留此窗口即可游玩，按 Ctrl+C 停止服务器。`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve,300));
  }
  server.kill('SIGTERM');
  throw new Error('本地服务器启动超时，请查看上方提示。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
