import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPuzzle,dailyPuzzleDay,dailyPuzzleDate } from '../lib/daily-puzzle.ts';
import { PHOTOS } from '../lib/puzzle-catalog.ts';

const beijing = value => Date.parse(value + '+08:00');

test('one Beijing day gives every visitor the same picture', () => {
  const early = beijing('2026-09-21T00:01:00'), late = beijing('2026-09-21T23:59:00');
  assert.equal(dailyPuzzleDate(early), '2026-09-21');
  assert.equal(dailyPuzzleDate(late), '2026-09-21');
  assert.equal(dailyPuzzle(early).id, dailyPuzzle(late).id);
});

test('the picture turns over at midnight Beijing time, not midnight UTC', () => {
  const before = beijing('2026-09-21T23:59:59'), after = beijing('2026-09-22T00:00:01');
  assert.equal(dailyPuzzleDate(before), '2026-09-21');
  assert.equal(dailyPuzzleDate(after), '2026-09-22');
  assert.equal(dailyPuzzleDay(after), dailyPuzzleDay(before) + 1);
  assert.notEqual(dailyPuzzle(before).id, dailyPuzzle(after).id);
  // 16:00 UTC is already the next day in Beijing, so a UTC-based rule would be late.
  assert.equal(dailyPuzzleDate(Date.parse('2026-09-21T16:00:00Z')), '2026-09-22');
});

test('the rotation visits every published picture before it repeats', () => {
  const start = dailyPuzzleDay(beijing('2026-09-21T12:00:00'));
  const seen = Array.from({length: PHOTOS.length}, (_, i) => dailyPuzzle((start + i) * 86400000).id);
  assert.equal(new Set(seen).size, PHOTOS.length, 'a full cycle must not repeat a picture');
  assert.equal(dailyPuzzle((start + PHOTOS.length) * 86400000).id, seen[0]);
  for (const id of seen) assert.ok(PHOTOS.some(photo => photo.id === id), id);
});
