import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkImageLibrary } from '../scripts/check-image-library.mjs';
import { PHOTOS, PHOTO_IDS, FEATURED_PHOTOS, RETIRED_PHOTO_IDS } from '../lib/puzzle-catalog.ts';
import { makeRoom } from '../lib/room-engine.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJson=(path,value)=>writeFile(path,JSON.stringify(value));

async function fixture(t){
  const base=tmpdir(),dir=await mkdtemp(join(base,'puzzle-provenance-test-'));
  t.after(async()=>{
    const child=relative(base,dir);
    assert.ok(child.startsWith('puzzle-provenance-test-')&&!child.includes('..')&&!isAbsolute(child));
    await rm(dir,{recursive:true,force:true});
  });
  for(const path of ['content/image-provenance','content/image-prompts','public/puzzles'])await mkdir(join(dir,path),{recursive:true});
  const photo=(await readJson(join(root,'content/puzzle-catalog.json'))).find(photo=>photo.id==='winter-village');
  await saveJson(join(dir,'content/puzzle-catalog.json'),[photo]);
  for(const path of ['content/image-provenance/winter-village.json','content/image-prompts/winter-village.txt','public/puzzles/winter-village.png', 'public'+photo.playSrc, 'public'+photo.thumbSrc])
    await copyFile(join(root,path),join(dir,path));
  return dir;
}

test('all playable assets have matching original files, provenance and review records',async()=>{
  assert.deepEqual(await checkImageLibrary(root),{published:PHOTOS.length});
  assert.equal(PHOTOS.length,20);
  assert.equal(FEATURED_PHOTOS.length,8);assert.equal(new Set(FEATURED_PHOTOS.map(photo=>photo.id)).size,8);
  assert.ok(FEATURED_PHOTOS.every(photo=>PHOTO_IDS.includes(photo.id)));
  for(const id of PHOTO_IDS)assert.equal(makeRoom('catalog-test',id,108,100000).puzzle.imageId,id);
  for(const id of RETIRED_PHOTO_IDS)assert.throws(()=>makeRoom('retired-test',id,108,100000));
});

test('an external-source catalog entry blocks publication',async t=>{
  const dir=await fixture(t),path=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(path);
  catalog[0].origin='external-demo';await saveJson(path,catalog);
  await assert.rejects(checkImageLibrary(dir),/禁止发布外部来源图片/);
});

test('an unreviewed asset blocks publication',async t=>{
  const dir=await fixture(t),path=join(dir,'content/image-provenance/winter-village.json'),record=await readJson(path);
  record.review.status='pending';await saveJson(path,record);
  await assert.rejects(checkImageLibrary(dir),/审核记录缺失/);
});

test('a new artwork cannot use the legacy missing-prompt exception',async t=>{
  const dir=await fixture(t),path=join(dir,'content/image-provenance/winter-village.json'),record=await readJson(path);
  record.generation.promptPath=null;record.generation.legacyPromptUnavailable=true;await saveJson(path,record);
  await assert.rejects(checkImageLibrary(dir),/缺少原始提示词/);
});

test('substituting an asset without updating its original record is rejected',async t=>{
  const dir=await fixture(t);
  await copyFile(join(root,'public/puzzles/amber-cabinet.png'),join(dir,'public/puzzles/winter-village.png'));
  await assert.rejects(checkImageLibrary(dir),/图片与原始记录不一致/);
});

test('unregistered files cannot be served from the puzzle directory',async t=>{
  const dir=await fixture(t);
  await writeFile(join(dir,'public/puzzles/external-demo.jpg'),'unapproved fixture');
  await assert.rejects(checkImageLibrary(dir),/未登记或未审核素材/);
});


test('a changed delivery image cannot bypass provenance checks',async t=>{
  const dir=await fixture(t),photo=PHOTOS.find(p=>p.id==='winter-village');
  await writeFile(join(dir,'public'+photo.playSrc),'broken webp');
  await assert.rejects(checkImageLibrary(dir),/衍生图片哈希不一致/);
});
