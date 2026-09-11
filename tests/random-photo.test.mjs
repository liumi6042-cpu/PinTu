import test from 'node:test';
import assert from 'node:assert/strict';
import { randomPhoto } from '../lib/random-photo.ts';
import { PHOTOS, RESTORABLE_PHOTOS, RESTORABLE_PHOTO_IDS } from '../lib/puzzle-catalog.ts';
import { createPuzzle, restorePuzzle } from '../lib/puzzle-engine.ts';
import { makeRoom } from '../lib/room-engine.ts';

test('random draw can reach every published picture, including both ends',()=>{
  const choices=PHOTOS.map((_,i)=>randomPhoto(PHOTOS,()=>(i+.5)/PHOTOS.length).id);
  assert.deepEqual(choices,PHOTOS.map(p=>p.id));
  assert.equal(randomPhoto(PHOTOS,()=>0).id,PHOTOS[0].id);
  assert.equal(randomPhoto(PHOTOS,()=>1-Number.EPSILON).id,PHOTOS.at(-1).id);
  assert.throws(()=>randomPhoto([]));
});

test('archived artwork restores progress but cannot create a new server room or enter random draws',()=>{
  const archived=RESTORABLE_PHOTOS.filter(p=>p.status==='archived');
  assert.equal(PHOTOS.length,30);assert.equal(archived.length,10);
  for(const photo of archived){
    assert.ok(!PHOTOS.some(p=>p.id===photo.id));
    const old=createPuzzle(photo.id,12,9);
    const restored=restorePuzzle(JSON.stringify(old),RESTORABLE_PHOTO_IDS);
    assert.equal(restored.imageId,photo.id);
    assert.equal(restored.groups.length,old.groups.length);
    assert.throws(()=>makeRoom('archive-test',photo.id,108,Date.now()));
  }
});
