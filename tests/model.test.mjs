import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource, previewFile} from '../source.mjs';
import {validateDraft, analyzeDraft, buildCandidate} from '../model.mjs';

const source = readSource();
// Exercise old saved draft input as well as the canonical tests in album-model.
const draft = () => structuredClone(source._private.legacyBaseline);
const retainedAssets = source.assets.filter(asset => asset.lifecycle === 'retained');
const pendingAssets = source.assets.filter(asset => asset.lifecycle === 'pending');
const firstId = retainedAssets[0].id;
const codes = value => analyzeDraft(value, source).blockers.map(item => item.code);
const invalid = value => assert.throws(() => validateDraft(value, source), error => error.status === 400);

test('real source baseline has no fabricated classification or compatibility changes', () => {
  const analysis = analyzeDraft(draft(), source);
  assert.deepEqual(analysis.changes, []);
  assert.deepEqual(analysis.blockers, []);
  assert.deepEqual(analysis.compatibleTargets, ['pc', 'mobile-shared']);
  assert.equal(retainedAssets.length, 134, 'historical playable and archived IDs remain stable');
  for (const target of ['pc', 'mobile-shared']) assert.equal(source._private.catalogs[target].length, 134);
  assert.equal(source.assets.length, retainedAssets.length + pendingAssets.length);
  assert.equal(source.stats.retained, retainedAssets.length);
  assert.equal(source.stats.pending, pendingAssets.length);
  assert.equal(source.stats.total, source.assets.length);
  assert.ok(retainedAssets.every(asset => source.baseline.assets[asset.id].styleGroupId === null && source.baseline.assets[asset.id].subjectTags.length === 0));
  for (const asset of pendingAssets) {
    const record = source._private.pending.byId.get(asset.id), config = source.baseline.assets[asset.id];
    assert.equal(config.styleGroupId, record.styleGroupId);
    assert.deepEqual(config.subjectTags, record.subjectTags);
    assert.equal(asset.publishedAt, null);
    for (const target of ['pc', 'mobile-shared']) assert.deepEqual(config.targets[target], {status: 'draft', galleryVisible: false, dailyOnly: false, category: 'illustration'});
  }
  assert.equal(JSON.stringify(source).includes('originalFile'), false);
});

test('management styles/tags are normalized, safely exportable, and not game-active', () => {
  const value = draft();
  value.assets[firstId].styleGroupId = 'paper-collage';
  value.assets[firstId].subjectTags = [' 风景 ', '海边', '风景'];
  const normalized = validateDraft(value, source);
  assert.deepEqual(normalized.assets[firstId].subjectTags, ['风景', '海边']);
  assert.deepEqual(analyzeDraft(normalized, source).compatibleTargets, ['pc', 'mobile-shared']);
  const candidate = buildCandidate(normalized, source, 'pc');
  const metadata = JSON.parse(candidate.files.find(item => item.path === 'content/content-admin-metadata.json').content);
  assert.deepEqual(metadata.assets[firstId], {styleGroupId: 'paper-collage', subjectTags: ['风景', '海边']});
  assert.equal(candidate.metadata.runtimeApplied, false);
});

test('image IDs, unknown fields and source-review edits cannot enter drafts', () => {
  let value = draft(); delete value.assets[firstId]; invalid(value);
  value = draft(); value.assets['made-up-id'] = structuredClone(value.assets[firstId]); invalid(value);
  value = draft(); value.assets[firstId].review = {status: 'reviewed'}; invalid(value);
  value = draft(); Object.defineProperty(value.assets[firstId], '__proto__', {value: {}, enumerable: true}); invalid(value);
  value = draft(); value.assets[firstId].targets.pc.galleryVisible = 'true'; invalid(value);
  value = draft(); value.assets[firstId].styleGroupId = 'unregistered'; invalid(value);
});

test('price and reward amounts require non-negative safe integers', () => {
  for (const price of [-1, 0.5, '180', Number.MAX_SAFE_INTEGER + 1]) {
    const value = draft(); value.targets['mobile-shared'].packs[0].price = price; invalid(value);
  }
  const value = draft(); value.targets['mobile-shared'].albums[0].milestones[0].coins = -1; invalid(value);
});

test('old mobile rights, price, award, independent cover and availability changes are blocked per target', () => {
  const scenarios = [
    [value => value.targets['mobile-shared'].packs[0].price++, 'MOBILE_PACK_PRICE_CHANGED'],
    [value => value.targets['mobile-shared'].packs[0].imageIds.pop(), 'MOBILE_PACK_MEMBERS_CHANGED'],
    [value => value.targets['mobile-shared'].packs[0].decorationId = 'berry-spark', 'MOBILE_PACK_DECORATION_CHANGED'],
    [value => value.targets['mobile-shared'].packs[0].coverImageId = value.targets['mobile-shared'].packs[0].imageIds[1], 'MOBILE_COVER_ADAPTER_REQUIRED'],
    [value => value.targets['mobile-shared'].packs[0].status = 'archived', 'MOBILE_PACK_STATUS_ADAPTER_REQUIRED'],
    [value => value.assets[value.targets['mobile-shared'].packs[0].imageIds[0]].targets['mobile-shared'].status = 'archived', 'MOBILE_PACK_IMAGE_UNAVAILABLE'],
  ];
  for (const [mutate, expected] of scenarios) {
    const value = draft(); mutate(value);
    assert.ok(codes(value).includes(expected), expected);
    assert.ok(analyzeDraft(value, source).compatibleTargets.includes('pc'));
    assert.throws(() => buildCandidate(value, source, 'mobile-shared'), error => error.status === 409);
  }
});

test('free-to-paid conversion and independent album rewards remain planning-only', () => {
  const value = draft(), mobile = value.targets['mobile-shared'];
  const free = mobile.albums.find(item => item.id === 'everyday-gallery').imageIds.slice(0, 3);
  mobile.albums.find(item => item.id === 'everyday-gallery').imageIds = mobile.albums.find(item => item.id === 'everyday-gallery').imageIds.filter(id => !free.includes(id));
  mobile.packs.push({id: 'new-style-pack', title: '新画风', description: '', imageIds: free, coverImageId: free[0], status: 'draft', styleGroupId: null, price: 20, decorationId: null});
  assert.ok(codes(value).includes('FREE_IMAGE_BECOMES_PAID'));
  const award = draft(); award.targets['mobile-shared'].albums[0].milestones[0].coins++;
  assert.ok(codes(award).includes('MOBILE_ALBUM_REWARDS_CHANGED'));
});

test('old daily selection/category and title locale mappings are protected', () => {
  const value = draft(); value.assets[firstId].targets.pc.category = '新的分类';
  assert.ok(analyzeDraft(value, source).blockers.some(item => item.target === 'pc' && item.code === 'EXISTING_CATEGORY_CHANGED'));
  const dailyId = source.assets.find(asset => asset.targets.pc.dailyOnly).id;
  const daily = draft(); daily.assets[dailyId].targets.pc.status = 'archived';
  assert.ok(codes(daily).includes('DAILY_ROTATION_CHANGED'));
  const title = draft(); title.assets[firstId].title = '重新命名';
  assert.deepEqual(analyzeDraft(title, source).compatibleTargets, []);
  assert.ok(codes(title).includes('LOCALE_ADAPTER_REQUIRED'));
});

test('PC theme editing is an explicit adapter blocker', () => {
  const value = draft(); value.targets.pc.packs[0].title = '新的画册';
  assert.ok(codes(value).includes('PC_THEME_ADAPTER_REQUIRED'));
  assert.ok(analyzeDraft(value, source).compatibleTargets.includes('mobile-shared'));
});

test('pack-only reordering cannot silently reorder the requested album configuration', () => {
  const value = draft(); value.targets['mobile-shared'].packs.reverse();
  assert.ok(codes(value).includes('MOBILE_ALBUM_ORDER_ADAPTER_REQUIRED'));
});

test('candidates preserve catalog ordering, historical identity and original immutable facts', () => {
  const candidate = buildCandidate(draft(), source, 'mobile-shared');
  assert.ok(candidate.files.every(file => typeof file.content === 'string'));
  const catalog = JSON.parse(candidate.files.find(item => item.path === 'content/puzzle-catalog.json').content);
  assert.deepEqual(catalog, source._private.catalogs['mobile-shared']);
  const collection = JSON.parse(candidate.files.find(item => item.path === 'lib/mobile-collection-catalog.json').content);
  assert.deepEqual(collection, source._private.collection);
  for (const asset of pendingAssets) assert.ok(candidate.files.every(file => !file.content.includes(asset.id)), 'private pending artwork must not enter runtime content');
  const summary = candidate.files.find(item => item.path === 'content/reviewed-delivery-summary.json').content;
  assert.equal(summary.includes('originalFile'), false);
  assert.equal(summary.includes('sourceDescription'), false);
  assert.equal(summary.includes('rightsStatement'), false);
});

test('previews expose registered WebP only, with explicit not-found errors', () => {
  assert.match(previewFile(source, firstId, 'preview'), /[\\/]public[\\/]puzzles[\\/].*\.webp$/);
  assert.throws(() => previewFile(source, 'unknown-photo', 'thumbnail'), error => error.status === 404);
  assert.throws(() => previewFile(source, '../server', 'thumbnail'), error => error.status === 400);
  assert.throws(() => previewFile(source, firstId, 'original'), error => error.status === 400);
});
