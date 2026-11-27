import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';
import { SqliteD1 } from '../server/sqlite.mjs';
import { DEFAULT_GAME_SETTINGS } from '../server/game-settings.mjs';
import { DEFAULT_TASK_REWARD_SETTINGS } from '../server/task-reward-settings.mjs';
import { newManagedProfile } from '../lib/managed-economy-model.mjs';
import { RoomClient } from '../lib/room-client.ts';
import { makeRoom, addMember, applyAction, snapshot, PHOTO_IDS } from '../lib/room-engine.ts';
import { createPuzzle, neighbors } from '../lib/puzzle-engine.ts';
import { supportsPieceCount } from '../lib/piece-policy.ts';
import { applyRoomBatch } from '../lib/room-batch.ts';
import { saveCachedRoom, loadCachedRoom, cachedRoomTicket } from '../lib/solo-play.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
globalThis.__sharedClientEnv = { PUZZLE_LOCAL_ORIGIN: 'http://localhost', PUZZLE_BETA_CAPACITY: '0' };
const built = await build({
  absWorkingDir: root,
  stdin: {
    contents: 'export {sharedClientApi} from "./lib/shared-client-api";export * from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";',
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  plugins: [{
    name: 'test-platform',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const env=globalThis.__sharedClientEnv;', loader: 'js' }));
    },
  }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const rid = () => randomBytes(16).toString('hex');
const hash = v => createHash('sha256').update(v).digest('hex');
const owner = 'a'.repeat(32), peer = 'b'.repeat(32), stranger = 'e'.repeat(32);
const ownerToken = 'c'.repeat(64), peerToken = 'd'.repeat(64), strangerToken = 'f'.repeat(64);
const origin = 'http://localhost';
const until = async cond => { for (let i = 0; i < 300; i++) { if (cond()) return; await turn(); } assert.fail('Timed out'); };
const memStorage = () => {
  const m = new Map();
  return { m, get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v), remove: k => m.delete(k) };
};

function sharedFixture() {
  const db = new SqliteD1(':memory:', fileURLToPath(new URL('../drizzle/', import.meta.url))), now = Date.now();
  globalThis.__sharedClientEnv.PUZZLE_DB = db;
  for (const [id, secret, name] of [[owner, ownerToken, '甲'], [peer, peerToken, '乙'], [stranger, strangerToken, '丙']]) {
    db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(id, id, name, 'hash', 'salt', now);
    db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(secret), id, now + 86400000);
  }
  const photos = api.RESTORABLE_PHOTOS.slice(0, 2).map(p => ({ ...p, width: 1200, height: 900 }));
  const free = { id: 'free', title: '免费相册', description: '', showOnPc: true, showOnMobile: true, purchasable: false, price: 0, imageIds: [photos[0].id, photos[1].id], milestones: [] };
  const game = structuredClone(DEFAULT_GAME_SETTINGS), rewards = structuredClone(DEFAULT_TASK_REWARD_SETTINGS);
  game.energy.contributionXp = 3;
  game.collection.contributionCoins = 5;
  game.collection.catalogMinimumContributions = 5;
  const contentSnapshot = { releaseId: 'web-batch-test', gameSettings: game, taskRewards: rewards, albums: { albums: [free] }, photos, dailyRuntime: { select: () => photos[0], managedImageIds: () => new Set(), releasedImageIds: () => new Set(), albumEntries: () => [] } };
  globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT = () => contentSnapshot;
  for (const id of [owner, peer, stranger]) {
    db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(id, JSON.stringify(newManagedProfile()), now);
  }
  const req = async (path, { method = 'GET', body, cookie = ownerToken, headers = {} } = {}) => {
    const response = await api.sharedClientApi(new Request(origin + '/api/shared' + path, {
      method,
      headers: { Cookie: 'puzzle_session=' + cookie, Origin: origin, ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    }), path.split('?')[0]);
    return { status: response.status, data: await response.json() };
  };
  const stored = id => JSON.parse(db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(id).data);
  return { db, req, photos, stored, close() { db.close(); delete globalThis.__sharedClientEnv.PUZZLE_DB; } };
}

test('Web shared API advertises soloLocalPlay, supports monotonic batch, forgiving rewards and late completion upgrade', async () => {
  assert.equal(api.SHARED_CAPABILITIES.soloLocalPlay, true);
  assert.equal(api.sharedConfig(origin).capabilities.soloLocalPlay, true);
  const f = sharedFixture();
  try {
    const made = await f.req('/api/rooms', { method: 'POST', body: { mode: 'selected', imageId: f.photos[0].id, pieces: 108, visibility: 'public' } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const roomId = made.data.room.id, path = '/api/rooms/' + roomId;
    const hA = { Authorization: 'Bearer ' + made.data.token };
    const joined = await f.req(path + '/join', { method: 'POST', cookie: peerToken, body: {} });
    assert.equal(joined.status, 200);
    const hB = { Authorization: 'Bearer ' + joined.data.token };

    // Alice batches 3 locks -> XP & coins credited, idempotent replay never double-credits.
    const opsA = [0, 1, 2].map(id => ({ requestId: rid(), groupId: id, dx: 0, dy: 0, pieceId: id, snapKind: 'lock' }));
    const resA = await f.req(path, { method: 'POST', headers: hA, body: { type: 'batch', requestId: rid(), ops: opsA } });
    assert.equal(resA.status, 200, JSON.stringify(resA.data));
    assert.deepEqual(resA.data.soloBatch, { applied: opsA.map(o => o.requestId), skipped: [], stopped: null });
    assert.equal(resA.data.mobileContributions.length, 3);
    assert.equal(f.stored(owner).totalXp, 9);
    assert.equal(f.stored(owner).coins, 15);
    const retryA = await f.req(path, { method: 'POST', headers: hA, body: { type: 'batch', requestId: rid(), ops: opsA } });
    assert.equal(retryA.status, 200);
    assert.equal(f.stored(owner).totalXp, 9);

    // Bob (disconnected) also locks piece 0 & 1 -> forgiving rewards granted, board never rolls back!
    const opsB = [0, 1].map(id => ({ requestId: rid(), groupId: id, dx: 0, dy: 0, pieceId: id, snapKind: 'lock' }));
    const resB = await f.req(path, { method: 'POST', cookie: peerToken, headers: hB, body: { type: 'batch', requestId: rid(), ops: opsB } });
    assert.equal(resB.status, 200, JSON.stringify(resB.data));
    assert.deepEqual(resB.data.soloBatch.applied, opsB.map(o => o.requestId));
    assert.equal(resB.data.mobileContributions.length, 2);
    assert.equal(resB.data.mobileContributions[0].forgiving, true);
    assert.equal(f.stored(peer).totalXp, 6);
    assert.equal(f.stored(peer).coins, 10);

    // Anti-abuse: Bob cannot double-claim piece 0 with a fresh requestId.
    const dupB = await f.req(path, { method: 'POST', cookie: peerToken, headers: hB, body: { type: 'batch', requestId: rid(), ops: [{ requestId: rid(), groupId: 0, dx: 0, dy: 0, pieceId: 0, snapKind: 'lock' }] } });
    assert.equal(dupB.status, 200);
    assert.equal(f.stored(peer).totalXp, 6);

    // Alice finishes remaining 105 pieces so room completes while Bob only has 2 contributions (< catalogMinimum 5).
    let snap = (await f.req(path, { headers: hA })).data;
    while (snap.completedAt === null) {
      const remaining = snap.puzzle.groups.filter(g => !g.locked).slice(0, 40).map(g => ({ requestId: rid(), groupId: g.id, dx: 0, dy: 0, pieceId: g.pieces[0], snapKind: 'lock' }));
      const next = await f.req(path, { method: 'POST', headers: hA, body: { type: 'batch', requestId: rid(), ops: remaining } });
      assert.equal(next.status, 200);
      snap = (await f.req(path, { headers: hA })).data;
    }
    assert.ok(snap.completedAt);
    assert.equal(f.stored(peer).artworks[f.photos[0].id], undefined, '2 contributions not yet enough for artwork');
    const peerCoinsAtComplete = f.stored(peer).coins;

    // Stranger joins AFTER completedAt -> forgiving batch rejected with CONFLICT!
    const joinedC = await f.req(path + '/join', { method: 'POST', cookie: strangerToken, body: {} });
    const hC = { Authorization: 'Bearer ' + joinedC.data.token };
    const resC = await f.req(path, { method: 'POST', cookie: strangerToken, headers: hC, body: { type: 'batch', requestId: rid(), ops: [{ requestId: rid(), groupId: 0, dx: 0, dy: 0, pieceId: 0, snapKind: 'lock' }] } });
    assert.equal(resC.status, 200);
    assert.equal(resC.data.soloBatch.skipped[0].code, 'CONFLICT');
    assert.equal(f.stored(stranger).totalXp, 0);

    // Bob reconnects and flushes 4 more forgiving locks (total 6 >= 5) -> late completion upgrades coins & artwork!
    const lateOpsB = [3, 4, 5, 6].map(id => ({ requestId: rid(), groupId: id, dx: 0, dy: 0, pieceId: id, snapKind: 'lock' }));
    const lateB = await f.req(path, { method: 'POST', cookie: peerToken, headers: hB, body: { type: 'batch', requestId: rid(), ops: lateOpsB } });
    assert.equal(lateB.status, 200, JSON.stringify(lateB.data));
    assert.equal(lateB.data.soloBatch.applied.length, 4);
    assert.ok(f.stored(peer).coins > peerCoinsAtComplete + 4 * 5, 'late completion pays completion coin delta beyond per-snap coins');
    assert.ok(Array.isArray(f.stored(peer).artworks[f.photos[0].id]), 'late completion unlocks catalog artwork');
  } finally {
    f.close();
  }
});

test('Classic Web RoomClient supports opt-in solo batch, multiplayer disconnect fallback, and cached offline resume', async t => {
  const catalogImage = PHOTO_IDS.find(id => supportsPieceCount(id, 108));
  const roomId = '1'.repeat(32), pA = '2'.repeat(32), pB = '3'.repeat(32), token = '4'.repeat(32);
  const store = memStorage();
  const room = makeRoom(roomId, catalogImage, 108, Date.now());
  room.puzzle = createPuzzle('seaside', 12, 9, 42);
  const mA = addMember(room, pA, '甲', 'dA', Date.now(), 'acc-a');
  const mB = addMember(room, pB, '乙', 'dB', Date.now(), 'acc-b');
  let offline = false;
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async (_url, init) => {
    if (offline) throw new TypeError('offline');
    const action = init?.body ? JSON.parse(init.body) : null;
    if (action?.type === 'batch') {
      const batchRes = applyRoomBatch(room, mA, action, Date.now());
      room.revision++;
      return Response.json({ ...snapshot(room, Date.now()), soloBatch: batchRes.soloBatch });
    }
    if (action && action.type !== 'leave') { applyAction(room, mA, action, Date.now()); room.revision++; }
    return Response.json(snapshot(room, Date.now()));
  };

  // Default 1-arg RoomClient stays in classic mode without solo local play.
  const classic = new RoomClient({ token, playerId: pA, room: snapshot(room, Date.now()) });
  const classicTable = { network: null, networkReady: true, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { classic.state = structuredClone(next); } };
  const detachClassic = classic.attach(classicTable);
  assert.equal(classic.localPlay, false);
  detachClassic();

  // Opt-in { solo: true, storage } enters disconnected local play when multiplayer drops, captures failed drop, and syncs on recovery!
  const client = new RoomClient({ token, playerId: pA, room: snapshot(room, Date.now()) }, { solo: true, storage: store });
  const table = { network: null, networkReady: true, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { client.state = structuredClone(next); } };
  const detach = client.attach(table); t.after(detach);
  await until(() => loadCachedRoom(store, roomId, Date.now()) !== null);
  assert.equal(client.localPlay, false);

  assert.equal(await table.network.acquire(0), true);
  offline = true;
  await table.network.drop(0, 0, 0);
  await until(() => client.localPlay && client.pendingSoloOps === 1);
  assert.equal(client.offlineFallback, true);
  assert.equal(table.networkReady, true);

  // Teammate locks piece 0 on server after player A's lease expires while offline; we lock piece 1 locally.
  if (room.leases[0]) room.leases[0].expires = Date.now() - 1;
  applyAction(room, mB, { type: 'claim', groupId: 0 }, Date.now());
  applyAction(room, mB, { type: 'drop', groupId: 0, dx: 0, dy: 0, seq: 1 }, Date.now());
  room.revision++;
  assert.equal(await table.network.acquire(1), true);
  await table.network.drop(1, 0, 0);
  assert.equal(client.pendingSoloOps, 2);

  // Reconnect -> flushes batch (piece 0 forgivingly rewarded, piece 1 locked on server) and exits local play cleanly.
  offline = false;
  client.flushSoloNow();
  await until(() => !client.localPlay && client.pendingSoloOps === 0 && client.connected);
  assert.equal(room.achievements.contributors['acc-a'].count, 2, 'forgiving piece 0 + normal piece 1 both credited');
  assert.equal(room.puzzle.groups.find(g => g.pieces.includes(1)).locked, true);

  // Cold-start cachedOffline resume works while server is unreachable.
  const cached = cachedRoomTicket(store, roomId, Date.now());
  assert.equal(cached.cachedOffline, true);
  offline = true;
  const cold = new RoomClient(cached, { solo: true, storage: store });
  const coldTable = { network: null, networkReady: false, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { cold.state = structuredClone(next); } };
  const detachCold = cold.attach(coldTable); t.after(detachCold);
  assert.equal(cold.localPlay, true);
  assert.equal(cold.offlineFallback, true);
  assert.equal(coldTable.networkReady, true);
});
