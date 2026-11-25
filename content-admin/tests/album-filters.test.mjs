import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ALBUM_FILTER_SCOPES, albumDailyStats, countAlbumScopes, filterAlbums} from '../public/album-filters.js';
import {createAdminServer} from '../server.mjs';
import {readSource} from '../source.mjs';

const sampleAlbums = [
  {id: 'a-mobile-free', title: '微光停留的地方', description: '日常光影', styleGroupId: 's-soft', showOnPc: false, showOnMobile: true, purchasable: false, imageIds: ['img-1', 'img-2']},
  {id: 'a-mobile-paid', title: '海风集', description: '夏日海岸', styleGroupId: 's-watercolor', showOnPc: true, showOnMobile: true, purchasable: true, imageIds: ['img-3']},
  {id: 'a-pc-only', title: '幻想山海', description: '九尾狐', styleGroupId: 's-fantasy', showOnPc: true, showOnMobile: false, purchasable: false, imageIds: ['img-4']},
  {id: 'a-hidden', title: '春日粉彩漫游', description: '待发布', styleGroupId: 's-soft', showOnPc: false, showOnMobile: false, purchasable: false, imageIds: ['img-5']},
];

const dailyPlans = [
  {id: 'img-1', imageId: 'img-1', date: null, albumId: 'a-mobile-free', autoPublish: true},
  {id: 'img-2', imageId: 'img-2', date: null, albumId: 'a-mobile-free', autoPublish: true},
  {id: 'img-5', imageId: 'img-5', date: null, albumId: 'a-hidden', autoPublish: true},
];

const dailyStateFor = id => ({
  'img-1': {code: 'enrolled'},
  'img-2': {code: 'automatic'},
  'img-5': {code: 'automatic'},
}[id] || {code: 'none'});

const styleNameFor = id => ({'s-soft': '柔和插画', 's-watercolor': '水彩', 's-fantasy': '幻想'}[id] || '');

test('album filter scopes distinguish mobile, PC-only, hidden, purchasable, free and daily albums', () => {
  const ctx = {dailyPlans, dailyStateFor, styleNameFor};
  assert.equal(ALBUM_FILTER_SCOPES.length, 7);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'mobile'}).map(a => a.id), ['a-mobile-free', 'a-mobile-paid']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'pc-only'}).map(a => a.id), ['a-pc-only']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'hidden'}).map(a => a.id), ['a-hidden']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'purchasable'}).map(a => a.id), ['a-mobile-paid']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'free'}).map(a => a.id), ['a-mobile-free', 'a-pc-only', 'a-hidden']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'daily'}).map(a => a.id), ['a-mobile-free', 'a-hidden']);
  assert.deepEqual(countAlbumScopes(sampleAlbums, ctx), {
    all: 4, mobile: 2, 'pc-only': 1, hidden: 1, purchasable: 1, free: 3, daily: 2,
  });
});

test('album search matches title, description, id and style name alongside scope filter and daily stats', () => {
  const ctx = {dailyPlans, dailyStateFor, styleNameFor};
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, query: '柔和插画'}).map(a => a.id), ['a-mobile-free', 'a-hidden']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, scope: 'mobile', query: '柔和插画'}).map(a => a.id), ['a-mobile-free']);
  assert.deepEqual(filterAlbums(sampleAlbums, {...ctx, query: '九尾狐'}).map(a => a.id), ['a-pc-only']);
  assert.deepEqual(albumDailyStats(sampleAlbums[0], ctx), {total: 2, pending: 1});
  assert.deepEqual(albumDailyStats(sampleAlbums[2], ctx), {total: 0, pending: 0});
});

test('admin server exposes /album-filters.js static asset', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jigsaw-album-filter-route-'));
  const app = createAdminServer({source: readSource(), dataDir: join(root, 'admin'), appearanceDir: join(root, 'appearances')});
  t.after(async () => { await app.close(); rmSync(root, {recursive: true, force: true}); });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const res = await fetch(`http://127.0.0.1:${app.server.address().port}/album-filters.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/javascript/);
  assert.match(await res.text(), /export function filterAlbums/);
});
