import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedGameEntry} from '../lib/shared-game-entry.ts';
import {languageRedirect} from '../lib/entrance-preference.ts';

test('retired game views go directly to the shared UI in either language',()=>{
 for(const path of ['/lobby','/gallery','/albums','/tasks','/decorations','/personal','/personal/images','/achievements','/leaderboard','/courtyard','/wardrobe','/puzzle/lake']){
  for(const localized of [path,'/zh'+path]){
   for(const language of [null,'zh','en']){
    const destination=sharedGameEntry(localized,'?invite=abc&friend=def&ref=ghi')??languageRedirect(localized,language);
    assert.equal(destination,'/play?invite=abc&friend=def&ref=ghi',localized);
    assert.equal(sharedGameEntry('/play'),null);
    assert.equal(languageRedirect('/play',language),null);
   }
  }
 }
 assert.equal(sharedGameEntry('/zh/gallery/'),'/play');
 assert.equal(sharedGameEntry('/gallery','','HEAD'),'/play');
});
test('public home pages render unless a link carries a game invitation',()=>{
 for(const path of ['/','/zh']){
  assert.equal(sharedGameEntry(path),null);
  assert.equal(sharedGameEntry(path,'?utm_source=post'),null);
  assert.equal(sharedGameEntry(path,'?invite=friend-code&utm_source=post'),'/play?invite=friend-code&utm_source=post');
  assert.equal(sharedGameEntry(path,'?room=abc&roomInvite=code'),'/play?room=abc&roomInvite=code');
 }
});
test('old room bookmarks preserve invitation data and select their actual room',()=>{
 assert.equal(sharedGameEntry('/room/abc_123','?room=wrong&roomId=wrong&roomInvite=token&code=code'),'/play?room=abc_123&roomInvite=token&code=code');
 assert.equal(sharedGameEntry('/zh/room/abc-123','?invite=friend'),'/play?invite=friend&room=abc-123');
 assert.equal(sharedGameEntry('/room/bad%2Froom'),null);
});
test('service pages, mutation routes and immutable assets stay available',()=>{
 for(const path of ['/play','/account','/account/security','/account/recover','/membership','/membership/manage','/privacy','/terms','/feedback','/help','/zh/help','/admin','/api/rooms','/api/rooms/abc','/api/shared/config','/puzzles/lake-optimized.webp','/shared-client/build/game.js','/assets/icon.png'])assert.equal(sharedGameEntry(path),null,path);
 for(const method of ['POST','PATCH','DELETE'])assert.equal(sharedGameEntry('/room/abc','',method),null,method);
});
