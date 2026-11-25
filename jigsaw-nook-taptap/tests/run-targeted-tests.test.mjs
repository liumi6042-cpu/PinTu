import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTestsForFiles, TEST_GROUPS} from '../scripts/run-targeted-tests.mjs';

test('panel module edits map to fast focused domain test groups instead of full suite', () => {
  const story = selectTestsForFiles(['mobile/panels/story-panel.ts']);
  assert.deepEqual(story.groups, ['story']);
  assert.ok(story.ts.includes('tests/mobile-story-comic.test.mjs'));
  assert.ok(!story.ts.includes('tests/mobile-tray-drag.test.mjs'));

  const board = selectTestsForFiles(['mobile/panels/room-hud-panel.ts']);
  assert.deepEqual(board.groups, ['board']);
  assert.ok(board.ts.includes('tests/mobile-tray-lock.test.mjs'));

  const completion = selectTestsForFiles(['mobile/panels/completion-panel.ts']);
  assert.deepEqual(completion.groups, ['completion']);
  assert.ok(completion.ts.includes('tests/mobile-completion-transition.test.mjs'));
  assert.ok(completion.plain.includes('tests/mobile-cheers.test.mjs'));
});

test('direct test file edits select that specific test file with accurate ts-register detection', () => {
  const direct = selectTestsForFiles(['jigsaw-nook-taptap/tests/mobile-redeem-client.test.mjs']);
  assert.deepEqual(direct.plain, []);
  assert.deepEqual(direct.ts, ['tests/mobile-redeem-client.test.mjs']);
});

test('every registered test group contains non-empty valid test entries', () => {
  for (const [name, entries] of Object.entries(TEST_GROUPS)) {
    assert.ok(entries.length > 0, `group ${name} must not be empty`);
    for (const entry of entries) {
      assert.match(entry.file, /^tests\/[\w.-]+\.test\.mjs$/);
      assert.equal(typeof entry.ts, 'boolean');
    }
  }
});
