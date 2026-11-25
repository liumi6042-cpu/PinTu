import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { randomPhoto } from '../lib/random-photo.ts';
import { PHOTOS, RESTORABLE_PHOTOS, RESTORABLE_PHOTO_IDS } from '../lib/puzzle-catalog.ts';
import { createPuzzle, restorePuzzle } from '../lib/puzzle-engine.ts';
import { makeRoom } from '../lib/room-engine.ts';
const catalog=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url),'utf8'));

test('random draw can reach every published picture, including both ends',()=>{
  const choices=PHOTOS.map((_,i)=>randomPhoto(PHOTOS,()=>(i+.5)/PHOTOS.length).id);
  assert.deepEqual(choices,PHOTOS.map(p=>p.id));
  assert.equal(randomPhoto(PHOTOS,()=>0).id,PHOTOS[0].id);
  assert.equal(randomPhoto(PHOTOS,()=>1-Number.EPSILON).id,PHOTOS.at(-1).id);
  assert.throws(()=>randomPhoto([]));
});

test('archived artwork restores progress but cannot create a new server room or enter random draws',()=>{
  const archived=RESTORABLE_PHOTOS.filter(p=>p.status==='archived');
  assert.ok(archived.length>0);
  const published=catalog.filter(photo=>['project-ai-generated','user-provided'].includes(photo.origin)&&photo.status==='published');
  const retired=catalog.filter(photo=>['project-ai-generated','user-provided'].includes(photo.origin)&&photo.status==='archived');
  assert.deepEqual(PHOTOS.map(photo=>photo.id),published.map(photo=>photo.id));
  assert.deepEqual(archived.map(photo=>photo.id),retired.map(photo=>photo.id));
  for(const photo of archived){
    assert.ok(!PHOTOS.some(p=>p.id===photo.id));
    const old=createPuzzle(photo.id,12,9);
    const restored=restorePuzzle(JSON.stringify(old),RESTORABLE_PHOTO_IDS);
    assert.equal(restored.imageId,photo.id);
    assert.equal(restored.groups.length,old.groups.length);
    assert.throws(()=>makeRoom('archive-test',photo.id,108,Date.now()));
  }
});
