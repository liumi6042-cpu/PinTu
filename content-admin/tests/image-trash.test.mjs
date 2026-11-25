import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {readSource} from '../source.mjs';
import {validateDraft} from '../model.mjs';
import {mergeDraft} from '../merge.mjs';
import {buildPublicAlbumDocument} from '../albums.mjs';
import {buildDailyConfiguration, createDailyCoordinator} from '../daily.mjs';
import {createStore} from '../store.mjs';
import {createAdminServer} from '../server.mjs';
import {deleteImages, planImageDeletion, restoreImages} from '../public/image-trash.js';

const projectRoot = resolve(import.meta.dirname, '../..'), source = readSource(projectRoot);
const copy = structuredClone;
function fixture() {
  const document = validateDraft(source.baseline, source);
  const ids = source.assets.filter(asset => asset.lifecycle === 'retained').slice(0, 3).map(asset => asset.id);
  for (const album of document.albums) {
    album.imageIds = album.imageIds.filter(id => !ids.includes(id));
    if (!album.imageIds.includes(album.coverImageId)) album.coverImageId = album.imageIds[0] ?? null;
  }
  const album = document.albums[0];
  album.imageIds.push(...ids); album.coverImageId = ids[0];
  document.dailyPlans = [{id: ids[0], imageId: ids[0], date: null, albumId: album.id, autoPublish: true},
    {id: ids[1], imageId: ids[1], date: '2032-05-03', albumId: album.id}];
  return {document, ids, album};
}
function temp() {
  const parent = resolve(projectRoot, 'content-admin/work'); mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, 'qa-image-trash-'));
  const cleanup = () => {const path = realpathSync(root); assert.equal(dirname(path), realpathSync(parent)); rmSync(path, {recursive: true, force: true});};
  return {root, cleanup};
}

test('deletion and restore keep stable image IDs and source facts, repair covers, and preserve frozen daily history', () => {
  const {document, ids, album} = fixture(), before = copy(document), sourceBefore = JSON.stringify(source);
  const plan = planImageDeletion(document, [ids[0], ids[1], ids[0]], {lockedImageIds: [ids[0]]});
  assert.deepEqual(document, before);
  assert.deepEqual(plan.cancelledPlans, [ids[1]]); assert.deepEqual(plan.retainedPlans, [ids[0]]);
  assert.equal(plan.albums[0].id, album.id); assert.equal(plan.albums[0].count, 2);
  deleteImages(document, ids.slice(0, 2), {lockedImageIds: [ids[0]]});
  assert.deepEqual(Object.keys(document.assets), Object.keys(before.assets));
  assert.deepEqual(document.assets[ids[0]], {...before.assets[ids[0]], deleted: true});
  assert.equal(album.imageIds.includes(ids[0]), false); assert.equal(album.imageIds.includes(ids[1]), false);
  assert.equal(album.coverImageId, album.imageIds[0] ?? null);
  assert.deepEqual(document.dailyPlans, [before.dailyPlans[0]]);
  assert.equal(JSON.stringify(source), sourceBefore);
  const removed = copy(document); assert.throws(() => deleteImages(document, [ids[2], 'unknown'])); assert.deepEqual(document, removed);
  assert.deepEqual(restoreImages(document, ids.slice(0, 2)), ids.slice(0, 2));
  assert.deepEqual(document.assets, before.assets);
  assert.equal(document.albums.some(album => album.imageIds.includes(ids[0])), false, 'restore leaves ordinary album assignment to the administrator');
});

test('deleted state validates and survives source merge; restored image must be explicitly reassigned', () => {
  const {document, ids} = fixture(), base = copy(document);
  deleteImages(document, [ids[0]]);
  assert.equal(validateDraft(document, source).assets[ids[0]].deleted, true);
  assert.equal(mergeDraft(base, document, copy(base)).assets[ids[0]].deleted, true);
  const invalid = copy(document); invalid.assets[ids[0]].deleted = 'yes';
  assert.throws(() => validateDraft(invalid, source), {code: 'INVALID_DRAFT'});
  const referenced = copy(document); referenced.albums[0].imageIds.push(ids[0]);
  assert.throws(() => validateDraft(referenced, source), /回收站/);
  restoreImages(referenced, [ids[0]]); assert.doesNotThrow(() => validateDraft(referenced, source));
});

test('public album/daily exports exclude deleted images while historical daily plans remain in management', () => {
  const {document, ids} = fixture(); deleteImages(document, ids.slice(0, 2), {lockedImageIds: [ids[0]]});
  const validated = validateDraft(document, source), daily = buildDailyConfiguration(validated, source), albums = buildPublicAlbumDocument(validated, source);
  assert.equal(validated.dailyPlans[0].imageId, ids[0]);
  assert.equal(albums.albums.some(album => album.imageIds.some(id => ids.slice(0, 2).includes(id))), false);
  assert.equal(daily.automaticCandidates.some(plan => plan.imageId === ids[0]), false);
  assert.equal(daily.entries.some(plan => plan.imageId === ids[1]), false);
  assert.equal(daily.fallbackImageIds.some(id => ids.slice(0, 2).includes(id)), false);
});

test('a deleted daily image keeps its receipt but is not reinserted into an album on the next day', t => {
  const {root, cleanup} = temp(), store = createStore(join(root, 'admin'), source); t.after(() => {store.close(); cleanup();});
  const bridgeDir = join(root, 'daily'), appearanceDir = join(root, 'appearances'); let at = Date.parse('2032-05-01T10:00:00+08:00');
  const coordinator = createDailyCoordinator({store, getSource: () => source, validateDocument: validateDraft, bridgeDir, appearanceDir, now: () => at});
  const {document, ids, album} = fixture(); document.dailyPlans = [document.dailyPlans[0]];
  const initial = store.draft(store.activeDraftId()); store.saveDraft(initial.id, initial.revision, document, 'fixture'); coordinator.sync();
  const cfg = JSON.parse(readFileSync(join(bridgeDir, 'configuration.json'), 'utf8'));
  mkdirSync(appearanceDir, {recursive: true}); writeFileSync(join(appearanceDir, '2032-05-01.json'), JSON.stringify({schema: 'jigsaw-daily-appearance/v2', target: 'mobile-shared', date: '2032-05-01', imageId: ids[0], albumId: album.id, activatedAt: at, configDigest: cfg.configDigest, planned: true, source: 'automatic'}));
  coordinator.sync();
  const saved = store.draft(initial.id), deleted = copy(saved.document); deleteImages(deleted, [ids[0]], {lockedImageIds: [ids[0]]});
  coordinator.assertChanges(saved.document, deleted); store.saveDraft(saved.id, saved.revision, validateDraft(deleted, source), 'fixture');
  at = Date.parse('2032-05-02T10:00:00+08:00'); coordinator.sync(); coordinator.sync();
  assert.equal(store.dailyAppearances().length, 1); assert.equal(store.dailyFrozenPlans().length, 1);
  assert.equal(store.dailyEnrollments().length, 0);
  assert.equal(store.draft(initial.id).document.albums.some(album => album.imageIds.includes(ids[0])), false);
});

test('authenticated delete/restore saves use revision checks and preserve independent reward settings', async t => {
  const {root, cleanup} = temp(), app = createAdminServer({projectRoot, source, dataDir: root, appearanceDir: join(root, 'appearances')});
  t.after(async () => {await app.close(); cleanup();}); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const setup = await fetch(origin + '/api/setup', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({username: 'trash-fixture', password: 'Trash-fixture-2026-test'})});
  assert.equal(setup.status, 200);
  const session = await setup.json(), cookie = setup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const before = app.store.draft(app.store.activeDraftId()), rewards = app.store.taskRewards(), growth = app.store.gameSettings(), document = copy(before.document);
  const imageId = document.albums.find(album => album.imageIds.length).imageIds[0]; deleteImages(document, [imageId]);
  async function save(revision, document) {return fetch(`${origin}/api/drafts/${before.id}`, {method: 'PUT', headers: {origin, cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken}, body: JSON.stringify({revision, document})});}
  const result = await save(before.revision, document); assert.equal(result.status, 200); const saved = await result.json();
  assert.equal(saved.document.assets[imageId].deleted, true);
  assert.equal((await save(before.revision, before.document)).status, 409);
  restoreImages(saved.document, [imageId]); assert.equal((await save(saved.revision, saved.document)).status, 200);
  assert.deepEqual(app.store.taskRewards(), rewards); assert.deepEqual(app.store.gameSettings(), growth);
  assert.equal((await fetch(origin + '/image-trash.js')).status, 200);
});
