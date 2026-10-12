import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource} from '../source.mjs';
import {validateDraft, analyzeDraft, buildCandidate} from '../model.mjs';
import {normalizeDraft, plannedImageVisibility, effectiveImageVisibility, buildAlbumConfiguration} from '../album-model.mjs';

const source = readSource(), draft = () => structuredClone(source.baseline);
const mobile = value => value.targets['mobile-shared'];
const codes = value => analyzeDraft(value, source).blockers.map(item => item.code);
const invalid = value => assert.throws(() => validateDraft(value, source), error => error.status === 400);
const emptyAlbum = id => ({id, title: '待整理相册', description: '', imageIds: [], coverImageId: null,
  styleGroupId: null, visible: true, purchasable: false, price: 0, decorationId: null, milestones: []});

test('legacy mirrors collapse without changing memberships, IDs, prices or reward keys', () => {
  const old = structuredClone(source._private.legacyBaseline), saved = structuredClone(old);
  const normalized = normalizeDraft(old, source);
  assert.deepEqual(old, saved, 'conversion must preserve the original stored document');
  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(Object.keys(mobile(normalized)), ['albums']);
  for (const pack of old.targets['mobile-shared'].packs) {
    const album = mobile(normalized).albums.find(album => album.id === pack.id);
    const oldAlbum = old.targets['mobile-shared'].albums.find(album => album.id === pack.id);
    assert.deepEqual(album.imageIds, pack.imageIds);
    assert.equal(album.price, pack.price);
    assert.equal(album.purchasable, true);
    assert.equal(album.decorationId, pack.decorationId);
    assert.deepEqual(album.milestones, oldAlbum.milestones);
  }
  for (const target of ['pc', 'mobile-shared']) {
    const assigned = normalized.targets[target].albums.flatMap(album => album.imageIds);
    assert.equal(new Set(assigned).size, assigned.length);
    const originalGallery = source._private.catalogs[target].filter(photo => photo.status === 'published' && photo.galleryVisible !== false && !photo.dailyOnly).map(photo => photo.id);
    assert.deepEqual([...effectiveImageVisibility(normalized, source, target)].sort(), originalGallery.sort());
  }
  assert.deepEqual(analyzeDraft(normalized, source).changes, []);
  assert.deepEqual(analyzeDraft(normalized, source).blockers, []);
});

test('legacy edits migrate once; divergent mirror edits need an explicit merge', () => {
  const old = structuredClone(source._private.legacyBaseline);
  old.targets['mobile-shared'].packs[0].title = '保留旧购买包编辑';
  const normalized = normalizeDraft(old, source);
  assert.equal(mobile(normalized).albums[0].title, '保留旧购买包编辑');
  old.targets['mobile-shared'].albums[0].title = '另一份独立编辑';
  assert.throws(() => normalizeDraft(old, source), error => error.code === 'ALBUM_MIGRATION_CONFLICT');
});

test('only visible albums contribute images; unassigned pictures remain private inventory', () => {
  const value = draft(), group = mobile(value).albums.find(album => album.id === 'everyday-gallery');
  const first = group.imageIds.shift(); group.coverImageId = group.imageIds[0];
  assert.equal(plannedImageVisibility(value, source, 'mobile-shared').has(first), false);
  const before = effectiveImageVisibility(value, source, 'mobile-shared');
  group.visible = false;
  const hidden = effectiveImageVisibility(value, source, 'mobile-shared');
  assert.equal(before.size - hidden.size, group.imageIds.length);
  assert.equal(hidden.size, 18);
  assert.ok(codes(value).includes('ALBUM_RUNTIME_ADAPTER_REQUIRED'));
  assert.throws(() => buildCandidate(value, source, 'mobile-shared'), error => error.status === 409);
});

test('pending and archived artwork can be planned in visible albums but cannot silently go live', () => {
  const value = draft(), album = emptyAlbum('new-artwork');
  const pending = source.assets.find(asset => asset.lifecycle === 'pending');
  const archived = source.assets.find(asset => asset.lifecycle === 'retained' && asset.targets['mobile-shared'].status === 'archived');
  assert.ok(pending && archived);
  album.imageIds = [pending.id, archived.id]; album.coverImageId = pending.id;
  mobile(value).albums.push(album);
  assert.doesNotThrow(() => validateDraft(value, source));
  const planned = plannedImageVisibility(value, source, 'mobile-shared'), runtime = effectiveImageVisibility(value, source, 'mobile-shared');
  assert.ok(planned.has(pending.id) && planned.has(archived.id));
  assert.equal(runtime.has(pending.id), false); assert.equal(runtime.has(archived.id), false);
  assert.ok(codes(value).includes('NEW_ASSET_RUNTIME_IMPORT_REQUIRED'));
  assert.ok(codes(value).includes('ALBUM_ARCHIVED_IMAGE_ADAPTER_REQUIRED'));
});

test('one ownership rule prevents the same picture being free and purchasable', () => {
  const value = draft(), copied = emptyAlbum('duplicate-purchase');
  copied.imageIds = [mobile(value).albums.at(-1).imageIds[0]]; copied.coverImageId = copied.imageIds[0];
  copied.purchasable = true; copied.price = 100;
  mobile(value).albums.push(copied); invalid(value);
  mobile(value).albums.at(-1).imageIds = ['unknown-picture'];
  mobile(value).albums.at(-1).coverImageId = 'unknown-picture'; invalid(value);
});

test('buying, free prices and numeric reward amounts are strict and safe', () => {
  for (const price of [0, -1, 0.5, '180', Number.MAX_SAFE_INTEGER + 1]) {
    const value = draft(); mobile(value).albums[0].price = price; invalid(value);
  }
  const free = draft(); mobile(free).albums.at(-1).price = 1; invalid(free);
  const paid = draft(); mobile(paid).albums.at(-1).purchasable = true; mobile(paid).albums.at(-1).price = 200;
  assert.doesNotThrow(() => validateDraft(paid, source));
  assert.ok(codes(paid).includes('FREE_IMAGE_BECOMES_PAID'));
});

test('empty albums and reduced memberships retain old rewards as editable planning', () => {
  const value = draft(), album = mobile(value).albums[0];
  const savedMilestones = structuredClone(album.milestones);
  album.imageIds = []; album.coverImageId = null;
  mobile(value).albums.push(emptyAlbum('empty-album'));
  assert.deepEqual(validateDraft(value, source).targets['mobile-shared'].albums[0].milestones, savedMilestones);
  assert.ok(codes(value).includes('ALBUM_REWARDS_REQUIRE_ADAPTER'));
  assert.ok(codes(value).includes('ALBUM_RUNTIME_ADAPTER_REQUIRED'));
});

test('canonical exports contain one album configuration and unchanged retained identities', () => {
  const value = draft(), candidate = buildCandidate(value, source, 'mobile-shared');
  const config = JSON.parse(candidate.files.find(file => file.path === 'content/content-albums.json').content);
  assert.deepEqual(config.albums, buildAlbumConfiguration(value, source, 'mobile-shared').albums);
  assert.equal(config.unassignedImagesVisible, false); assert.equal(config.oneAlbumPerImage, true);
  assert.equal(config.effectiveGalleryImageIds.length, 79);
  const catalog = JSON.parse(candidate.files.find(file => file.path === 'content/puzzle-catalog.json').content);
  assert.deepEqual(catalog, source._private.catalogs['mobile-shared']);
  for (const asset of source.assets.filter(asset => asset.lifecycle === 'pending'))
    assert.ok(candidate.files.every(file => !file.content.includes(asset.id)));
  assert.equal(candidate.metadata.runtimeApplied, false);
});
