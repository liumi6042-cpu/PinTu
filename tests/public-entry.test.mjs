import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {galleryEntry,PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE,USER_IMAGE_UPLOAD_VISIBLE} from '../lib/feature-visibility.ts';
test('public launch does not turn stale solo/private gallery links into personal games',()=>{
  assert.equal(PERSONAL_PLAY_VISIBLE,false);assert.equal(MEMBERSHIP_VISIBLE,false);
  for(const mode of [undefined,'public','solo','create','unknown'])assert.deepEqual(galleryEntry(mode),{entryMode:'public',guestPlay:false});
});
test('uploading your own picture is open to signed-in accounts while solo and membership stay hidden',()=>{
  assert.equal(USER_IMAGE_UPLOAD_VISIBLE,true);
});
test('the picture upload entry lives in the gallery instead of personal space',async()=>{
  const [gallery,personal]=await Promise.all([
    readFile(new URL('../app/puzzle-app.tsx',import.meta.url),'utf8'),
    readFile(new URL('../app/personal/personal-space.tsx',import.meta.url),'utf8')
  ]);
  assert.match(gallery,/gallery-upload-entry/);
  assert.match(gallery,/href="\/personal\/images"/);
  assert.doesNotMatch(personal,/href="\/personal\/images"/);
});
