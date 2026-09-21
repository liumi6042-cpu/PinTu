import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTableChoice } from '../lib/next-table.ts';

const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

// "Another table straight away" has to be a decision nobody has to make: never the picture just
// finished, and the same size as the one that just ended whenever the new picture can carry it.
test('the next picture is a different one, at the size that just finished', () => {
  const { photo, pieces } = nextTableChoice(
    { imageId: 'a', cols: 20, rows: 15 }, // a 300-piece board
    { photos, supports: () => true, recommended: () => 108, random: () => 0 },
  );
  assert.equal(pieces, 300, 'the same size as the board just finished');
  assert.notEqual(photo.id, 'a', 'never the picture that was just completed');
});

test('the fitted board still counts as the size that was asked for', () => {
  // A 2:1 picture asked for 300 pieces plays on a fitted grid; 288 belongs to the 300 board.
  const { pieces } = nextTableChoice(
    { imageId: 'a', cols: 24, rows: 12 },
    { photos, supports: () => true, recommended: () => 108, random: () => 0 },
  );
  assert.equal(pieces, 300);
});

test('a picture that cannot carry the size gets its own recommended count', () => {
  const { photo, pieces } = nextTableChoice(
    { imageId: 'a', cols: 20, rows: 15 },
    { photos, supports: (id, count) => id === 'c' && count === 300, recommended: (id) => (id === 'c' ? 300 : 108), random: () => 0 },
  );
  assert.equal(photo.id, 'c', 'only the picture that supports the size is offered');
  assert.equal(pieces, 300);
  // Nothing supports it: fall back to the pool and to that picture's own recommendation.
  const fallback = nextTableChoice(
    { imageId: 'a', cols: 20, rows: 15 },
    { photos, supports: () => false, recommended: () => 108, random: () => 0.99 },
  );
  assert.equal(fallback.pieces, 108);
  assert.notEqual(fallback.photo.id, 'a');
});

test('an empty pool is an error rather than an undefined picture', () => {
  assert.throws(() => nextTableChoice({ imageId: 'a', cols: 20, rows: 15 }, { photos: [{ id: 'a' }] }), /没有可用图片/);
});
