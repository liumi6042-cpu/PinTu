import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {createAdminServer} from '../server.mjs';

const projectRoot = resolve(import.meta.dirname, '../..');
const sourceFiles = [
  'puzzle-play/content/puzzle-catalog.json',
  'jigsaw-nook-taptap/content/puzzle-catalog.json',
  'jigsaw-nook-taptap/lib/mobile-collection-catalog.json',
];
const sourceHashes = () => Promise.all(sourceFiles.map(async file =>
  createHash('sha256').update(await readFile(join(projectRoot, file))).digest('hex')));

// The HTTP suite creates one private temporary CMS. It never edits a game source,
// a player database, or the service's normal work/ directory.
test('HTTP authorization, draft concurrency and compatible version lifecycle', {timeout: 120_000}, async t => {
  const tempParent = await realpath(tmpdir());
  const dataDir = await mkdtemp(join(tempParent, 'jigsaw-admin-http-'));
  const originalHashes = await sourceHashes();
  let app;
  t.after(async () => {
    if (app?.close) await app.close();
    else if (app?.server) {
      app.server.closeAllConnections();
      await new Promise((resolveClose, reject) => app.server.close(error => error ? reject(error) : resolveClose()));
      app.store?.close?.();
    }
    assert.deepEqual(await sourceHashes(), originalHashes, 'HTTP CMS operations must leave existing game catalogs unchanged');
    // Validate the absolute target before this sole recursive delete.
    const exactCreatedPath = await realpath(dataDir);
    assert.equal(dirname(exactCreatedPath), tempParent);
    assert.equal(exactCreatedPath, resolve(dataDir));
    assert.match(basename(exactCreatedPath), /^jigsaw-admin-http-/);
    await rm(exactCreatedPath, {recursive: true});
  });

  app = await createAdminServer({projectRoot, dataDir});
  await new Promise((resolveListen, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const password = `Http-test-${randomBytes(16).toString('hex')}`;
  let cookie = '';
  let csrfToken = '';
  let draft;
  let baselineDocument;
  let imageId;
  let safeVersionId;

  async function request(path, options = {}) {
    const method = options.method ?? 'GET';
    const headers = {...(options.auth === false ? {} : {cookie})};
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.origin = origin;
      if (options.auth !== false && csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    Object.assign(headers, options.headers);
    for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
    const response = await fetch(origin + path, {
      method, headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });
    if (options.captureCookie) {
      const cookies = response.headers.getSetCookie();
      assert.ok(cookies.length, 'successful authentication must set a session cookie');
      cookie = cookies.map(item => item.split(';')[0]).join('; ');
      assert.match(cookies.join('; '), /HttpOnly/i);
      assert.match(cookies.join('; '), /SameSite=(?:Strict|Lax)/i);
    }
    const type = response.headers.get('content-type') ?? '';
    const body = type.includes('application/json') ? await response.json() : await response.text();
    return {status: response.status, body, headers: response.headers};
  }

  function expectStatus(result, expected) {
    assert.equal(result.status, expected, JSON.stringify(result.body).slice(0, 800));
    return result.body;
  }
  const draftResult = body => body.draft ?? body;
  async function bootstrap() {
    return expectStatus(await request('/api/bootstrap'), 200);
  }
  async function save(document, revision = draft.revision, options = {}) {
    return request(`/api/drafts/${draft.id}`, {method: 'PUT', body: {revision, document}, ...options});
  }
  async function publish(overrides = {}) {
    return request(`/api/drafts/${draft.id}/publish`, {
      method: 'POST', body: {revision: draft.revision, password, reason: 'HTTP 聚焦验证', label: '测试版本', kind: 'snapshot', target: null, ...overrides},
    });
  }

  await t.test('anonymous source, image and version access is rejected; local administrator setup works', async () => {
    const session = expectStatus(await request('/api/session', {auth: false}), 200);
    assert.equal(session.authenticated, false);
    assert.equal(session.setupRequired, true);
    // fetch rewrites Host; use a literal HTTP request for the rebinding check.
    const wrongHostStatus = await new Promise((resolveStatus, reject) => {
      const attempt = httpRequest(origin, {headers: {host: 'untrusted.invalid'}}, response => {
        response.resume();
        response.on('end', () => resolveStatus(response.statusCode));
      });
      attempt.on('error', reject);
      attempt.end();
    });
    assert.equal(wrongHostStatus, 403);
    for (const path of ['/api/bootstrap', '/api/images/cel-coastal-family-v1?kind=thumbnail', '/api/versions/nonexistent/download']) {
      expectStatus(await request(path, {auth: false}), 401);
    }
    expectStatus(await request('/api/setup', {method: 'POST', auth: false, headers: {origin: 'http://untrusted.invalid'}, body: {username: 'test-admin', password}}), 403);
    const setup = await request('/api/setup', {method: 'POST', auth: false, captureCookie: true, body: {username: 'test-admin', password}});
    assert.ok([200, 201].includes(setup.status), JSON.stringify(setup.body));
    csrfToken = setup.body.csrfToken;
    if (!csrfToken) csrfToken = expectStatus(await request('/api/session'), 200).csrfToken;
    assert.ok(csrfToken);
    const state = await bootstrap();
    assert.ok(state.source.assets.length > 0);
    const retained = state.source.assets.filter(asset => asset.lifecycle === 'retained'), pending = state.source.assets.filter(asset => asset.lifecycle === 'pending');
    assert.equal(retained.length, 134, 'the historical runtime library remains unchanged');
    assert.equal(state.source.stats.pending, pending.length);
    assert.equal(state.source.assets.length, retained.length + pending.length);
    imageId = retained[0].id;
    draft = draftResult(expectStatus(await request(`/api/drafts/${state.activeDraftId}`), 200));
    assert.equal(draft.document.schemaVersion, 3);
    assert.equal(draft.document.targets, undefined, 'album ownership is shared rather than duplicated by target');
    assert.equal(draft.document.albums.length, 4);
    for (const asset of pending) {
      const config = draft.document.assets[asset.id];
      assert.equal(config.styleGroupId, asset.styleGroupId);
      assert.deepEqual(config.subjectTags, asset.subjectTags);
      assert.equal(asset.publishedAt, null);
      for (const target of ['pc', 'mobile-shared']) assert.deepEqual(config.targets[target], {status: 'draft', galleryVisible: false, dailyOnly: false, category: 'illustration'});
    }
    baselineDocument = structuredClone(draft.document);
  });

  await t.test('Origin, CSRF, invalid fields and stale revisions cannot mutate a draft', async () => {
    const initialRevision = draft.revision;
    expectStatus(await save(draft.document, initialRevision, {headers: {origin: 'http://untrusted.invalid'}}), 403);
    expectStatus(await save(draft.document, initialRevision, {headers: {origin: null}}), 403);
    expectStatus(await save(draft.document, initialRevision, {headers: {'x-csrf-token': null}}), 403);
    expectStatus(await save(draft.document, initialRevision, {headers: {'x-csrf-token': 'wrong'}}), 403);
    expectStatus(await save(draft.document, initialRevision, {headers: {'x-csrf-token': 'é'.repeat(64)}}), 403);
    const unknownField = structuredClone(draft.document);
    unknownField.assets[imageId].sha256 = 'must-not-override-source-facts';
    expectStatus(await save(unknownField), 400);
    const badReference = structuredClone(draft.document);
    badReference.albums[0].imageIds.push('missing-image-for-validation');
    expectStatus(await save(badReference), 400);
    const beforeSave = draftResult(expectStatus(await request(`/api/drafts/${draft.id}`), 200));
    assert.equal(beforeSave.revision, initialRevision);
    assert.deepEqual(beforeSave.document, baselineDocument);

    const safeDocument = structuredClone(draft.document);
    safeDocument.assets[imageId].styleGroupId = 'paper-collage';
    safeDocument.assets[imageId].subjectTags = ['海岸', '家庭'];
    draft = draftResult(expectStatus(await save(safeDocument), 200));
    assert.ok(draft.revision > initialRevision);
    assert.deepEqual(draft.document.assets[imageId].subjectTags, ['海岸', '家庭']);
    expectStatus(await save(baselineDocument, initialRevision), 409);
    const analysis = expectStatus(await request(`/api/drafts/${draft.id}/analyze`, {method: 'POST', body: {revision: draft.revision}}), 200);
    assert.ok(analysis.blockers.some(issue => issue.target === 'pc' && issue.code === 'SHARED_ALBUM_RUNTIME_ADAPTER_REQUIRED'));
    assert.equal(analysis.blockers.some(issue => issue.target === 'mobile-shared'), false);
    assert.deepEqual(analysis.compatibleTargets, ['mobile-shared']);
    assert.ok(analysis.changes.length > 0);
  });

  await t.test('preview paths are bounded and raw or private files are inaccessible', async () => {
    const thumbnail = await request(`/api/images/${imageId}?kind=thumbnail`);
    expectStatus(thumbnail, 200);
    assert.match(thumbnail.headers.get('content-type'), /^image\/webp/);
    for (const path of [
      `/api/images/${imageId}?kind=original`,
      '/api/images/%2e%2e%2fpackage.json?kind=thumbnail',
      '/work/admin.sqlite',
      '/source.mjs',
      '/package.json',
      '/content/image-provenance/cel-coastal-family-v1.json',
    ]) {
      const result = await request(path);
      assert.ok([400, 403, 404].includes(result.status), `${path} leaked with ${result.status}`);
    }
  });

  await t.test('historical IDs survive imported baselines and same-source reimport preserves the draft', async () => {
    const startingCount = (await bootstrap()).versions.length;
    const startingRevision = draft.revision;
    const savedDocument = structuredClone(draft.document);
    const historicalFingerprint = 'e'.repeat(64);
    const historicalDocument = JSON.stringify({assets: {'historic-removed-qa': {}}});
    assert.notEqual(historicalFingerprint, app.source.fingerprint);
    app.store.db.prepare('INSERT INTO content_source_baselines(fingerprint,document) VALUES(?,?)')
      .run(historicalFingerprint, historicalDocument);
    const reimport = () => request(`/api/drafts/${draft.id}/reimport`, {
      method: 'POST', body: {revision: draft.revision, password, reason: '核对历史图片后重新导入'},
    });
    try {
      const rejectedPublish = await publish();
      expectStatus(rejectedPublish, 409);
      assert.equal(rejectedPublish.body.code, 'HISTORICAL_ID_MISSING');
      const rejectedReimport = await reimport();
      expectStatus(rejectedReimport, 409);
      assert.equal(rejectedReimport.body.code, 'HISTORICAL_ID_MISSING');
      assert.equal((await bootstrap()).versions.length, startingCount);
      const unchangedDraft = draftResult(expectStatus(await request(`/api/drafts/${draft.id}`), 200));
      assert.equal(unchangedDraft.revision, startingRevision);
      assert.deepEqual(unchangedDraft.document, savedDocument);
    } finally {
      const deleted = app.store.db.prepare('DELETE FROM content_source_baselines WHERE fingerprint=? AND document=?')
        .run(historicalFingerprint, historicalDocument);
      assert.equal(deleted.changes, 1, 'cleanup must remove exactly the test-inserted baseline');
    }
    draft = draftResult(expectStatus(await reimport(), 200));
    assert.equal(draft.revision, startingRevision + 1);
    assert.deepEqual(draft.document, savedDocument);
    assert.equal((await bootstrap()).versions.length, startingCount);
  });

  await t.test('failed reauthentication and compatibility blockers create no version; snapshots and restores preserve history', async () => {
    const startingCount = (await bootstrap()).versions.length;
    expectStatus(await publish({password: 'incorrect-admin-password'}), 403);
    expectStatus(await publish({reason: ''}), 400);
    assert.equal((await bootstrap()).versions.length, startingCount);

    // Simulate stale imported facts in memory, without touching either game.
    // Publishing must detect disagreement with the freshly reread disk source.
    const importedFingerprint = app.source.fingerprint;
    try {
      app.source.fingerprint = 'f'.repeat(64);
      const sourceChanged = await publish();
      expectStatus(sourceChanged, 409);
      assert.equal(sourceChanged.body.code, 'SOURCE_CHANGED');
      assert.equal((await bootstrap()).versions.length, startingCount);
    } finally {
      app.source.fingerprint = importedFingerprint;
    }

    const safeVersion = await publish({label: '安全分类快照'});
    assert.ok([200, 201].includes(safeVersion.status), JSON.stringify(safeVersion.body));
    safeVersionId = (safeVersion.body.version ?? safeVersion.body).id;
    assert.ok(safeVersionId);
    const download = expectStatus(await request(`/api/versions/${safeVersionId}/download`), 200);
    assert.ok(download);
    assert.equal(download.schema, 'jigsaw-content-admin/export-v1');
    assert.deepEqual(download.document, draft.document);
    assert.equal(download.version.kind, 'snapshot');
    const beforeBlockedCandidate = (await bootstrap()).versions.length;
    const pcCandidate = await publish({kind: 'candidate', target: 'pc'});
    expectStatus(pcCandidate, 422);
    assert.ok(pcCandidate.body.analysis.blockers.some(issue => issue.target === 'pc' && issue.code === 'SHARED_ALBUM_RUNTIME_ADAPTER_REQUIRED'));
    assert.equal((await bootstrap()).versions.length, beforeBlockedCandidate);
    const candidate = await publish({kind: 'candidate', target: 'mobile-shared', label: '安全小游戏候选'});
    assert.ok([200, 201].includes(candidate.status), JSON.stringify(candidate.body));
    const candidateId = (candidate.body.version ?? candidate.body).id;
    const exportedCandidate = expectStatus(await request(`/api/versions/${candidateId}/download`), 200);
    assert.ok(exportedCandidate.files.length > 0);
    assert.equal(exportedCandidate.document, undefined, 'public candidate downloads must not include a private CMS draft');
    assert.ok(exportedCandidate.files.every(file => !/image-provenance|\.sqlite|player|password|secret/i.test(file.path)));
    for (const asset of app.source.assets.filter(asset => asset.lifecycle === 'pending' && !asset.runtimeAvailable)) assert.ok(exportedCandidate.files.every(file => !file.content.includes(asset.id)), 'pending artwork must stay out of public runtime candidates');
    const beforePlanning = structuredClone(draft.document);
    const planned = structuredClone(draft.document);
    planned.albums[0].price += 1;
    planned.albums[0].imageIds.pop();
    draft = draftResult(expectStatus(await save(planned), 200));
    const analysis = expectStatus(await request(`/api/drafts/${draft.id}/analyze`, {method: 'POST', body: {revision: draft.revision}}), 200);
    const codes = analysis.blockers.map(item => item.code);
    assert.ok(codes.includes('MOBILE_PACK_PRICE_CHANGED'));
    assert.ok(codes.includes('MOBILE_PACK_MEMBERS_CHANGED'));
    const savedCount = (await bootstrap()).versions.length;
    expectStatus(await publish({kind: 'candidate', target: 'mobile-shared'}), 422);
    assert.equal((await bootstrap()).versions.length, savedCount);

    const planningSnapshot = await publish({label: '包含阻断的规划快照'});
    assert.ok([200, 201].includes(planningSnapshot.status), JSON.stringify(planningSnapshot.body));
    assert.equal((await bootstrap()).versions.length, savedCount + 1);
    expectStatus(await request(`/api/versions/${safeVersionId}/download`, {auth: false}), 401);
    expectStatus(await request(`/api/versions/${safeVersionId}/restore`, {method: 'POST', body: {password: 'wrong-password', reason: '错误密码回退', name: '不应存在'}}), 403);
    const restored = draftResult(expectStatus(await request(`/api/versions/${safeVersionId}/restore`, {method: 'POST', body: {password, reason: '恢复安全分类草稿', name: 'HTTP 恢复草稿'}}), 201));
    assert.notEqual(restored.id, draft.id);
    assert.deepEqual(restored.document, {...beforePlanning, name: 'HTTP 恢复草稿'});
    const oldDraft = draftResult(expectStatus(await request(`/api/drafts/${draft.id}`), 200));
    assert.equal(oldDraft.document.albums[0].price, planned.albums[0].price);
    assert.equal((await bootstrap()).versions.length, savedCount + 1);
  });

  await t.test('logout revokes access, login rotates the session and repeated bad credentials are bounded', async () => {
    const oldCookie = cookie;
    expectStatus(await request('/api/logout', {method: 'POST', body: {}}), 200);
    expectStatus(await request('/api/bootstrap'), 401);
    const login = await request('/api/login', {method: 'POST', auth: false, captureCookie: true, body: {username: 'test-admin', password}});
    csrfToken = expectStatus(login, 200).csrfToken;
    assert.notEqual(cookie, oldCookie);
    expectStatus(await request('/api/bootstrap', {headers: {cookie: oldCookie}}), 401);
    expectStatus(await request('/api/bootstrap'), 200);
    let limited = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await request('/api/login', {method: 'POST', auth: false, body: {username: 'test-admin', password: 'invalid-credentials'}});
      if (result.status === 429) {limited = true; break;}
      expectStatus(result, 401);
    }
    assert.equal(limited, true, 'bad credential attempts must reach the login rate limit');
  });
});
