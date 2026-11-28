// 零依赖本地服务：「团子去旅行 2.0」可玩原型 + 主游戏共享金币钱包直连（mobile_collection_wallets）
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const GAME_ROOT = resolve(ROOT, '../..');
const PORT = Number(process.env.PORT || 4178);
const DEFAULT_DB_PATH = resolve(GAME_ROOT, 'data/mobile-v3-preview/mobile.sqlite');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** 直接挂载主游戏同结构 SQLite 钱包表（mobile_collection_wallets + mobile_collection_ledger），不新建第二套货币 */
function openSharedWallet(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_collection_wallets(
      owner TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0),
      fragments INTEGER NOT NULL DEFAULT 0 CHECK(fragments>=0),
      equipped TEXT
    );
    CREATE TABLE IF NOT EXISTS mobile_collection_ledger(
      owner TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      coins INTEGER NOT NULL,
      fragments INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `.replace(
    // Match exact composite PK from server/mobile-collection.mjs
    'owner TEXT PRIMARY KEY NOT NULL,',
    'owner TEXT NOT NULL,',
  ).replace(
    'created_at INTEGER NOT NULL\n    );',
    'created_at INTEGER NOT NULL,\n      PRIMARY KEY(owner, source)\n    );',
  ));

  function resolveOwner() {
    // 优先绑定主游戏已有的真实本地账号，若主游戏尚未建号则复用统一预览账号
    const hasProfiles = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_profiles'").get();
    if (hasProfiles) {
      const p = db.prepare('SELECT id FROM mobile_profiles ORDER BY rowid DESC LIMIT 1').get();
      if (p?.id) return { owner: p.id, linkedMainProfile: true };
    }
    const existing = db.prepare('SELECT owner FROM mobile_collection_wallets ORDER BY rowid ASC LIMIT 1').get();
    if (existing?.owner) return { owner: existing.owner, linkedMainProfile: existing.owner !== 'local-preview-player' };
    const fallbackOwner = 'local-preview-player';
    db.prepare('INSERT OR IGNORE INTO mobile_collection_wallets(owner, coins, fragments, equipped) VALUES(?, 0, 0, NULL)').run(fallbackOwner);
    const seeded = db.prepare('INSERT OR IGNORE INTO mobile_collection_ledger VALUES(?, ?, ?, 0, ?)').run(fallbackOwner, 'preview:starter-coins', 180, Date.now());
    if (seeded.changes === 1) {
      db.prepare('UPDATE mobile_collection_wallets SET coins = coins + 180 WHERE owner = ?').run(fallbackOwner);
    }
    return { owner: fallbackOwner, linkedMainProfile: false };
  }

  function snapshot() {
    const { owner, linkedMainProfile } = resolveOwner();
    db.prepare('INSERT OR IGNORE INTO mobile_collection_wallets(owner, coins, fragments, equipped) VALUES(?, 0, 0, NULL)').run(owner);
    const row = db.prepare('SELECT coins, fragments FROM mobile_collection_wallets WHERE owner = ?').get(owner) || { coins: 0, fragments: 0 };
    const ledger = db.prepare('SELECT source, coins, created_at FROM mobile_collection_ledger WHERE owner = ? ORDER BY created_at DESC LIMIT 6').all(owner);
    return {
      ok: true,
      owner,
      coins: Number(row.coins) || 0,
      fragments: Number(row.fragments) || 0,
      linkedMainProfile,
      dbPath,
      ledger,
    };
  }

  function applyDelta(source, delta, now = Date.now()) {
    if (typeof source !== 'string' || !source.trim() || source.length > 512) {
      return { status: 400, data: { ok: false, code: 'INVALID_SOURCE', message: '无效流水标识' } };
    }
    if (!Number.isSafeInteger(delta)) {
      return { status: 400, data: { ok: false, code: 'INVALID_DELTA', message: '无效金币变动' } };
    }
    const { owner } = resolveOwner();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO mobile_collection_wallets(owner, coins, fragments, equipped) VALUES(?, 0, 0, NULL)').run(owner);
      const recorded = db.prepare('SELECT coins FROM mobile_collection_ledger WHERE owner = ? AND source = ?').get(owner, source);
      if (recorded) {
        db.exec('COMMIT');
        return { status: 200, data: { ...snapshot(), applied: false } };
      }
      const current = Number(db.prepare('SELECT coins FROM mobile_collection_wallets WHERE owner = ?').get(owner)?.coins ?? 0);
      if (current + delta < 0) {
        db.exec('ROLLBACK');
        return { status: 409, data: { ok: false, code: 'COINS_INSUFFICIENT', message: '主游戏金币不足，继续拼图即可积累', coins: current } };
      }
      db.prepare('INSERT INTO mobile_collection_ledger(owner, source, coins, fragments, created_at) VALUES(?, ?, ?, 0, ?)').run(owner, source, delta, now);
      db.prepare('UPDATE mobile_collection_wallets SET coins = coins + ? WHERE owner = ?').run(delta, owner);
      db.exec('COMMIT');
      return { status: 200, data: { ...snapshot(), applied: true } };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      return { status: 500, data: { ok: false, code: 'WALLET_ERROR', message: error.message } };
    }
  }

  return { snapshot, applyDelta, close: () => db.close() };
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export function createServer({ dbPath = process.env.MOBILE_DB || DEFAULT_DB_PATH } = {}) {
  const wallet = openSharedWallet(dbPath);
  const server = http.createServer(async (req, res) => {
    const cleanPath = (req.url || '/').split('?')[0];

    // 主游戏共享金币钱包桥接接口（读写同一张 mobile_collection_wallets 表）
    if (cleanPath === '/api/mobile/wallet' && req.method === 'GET') {
      sendJson(res, 200, wallet.snapshot());
      return;
    }
    if (cleanPath === '/api/mobile/wallet/apply' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const result = wallet.applyDelta(body.source, Number(body.delta));
        sendJson(res, result.status, result.data);
      } catch {
        sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求格式错误' });
      }
      return;
    }

    const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const full = resolve(join(ROOT, normalize(rel)));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const data = await readFile(full);
      res.writeHead(200, {
        'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  server.on('close', () => wallet.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Tuanzi Travel 2.0 Prototype running at http://127.0.0.1:${PORT}/`);
    console.log(`Shared main-game wallet DB: ${process.env.MOBILE_DB || DEFAULT_DB_PATH}`);
  });
}
