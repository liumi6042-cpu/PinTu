import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PUZZLE_TEST_URL || 'http://localhost:3000';
function client() {
  const cookies = new Map();
  return async (path, body, token) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '),
        ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie() };
  };
}

test('guests can play immediately, keep ownership after optional login, and appear in public timers and rankings',
  { skip: process.env.PUZZLE_TEST_LOCAL !== '1' }, async t => {
  const rooms = [], users = [], a = client(), b = client(), spectator = client();
  t.after(async () => {
    assert.ok([...rooms, ...users].every(id => /^[a-f0-9]{32}$/.test(id)));
    const quote = values => values.map(id => "'" + id + "'").join(',');
    const sql = [];
    if (rooms.length) for (const table of ['puzzle_results', 'puzzle_room_directory', 'puzzle_rooms'])
      sql.push(`DELETE FROM ${table} WHERE ${table === 'puzzle_rooms' ? 'id' : 'room_id'} IN (${quote(rooms)});`);
    if (users.length) {
      sql.push(`DELETE FROM puzzle_sessions WHERE user_id IN (${quote(users)});`);
      sql.push(`DELETE FROM puzzle_login_attempts WHERE username IN (SELECT username FROM puzzle_users WHERE id IN (${quote(users)}));`);
      sql.push(`DELETE FROM puzzle_users WHERE id IN (${quote(users)});`);
    }
    await mkdir(new URL('../work/', import.meta.url), { recursive: true });
    await writeFile(new URL('../work/guest-test-cleanup.sql', import.meta.url), sql.join('\n'));
  });
  const anonymous = client();
  assert.equal((await anonymous('/api/lobby')).status, 200);
  assert.equal((await anonymous('/api/leaderboard')).status, 200);
  const secret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const parallel = await Promise.all([a('/api/guest', { secret }), client()('/api/guest', { secret })]);
  for (const response of parallel) {
    assert.equal(response.status, 200);
    assert.match(response.cookies[0], /HttpOnly; SameSite=Strict/);
    assert.ok(response.cookies[0].startsWith('puzzle_guest=' + secret + ';'));
  }
  async function create(who, visibility) {
    const response = await who('/api/rooms', { visibility, imageId: 'blossom-canal', pieces:108 });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    rooms.push(response.data.room.id);
    return response.data;
  }
  const publicRoom = await create(a, 'public'), solo = await create(a, 'solo'), privateRoom = await create(a, 'private');
  const path = '/api/rooms/' + publicRoom.room.id;
  assert.equal(publicRoom.room.startedAt, null);
  const joined = await b(path + '/join', {});
  assert.equal(joined.status, 200);
  assert.equal(joined.data.room.members.length, 2);
  const [again, parallelJoin] = await Promise.all([b(path + '/join', {}), b(path + '/join', {})]);
  assert.equal(parallelJoin.status, 200);
  assert.equal((await b(path, { type: 'heartbeat' }, again.data.token)).status, 200);
  assert.equal((await b(path, { type: 'heartbeat' }, parallelJoin.data.token)).status, 200);
  assert.equal(again.data.playerId, joined.data.playerId);
  assert.equal(again.data.room.members.length, 2);
  const card = (await anonymous('/api/lobby')).data.rooms.find(room => room.id === publicRoom.room.id);
  assert.equal(card.players, 2); assert.equal(card.startedAt, null); assert.equal(card.elapsed, 0);
  for (const secretName of ['guestId', 'accountId', 'digest', secret]) assert.ok(!JSON.stringify(again.data.room).includes(secretName));
  assert.equal((await b('/api/rooms/' + solo.room.id + '/join', {})).status, 403);
  assert.equal((await b('/api/rooms/' + solo.room.id, undefined, solo.token)).status, 401);
  assert.equal((await a('/api/rooms/' + solo.room.id, { type: 'shuffle' }, solo.token)).status, 200);
  assert.equal((await spectator(path + '/join', {})).status, 200);

  async function finish(ticket, second) {
    const roomPath = '/api/rooms/' + ticket.room.id;
    let view = (await a(roomPath, undefined, ticket.token)).data, turn = 0;
    while (view.puzzle.groups.some(group => !group.locked)) {
      const group = view.puzzle.groups.find(group => !group.locked);
      const other = second && turn % 2 === 1, who = other ? b : a, token = other ? second.token : ticket.token;
      const claim = await who(roomPath, { type: 'claim', groupId: group.id }, token);
      assert.equal(claim.status, 200, JSON.stringify(claim.data));
      if (turn === 0 && ticket.room.id === publicRoom.room.id) {
        const started = (await anonymous('/api/lobby')).data.rooms.find(room => room.id === ticket.room.id);
        assert.ok(started.startedAt); assert.equal(started.players, 3);
      }
      const drop = await who(roomPath, { type: 'drop', groupId: group.id, dx: 0, dy: 0, seq: 1 }, token);
      assert.equal(drop.status, 200, JSON.stringify(drop.data)); view = drop.data; turn++;
    }
    assert.ok(view.completedAt); return view.completedAt - view.startedAt;
  }
  const elapsed = await finish(publicRoom, again.data);
  const board = await anonymous('/api/leaderboard?mode=team&imageId=blossom-canal&pieces=108&players=2');
  const result = board.data.entries.find(row => row.roomId === publicRoom.room.id);
  assert.equal(result.elapsedMs, elapsed); assert.equal(result.playerCount, 2);
  assert.equal(result.names.length, 2); assert.ok(result.names.every(name => /^游客 [A-F0-9]{4}$/.test(name)));

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const registered = await a('/api/auth/register', { username: 'guest_' + suffix, name: '测试游客转账号', password: 'test-password-' + suffix });
  assert.equal(registered.status, 201); users.push(registered.data.account.id);
  assert.equal((await a('/api/rooms/' + solo.room.id, undefined, solo.token)).status, 200);
  const soloAgain = await a('/api/rooms/' + solo.room.id + '/join', {});
  assert.equal(soloAgain.status, 200); assert.equal(soloAgain.data.playerId, solo.playerId);
  const accountSolo = await create(a, 'solo');
  const owned = (await a('/api/my-rooms')).data.rooms.map(room => room.id);
  assert.ok(owned.includes(solo.room.id)); assert.ok(owned.includes(accountSolo.room.id));
  assert.equal((await b('/api/rooms/' + accountSolo.room.id + '/join', {})).status, 403);
  assert.equal((await b('/api/rooms/' + accountSolo.room.id, undefined, accountSolo.token)).status, 401);
  await finish(privateRoom);
  const privateBoard = await anonymous('/api/leaderboard?mode=team&imageId=blossom-canal&pieces=108&players=1');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(privateRoom.room.id));
  const resultId = 'result:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  assert.ok(privateBoard.data.entries.some(row => row.roomId === resultId));
  assert.ok(!JSON.stringify(privateBoard.data).includes(privateRoom.room.id));
});
