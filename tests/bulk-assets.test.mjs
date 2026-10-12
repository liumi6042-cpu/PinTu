import test from 'node:test';
import assert from 'node:assert/strict';
import {planBulkAssets, applyBulkAssets} from '../public/bulk-assets.js';

const fixture = () => ({
  name: '测试草稿', styles: [{id: 'paper', name: '纸艺'}],
  assets: {
    first: {title: '纸艺海边', subtitle: '保留来源说明', styleGroupId: 'paper', subjectTags: ['海边'],
      targets: {pc: {status: 'published', galleryVisible: true, dailyOnly: false, category: '风景'},
        'mobile-shared': {status: 'published', galleryVisible: true, dailyOnly: false, category: '风景'}}},
    daily: {title: '每日森林', subtitle: '', styleGroupId: null, subjectTags: [],
      targets: {pc: {status: 'published', galleryVisible: false, dailyOnly: true, category: '每日'},
        'mobile-shared': {status: 'archived', galleryVisible: false, dailyOnly: true, category: '每日'}}},
  },
  targets: {
    pc: {packs: [], albums: []},
    'mobile-shared': {
      packs: [{id: 'pack-old', title: '旧图包', imageIds: ['first'], coverImageId: 'first', price: 180}],
      albums: [{id: 'album-old', title: '旧图鉴', imageIds: ['first'], milestones: [{target: 1, coins: 20}]}],
    },
  },
});

test('plan deduplicates selection and leaves the draft and source facts unchanged', () => {
  const document = fixture();
  const before = structuredClone(document);
  const plan = planBulkAssets(document, ['first', 'first', 'daily'], 'mobile-shared', 'archive');
  assert.deepEqual(plan.ids, ['first', 'daily']);
  assert.equal(plan.target, 'mobile-shared');
  assert.equal(plan.action, 'archive');
  assert.deepEqual(plan.changes, [{id: 'first', title: '纸艺海边',
    before: {status: 'published', galleryVisible: true}, after: {status: 'archived', galleryVisible: true}}]);
  assert.equal(plan.unchangedCount, 1);
  assert.deepEqual(document, before);
});

test('archive and restore preserve historical IDs, metadata, original arrays and the other target', () => {
  const document = fixture();
  const before = structuredClone(document);
  const packs = document.targets['mobile-shared'].packs;
  const members = packs[0].imageIds;
  const tags = document.assets.first.subjectTags;
  applyBulkAssets(document, new Set(['first']), 'mobile-shared', 'archive');
  assert.equal(document.assets.first.targets['mobile-shared'].status, 'archived');
  assert.deepEqual(document.assets.first.targets.pc, before.assets.first.targets.pc);
  assert.strictEqual(document.targets['mobile-shared'].packs, packs);
  assert.strictEqual(packs[0].imageIds, members);
  assert.strictEqual(document.assets.first.subjectTags, tags);
  assert.deepEqual(document.targets, before.targets);
  assert.deepEqual(Object.keys(document.assets), Object.keys(before.assets));
  applyBulkAssets(document, ['first', 'daily'], 'mobile-shared', 'restore');
  assert.deepEqual(document.assets.first, before.assets.first);
  assert.deepEqual(document.assets.daily.targets['mobile-shared'], {
    status: 'published', galleryVisible: false, dailyOnly: true, category: '每日',
  });
  assert.deepEqual(document.assets.daily.targets.pc, before.assets.daily.targets.pc);
});

test('hide and show change visibility only and preserve daily and archived status', () => {
  const document = fixture();
  const before = structuredClone(document);
  applyBulkAssets(document, ['first', 'daily'], 'mobile-shared', 'hide');
  assert.deepEqual(document.assets.first.targets['mobile-shared'], {
    ...before.assets.first.targets['mobile-shared'], galleryVisible: false,
  });
  applyBulkAssets(document, ['daily'], 'mobile-shared', 'show');
  assert.deepEqual(document.assets.daily.targets['mobile-shared'], {
    status: 'archived', galleryVisible: true, dailyOnly: true, category: '每日',
  });
  assert.deepEqual(document.assets.daily.targets.pc, before.assets.daily.targets.pc);
  assert.deepEqual(document.targets, before.targets);
});

test('unchanged actions are a no-op for both plan and apply', () => {
  const document = fixture();
  const before = structuredClone(document);
  for (const [id, action] of [['first', 'restore'], ['first', 'show'], ['daily', 'archive'], ['daily', 'hide']]) {
    const plan = applyBulkAssets(document, [id], 'mobile-shared', action);
    assert.deepEqual(plan.changes, []);
    assert.equal(plan.unchangedCount, 1);
  }
  assert.deepEqual(document, before);
});

test('invalid or mixed selections reject atomically before changing any asset', () => {
  const document = fixture();
  const before = structuredClone(document);
  for (const [ids, target, action] of [
    [['first', 'missing'], 'mobile-shared', 'archive'],
    [['first'], 'unknown-target', 'archive'],
    [['first'], 'pc', 'delete'],
    [[], 'pc', 'archive'],
    ['first', 'pc', 'archive'],
    [[1], 'pc', 'archive'],
    [['constructor'], 'pc', 'archive'],
  ]) assert.throws(() => applyBulkAssets(document, ids, target, action), error => error.status === 400);
  assert.deepEqual(document, before);
});

test('warning text identifies related packs and albums and preserves daily semantics', () => {
  const plan = planBulkAssets(fixture(), ['first', 'daily'], 'mobile-shared', 'archive');
  const text = plan.warnings.join('\n');
  assert.match(text, /不删除图片原件/);
  assert.match(text, /旧房间/);
  assert.match(text, /pack-old/);
  assert.match(text, /album-old/);
  assert.match(text, /价格、玩家权益或图鉴进度/);
  assert.match(text, /每日专用素材：daily/);
  assert.match(text, /兼容检查阻断/);
  const pcText = planBulkAssets(fixture(), ['first'], 'pc', 'archive').warnings.join('\n');
  assert.doesNotMatch(pcText, /pack-old|album-old/);
});
