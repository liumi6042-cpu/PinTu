import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readPendingAssets, pendingPreviewFile} from '../pending.mjs';
import {readSource, previewFile} from '../source.mjs';
import {analyzeDraft, buildCandidate, validateDraft} from '../model.mjs';
import {pendingDeliveryFiles,readDeliveredAssets} from '../delivery-status.mjs';
import {buildPublicAlbumDocument} from '../albums.mjs';
import {mediaPuzzlesDir} from '../project-layout.mjs';

const project = resolve(import.meta.dirname, '../..');
const game = join(project, 'jigsaw-nook-taptap');
const originalCatalog = JSON.parse(readFileSync(join(project, 'puzzle-play/content/puzzle-catalog.json'), 'utf8'));
const originalPhoto = originalCatalog.find(photo => photo.id === 'cel-coastal-family-v1');
const originalRecord = JSON.parse(readFileSync(join(game, 'content/image-provenance', originalPhoto.id + '.json'), 'utf8'));

function fixture(t, includeGameFacts = false) {
  const temp = realpathSync(tmpdir()), root = mkdtempSync(join(temp, 'jigsaw-pending-test-'));
  t.after(() => {assert.ok(root.startsWith(temp + sep)); rmSync(root, {recursive: true, force: true});});
  const pendingRoot = join(root, 'content-admin/work/pending-assets');
  mkdirSync(join(pendingRoot, 'images'), {recursive: true});
  const puzzlesRoot = mediaPuzzlesDir(project, game);
  const masterInfo = originalRecord.master?.format === 'webp' ? originalRecord.master : null;
  const masterSrcFile = join(puzzlesRoot, (masterInfo ? masterInfo.src : originalPhoto.src).slice('/puzzles/'.length));
  const masterRel = masterInfo ? 'images/original.webp' : 'images/original.png';
  copyFileSync(masterSrcFile, join(pendingRoot, masterRel));
  const source = {path: 'images/original.png', sha256: originalRecord.sha256, width: originalRecord.width, height: originalRecord.height,
    bytes: readFileSync(masterSrcFile).length,
    ...(masterInfo ? {master: {format: 'webp', quality: masterInfo.quality ?? 90, path: masterRel, sha256: masterInfo.sha256, bytes: masterInfo.bytes, width: masterInfo.width, height: masterInfo.height}} : {})};
  // Two delivery files since 2026-10-17; the playable file is the optimized one.
  const delivery = {sourceSha256: source.sha256};
  for (const kind of ['thumbnail', 'optimized']) {
    const old = originalRecord.delivery[kind], path = 'images/' + kind + '.webp';
    copyFileSync(join(puzzlesRoot, old.src.slice('/puzzles/'.length)), join(pendingRoot, path));
    delivery[kind] = {...old, path}; delete delivery[kind].src;
  }
  const asset = {id: 'pending-anime-new-v1', title: '新图', subtitle: '后台待整理', styleGroupId: 'anime', subjectTags: ['花园'], origin: 'project-ai-generated',
    source, generation: {threadId: 'test-generation-thread', native: {...source}, prompt: 'Actual fixture prompt', generatedAt: '2026-10-12T12:00:00+08:00', referencePaths: []},
    export: {originalPath: source.path, width: source.width, height: source.height, isUpscaled: false},
    review: {status: 'approved', reviewer: 'Fixture reviewer', reviewedAt: '2026-10-12T12:30:00+08:00', notes: '本测试仅验证入库边界。'}, delivery};
  const registry = {schema: 'jigsaw-pending-assets/v1', assets: [asset]};
  const save = () => writeFileSync(join(pendingRoot, 'registry.json'), JSON.stringify(registry));
  save();
  if (includeGameFacts) for (const name of ['puzzle-play', 'jigsaw-nook-taptap']) {
    const input = join(project, name), output = join(root, name), catalog = JSON.parse(readFileSync(join(input, 'content/puzzle-catalog.json'), 'utf8'));
    const files = ['content/puzzle-catalog.json', 'content/puzzle-guidance.json', 'lib/puzzle-catalog.ts', 'lib/daily-puzzle.ts', 'scripts/check-image-library.mjs', 'scripts/image-origin.mjs',
      ...(name === 'puzzle-play' ? ['lib/puzzle-journey.ts'] : ['lib/mobile-collection-catalog.json', 'server/mobile-collection.mjs', 'scripts/package-mobile-assets.mjs', 'h5/asset-manifest.json']),
      ...catalog.map(photo => 'content/image-provenance/' + photo.id + '.json')];
    for (const path of files) {mkdirSync(resolve(join(output, path), '..'), {recursive: true}); copyFileSync(join(input, path), join(output, path));}
    if(name==='jigsaw-nook-taptap'){
      const ids=new Set(originalCatalog.map(photo=>photo.id)),extraUrls=new Set(catalog.filter(photo=>!ids.has(photo.id)).flatMap(photo=>[photo.thumbSrc,photo.playSrc,photo.optimizedSrc]));
      for(const [path,value] of [
        ['content/puzzle-catalog.json',catalog.filter(photo=>ids.has(photo.id))],
        ['content/puzzle-guidance.json',Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(input,'content/puzzle-guidance.json'),'utf8'))).filter(([id])=>ids.has(id)))],
        ['h5/asset-manifest.json',JSON.parse(readFileSync(join(input,'h5/asset-manifest.json'),'utf8')).filter(url=>!extraUrls.has(url))],
      ])writeFileSync(join(output,path),JSON.stringify(value,null,2)+'\n');
    }
  }
  return {root, pendingRoot, registry, asset, save};
}

test('a private registry joins the CMS while keeping both runtime catalogs and candidate metadata unchanged', t => {
  const f = fixture(t, true), source = readSource(f.root), pending = source.assets.find(asset => asset.id === f.asset.id);
  assert.equal(source.assets.length, originalCatalog.length + 1);
  assert.equal(source.stats.pending, 1);
  assert.equal(source.stats.retained, originalCatalog.length);
  assert.equal(pending.lifecycle, 'pending'); assert.equal(pending.publishedAt, null);
  assert.deepEqual(pending.nativeResolution, {width: f.asset.source.width, height: f.asset.source.height});
  assert.deepEqual(source.baseline.assets[pending.id].subjectTags, ['花园']);
  assert.equal(source.baseline.assets[pending.id].styleGroupId, 'anime');
  for (const target of ['pc', 'mobile-shared']) assert.deepEqual(pending.targets[target], {status: 'draft', galleryVisible: false, dailyOnly: false, category: 'illustration'});
  const publicSource = JSON.stringify(source);
  assert.equal(publicSource.includes('original.png'), false); assert.equal(publicSource.includes('Actual fixture prompt'), false);
  assert.ok(previewFile(source, pending.id).endsWith('thumbnail.webp'));
  const document = structuredClone(source.baseline);
  document.assets[pending.id].title = '重新整理的新标题';
  document.assets[pending.id].subjectTags.push('春天');
  const analysis = analyzeDraft(document, source);
  assert.ok(analysis.blockers.some(issue => issue.target === 'pc' && issue.code === 'SHARED_ALBUM_RUNTIME_ADAPTER_REQUIRED'));
  assert.equal(analysis.blockers.some(issue => issue.target === 'mobile-shared'), false);
  assert.throws(() => buildCandidate(document, source, 'pc'), error => error.code === 'CANDIDATE_BLOCKED');
  const candidate = buildCandidate(document, source, 'mobile-shared');
  assert.equal(candidate.files.some(file => file.content.includes(pending.id)), false);
  assert.deepEqual(JSON.parse(candidate.files.find(file => file.path === 'content/puzzle-catalog.json').content), source._private.catalogs['mobile-shared']);
});

test('new artwork cannot be published or referenced by either runtime target before its adapter is ready', t => {
  const f = fixture(t, true), source = readSource(f.root), pendingId = f.asset.id;
  for (const target of ['pc', 'mobile-shared']) {
    for (const scenario of ['published', 'archived', 'album']) {
      const document = structuredClone(source.baseline);
      if (['published', 'archived'].includes(scenario)) document.assets[pendingId].targets[target].status = scenario;
      else document.albums[0].imageIds.push(pendingId);
      validateDraft(document, source);
      const analysis = analyzeDraft(document, source);
      assert.ok(analysis.blockers.some(issue => issue.target === target && issue.code === 'NEW_ASSET_RUNTIME_IMPORT_REQUIRED'));
      assert.equal(analysis.blockers.some(issue => issue.id === pendingId && issue.code === 'HISTORY_RETENTION_REQUIRED'), false);
      assert.throws(() => buildCandidate(document, source, target), error => error.code === 'CANDIDATE_BLOCKED');
    }
  }
});

test('provenance changes alter the fingerprint and tampered private previews fail closed', t => {
  const f = fixture(t, true), before = readSource(f.root);
  f.asset.review.notes = '再次核对来源'; f.save();
  const after = readSource(f.root);
  assert.notEqual(before.fingerprint, after.fingerprint);
  writeFileSync(join(f.pendingRoot, 'images/thumbnail.webp'), Buffer.from('not a registered image'));
  assert.throws(() => pendingPreviewFile(after._private.pending, f.asset.id), error => error.code === 'INVALID_PENDING_ASSET');
  assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
});

test('relative traversal, absolute paths, file size mismatches and duplicate IDs are rejected', t => {
  const f = fixture(t), good = structuredClone(f.registry);
  for (const mutate of [
    asset => {asset.source.path = '../original.png';}, asset => {asset.source.path = 'C:/outside.png';},
    asset => {if (asset.source.master) asset.source.master.bytes++; else asset.source.bytes++;}, asset => {asset.delivery.optimized.quality = 20;},
    asset => {asset.delivery.sourceSha256 = '0'.repeat(64);}, asset => {asset.delivery.optimized.lossless = true;},
  ]) {
    f.registry.assets = structuredClone(good.assets); mutate(f.registry.assets[0]); f.save();
    assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
  }
  f.registry.assets = [good.assets[0], structuredClone(good.assets[0])]; f.save();
  assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
});

test('new Q70 delivery is accepted alongside legacy Q84 while crossed encoder profiles are rejected', async t => {
  const f = fixture(t);
  assert.equal(readPendingAssets(f.root).assets.length, 1, 'legacy Q84 delivery remains readable');
  const sharp = createRequire(join(game, 'package.json'))('sharp');
  const sourceFile = join(f.pendingRoot, f.asset.source.master?.path ?? f.asset.source.path);
  const bytes = await sharp(readFileSync(sourceFile)).webp({quality: 70, effort: 6, smartSubsample: true}).toBuffer();
  const optimized = f.asset.delivery.optimized;
  writeFileSync(join(f.pendingRoot, optimized.path), bytes);
  optimized.bytes = bytes.length;
  optimized.sha256 = createHash('sha256').update(bytes).digest('hex');
  optimized.quality = 70;
  optimized.encoding = {...optimized.encoding, effort: 6, smartSubsample: true};
  delete optimized.effort;
  delete optimized.smartSubsample;
  f.save();
  assert.equal(readPendingAssets(f.root).byId.get(f.asset.id).delivery.optimized.quality, 70);
  assert.equal(pendingPreviewFile(readPendingAssets(f.root), f.asset.id, 'preview'), join(f.pendingRoot, optimized.path));
  for (const [quality, effort] of [[70, 5], [84, 6], [69, 6]]) {
    optimized.quality = quality;
    optimized.encoding.effort = effort;
    f.save();
    assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
  }
});

test('a directory junction cannot redirect a registered preview outside its private root', t => {
  const f = fixture(t), outside = join(f.root, 'outside');
  const sourceRel = f.asset.source.master?.path ?? f.asset.source.path;
  const leaf = sourceRel.split('/').at(-1);
  mkdirSync(outside); copyFileSync(join(f.pendingRoot, sourceRel), join(outside, leaf));
  symlinkSync(outside, join(f.pendingRoot, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  if (f.asset.source.master) f.asset.source.master.path = 'redirect/' + leaf;
  else { f.asset.source.path = 'redirect/' + leaf; f.asset.export.originalPath = f.asset.source.path; }
  f.save();
  assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
});

test('an absent registry preserves the original source without pending entries', t => {
  const f = fixture(t, true);
  rmSync(join(f.pendingRoot, 'registry.json'));
  const source = readSource(f.root);
  assert.equal(source.assets.length, originalCatalog.length); assert.equal(source.stats.pending, 0);
  assert.deepEqual(analyzeDraft(source.baseline, source).changes, []);
});

test('registered runtime imports preserve the source fingerprint; only verified dual delivery enables publication', t => {
  const f=fixture(t,true),before=readSource(f.root),id=f.asset.id;
  const kinds=['thumbnail','optimized'];
  const files=pendingDeliveryFiles(f.asset),byKind=Object.fromEntries(kinds.map(kind=>[kind,'/puzzles/'+f.asset.delivery[kind].path.split('/').at(-1)]));
  const photo={id,title:f.asset.title,origin:f.asset.origin,status:'archived',galleryVisible:false,src:'/puzzles/'+id+'.png',thumbSrc:byKind.thumbnail,playSrc:byKind.optimized,optimizedSrc:byKind.optimized};
  const record={id,origin:f.asset.origin,width:f.asset.source.width,height:f.asset.source.height,sha256:f.asset.source.sha256,delivery:{sourceSha256:f.asset.source.sha256,...Object.fromEntries(kinds.map(kind=>{const value={...f.asset.delivery[kind],src:byKind[kind]};delete value.path;return [kind,value];}))}};
  const put=(root,path,value)=>{const output=join(root,path);mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(value,null,2)+'\n');};
  const mobile=join(f.root,'jigsaw-nook-taptap'),web=join(f.root,'work/dual-managed-release-20261014');
  const catalog=JSON.parse(readFileSync(join(mobile,'content/puzzle-catalog.json'),'utf8'));
  put(mobile,'content/puzzle-catalog.json',[...catalog,photo]);put(mobile,'content/image-provenance/'+id+'.json',record);
  const guidance=JSON.parse(readFileSync(join(mobile,'content/puzzle-guidance.json'),'utf8'));guidance[id]={width:record.width,height:record.height};put(mobile,'content/puzzle-guidance.json',guidance);
  const manifest=JSON.parse(readFileSync(join(mobile,'h5/asset-manifest.json'),'utf8'));put(mobile,'h5/asset-manifest.json',[...manifest,...files.map(file=>file.url)]);
  const imported=readSource(f.root);
  assert.equal(imported.fingerprint,before.fingerprint);assert.deepEqual(imported.baseline,before.baseline);assert.equal(imported.assets.find(asset=>asset.id===id).runtimeAvailable,false);
  const receipt={schema:'jigsaw-delivered-assets/v1',webRelease:'20261014-test',mobileRelease:'content-test',verifiedAt:'2026-10-14T12:00:00Z',images:[{id,sourceSha256:record.sha256,files}]};
  put(f.root,'content-admin/work/delivered-assets.json',receipt);
  assert.throws(()=>readSource(f.root),'an unfulfilled receipt cannot make artwork available');
  put(web,'content/puzzle-catalog.json',[photo]);put(web,'content/image-provenance/'+id+'.json',record);
  for(const root of [web,mobile])for(const kind of kinds){mkdirSync(join(root,'public/puzzles'),{recursive:true});copyFileSync(join(f.pendingRoot,f.asset.delivery[kind].path),join(root,'public'+byKind[kind]));}
  const delivered=readSource(f.root),asset=delivered.assets.find(asset=>asset.id===id);
  assert.equal(asset.lifecycle,'pending');assert.equal(asset.runtimeAvailable,true);assert.equal(delivered.fingerprint,before.fingerprint);assert.deepEqual(delivered.baseline,before.baseline);
  const document=structuredClone(delivered.baseline);document.albums[0].imageIds.push(id);
  assert.ok(buildPublicAlbumDocument(document,delivered).albums[0].imageIds.includes(id));
  assert.equal(buildPublicAlbumDocument(document,imported).albums[0].imageIds.includes(id),false);
  document.assets[id].deleted=true;
  document.albums[0].imageIds=document.albums[0].imageIds.filter(value=>value!==id);
  assert.equal(buildPublicAlbumDocument(document,delivered).albums[0].imageIds.includes(id),false);
  writeFileSync(join(web,'public'+byKind.thumbnail),'corrupt');
  assert.throws(()=>readDeliveredAssets(f.root,delivered._private.pending),error=>error.code==='INVALID_DELIVERY_RECEIPT');
  put(mobile,'content/puzzle-catalog.json',[...catalog,{...photo,id:'unregistered-extra'}]);
  assert.throws(()=>readSource(f.root),/未在待整理登记/);
});
