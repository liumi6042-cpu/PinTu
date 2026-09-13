import test from 'node:test';
import assert from 'node:assert/strict';
import {galleryEntry,PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE} from '../lib/feature-visibility.ts';
test('public launch does not turn stale solo/private gallery links into personal games',()=>{
  assert.equal(PERSONAL_PLAY_VISIBLE,false);assert.equal(MEMBERSHIP_VISIBLE,false);
  for(const mode of [undefined,'public','solo','create','unknown'])assert.deepEqual(galleryEntry(mode),{entryMode:'public',guestPlay:false});
});
