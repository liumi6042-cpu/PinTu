import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkImageLibrary, deliveryDimensions } from '../scripts/check-image-library.mjs';
import { PHOTOS, RESTORABLE_PHOTOS, PHOTO_IDS, FEATURED_PHOTOS, RETIRED_PHOTO_IDS } from '../lib/puzzle-catalog.ts';
import { makeRoom } from '../lib/room-engine.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJson=(path,value)=>writeFile(path,JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ONE={published:1,legacyDerivatives:0,artworkOverlay:{activeImages:0,files:0}};

async function fixture(t,id='winter-village'){
  const base=tmpdir(),dir=await mkdtemp(join(base,'puzzle-provenance-test-'));
  t.after(async()=>{
    const child=relative(base,dir);
    assert.ok(child.startsWith('puzzle-provenance-test-')&&!child.includes('..')&&!isAbsolute(child));
    await rm(dir,{recursive:true,force:true});
  });
  for(const path of ['content/image-provenance','public/puzzles'])await mkdir(join(dir,path),{recursive:true});
  const photo={...(await readJson(join(root,'content/puzzle-catalog.json'))).find(photo=>photo.id===id),status:'published'};
  await saveJson(join(dir,'content/puzzle-catalog.json'),[photo]);
  // Uniform delivery: the PNG original, one lossy optimized build (which playSrc points at) and a thumbnail.
  for(const path of ['content/image-provenance/'+id+'.json','public/puzzles/'+id+'.png','public'+photo.thumbSrc,'public'+photo.optimizedSrc])
    await copyFile(join(root,path),join(dir,path));
  const record=await readJson(join(root,'content/image-provenance',id+'.json'));
  if(record.composite)await cp(join(root,'content/artwork/gallery-hd',id),join(dir,'content/artwork/gallery-hd',id),{recursive:true});
  return dir;
}

test('all playable assets have matching originals and delivery records',async()=>{
  const result=await checkImageLibrary(root);
  assert.equal(result.published,PHOTOS.length);
  // Old-hash derivatives in public/puzzles are kept for older clients and counted, never silently ignored.
  const catalog=await readJson(join(root,'content/puzzle-catalog.json'));
  const ids=new Set(catalog.map(photo=>photo.id)),served=await readdir(join(root,'public/puzzles'));
  assert.ok(result.legacyDerivatives>0&&result.legacyDerivatives<served.length);
  const published=catalog.filter(photo=>['project-ai-generated','user-provided'].includes(photo.origin)&&photo.status==='published');
  assert.deepEqual(PHOTOS.map(photo=>photo.id),published.map(photo=>photo.id));
  assert.ok(PHOTOS.every(photo=>ids.has(photo.id)));
  assert.equal(new Set(FEATURED_PHOTOS.map(photo=>photo.id)).size,FEATURED_PHOTOS.length);
  assert.ok(FEATURED_PHOTOS.every(photo=>PHOTO_IDS.includes(photo.id)));
  for(const photo of RESTORABLE_PHOTOS.filter(photo=>photo.status==='archived')){
    assert.ok(!PHOTO_IDS.includes(photo.id));assert.throws(()=>makeRoom('withdrawn',photo.id,108,100000));
  }
  for(const id of PHOTO_IDS)assert.equal(makeRoom('catalog-test',id,108,100000).puzzle.imageId,id);
  for(const id of RETIRED_PHOTO_IDS)assert.throws(()=>makeRoom('retired-test',id,108,100000));
});

test('a story comic page in public/puzzles must be listed in runtime assets and named after its hash',async t=>{
  const dir=await fixture(t),bytes=await sharp({create:{width:96,height:64,channels:3,background:'#f5ecd8'}}).webp({quality:70}).toBuffer();
  const name='story-comic-ch3-01-page-'+sha(bytes).slice(0,12)+'.webp';
  await writeFile(join(dir,'public/puzzles',name),bytes);
  await mkdir(join(dir,'config'),{recursive:true});await saveJson(join(dir,'config/runtime-assets.json'),{static:[]});
  await assert.rejects(checkImageLibrary(dir),/漫画页未登记或内容不符/);
  await saveJson(join(dir,'config/runtime-assets.json'),{static:['/puzzles/'+name]});
  assert.deepEqual(await checkImageLibrary(dir),ONE);
  await writeFile(join(dir,'public/puzzles',name),Buffer.from(bytes).fill(0xff,bytes.length-8,bytes.length-4));
  await assert.rejects(checkImageLibrary(dir),/漫画页未登记或内容不符/);
});

test('an external-source catalog entry blocks publication',async t=>{
  const dir=await fixture(t),path=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(path);
  catalog[0].origin='external-demo';await saveJson(path,catalog);
  await assert.rejects(checkImageLibrary(dir),/禁止发布未登记来源的图片/);
});

// Owner decision 2026-10-23: every picture is the owner's own generation, so review status,
// prompts, generation tools and terms are not gated. The record must still describe this picture.
test('provenance details are not gated, but the record must match its catalog entry',async t=>{
  const dir=await fixture(t),path=join(dir,'content/image-provenance/winter-village.json'),original=await readJson(path);
  const relaxed=structuredClone(original);
  relaxed.review={status:'pending'};delete relaxed.generation;delete relaxed.commercialUse;
  await saveJson(path,relaxed);
  assert.deepEqual(await checkImageLibrary(dir),ONE);
  for(const [key,value] of [['id','another-picture'],['origin','user-provided']]){
    await saveJson(path,{...original,[key]:value});
    await assert.rejects(checkImageLibrary(dir),/图片记录与目录不一致/,key);
  }
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

test('old-hash derivatives are accepted only for pictures in the catalog',async t=>{
  const dir=await fixture(t),thumb=await readFile(join(dir,'public'+(await readJson(join(dir,'content/puzzle-catalog.json')))[0].thumbSrc));
  for(const kind of ['compact','optimized','play','thumbnail','standard'])
    await writeFile(join(dir,`public/puzzles/winter-village-${kind}-0123456789ab.webp`),thumb);
  assert.deepEqual(await checkImageLibrary(dir),{...ONE,legacyDerivatives:5});
  // A derivative-shaped name for a picture that is not in the catalog still fails.
  await writeFile(join(dir,'public/puzzles/unknown-picture-thumbnail-0123456789ab.webp'),thumb);
  await assert.rejects(checkImageLibrary(dir),/未登记或未审核素材：unknown-picture/);
  await rm(join(dir,'public/puzzles/unknown-picture-thumbnail-0123456789ab.webp'));
  // So does an unknown kind, a malformed hash, or a non-WebP payload under a valid name.
  for(const name of ['winter-village-poster-0123456789ab.webp','winter-village-thumbnail-0123.webp']){
    await writeFile(join(dir,'public/puzzles',name),thumb);
    await assert.rejects(checkImageLibrary(dir),/未登记或未审核素材/,name);
    await rm(join(dir,'public/puzzles',name));
  }
  await writeFile(join(dir,'public/puzzles/winter-village-play-0123456789ab.webp'),'not a webp');
  await assert.rejects(checkImageLibrary(dir),/WebP/);
});

test('a changed delivery image is rejected',async t=>{
  const dir=await fixture(t),photo=RESTORABLE_PHOTOS.find(p=>p.id==='winter-village');
  await writeFile(join(dir,'public'+photo.thumbSrc),'broken webp');
  await assert.rejects(checkImageLibrary(dir),/衍生图片哈希不一致/);
  await copyFile(join(root,'public'+photo.thumbSrc),join(dir,'public'+photo.thumbSrc));
  await writeFile(join(dir,'public'+photo.optimizedSrc),'broken webp');
  await assert.rejects(checkImageLibrary(dir),/压缩交付哈希或字节不一致/);
});

test('uniform delivery requires playSrc to point at the optimized build',async t=>{
  const dir=await fixture(t),path=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(path);
  await saveJson(path,[{...catalog[0],playSrc:'/puzzles/winter-village-play-0123456789ab.webp'}]);
  await assert.rejects(checkImageLibrary(dir),/统一交付须由 playSrc 指向 optimized/);
});

test('composite regions are verified against their recorded hashes',async t=>{
  const id='mountain-lake-reflection-hd-v3',dir=await fixture(t,id),path=join(dir,'content/image-provenance',id+'.json'),original=await readJson(path);
  assert.deepEqual(await checkImageLibrary(dir),ONE);
  const changed=structuredClone(original);changed.composite.parts[0].sha256='0'.repeat(64);await saveJson(path,changed);
  await assert.rejects(checkImageLibrary(dir),/拼接分区来源不一致/);
  const upscaled=structuredClone(original);upscaled.composite.finalUpscaling=true;await saveJson(path,upscaled);
  await assert.rejects(checkImageLibrary(dir),/拼接来源说明无效/);
});

test('a real Q70 effort6 optimized build within the pixel budget is accepted',async t=>{
  const id='winter-village',dir=await fixture(t,id),recordPath=join(dir,'content/image-provenance',id+'.json'),record=await readJson(recordPath);
  const catalogPath=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(catalogPath);
  const item=record.delivery.optimized,previous=item.src,target=deliveryDimensions(record.width,record.height);
  const bytes=await sharp(await readFile(join(dir,'public'+catalog[0].src))).resize(target.width,target.height).webp({quality:70,effort:6,smartSubsample:true}).toBuffer();
  item.sha256=sha(bytes);item.bytes=bytes.length;item.src=`/puzzles/${id}-optimized-${item.sha256.slice(0,12)}.webp`;
  item.quality=70;item.encoding={library:'sharp',version:sharp.versions.sharp,effort:6,smartSubsample:true};
  catalog[0].optimizedSrc=catalog[0].playSrc=item.src;
  if(previous!==item.src)await rm(join(dir,'public'+previous));await writeFile(join(dir,'public'+item.src),bytes);
  await saveJson(recordPath,record);await saveJson(catalogPath,catalog);
  assert.deepEqual(await checkImageLibrary(dir),ONE);
  const wrongPair=structuredClone(record);wrongPair.delivery.optimized.encoding.effort=5;
  await saveJson(recordPath,wrongPair);await assert.rejects(checkImageLibrary(dir),/压缩交付编码记录无效/);
});

test('the delivery pixel budget scales large originals and leaves small ones alone',()=>{
  assert.deepEqual(deliveryDimensions(1448,1086),{width:1448,height:1086});
  const scaled=deliveryDimensions(4096,4096);
  assert.ok(scaled.width*scaled.height<=6_553_600&&scaled.width===scaled.height);
});

test('optimized delivery validates source linkage, exact pixels, quality, hash and byte metadata',async t=>{
  const id='winter-village',dir=await fixture(t,id),path=join(dir,'content/image-provenance',id+'.json'),original=await readJson(path);
  assert.deepEqual(await checkImageLibrary(dir),ONE);
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
  const thumb=structuredClone(original);thumb.delivery.thumbnail.width+=1;await saveJson(path,thumb);
  await assert.rejects(checkImageLibrary(dir),/衍生图片尺寸不一致/);
});

test('optimized VP8 verification rejects lossless substitution, animation and forged canvas dimensions even with valid hashes',async t=>{
  const id='lemon-still-life-native-v2',dir=await fixture(t,id),recordPath=join(dir,'content/image-provenance',id+'.json'),original=await readJson(recordPath);
  const catalogPath=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(catalogPath),data=await readFile(join(dir,'public'+original.delivery.optimized.src));
  const frameAt=data.indexOf(Buffer.from('VP8 '),12);assert.ok(frameAt>=12);
  async function substitute(bytes,pattern){
    const record=structuredClone(original),nextCatalog=structuredClone(catalog),item=record.delivery.optimized;
    item.sha256=sha(bytes);item.bytes=bytes.length;
    item.src=`/puzzles/${id}-optimized-${item.sha256.slice(0,12)}.webp`;nextCatalog[0].optimizedSrc=nextCatalog[0].playSrc=item.src;
    await writeFile(join(dir,'public'+item.src),bytes);await saveJson(recordPath,record);await saveJson(catalogPath,nextCatalog);
    await assert.rejects(checkImageLibrary(dir),pattern);
    await rm(join(dir,'public'+item.src));
  }
  const lossless=await sharp({create:{width:original.width,height:original.height,channels:3,background:'#88aacc'}}).webp({lossless:true}).toBuffer();
  await substitute(lossless,/静态 VP8 有损/);
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

async function userProvidedFixture(t){
  const dir=await fixture(t),catalogPath=join(dir,'content/puzzle-catalog.json'),catalog=await readJson(catalogPath);
  const recordPath=join(dir,'content/image-provenance/winter-village.json'),source=await readJson(recordPath);
  const record={id:'winter-village',origin:'user-provided',width:source.width,height:source.height,sha256:source.sha256,
    nativeResolution:true,delivery:source.delivery};
  catalog[0].origin='user-provided';catalog[0].category='用户提供';
  await saveJson(catalogPath,catalog);await saveJson(recordPath,record);
  return {dir,catalogPath,recordPath};
}

test('a user-provided picture publishes without source, rights or generation records',async t=>{
  const {dir}=await userProvidedFixture(t);
  assert.deepEqual(await checkImageLibrary(dir),ONE);
});

test('a user-provided picture still requires a real PNG original and derived delivery',async t=>{
  const {dir,recordPath}=await userProvidedFixture(t),record=await readJson(recordPath);
  await copyFile(join(root,'public/puzzles/amber-cabinet.png'),join(dir,'public/puzzles/winter-village.png'));
  await assert.rejects(checkImageLibrary(dir),/图片与原始记录不一致/);
  await copyFile(join(root,'public/puzzles/winter-village.png'),join(dir,'public/puzzles/winter-village.png'));
  await writeFile(join(dir,'public'+record.delivery.thumbnail.src),'broken webp');
  await assert.rejects(checkImageLibrary(dir),/衍生图片哈希不一致/);
});

test('a user-provided picture cannot smuggle files into the puzzle directory',async t=>{
  const {dir}=await userProvidedFixture(t);
  await writeFile(join(dir,'public/puzzles/side-loaded.png'),'unregistered');
  await assert.rejects(checkImageLibrary(dir),/未登记或未审核素材/);
});

test('the build validator accepts both origins through one shared decision',async()=>{
  const { isPlayableOrigin, PLAYABLE_ORIGINS, isPublishedPlayable, isRetained }=await import('../scripts/image-origin.mjs');
  assert.deepEqual(PLAYABLE_ORIGINS,['project-ai-generated','user-provided']);
  assert.ok(isPlayableOrigin('project-ai-generated')&&isPlayableOrigin('user-provided'));
  for(const bad of [undefined,null,'','external','user-provided-style-reference','PROJECT-AI-GENERATED'])
    assert.ok(!isPlayableOrigin(bad),String(bad));
  assert.ok(isPublishedPlayable({origin:'user-provided',status:'published'}));
  assert.ok(!isPublishedPlayable({origin:'user-provided',status:'archived'}));
  assert.ok(isRetained({origin:'user-provided',status:'archived'}));
  assert.ok(!isRetained({origin:'external',status:'published'}));
});
