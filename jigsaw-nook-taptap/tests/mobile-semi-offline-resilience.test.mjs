import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createMobileService } from '../server/mobile-service.mjs';
import { PHOTOS, photoGuidance, gridForDimensions, placedCount, neighbors, snapTolerance } from '../outputs/mobile/engine.mjs';
import { isNetworkFailure, isServerUnavailable, isOfflineFallbackError } from '../lib/offline-play.ts';
import { RoomClient } from '../lib/room-client.ts';
import { makeRoom, addMember, applyAction, snapshot, PHOTO_IDS } from '../lib/room-engine.ts';
import { supportsPieceCount } from '../lib/piece-policy.ts';
import { createPuzzle } from '../lib/puzzle-engine.ts';
import {
  ROOM_CACHE_MAX,
  ROOM_CACHE_TTL_MS,
  applySoloDrop,
  saveCachedRoom,
  loadCachedRoom,
  listCachedRooms,
  removeCachedRoom,
  cachedRoomTicket,
  saveSoloOutbox,
  flushStoredSoloOutboxes,
} from '../lib/solo-play.ts';

const rid = () => randomBytes(16).toString('hex');
const identity = () => randomBytes(32).toString('hex');
const photo48 = PHOTOS.find(p => p.galleryVisible !== false && gridForDimensions(photoGuidance(p.id).width, photoGuidance(p.id).height, 48)?.count === 48);
const catalogImage = PHOTO_IDS.find(id => supportsPieceCount(id, 108));
const until = async condition => { for (let i = 0; i < 300; i++) { if (condition()) return; await turn(); } assert.fail('Timed out waiting for condition'); };
const memStorage = () => {
  const values = new Map();
  return { values, get: k => values.get(k) ?? null, set: (k, v) => values.set(k, v), remove: k => values.delete(k) };
};

function serverFixture(t, options = {}) {
  mkdirSync(resolve('work'), { recursive: true });
  const dir = mkdtempSync(resolve('work/mobile-semi-offline-'));
  const databasePath = resolve(dir, 'mobile.sqlite');
  let now = 1800000000000;
  const service = createMobileService({ databasePath, now: () => now, randomInt: (_min, max) => max - 1, ...options });
  const db = new DatabaseSync(databasePath);
  t.after(() => { db.close(); service.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (actor, url, body, token) => service.handle({ identity: actor, url, method: body === undefined ? 'GET' : 'POST', body, authorization: token ? 'Bearer ' + token : undefined });
  const ok = (...args) => { const reply = call(...args); assert.ok([200, 201].includes(reply.status), JSON.stringify(reply)); return reply.data; };
  const profile = actor => ok(actor, '/api/mobile/profile');
  const patch = (actor, changes) => {
    profile(actor);
    const p = JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);
    db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({ ...p, ...changes }), actor);
  };
  const player = () => {
    const actor = identity();
    patch(actor, { level: 50, xp: 20, totalXp: 12000, energy: 1000, energyAt: now, firstRoomCompleted: true, autoSupply: false });
    return actor;
  };
  const createRoom = actor => ok(actor, '/api/rooms', { mode: 'selected', imageId: photo48.id, pieces: 48, visibility: 'public', requestId: rid() });
  const joinRoom = (actor, roomId) => ok(actor, `/api/rooms/${roomId}/join`, {});
  const batch = (actor, ticket, ops) => ok(actor, `/api/rooms/${ticket.room.id}`, { type: 'batch', ops, requestId: rid() }, ticket.token);
  const rawRoom = roomId => JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(roomId).data);
  const advance = ms => { now += ms; };
  return { service, db, call, ok, profile, patch, player, createRoom, joinRoom, batch, rawRoom, advance, get now() { return now; } };
}

test('5xx errors trigger offline fallback without changing isNetworkFailure contract', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isNetworkFailure({ status }), false);
    assert.equal(isServerUnavailable({ status }), true);
    assert.equal(isOfflineFallbackError({ status }), true);
  }
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    assert.equal(isServerUnavailable({ status }), false);
    assert.equal(isOfflineFallbackError({ status }), false);
  }
  assert.equal(isOfflineFallbackError(new TypeError('Failed to fetch')), true);
  assert.equal(isOfflineFallbackError({ status: 0 }), true);
});

test('cached room snapshot store saves, evicts past max, expires, filters completed and prunes on recovery', async () => {
  const store = memStorage(), baseNow = 1000000;
  const makeSnap = (id, completedAt = null) => {
    const room = makeRoom(id, catalogImage, 108, baseNow);
    room.puzzle = createPuzzle('seaside', 12, 9, 42);
    room.completedAt = completedAt;
    addMember(room, 'b'.repeat(32), '玩家', 'd', baseNow);
    return snapshot(room, baseNow);
  };
  const ids = Array.from({ length: ROOM_CACHE_MAX + 2 }, (_, i) => (i + 1).toString(16).padStart(32, '0'));
  for (let i = 0; i < ids.length; i++) {
    saveCachedRoom(store, { v: 1, roomId: ids[i], playerId: 'b'.repeat(32), token: 'c'.repeat(32), snapshot: makeSnap(ids[i]), savedAt: baseNow + i * 1000 });
  }
  const listed = listCachedRooms(store, baseNow + 20000);
  assert.equal(listed.length, ROOM_CACHE_MAX);
  assert.equal(loadCachedRoom(store, ids[0], baseNow + 20000), null, 'oldest room evicted past ROOM_CACHE_MAX');
  assert.equal(listed[0].roomId, ids.at(-1), 'newest cached room listed first');
  const ticket = cachedRoomTicket(store, ids.at(-1), baseNow + 20000);
  assert.equal(ticket.cachedOffline, true);
  assert.equal(ticket.room.id, ids.at(-1));
  assert.equal(loadCachedRoom(store, ids.at(-1), baseNow + ROOM_CACHE_TTL_MS + 100000), null, 'expired entry pruned');

  const doneId = 'd'.repeat(32), activeId = 'e'.repeat(32);
  saveCachedRoom(store, { v: 1, roomId: doneId, playerId: 'b'.repeat(32), token: 'c'.repeat(32), snapshot: makeSnap(doneId, baseNow), savedAt: baseNow });
  saveCachedRoom(store, { v: 1, roomId: activeId, playerId: 'b'.repeat(32), token: 'c'.repeat(32), snapshot: makeSnap(activeId, null), savedAt: baseNow });
  assert.equal(listCachedRooms(store, baseNow + 100).some(e => e.roomId === doneId), false, 'completed snapshots excluded from resume list');
  saveSoloOutbox(store, { v: 1, roomId: activeId, playerId: 'b'.repeat(32), token: 'c'.repeat(32), ops: [{ requestId: rid(), groupId: 0, dx: 0, dy: 0, snapped: true }], savedAt: baseNow });
  await flushStoredSoloOutboxes({
    storage: store, now: () => baseNow + 200, randomId: rid,
    fetch: async (_url, init) => {
      const action = JSON.parse(init.body);
      return Response.json({ completedAt: baseNow + 200, soloBatch: { applied: [action.ops[0].requestId], skipped: [], stopped: null } });
    },
  });
  assert.equal(loadCachedRoom(store, activeId, baseNow + 200), null, 'completed recovery prunes cached room');
  removeCachedRoom(store, doneId);
});

test('server resolves monotonic retargeting when teammate merged or moved pieces while disconnected', t => {
  const f = serverFixture(t);
  const alice = f.player(), bob = f.player();
  const ticketA = f.createRoom(alice);
  const ticketB = f.joinRoom(bob, ticketA.room.id);
  const { cols, rows } = ticketA.room.puzzle;
  const p0 = 0, p1 = neighbors(p0, cols, rows)[0];
  // Alice joins p0 + p1 into one unlocked group away from the board.
  const g1 = ticketA.room.puzzle.groups.find(g => g.id === p1);
  f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'claim', groupId: p1 }, ticketA.token);
  f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'drop', groupId: p1, dx: 180, dy: 140, seq: 1, requestId: rid() }, ticketA.token);
  f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'claim', groupId: p0 }, ticketA.token);
  const joined = f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'drop', groupId: p0, dx: 180, dy: 140, seq: 1, requestId: rid() }, ticketA.token);
  const mergedGroup = joined.puzzle.groups.find(g => g.pieces.includes(p0) && g.pieces.includes(p1));
  assert.ok(mergedGroup && !mergedGroup.locked);

  // Bob was disconnected and locked p1 (old groupId p1, now inside mergedGroup) onto the board.
  const lockOp = { requestId: rid(), groupId: p1, dx: 0, dy: 0, pieceId: p1, snapKind: 'lock' };
  const reply = f.batch(bob, ticketB, [lockOp]);
  assert.deepEqual(reply.soloBatch.applied, [lockOp.requestId]);
  assert.deepEqual(reply.soloBatch.skipped, []);
  const after = reply.puzzle.groups.find(g => g.pieces.includes(p0) && g.pieces.includes(p1));
  assert.equal(after.locked, true, 'monotonic lock locks the entire teammate-merged group');
  assert.equal(reply.mobileContributions.length, 1);

  // Now Alice moves piece p2 to (220, 160), while Bob tries to join p3 onto p2 using stale coords.
  const p2 = cols * 2, p3 = neighbors(p2, cols, rows)[0];
  f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'claim', groupId: p2 }, ticketA.token);
  f.ok(alice, `/api/rooms/${ticketA.room.id}`, { type: 'drop', groupId: p2, dx: 220, dy: 160, seq: 1, requestId: rid() }, ticketA.token);
  const joinOp = { requestId: rid(), groupId: p3, dx: -50, dy: -50, pieceId: p3, snapKind: 'join', mergedPieces: [p2] };
  const joinReply = f.batch(bob, ticketB, [joinOp]);
  assert.deepEqual(joinReply.soloBatch.applied, [joinOp.requestId]);
  assert.ok(joinReply.puzzle.groups.some(g => g.pieces.includes(p2) && g.pieces.includes(p3)), 'join retargeted to teammate position');
});

test('server awards forgiving rewards without rollback, enforces anti-abuse and settles late completion', t => {
  const f = serverFixture(t);
  const alice = f.player(), bob = f.player(), carol = f.player();
  const ticketA = f.createRoom(alice);
  const ticketB = f.joinRoom(bob, ticketA.room.id);
  const { cols, rows } = ticketA.room.puzzle;
  const p0 = 0, p1 = neighbors(p0, cols, rows)[0];

  // Alice locks p0 & p1.
  f.batch(alice, ticketA, [
    { requestId: rid(), groupId: p0, dx: 0, dy: 0, pieceId: p0, snapKind: 'lock' },
    { requestId: rid(), groupId: p1, dx: 0, dy: 0, pieceId: p1, snapKind: 'lock' },
  ]);
  const bobBefore = f.profile(bob);

  // Bob (disconnected) also locked p0 and joined p0+p1 -> both rewarded forgivingly without rollback!
  const forgivingOps = [
    { requestId: rid(), groupId: p0, dx: 0, dy: 0, pieceId: p0, snapKind: 'lock' },
    { requestId: rid(), groupId: p1, dx: 10, dy: 10, pieceId: p1, snapKind: 'join', mergedPieces: [p0] },
  ];
  const res = f.batch(bob, ticketB, forgivingOps);
  assert.deepEqual(res.soloBatch, { applied: forgivingOps.map(o => o.requestId), skipped: [], stopped: null });
  assert.equal(res.mobileContributions.length, 2);
  assert.equal(res.mobileContributions[0].forgiving, true);
  assert.equal(res.mobileContributions[1].forgiving, true);
  assert.equal(res.profile.totalXp, bobBefore.totalXp + 2 * bobBefore.economy.contributionXp);
  assert.equal(res.profile.energy, bobBefore.energy - 2 * bobBefore.economy.contributionCost);
  assert.ok(res.profile.collection.coins > bobBefore.collection.coins);
  assert.equal(placedCount(res.puzzle), 2, 'board never rolls back');

  // Idempotent retry of the exact same batch never double-pays.
  const retry = f.batch(bob, ticketB, forgivingOps);
  assert.equal(retry.profile.totalXp, res.profile.totalXp);
  assert.equal(retry.profile.energy, res.profile.energy);

  // Anti-abuse 1: Bob sends a NEW requestId claiming forgiving lock on p0 again -> applied (no rollback) with ZERO extra reward!
  const dupOp = { requestId: rid(), groupId: p0, dx: 0, dy: 0, pieceId: p0, snapKind: 'lock' };
  const dupRes = f.batch(bob, ticketB, [dupOp]);
  assert.deepEqual(dupRes.soloBatch.applied, [dupOp.requestId]);
  assert.equal(dupRes.mobileContributions.length, 0);
  assert.equal(dupRes.profile.totalXp, res.profile.totalXp);
  assert.equal(dupRes.profile.energy, res.profile.energy);

  // Anti-abuse 2: Energy empty stops forgiving batch!
  const p2 = cols * 2;
  f.batch(alice, ticketA, [{ requestId: rid(), groupId: p2, dx: 0, dy: 0, pieceId: p2, snapKind: 'lock' }]);
  f.patch(bob, { energy: 0 });
  const emptyOp = { requestId: rid(), groupId: p2, dx: 0, dy: 0, pieceId: p2, snapKind: 'lock' };
  const stoppedRes = f.batch(bob, ticketB, [emptyOp]);
  assert.equal(stoppedRes.soloBatch.stopped.code, 'ENERGY_EMPTY');
  assert.equal(stoppedRes.soloBatch.applied.length, 0);
  f.patch(bob, { energy: 1000 });

  // Alice finishes the entire rest of the room while Bob is disconnected (Bob had 2 contributions < catalogMinimum).
  f.advance(5000);
  let snapA = f.ok(alice, `/api/rooms/${ticketA.room.id}`, undefined, ticketA.token);
  while (snapA.completedAt === null) {
    const ops = snapA.puzzle.groups.filter(g => !g.locked).slice(0, 40).map(g => ({ requestId: rid(), groupId: g.id, dx: 0, dy: 0, pieceId: g.pieces[0], snapKind: 'lock' }));
    snapA = f.batch(alice, ticketA, ops);
  }
  const aliceSettledEnergy = f.profile(alice).energy;
  const bobAfterComplete = f.profile(bob);

  // Anti-abuse 3: Carol joins AFTER completedAt -> cannot claim forgiving rewards!
  f.advance(1000);
  const ticketC = f.joinRoom(carol, ticketA.room.id);
  const carolOp = { requestId: rid(), groupId: p0, dx: 0, dy: 0, pieceId: p0, snapKind: 'lock' };
  const carolRes = f.batch(carol, ticketC, [carolOp]);
  assert.equal(carolRes.soloBatch.applied.length, 0);
  assert.equal(carolRes.soloBatch.skipped[0].code, 'CONFLICT');
  assert.equal(carolRes.mobileContributions.length, 0);

  // Late completion settlement: Bob reconnects and flushes 10 forgiving snaps (pieces 5..14) he finished while disconnected!
  const lateOps = Array.from({ length: 10 }, (_, idx) => {
    const pid = 5 + idx;
    return { requestId: rid(), groupId: pid, dx: 0, dy: 0, pieceId: pid, snapKind: 'lock' };
  });
  const lateRes = f.batch(bob, ticketB, lateOps);
  assert.equal(lateRes.soloBatch.applied.length, 10);
  assert.equal(lateRes.mobileContributions.length, 10);
  assert.equal(lateRes.mobileResult.contribution, 12, 'late settlement updates total contribution');
  assert.equal(lateRes.mobileResult.catalog.qualified, true, 'late settlement upgrades artwork qualification');
  assert.ok(lateRes.profile.collection.coins > bobAfterComplete.collection.coins, 'late completion pays coin delta');
  assert.equal(f.profile(alice).energy, aliceSettledEnergy, 'teammate already-paid energy pool is untouched');
});

test('RoomClient falls back to local play on multiplayer disconnect, captures failed drop, and syncs on reconnect', async t => {
  const roomId = 'a'.repeat(32), pA = 'b'.repeat(32), pB = 'd'.repeat(32), token = 'c'.repeat(32);
  const store = memStorage();
  const room = makeRoom(roomId, catalogImage, 108, Date.now());
  room.puzzle = createPuzzle('seaside', 12, 9, 123);
  const mA = addMember(room, pA, '甲', 'dA', Date.now());
  const mB = addMember(room, pB, '乙', 'dB', Date.now());
  let offline = false;
  let serial = 1;
  const randomId = () => (++serial).toString(16).padStart(32, '0');
  const batches = [];
  const fetch = async (_url, init) => {
    const action = init?.body ? JSON.parse(init.body) : null;
    if (offline) throw new TypeError('network down');
    if (action?.type === 'batch') {
      batches.push(action);
      const applied = [];
      for (const op of action.ops) {
        const g = room.puzzle.groups.find(group => group.pieces.includes(op.pieceId ?? op.groupId));
        if (g && !g.locked) {
          applyAction(room, mA, { type: 'claim', groupId: g.id }, Date.now());
          applyAction(room, mA, { type: 'drop', groupId: g.id, dx: 0, dy: 0, seq: 1 }, Date.now());
          room.revision++;
        }
        applied.push(op.requestId);
      }
      return Response.json({ ...snapshot(room, Date.now()), soloBatch: { applied, skipped: [], stopped: null }, mobileContributions: [] });
    }
    if (action && action.type !== 'leave') { applyAction(room, mA, action, Date.now()); room.revision++; }
    return Response.json(snapshot(room, Date.now()));
  };
  const client = new RoomClient({ token, playerId: pA, room: snapshot(room, Date.now()) }, {
    fetch, randomId, emit() {}, hidden: () => false, now: () => Date.now(), performanceNow: () => Date.now(),
    solo: { enabled: () => true, storage: store, energy: () => null },
  });
  const table = { network: null, networkReady: true, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { client.state = structuredClone(next); } };
  const detach = client.attach(table); t.after(detach);
  await until(() => !client.polling);
  assert.equal(client.localPlay, false, 'multiplayer starts in server-claim mode');

  // Claim piece 0 online, then network drops right before drop!
  assert.equal(await table.network.acquire(0), true);
  offline = true;
  await table.network.drop(0, 0, 0);
  await until(() => client.localPlay && client.pendingSoloOps === 1);
  assert.equal(client.offlineFallback, true);
  assert.equal(table.networkReady, true, 'board remains playable during multiplayer disconnect');
  assert.equal(client.state.groups.find(g => g.pieces.includes(0)).locked, true, 'failed in-flight drop was captured locally');

  // Keep puzzling piece 1 while completely offline!
  assert.equal(await table.network.acquire(1), true);
  await table.network.drop(1, 0, 0);
  assert.equal(client.pendingSoloOps, 2);

  // Teammate locks piece 0 on server after player A's lease expires while offline.
  if (room.leases[0]) room.leases[0].expires = Date.now() - 1;
  applyAction(room, mB, { type: 'claim', groupId: 0 }, Date.now());
  applyAction(room, mB, { type: 'drop', groupId: 0, dx: 0, dy: 0, seq: 1 }, Date.now());
  room.revision++;

  // Network recovers -> retryNow triggers poll + monotonic batch flush + clean exit back to multiplayer!
  offline = false;
  client.retryNow();
  await until(() => !client.localPlay && client.pendingSoloOps === 0 && client.connected);
  assert.equal(client.offlineFallback, false);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].ops.length, 2);
  assert.equal(batches[0].ops[0].snapKind, 'lock');
  assert.equal(room.puzzle.groups.find(g => g.pieces.includes(0)).locked, true);
  assert.equal(room.puzzle.groups.find(g => g.pieces.includes(1)).locked, true);
});

test('dedicated solo story room uses lazy sync, local completion triggers offline, and cachedOffline resumes cold-start', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const roomId = '1'.repeat(32), playerId = '2'.repeat(32), token = '3'.repeat(32);
  const store = memStorage();
  const room = makeRoom(roomId, catalogImage, 108, Date.now());
  room.puzzle = createPuzzle('seaside', 12, 9, 99);
  for (const g of room.puzzle.groups) if (g.id > 1) { g.dx = 0; g.dy = 0; g.locked = true; }
  const member = addMember(room, playerId, '玩家', 'd', Date.now());
  const levelSnap = { ...snapshot(room, Date.now()), levelId: 'ch1-1' };
  let offline = false, batchCount = 0;
  let serial = 1;
  const randomId = () => (++serial).toString(16).padStart(32, '0');
  const fetch = async (_url, init) => {
    if (offline) throw new TypeError('offline');
    const action = init?.body ? JSON.parse(init.body) : null;
    if (action?.type === 'batch') {
      batchCount++;
      const applied = [];
      for (const op of action.ops) {
        applyAction(room, member, { type: 'claim', groupId: op.groupId }, Date.now());
        applyAction(room, member, { type: 'drop', groupId: op.groupId, dx: op.dx, dy: op.dy, seq: 1 }, Date.now());
        room.revision++; applied.push(op.requestId);
      }
      return Response.json({ ...snapshot(room, Date.now()), levelId: 'ch1-1', soloBatch: { applied, skipped: [], stopped: null } });
    }
    if (action && action.type !== 'leave') { applyAction(room, member, action, Date.now()); room.revision++; }
    return Response.json({ ...snapshot(room, Date.now()), levelId: 'ch1-1' });
  };
  const client = new RoomClient({ token, playerId, room: levelSnap }, {
    fetch, randomId, emit() {}, hidden: () => false, now: () => Date.now(), performanceNow: () => Date.now(),
    solo: { enabled: () => true, storage: store, energy: () => null },
  });
  const table = { network: null, networkReady: true, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { client.state = structuredClone(next); } };
  const detach = client.attach(table); t.after(detach);
  await until(() => !client.polling);
  assert.ok(loadCachedRoom(store, roomId, Date.now()), 'unfinished online room is persisted to local cache');

  // Drop piece 0: dedicated solo story room waits 2500ms instead of 800ms!
  assert.equal(await table.network.acquire(0), true);
  await table.network.drop(0, 0, 0);
  t.mock.timers.tick(2499); await turn();
  assert.equal(batchCount, 0, 'lazy solo debounce does not flush before 2500ms');
  t.mock.timers.tick(1); await until(() => batchCount === 1 && client.pendingSoloOps === 0);

  // Drop final piece 1 while offline -> triggers local completion immediately!
  offline = true;
  assert.equal(await table.network.acquire(1), true);
  await table.network.drop(1, 0, 0);
  t.mock.timers.tick(0);
  await until(() => client.pendingCompletionSync);
  assert.notEqual(client.completedAt, null, 'local completion sets completedAt immediately while offline');
  assert.equal(client.snapshot.completedAt, null);

  // Network recovers -> server ACK upgrades completion & clears cache!
  offline = false;
  client.retryNow();
  t.mock.timers.tick(0);
  await until(() => client.snapshot.completedAt != null && !client.pendingCompletionSync);
  assert.equal(loadCachedRoom(store, roomId, Date.now()), null, 'completed room removed from local cache');

  // Cold-start cachedOffline resume works immediately even while offline!
  const coldId = '4'.repeat(32);
  const coldRoom = makeRoom(coldId, catalogImage, 108, Date.now());
  coldRoom.puzzle = createPuzzle('seaside', 12, 9, 77);
  addMember(coldRoom, playerId, '玩家', 'd', Date.now());
  saveCachedRoom(store, { v: 1, roomId: coldId, playerId, token, snapshot: snapshot(coldRoom, Date.now()), savedAt: Date.now() });
  const coldTicket = cachedRoomTicket(store, coldId, Date.now());
  const coldClient = new RoomClient(coldTicket, {
    fetch: async () => { throw new TypeError('server down'); },
    randomId, emit() {}, hidden: () => false, now: () => Date.now(), performanceNow: () => Date.now(),
    solo: { enabled: () => true, storage: store, energy: () => null },
  });
  const coldTable = { network: null, networkReady: false, fit() {}, cancelNetworkDrag() {}, playConnectionSound() {}, syncRemote(next) { coldClient.state = structuredClone(next); } };
  const detachCold = coldClient.attach(coldTable); t.after(detachCold);
  assert.equal(coldClient.localPlay, true);
  assert.equal(coldClient.offlineFallback, true);
  assert.equal(coldTable.networkReady, true);
  assert.equal(await coldTable.network.acquire(0), true);
  await coldTable.network.drop(0, 0, 0);
  assert.equal(coldClient.pendingSoloOps, 1);
  assert.equal(coldClient.state.groups.find(g => g.pieces.includes(0)).locked, true);
});
