import test from 'node:test';
import assert from 'node:assert/strict';
import { beijingDayStart, completionStats } from '../lib/completion-stats.ts';

// A fake D1-style database: records the bound parameter so the test can prove which day was asked for.
function fakeDatabase(today, total, pieces, calls) {
  if (!calls) { calls = pieces; pieces = 0; }
  return {
    prepare(sql) {
      assert.match(sql, /FROM puzzle_results/);
      return {
        bind(...values) {
          return {
            all: async () => {
              calls.push(values);
            return { results: [{ today, total, pieces }] };
            },
          };
        },
      };
    },
  };
}

// Beijing is UTC+8 and has no daylight saving, so the site's day boundary is a fixed offset:
// the same midnight the day's picture turns over at.
test('the day boundary is midnight in Beijing', () => {
  // 2026-09-21 23:59 Beijing is still the 21st.
  assert.equal(beijingDayStart(Date.UTC(2026, 8, 21, 15, 59)), Date.UTC(2026, 8, 20, 16, 0));
  // 2026-09-22 00:01 Beijing has moved to the 22nd.
  assert.equal(beijingDayStart(Date.UTC(2026, 8, 21, 16, 1)), Date.UTC(2026, 8, 21, 16, 0));
  // Midday in Beijing sits inside the same day.
  assert.equal(beijingDayStart(Date.UTC(2026, 8, 22, 4, 0)), Date.UTC(2026, 8, 21, 16, 0));
});

test('today is counted from the Beijing day start and the total has no boundary', async () => {
  const calls = [], now = Date.UTC(2026, 8, 21, 15, 0);
  const stats = await completionStats(now, fakeDatabase(7, 1234, 9876, calls));
  assert.deepEqual(stats, { completedToday: 7, completedTotal: 1234, completedPiecesTotal: 9876 });
  assert.deepEqual(calls, [[beijingDayStart(now)]]);
});

test('the numbers are memoised briefly, and recomputed when the day turns over', async () => {
  const calls = [];
  const database = fakeDatabase(3, 50, 4000, calls);
  const now = Date.UTC(2026, 8, 21, 15, 0);
  await completionStats(now, database);
  // A lobby polls every few seconds; a finished puzzle is rare, so the second poll must not query.
  await completionStats(now + 4000, database);
  assert.equal(calls.length, 1);
  // After the cache expires it asks again.
  await completionStats(now + 6000, database);
  assert.equal(calls.length, 2);
  // Crossing midnight always asks again, even inside the cache window.
  const afterMidnight = Date.UTC(2026, 8, 21, 16, 5);
  const fresh = fakeDatabase(0, 51, calls);
  assert.deepEqual(await completionStats(afterMidnight, fresh), { completedToday: 0, completedTotal: 51, completedPiecesTotal: 0 });
  assert.equal(calls.length, 3);
});

test('a request against another database is not served from the cache', async () => {
  const calls = [];
  const now = Date.UTC(2026, 8, 21, 15, 0);
  await completionStats(now, fakeDatabase(1, 2, calls));
  await completionStats(now, fakeDatabase(9, 99, calls));
  assert.equal(calls.length, 2);
});
