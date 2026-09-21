import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRANCE_BYPASS, ENTRANCE_COOKIE, entrancePaths, isEntrancePath, lobbyFor, skipsEntrance } from '../lib/entrance-preference.ts';

test('only a browser that has been in the lobby skips the entrance, and never a crawler', () => {
  for (const path of entrancePaths()) {
    assert.equal(skipsEntrance(path, false, '1'), true, path);
    // No cookie is what a crawler sends, and what a first-time visitor has.
    assert.equal(skipsEntrance(path, false, undefined), false, path);
    assert.equal(skipsEntrance(path, false, ''), false, path);
    assert.equal(skipsEntrance(path, false, '0'), false, path);
    // The brand link asks for the entrance on purpose.
    assert.equal(skipsEntrance(path, true, '1'), false, path);
  }
  // Nothing else moves, the lobby included.
  for (const path of ['/lobby', '/zh/lobby', '/gallery', '/zh/gallery', '/puzzle/lake', '/help', '/account', '/room/x']) {
    assert.equal(skipsEntrance(path, false, '1'), false, path);
  }
  assert.deepEqual(entrancePaths(), ['/', '/zh']);
  // Only these two addresses may vary by the cookie, which is what the cache headers hang on.
  for (const path of entrancePaths()) assert.equal(isEntrancePath(path), true, path);
  for (const path of ['/lobby', '/gallery', '/puzzle/lake', '/zh/gallery', '/']) assert.equal(isEntrancePath(path), path === '/', 'isEntrancePath ' + path);
  assert.equal(lobbyFor('/'), '/lobby');
  assert.equal(lobbyFor('/zh'), '/zh/lobby');
  assert.equal(ENTRANCE_BYPASS, 'home');
  assert.match(ENTRANCE_COOKIE, /^[a-z][a-z-]*$/);
});
