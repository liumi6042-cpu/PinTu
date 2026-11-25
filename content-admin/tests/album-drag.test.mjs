import test from 'node:test';
import assert from 'node:assert/strict';
import {MIME, createDragPayload, parseDragPayload} from '../public/album-drag.js';

const knownIds = new Set(['one', 'two', 'three']);
const context = {target: 'mobile-shared', knownIds};
const encode = imageIds => JSON.stringify({schema: 'jigsaw-album-images/v1', target: context.target, imageIds});

test('dragging a selected picture carries the known selection in order, without duplicates', () => {
  assert.equal(MIME, 'application/x-jigsaw-album-images');
  const selectedIds = ['two', 'one', 'two', 'unknown', null];
  const raw = createDragPayload({...context, imageId: 'one', selectedIds});
  assert.deepEqual(parseDragPayload(raw, context), ['two', 'one']);
  assert.deepEqual(selectedIds, ['two', 'one', 'two', 'unknown', null]);
  assert.deepEqual([...knownIds], ['one', 'two', 'three']);
});

test('dragging outside a selection carries only the dragged picture', () => {
  const raw = createDragPayload({...context, imageId: 'three', selectedIds: new Set(['one', 'two'])});
  assert.deepEqual(parseDragPayload(raw, context), ['three']);
  assert.deepEqual(parseDragPayload(createDragPayload({...context, imageId: 'one'}), context), ['one']);
});

test('unknown or missing pictures cannot start a drag', () => {
  for (const imageId of ['', 'unknown', null, 1]) {
    assert.equal(createDragPayload({...context, imageId}), null);
  }
  assert.equal(createDragPayload(), null);
  assert.equal(createDragPayload({imageId: 'one', target: context.target}), null);
  assert.equal(createDragPayload({...context, imageId: 'one', target: ''}), null);
});

test('payloads cannot cross game targets or contain any unknown image', () => {
  assert.deepEqual(parseDragPayload(encode(['one']), {...context, target: 'pc'}), []);
  assert.deepEqual(parseDragPayload(encode(['one', 'unknown']), context), []);
  assert.deepEqual(parseDragPayload(encode(['one']), {...context, knownIds: []}), []);
  assert.deepEqual(parseDragPayload(encode(['one']), {target: null, knownIds}), []);
});

test('foreign, malformed and empty drag data is ignored', () => {
  const invalid = [null, undefined, 42, '', 'one', '{', 'null', '[]', '{}',
    JSON.stringify({schema: 'other-app', target: context.target, imageIds: ['one']}),
    JSON.stringify({schema: 'jigsaw-album-images/v1', target: context.target, imageIds: ['one'], extra: true}),
    JSON.stringify({schema: 'jigsaw-album-images/v1', target: context.target, imageIds: 'one'}),
    encode([]), encode(['']), encode([null]), encode([1]), encode([{}])];
  for (const raw of invalid) assert.deepEqual(parseDragPayload(raw, context), [], String(raw));
  assert.deepEqual(parseDragPayload(encode(['one', 'one', 'two']), context), ['one', 'two']);
});

test('bounded payloads cover the inventory but reject excessive counts and byte lengths', () => {
  const ids = Array.from({length: 187}, (_, i) => `generated-image-${i.toString().padStart(3, '0')}`);
  const largerContext = {target: 'pc', knownIds: ids};
  const raw = createDragPayload({...largerContext, imageId: ids[0], selectedIds: new Set(ids)});
  assert.deepEqual(parseDragPayload(raw, largerContext), ids);
  assert.deepEqual(parseDragPayload(encode(Array(1001).fill('one')), context), []);
  assert.deepEqual(parseDragPayload(`${' '.repeat(64 * 1024)}${encode(['one'])}`, context), []);

  const manyIds = Array.from({length: 1001}, (_, i) => `image-${i}`);
  assert.equal(createDragPayload({target: 'pc', imageId: manyIds[0], knownIds: manyIds, selectedIds: manyIds}), null);
  const wideIds = Array.from({length: 300}, (_, i) => `${'画'.repeat(90)}-${i}`);
  assert.equal(createDragPayload({target: 'pc', imageId: wideIds[0], knownIds: wideIds, selectedIds: wideIds}), null);
  const wideRaw = JSON.stringify({schema: 'jigsaw-album-images/v1', target: 'pc', imageIds: wideIds});
  assert.ok(wideRaw.length < 64 * 1024, 'the byte bound must cover multibyte names');
  assert.deepEqual(parseDragPayload(wideRaw, {target: 'pc', knownIds: wideIds}), []);
});
