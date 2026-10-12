import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {readPendingAssets, pendingPreviewFile} from '../pending.mjs';
import {readSource, previewFile} from '../source.mjs';
import {analyzeDraft, buildCandidate, validateDraft} from '../model.mjs';

const project = resolve(import.meta.dirname, '../..');
const game = join(project, 'jigsaw-nook-taptap');
const originalCatalog = JSON.parse(readFileSync(join(game, 'content/puzzle-catalog.json'), 'utf8'));
const originalPhoto = originalCatalog.find(photo => photo.id === 'cel-coastal-family-v1');
const originalRecord = JSON.parse(readFileSync(join(game, 'content/image-provenance', originalPhoto.id + '.json'), 'utf8'));

function fixture(t, includeGameFacts = false) {
  const temp = realpathSync(tmpdir()), root = mkdtempSync(join(temp, 'jigsaw-pending-test-'));
  t.after(() => {assert.ok(root.startsWith(temp + sep)); rmSync(root, {recursive: true, force: true});});
  const pendingRoot = join(root, 'content-admin/work/pending-assets');
  mkdirSync(join(pendingRoot, 'images'), {recursive: true});
  const source = {path: 'images/original.png', sha256: originalRecord.sha256, width: originalRecord.width, height: originalRecord.height,
    bytes: readFileSync(join(game, 'public', originalPhoto.src)).length};
  copyFileSync(join(game, 'public', originalPhoto.src), join(pendingRoot, source.path));
  const delivery = {sourceSha256: source.sha256};
  for (const kind of ['thumbnail', 'play', 'optimized']) {
    const old = originalRecord.delivery[kind], path = 'images/' + kind + '.webp';
    copyFileSync(join(game, 'public', old.src), join(pendingRoot, path));
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
  assert.deepEqual(analyzeDraft(document, source).blockers, []);
  for (const target of ['pc', 'mobile-shared']) {
    const candidate = buildCandidate(document, source, target);
    assert.equal(candidate.files.some(file => file.content.includes(pending.id)), false);
    assert.deepEqual(JSON.parse(candidate.files.find(file => file.path === 'content/puzzle-catalog.json').content), source._private.catalogs[target]);
  }
});

test('new artwork cannot be published or referenced by either runtime target before its adapter is ready', t => {
  const f = fixture(t, true), source = readSource(f.root), pendingId = f.asset.id;
  for (const target of ['pc', 'mobile-shared']) {
    for (const scenario of ['published', 'archived', 'album']) {
      const document = structuredClone(source.baseline);
      if (['published', 'archived'].includes(scenario)) document.assets[pendingId].targets[target].status = scenario;
      else document.targets[target].albums[0].imageIds.push(pendingId);
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
    asset => {asset.source.bytes++;}, asset => {asset.delivery.optimized.quality = 20;},
    asset => {asset.delivery.sourceSha256 = '0'.repeat(64);}, asset => {asset.delivery.play.lossless = false;},
  ]) {
    f.registry.assets = structuredClone(good.assets); mutate(f.registry.assets[0]); f.save();
    assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
  }
  f.registry.assets = [good.assets[0], structuredClone(good.assets[0])]; f.save();
  assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
});

test('a directory junction cannot redirect a registered preview outside its private root', t => {
  const f = fixture(t), outside = join(f.root, 'outside');
  mkdirSync(outside); copyFileSync(join(f.pendingRoot, f.asset.source.path), join(outside, 'original.png'));
  symlinkSync(outside, join(f.pendingRoot, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  f.asset.source.path = 'redirect/original.png'; f.asset.export.originalPath = f.asset.source.path; f.save();
  assert.throws(() => readPendingAssets(f.root), error => error.code === 'INVALID_PENDING_ASSET');
});

test('an absent registry preserves the original source without pending entries', t => {
  const f = fixture(t, true);
  rmSync(join(f.pendingRoot, 'registry.json'));
  const source = readSource(f.root);
  assert.equal(source.assets.length, originalCatalog.length); assert.equal(source.stats.pending, 0);
  assert.deepEqual(analyzeDraft(source.baseline, source).changes, []);
});
