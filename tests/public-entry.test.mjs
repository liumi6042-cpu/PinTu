import test from 'node:test';
import assert from 'node:assert/strict';
import {galleryEntry,PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE,USER_IMAGE_UPLOAD_VISIBLE} from '../lib/feature-visibility.ts';
test('public launch does not turn stale solo/private gallery links into personal games',()=>{
  assert.equal(PERSONAL_PLAY_VISIBLE,false);assert.equal(MEMBERSHIP_VISIBLE,false);
  for(const mode of [undefined,'public','solo','create','unknown'])assert.deepEqual(galleryEntry(mode),{entryMode:'public',guestPlay:false});
});
test('uploading your own picture is open to signed-in accounts while solo and membership stay hidden',()=>{
  assert.equal(USER_IMAGE_UPLOAD_VISIBLE,true);
});
