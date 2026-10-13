import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlbumRecovery} from '../public/album-recovery.js';

const memoryStorage = () => {
  const data = new Map();
  return {get length() {return data.size;}, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)};
};
const document = title => ({schemaVersion: 3, albums: [{id: 'example', title}], assets: {}, dailyPlans: []});

test('album recovery survives refresh, isolates owners and tabs, and clears only its own saved content', () => {
  const storage = memoryStorage(), firstSession = memoryStorage(), secondSession = memoryStorage();
  const first = createAlbumRecovery({storage, sessionStorage: firstSession, now: () => 100, newId: () => 'tab-one'});
  const second = createAlbumRecovery({storage, sessionStorage: secondSession, now: () => 200, newId: () => 'tab-two'});
  const context = {owner: '管理员:甲', draftId: 'draft/one', revision: 10};
  const base = document('已保存'), edited = document('新的相册');
  assert.equal(first.save({...context, document: edited, baseDocument: base}), true);
  assert.equal(second.save({...context, document: document('另一窗口'), baseDocument: base}), true);
  const refreshed = createAlbumRecovery({storage, sessionStorage: firstSession, newId: () => 'unused'});
  assert.equal(refreshed.getTabId(), 'tab-one');
  assert.deepEqual(refreshed.entries(context).map(entry => [entry.tabId, entry.revision]), [['tab-two', 10], ['tab-one', 10]]);
  assert.deepEqual(refreshed.entries(context)[1].document, edited);
  assert.deepEqual(refreshed.entries({...context, owner: '管理员:乙'}), []);
  assert.deepEqual(refreshed.entries({...context, draftId: 'different'}), []);
  assert.equal(first.save({...context, owner: '管理员:乙', document: edited, baseDocument: base}), true);
  assert.equal(first.save({...context, document: base, baseDocument: base}), true);
  assert.deepEqual(first.entries(context).map(entry => entry.tabId), ['tab-two']);
  assert.equal(first.entries({...context, owner: '管理员:乙'}).length, 1);
  assert.equal(first.clear(context), true);
  assert.equal(second.entries(context).length, 1, 'one tab must not delete another tab\'s recovery snapshot');
  assert.deepEqual(Object.keys(second.entries(context)[0]), ['schema', 'tabId', 'owner', 'draftId', 'revision', 'document', 'savedAt']);
});

test('album recovery ignores damaged or oversized records and storage failures never throw', () => {
  const storage = memoryStorage(), sessionStorage = memoryStorage();
  const recovery = createAlbumRecovery({storage, sessionStorage, now: () => 100, newId: () => 'fixture-tab'});
  const context = {owner: 'fixture-user', draftId: 'fixture-draft', revision: 3};
  assert.equal(recovery.save({...context, document: document('可恢复')}), true);
  const validKey = storage.key(0), prefix = validKey.slice(0, validKey.lastIndexOf(':') + 1);
  storage.setItem(prefix + 'broken', '{broken');
  storage.setItem(prefix + 'wrong-tab', JSON.stringify({...recovery.entries(context)[0], tabId: 'other'}));
  storage.setItem(prefix + 'oversized', 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.equal(recovery.entries(context).length, 1);
  assert.equal(recovery.save({...context, document: {large: 'x'.repeat(2 * 1024 * 1024)}}), false);
  assert.equal(recovery.entries(context).length, 1, 'a failed oversized save retains the previous snapshot');
  const circular = {}; circular.self = circular;
  assert.equal(recovery.save({...context, document: circular}), false);
  const failing = {get length() {throw new Error('denied');}, getItem() {throw new Error('denied');},
    setItem() {throw new Error('quota');}, removeItem() {throw new Error('denied');}};
  const unavailable = createAlbumRecovery({storage: failing, sessionStorage: failing, newId: () => 'volatile-tab'});
  assert.equal(unavailable.getTabId(), 'volatile-tab');
  assert.equal(unavailable.save({...context, document: document('新相册')}), false);
  assert.equal(unavailable.clear(context), false);
  assert.deepEqual(unavailable.entries(context), []);
});
