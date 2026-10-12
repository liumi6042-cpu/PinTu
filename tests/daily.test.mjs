import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readSource} from '../source.mjs';
import {validateDraft} from '../model.mjs';
import {normalizeDraft, buildAlbumConfiguration} from '../album-model.mjs';
import {createStore} from '../store.mjs';
import {assertDailyPlanChanges, beijingDate, buildDailyConfiguration, configurationDigest, createDailyCoordinator, dailyReadiness} from '../daily.mjs';
import {createAdminServer} from '../server.mjs';

const source = readSource(), copy = value => structuredClone(value);
const dailyImage = source.assets.find(asset => asset.lifecycle === 'retained' && asset.targets['mobile-shared'].status === 'published' && asset.targets['mobile-shared'].dailyOnly).id;
const secondImage = source.assets.find(asset => asset.lifecycle === 'retained' && asset.targets['mobile-shared'].status === 'published' && !asset.targets['mobile-shared'].dailyOnly).id;
const emptyAlbum = id => ({id, title: '预选相册', description: '保持设置', imageIds: [], coverImageId: null, styleGroupId: null,
  showOnPc: false, showOnMobile: false, purchasable: false, price: 0, decorationId: null, milestones: []});
const plan = (imageId = dailyImage, date = '2030-05-02', albumId = 'daily-destination') => ({id: imageId, imageId, date, albumId});
function document() {const draft = copy(source.baseline); draft.albums.push(emptyAlbum('daily-destination'), emptyAlbum('daily-origin')); return draft;}

function fixture(t) {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'jigsaw-daily-test-'));
  const store = createStore(join(root, 'admin'), source), bridgeDir = join(root, 'daily-bridge'), appearanceDir = join(root, 'appearances');
  let at = Date.parse('2030-05-01T12:00:00+08:00'), currentSource = source;
  const coordinator = createDailyCoordinator({store, getSource: () => currentSource, validateDocument: validateDraft, bridgeDir, appearanceDir, now: () => at});
  t.after(() => {
    store.close(); const absolute = realpathSync(root);
    assert.equal(dirname(absolute), parent); assert.equal(absolute, resolve(root)); assert.match(basename(absolute), /^jigsaw-daily-test-/);
    rmSync(absolute, {recursive: true});
  });
  return {root, store, bridgeDir, appearanceDir, coordinator, setNow: value => at = Date.parse(value), setSource: value => currentSource = value,
    save(value) {const current = store.draft(store.activeDraftId()); return store.saveDraft(current.id, current.revision, validateDraft(value, source), 'test');},
    receipt(value = {}) {
      mkdirSync(appearanceDir, {recursive: true});
      const configuration = JSON.parse(readFileSync(join(bridgeDir, 'configuration.json'), 'utf8'));
      const entry = configuration.entries[0];
      const fact = {schema: 'jigsaw-daily-appearance/v1', target: 'mobile-shared', date: entry.date, imageId: entry.imageId, albumId: entry.albumId,
        activatedAt: at, configDigest: configuration.configDigest, planned: true, ...value};
      writeFileSync(join(appearanceDir, fact.date + '.json'), JSON.stringify(fact)); return fact;
    }};
}

test('optional v3 plans round-trip and reject invalid dates, duplicate days and unknown references', () => {
  const old = document(); delete old.dailyPlans;
  assert.deepEqual(validateDraft(old, source).dailyPlans, []); assert.deepEqual(normalizeDraft(old, source).dailyPlans, []);
  const draft = document(); draft.dailyPlans = [plan()];
  assert.deepEqual(validateDraft(draft, source).dailyPlans, [plan()]);
  assert.deepEqual(buildAlbumConfiguration(draft, source).dailyPlans, [plan()]);
  for (const invalid of [null, [plan(dailyImage, '2030-02-29')], [plan(), plan(secondImage)], [plan(), plan(dailyImage, '2030-05-03')], [plan('not-an-image')], [plan(dailyImage, '2030-05-02', 'missing-album')]]) {
    assert.throws(() => validateDraft({...draft, dailyPlans: invalid}, source), error => error.code === 'INVALID_DRAFT');
  }
  assert.throws(() => assertDailyPlanChanges(old, {...draft, dailyPlans: [plan(dailyImage, '2030-05-01')]}, [], Date.parse('2030-05-01T01:00:00+08:00')), error => error.code === 'DAILY_PLAN_DATE_PAST');
  assert.doesNotThrow(() => assertDailyPlanChanges(draft, draft, [], Date.parse('2030-05-03T00:00:00+08:00')), 'unchanged expired plans remain savable');
});

test('bridge excludes unusable plans and every private source field', () => {
  const draft = document(), pending = source.assets.find(asset => asset.lifecycle === 'pending'), archived = source.assets.find(asset => asset.targets['mobile-shared'].status === 'archived');
  draft.dailyPlans = [plan(), plan(pending.id, '2030-05-03'), plan(archived.id, '2030-05-04')];
  const configuration = buildDailyConfiguration(validateDraft(draft, source), source);
  assert.equal(configurationDigest(configuration), configuration.configDigest); assert.equal(configuration.entries.length, 1);
  assert.deepEqual(configuration.entries[0], {date: '2030-05-02', imageId: dailyImage, albumId: 'daily-destination'});
  assert.deepEqual(Object.keys(configuration.albums[0]).sort(), ['id', 'title', 'description', 'showOnPc', 'showOnMobile', 'purchasable', 'price', 'decorationId', 'milestones'].sort());
  assert.equal(configuration.albums[0].showOnMobile, false);
  for (const forbidden of ['sourceFingerprint', '_private', 'password', 'salt', 'src', 'rightsStatement', 'sourceDescription', 'imageIds']) assert.equal(Object.hasOwn(configuration, forbidden), false);
});

test('new purchase albums retain daily plans while excluding them from the runtime bridge', () => {
  const draft = document(), album = draft.albums.find(item => item.id === 'daily-destination');
  album.purchasable = true; album.price = 250; draft.dailyPlans = [plan()];
  const validated = validateDraft(draft, source), readiness = dailyReadiness(validated, source);
  assert.deepEqual(validated.dailyPlans, [plan()]); assert.equal(readiness[0].ready, false);
  assert.match(readiness[0].reason, /购买相册尚未接入小游戏商店/);
  assert.deepEqual(buildDailyConfiguration(validated, source).entries, []);
  assert.deepEqual(buildDailyConfiguration(validated, source).albums, []);
  validated.dailyPlans[0].albumId = source._private.collection.packs[0].id;
  assert.equal(dailyReadiness(validated, source)[0].ready, true, 'existing store pack IDs remain supported');
});

test('actual appearance waits for Beijing next day, preserves metadata and enrolls once with CAS', t => {
  const f = fixture(t), draft = document(); draft.dailyPlans = [plan()];
  draft.albums.find(album => album.id === 'daily-origin').imageIds = [dailyImage]; draft.albums.at(-1).coverImageId = dailyImage;
  f.save(draft); f.coordinator.sync(); const before = f.store.draft(f.store.activeDraftId());
  f.setNow('2030-05-03T00:00:00+08:00'); f.coordinator.sync();
  assert.equal(f.store.dailyEnrollments().length, 0, 'an expired plan without a runtime receipt is not an appearance');
  f.setNow('2030-05-02T10:00:00+08:00'); f.receipt();
  let status = f.coordinator.sync(); assert.equal(status.appearances.length, 1); assert.equal(status.enrollments.length, 0);
  assert.throws(() => f.coordinator.assertChanges(before.document, {...before.document, dailyPlans: []}), error => error.code === 'DAILY_PLAN_LOCKED');
  f.setNow('2030-05-02T23:59:59.999+08:00'); f.coordinator.sync(); assert.equal(f.store.dailyEnrollments().length, 0);
  f.setNow('2030-05-03T00:00:00+08:00'); status = f.coordinator.sync();
  assert.equal(beijingDate(status.enrollments[0].enrolledAt), '2030-05-03');
  const after = f.store.draft(before.id), origin = after.document.albums.find(album => album.id === 'daily-origin'), target = after.document.albums.find(album => album.id === 'daily-destination');
  assert.deepEqual(origin.imageIds, []); assert.equal(origin.coverImageId, null); assert.deepEqual(target.imageIds, [dailyImage]); assert.equal(target.coverImageId, dailyImage);
  assert.deepEqual(after.document.assets, before.document.assets); assert.deepEqual(after.document.styles, before.document.styles);
  assert.deepEqual(after.document.albums.slice(0, 4), before.document.albums.slice(0, 4)); assert.equal(target.showOnPc, false); assert.equal(target.showOnMobile, false);
  assert.equal(f.store.listDrafts().length, 1); assert.equal(after.revision, before.revision + 1);
  assert.throws(() => f.store.saveDraft(before.id, before.revision, before.document, 'stale-tab'), error => error.code === 'REVISION_CONFLICT');
  const manual = copy(after.document); manual.albums.find(album => album.id === target.id).imageIds = []; manual.albums.find(album => album.id === target.id).coverImageId = null;
  manual.albums.find(album => album.id === origin.id).imageIds = [dailyImage]; manual.albums.find(album => album.id === origin.id).coverImageId = dailyImage;
  f.save(manual); const manualRevision = f.store.draft(before.id).revision; f.coordinator.sync(); f.coordinator.sync();
  assert.equal(f.store.draft(before.id).revision, manualRevision); assert.deepEqual(f.store.draft(before.id).document, validateDraft(manual, source)); assert.equal(f.store.dailyEnrollments().length, 1);
});

test('untrusted receipts and changed sources cannot trigger enrollment; late trusted receipt freezes its original plan', t => {
  const f = fixture(t), draft = document(); draft.dailyPlans = [plan()]; f.save(draft); f.coordinator.sync();
  f.setNow('2030-05-02T10:00:00+08:00'); f.receipt({configDigest: 'a'.repeat(64)}); f.coordinator.sync(); assert.equal(f.store.dailyAppearances().length, 0);
  f.receipt({planned: false}); f.coordinator.sync(); assert.equal(f.store.dailyAppearances().length, 0);
  f.receipt(); const future = copy(draft); future.dailyPlans[0].date = '2030-05-05'; f.save(future);
  f.setSource({...source, fingerprint: 'changed-source'}); f.setNow('2030-05-03T00:00:00+08:00');
  let status = f.coordinator.sync(); assert.equal(status.readiness[0].ready, false); assert.equal(f.store.dailyAppearances().length, 0);
  f.setSource(source); status = f.coordinator.sync(); assert.equal(status.appearances.length, 1); assert.equal(status.enrollments.length, 1);
  assert.deepEqual(f.store.draft(f.store.activeDraftId()).document.dailyPlans, [plan()]);
});

test('daily status remains authenticated and server guards past plans and frozen restores', {timeout: 30_000}, async t => {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'jigsaw-daily-test-'));
  let at = Date.parse('2030-05-01T12:00:00+08:00');
  const app = createAdminServer({source, dataDir: join(root, 'admin'), bridgeDir: join(root, 'bridge'), appearanceDir: join(root, 'appearances'), now: () => at});
  t.after(async () => {await app.close(); const exact = realpathSync(root); assert.equal(dirname(exact), parent); assert.match(basename(exact), /^jigsaw-daily-test-/); rmSync(exact, {recursive: true});});
  await new Promise(done => app.server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + app.server.address().port;
  let cookie = '', csrf = '';
  async function request(path, method = 'GET', body) {
    const headers = {cookie}; if (body) Object.assign(headers, {'content-type': 'application/json', origin, 'x-csrf-token': csrf});
    const response = await fetch(origin + path, {method, headers, body: body ? JSON.stringify(body) : undefined});
    const payload = await response.json(); return {status: response.status, payload, response};
  }
  assert.equal((await request('/api/daily/status')).status, 401);
  const setup = await request('/api/setup', 'POST', {username: 'daily-test', password: 'Daily-fixture-password-123'}); assert.equal(setup.status, 200);
  cookie = setup.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); csrf = setup.payload.csrfToken;
  if (!csrf) csrf = (await request('/api/session')).payload.csrfToken;
  const current = app.store.draft(app.store.activeDraftId()), draft = document(); draft.dailyPlans = [plan(dailyImage, '2030-05-01')];
  const oldVersion = app.store.publish(current, {kind: 'snapshot', target: null, label: '未排期备份', reason: '聚焦验证'}, [], {changes: [], blockers: [], warnings: [], compatibleTargets: []}, 'test');
  let result = await request('/api/drafts/' + current.id, 'PUT', {revision: current.revision, document: draft}); assert.equal(result.payload.code, 'DAILY_PLAN_DATE_PAST');
  draft.dailyPlans = [plan()]; result = await request('/api/drafts/' + current.id, 'PUT', {revision: current.revision, document: draft}); assert.equal(result.status, 200, JSON.stringify(result.payload));
  const configured = JSON.parse(readFileSync(join(root, 'bridge/configuration.json'), 'utf8')); at = Date.parse('2030-05-02T10:00:00+08:00'); mkdirSync(join(root, 'appearances'), {recursive: true});
  writeFileSync(join(root, 'appearances/2030-05-02.json'), JSON.stringify({schema: 'jigsaw-daily-appearance/v1', target: 'mobile-shared', date: '2030-05-02', imageId: dailyImage, albumId: 'daily-destination', activatedAt: at, configDigest: configured.configDigest, planned: true}));
  const status = await request('/api/daily/status'); assert.equal(status.status, 200); assert.equal(status.payload.daily.appearances.length, 1);
  const saved = app.store.draft(current.id), changed = copy(saved.document); changed.dailyPlans = [];
  result = await request('/api/drafts/' + current.id, 'PUT', {revision: saved.revision, document: changed}); assert.equal(result.payload.code, 'DAILY_PLAN_LOCKED');
  result = await request('/api/versions/' + oldVersion.id + '/restore', 'POST', {password: 'Daily-fixture-password-123', reason: '验证旧备份不可覆盖实际出场档案'});
  assert.equal(result.payload.code, 'DAILY_PLAN_LOCKED'); assert.equal(app.store.listDrafts().length, 1);
});
