import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkImageLibrary } from '../scripts/check-image-library.mjs';
import { PHOTOS, RESTORABLE_PHOTOS, PHOTO_IDS, FEATURED_PHOTOS, RETIRED_PHOTO_IDS } from '../lib/puzzle-catalog.ts';
import { makeRoom } from '../lib/room-engine.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJson=(path,value)=>writeFile(path,JSON.stringify(value));

async function fixture(t,id='winter-village'){
  const base=tmpdir(),dir=await mkdtemp(join(base,'puzzle-provenance-test-'));
  t.after(async()=>{
    const child=relative(base,dir);
    assert.ok(child.startsWith('puzzle-provenance-test-')&&!child.includes('..')&&!isAbsolute(child));
    await rm(dir,{recursive:true,force:true});
  });
  for(const path of ['content/image-provenance','content/image-prompts','public/puzzles'])await mkdir(join(dir,path),{recursive:true});
  const photo={...(await readJson(join(root,'content/puzzle-catalog.json'))).find(photo=>photo.id===id),status:'published'};
  await saveJson(join(dir,'content/puzzle-catalog.json'),[photo]);
  for(const path of ['content/image-provenance/'+id+'.json','content/image-prompts/'+id+'.txt','public/puzzles/'+id+'.png', 'public'+photo.playSrc, 'public'+photo.thumbSrc,'public'+photo.optimizedSrc,...(photo.standardSrc?['public'+photo.standardSrc,'public'+photo.optimizedStandardSrc]:[])])
    await copyFile(join(root,path),join(dir,path));
  if(photo.standardSrc)await cp(join(root,'content/artwork/gallery-hd',id),join(dir,'content/artwork/gallery-hd',id),{recursive:true});
  return dir;
}

test('all playable assets have matching original files, provenance and review records',async()=>{
  assert.deepEqual(await checkImageLibrary(root),{published:PHOTOS.length});
  const catalog=await readJson(join(root,'content/puzzle-catalog.json'));
  const published=catalog.filter(photo=>photo.origin==='project-ai-generated'&&photo.status==='published');
  assert.deepEqual(PHOTOS.map(photo=>photo.id),published.map(photo=>photo.id));
  assert.equal(PHOTOS.filter(photo=>photo.category==='动漫').length,5,'all five new anime pictures are published');
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
  const dir=await fixture(t),photo=RESTORABLE_PHOTOS.find(p=>p.id==='winter-village');
  await writeFile(join(dir,'public'+photo.playSrc),'broken webp');
  await assert.rejects(checkImageLibrary(dir),/衍生图片哈希不一致/);
});

test('HD project references, native regions and standard delivery are independently verified',async t=>{
  const id='mountain-lake-reflection-hd-v3',dir=await fixture(t,id),path=join(dir,'content/image-provenance',id+'.json'),original=await readJson(path);
  assert.deepEqual(await checkImageLibrary(dir),{published:1});
  const external=structuredClone(original);external.generation.referenceImages[0].origin='external';await saveJson(path,external);
  await assert.rejects(checkImageLibrary(dir),/本项目生成的参考图/);
  const changed=structuredClone(original);changed.composite.parts[0].sha256='0'.repeat(64);await saveJson(path,changed);
  await assert.rejects(checkImageLibrary(dir),/拼接分区来源不一致/);
  const standard=structuredClone(original);standard.delivery.standard.downsampled=false;await saveJson(path,standard);
  await assert.rejects(checkImageLibrary(dir),/小片数图片交付记录无效/);
});

test('optimized delivery validates source linkage, exact pixels, quality, hash and byte metadata',async t=>{
  const id='winter-village',dir=await fixture(t,id),path=join(dir,'content/image-provenance',id+'.json'),original=await readJson(path);
  assert.deepEqual(await checkImageLibrary(dir),{published:1});
  const cases=[
    ['quality',80,/压缩交付记录无效/],
    ['lossless',true,/压缩交付记录无效/],
    ['upscaled',true,/压缩交付记录无效/],
    ['sourceSha256','0'.repeat(64),/压缩交付原件关联无效/],
    ['inputSha256','0'.repeat(64),/压缩交付原件关联无效/],
    ['width',original.width+1,/不得改变来源像素尺寸/],
    ['bytes',original.delivery.optimized.bytes+1,/哈希或字节不一致/],
  ];
  for(const [key,value,pattern] of cases){
    const record=structuredClone(original);record.delivery.optimized[key]=value;await saveJson(path,record);
    await assert.rejects(checkImageLibrary(dir),pattern,key);
  }
  const encoding=structuredClone(original);encoding.delivery.optimized.encoding.effort=2;await saveJson(path,encoding);
  await assert.rejects(checkImageLibrary(dir),/压缩交付编码记录无效/);
  await saveJson(path,original);
  await writeFile(join(dir,'public'+original.delivery.optimized.src),'changed optimized data');
  await assert.rejects(checkImageLibrary(dir),/压缩交付哈希或字节不一致/);
});

test('optimized VP8 verification rejects lossless substitution, animation and forged canvas dimensions even with valid hashes',async t=>{
  const id='lemon-still-life-native-v2',dir=await fixture(t,id),recordPath=join(dir,'content/image-provenance',id+'.json'),original=await readJson(recordPath);
  const catalogPath=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(catalogPath),data=await readFile(join(dir,'public'+original.delivery.optimized.src));
  const frameAt=data.indexOf(Buffer.from('VP8 '),12);assert.ok(frameAt>=12);
  async function substitute(bytes,pattern){
    const record=structuredClone(original),nextCatalog=structuredClone(catalog),item=record.delivery.optimized;
    item.sha256=createHash('sha256').update(bytes).digest('hex');item.bytes=bytes.length;
    item.src=`/puzzles/${id}-optimized-${item.sha256.slice(0,12)}.webp`;nextCatalog[0].optimizedSrc=item.src;
    await writeFile(join(dir,'public'+item.src),bytes);await saveJson(recordPath,record);await saveJson(catalogPath,nextCatalog);
    await assert.rejects(checkImageLibrary(dir),pattern);
  }
  await substitute(await readFile(join(dir,'public'+original.delivery.play.src)),/静态 VP8 有损/);
  const animated=Buffer.concat([data,Buffer.from('ANIM\x00\x00\x00\x00','binary')]);animated.writeUInt32LE(animated.length-8,4);
  await substitute(animated,/静态 VP8 有损/);
  const malformed=Buffer.from(data);malformed.writeUInt32LE(data.length+100,4);
  await substitute(malformed,/静态 VP8 有损/);
  const invalidFrame=Buffer.from(data);invalidFrame[frameAt+8+3]=0;
  await substitute(invalidFrame,/静态 VP8 有损/);
  const actualResize=Buffer.from(data);actualResize.writeUInt16LE(original.width+1,frameAt+8+6);
  await substitute(actualResize,/不得改变来源像素尺寸/);
  const vp8x=Buffer.alloc(18);vp8x.write('VP8X',0,'ascii');vp8x.writeUInt32LE(10,4);vp8x.writeUIntLE(original.width-1,12,3);vp8x.writeUIntLE(original.height-1,15,3);
  const forged=Buffer.concat([actualResize.subarray(0,12),vp8x,actualResize.subarray(12)]);forged.writeUInt32LE(forged.length-8,4);
  await substitute(forged,/静态 VP8 有损/);
  const oversized=Buffer.alloc(2*1024*1024+1);data.copy(oversized);oversized.writeUInt32LE(oversized.length-8,4);
  await substitute(oversized,/超过体积预算/);
});

test('compact HD delivery is tied to exact standard pixels and its own source hash and budget',async t=>{
  const id='mountain-lake-reflection-hd-v3',dir=await fixture(t,id),recordPath=join(dir,'content/image-provenance',id+'.json'),original=await readJson(recordPath);
  const catalogPath=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(catalogPath);
  for(const [key,value,pattern] of [
    ['inputSha256',original.sha256,/原件关联无效/],
    ['downsampled',false,/压缩小图交付记录无效/],
    ['maximumPieces',5000,/压缩小图交付记录无效/],
    ['quality',88,/压缩交付记录无效/],
    ['height',original.delivery.compact.height-1,/不得改变来源像素尺寸/],
  ]){
    const record=structuredClone(original);record.delivery.compact[key]=value;await saveJson(recordPath,record);
    await assert.rejects(checkImageLibrary(dir),pattern,key);
  }
  const record=structuredClone(original),item=record.delivery.compact,data=Buffer.alloc(700*1024+1);
  item.bytes=data.length;item.sha256=createHash('sha256').update(data).digest('hex');item.src=`/puzzles/${id}-compact-${item.sha256.slice(0,12)}.webp`;
  catalog[0].optimizedStandardSrc=item.src;
  await saveJson(recordPath,record);await saveJson(catalogPath,catalog);await writeFile(join(dir,'public'+item.src),data);
  await assert.rejects(checkImageLibrary(dir),/超过体积预算/);
});

test('adding optimized delivery does not relax the original play lossless requirement',async t=>{
  const id='winter-village',dir=await fixture(t,id),recordPath=join(dir,'content/image-provenance',id+'.json'),record=await readJson(recordPath);
  record.delivery.play.lossless=false;await saveJson(recordPath,record);
  await assert.rejects(checkImageLibrary(dir),/游玩图片必须无损并保留原生尺寸/);
});
