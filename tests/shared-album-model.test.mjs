import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource} from '../source.mjs';
import {validateDraft, analyzeDraft, buildCandidate} from '../model.mjs';
import {normalizeDraft, plannedImageVisibility, effectiveImageVisibility, buildAlbumConfiguration, toLegacyDraft} from '../album-model.mjs';

const source = readSource(), draft = () => structuredClone(source.baseline);
const visible = (document, target) => [...plannedImageVisibility(document, source, target)].sort();
const emptyAlbum = id => ({id, title: '共享相册', description: '', imageIds: [], coverImageId: null, styleGroupId: null,
  showOnPc: true, showOnMobile: true, purchasable: false, price: 0, decorationId: null, milestones: []});

// The exact former two-workspace structure, without consulting or modifying a DB.
function versionTwoDraft() {
  const document = draft(), legacy = source._private.legacyBaseline;
  const mobile = document.albums.map(({showOnPc, showOnMobile, ...album}) => ({...album, visible: showOnMobile}));
  const pc = legacy.targets.pc.albums.map(album => {
    const pack = legacy.targets.pc.packs.find(pack => pack.id === album.packId);
    return {id: album.id, title: album.title, description: album.description, imageIds: [...album.imageIds],
      coverImageId: pack.coverImageId, styleGroupId: album.styleGroupId, visible: true,
      purchasable: false, price: 0, decorationId: null, milestones: structuredClone(album.milestones)};
  });
  const assigned = new Set(pc.flatMap(album => album.imageIds));
  const ordinary = Object.keys(document.assets).filter(id => {
    const config = document.assets[id].targets.pc;
    return config.status === 'published' && config.galleryVisible && !config.dailyOnly && !assigned.has(id);
  });
  pc.push({...emptyAlbum('free-gallery'), title: '日常拾光', description: '自由图库中的普通图片。', imageIds: ordinary,
    coverImageId: ordinary[0], visible: true});
  delete pc.at(-1).showOnPc; delete pc.at(-1).showOnMobile;
  delete document.albums;
  delete document.dailyPlans;
  return {...document, schemaVersion: 2, targets: {pc: {albums: pc}, 'mobile-shared': {albums: mobile}}};
}

test('version two copies become four shared albums without duplicated ownership or lost metadata', () => {
  const old = versionTwoDraft(), original = structuredClone(old);
  old.assets[Object.keys(old.assets)[0]].subjectTags = ['风景', '海边'];
  const converted = validateDraft(old, source);
  assert.equal(converted.schemaVersion, 3);
  assert.equal(Object.hasOwn(converted, 'targets'), false);
  assert.equal(converted.albums.length, 4);
  assert.equal(converted.albums.flatMap(album => album.imageIds).length, 79);
  assert.equal(new Set(converted.albums.flatMap(album => album.imageIds)).size, 79);
  assert.ok(converted.albums.every(album => album.showOnPc && album.showOnMobile));
  assert.deepEqual(converted.assets, old.assets);
  assert.deepEqual(converted.styles, old.styles);
  assert.deepEqual(old.targets, original.targets, 'conversion must not mutate old saved copies');
  assert.deepEqual(source._private.legacyBaseline.targets.pc.albums.map(album => album.id), ['lantern-stories']);
});

test('old visibility and purchase settings become shared flags and shared prices', () => {
  const old = versionTwoDraft();
  old.targets['mobile-shared'].albums[0].visible = false;
  old.targets['mobile-shared'].albums[0].price = 250;
  const album = validateDraft(old, source).albums[0];
  assert.equal(album.showOnPc, false); assert.equal(album.showOnMobile, false);
  assert.equal(album.price, 250); assert.equal(album.purchasable, true);
});

test('independent PC edits and PC-only albums require a conflict resolution', () => {
  const scenarios = [
    old => old.targets.pc.albums[0].title = '单独修改',
    old => old.targets.pc.albums[0].visible = false,
    old => old.targets.pc.albums[0].imageIds.reverse(),
    old => old.targets.pc.albums.reverse(),
    old => old.targets.pc.albums.push((({showOnPc, showOnMobile, ...album}) => ({...album, visible: true}))(emptyAlbum('pc-only'))),
    old => {
      const pending = source.assets.find(asset => asset.lifecycle === 'pending');
      old.targets.pc.albums.at(-1).imageIds.push(pending.id);
    },
  ];
  for (const mutate of scenarios) {
    const old = versionTwoDraft(); mutate(old);
    assert.throws(() => validateDraft(old, source), error => error.code === 'ALBUM_MIGRATION_CONFLICT');
  }
  assert.throws(() => normalizeDraft(versionTwoDraft()), error => error.code === 'ALBUM_MIGRATION_CONFLICT');
});

test('each display checkbox independently controls the same album members', () => {
  const document = draft(), album = document.albums[0], original = visible(document, 'pc');
  album.showOnPc = false;
  assert.equal(visible(document, 'pc').length, original.length - album.imageIds.length);
  assert.equal(visible(document, 'mobile-shared').length, original.length);
  album.showOnMobile = false;
  assert.deepEqual(visible(document, 'pc'), visible(document, 'mobile-shared'));
  album.showOnPc = true;
  assert.equal(visible(document, 'pc').length, original.length);
  assert.equal(visible(document, 'mobile-shared').length, original.length - album.imageIds.length);
  const first = album.imageIds.shift(); album.coverImageId = album.imageIds[0];
  assert.equal(plannedImageVisibility(document, source, 'pc').has(first), false);
  assert.equal(plannedImageVisibility(document, source, 'mobile-shared').has(first), false);
  assert.deepEqual(validateDraft(document, source).albums, document.albums);
});

test('global ownership remains unique even when duplicate albums target different devices', () => {
  const document = draft(), first = document.albums[0];
  first.showOnMobile = false;
  document.albums.push({...emptyAlbum('mobile-copy'), imageIds: [first.imageIds[0]], coverImageId: first.imageIds[0], showOnPc: false});
  assert.throws(() => validateDraft(document, source), error => error.status === 400);
  for (const field of ['showOnPc', 'showOnMobile']) {
    const invalid = draft(); invalid.albums[0][field] = 'true';
    assert.throws(() => validateDraft(invalid, source), error => error.status === 400);
  }
  const obsolete = draft(); obsolete.albums[0].visible = true;
  assert.throws(() => validateDraft(obsolete, source), error => error.status === 400);
});

test('shared configuration preserves two flags and PC runtime support remains an explicit requirement', () => {
  const document = draft(); document.albums[0].showOnPc = false;
  const config = buildAlbumConfiguration(document, source);
  assert.equal(config.schema, 'jigsaw-content-albums/v3');
  assert.equal(config.sharedAlbums, true); assert.equal(config.unassignedImagesVisible, false);
  assert.deepEqual(config.albums, document.albums);
  const analysis = analyzeDraft(document, source);
  assert.ok(analysis.blockers.some(item => item.target === 'pc' && item.code === 'SHARED_ALBUM_RUNTIME_ADAPTER_REQUIRED'));
  assert.ok(analysis.compatibleTargets.includes('mobile-shared'), 'PC-only visibility must not block compatible mobile content');
  assert.throws(() => buildCandidate(document, source, 'pc'), error => error.code === 'CANDIDATE_BLOCKED');
  const candidate = buildCandidate(document, source, 'mobile-shared');
  const exported = JSON.parse(candidate.files.find(file => file.path === 'content/content-albums.json').content);
  assert.deepEqual(exported.albums, document.albums);
  assert.deepEqual(exported.effectiveGalleryImageIds, [...effectiveImageVisibility(document, source, 'mobile-shared')]);
  assert.equal(candidate.metadata.schema, 'jigsaw-content-candidate/v3');
  assert.deepEqual(toLegacyDraft(document, source).targets.pc, source._private.legacyBaseline.targets.pc);
});
