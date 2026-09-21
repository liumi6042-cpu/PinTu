import { dailyPuzzleDay } from './daily-puzzle';

const DAY = 86400000, BEIJING_OFFSET = 8 * 3600000;

// The start of the Beijing day the visitor is living in — the same midnight the day's
// picture turns over at, so "today" means the same thing everywhere on the site.
export const beijingDayStart = (now: number) => dailyPuzzleDay(now) * DAY - BEIJING_OFFSET;

export type CompletionStats = { completedToday: number; completedTotal: number };

type Reader = { prepare: (sql: string) => { bind: (...values: number[]) => { all: () => Promise<{ results: Array<Record<string, unknown>> }> } } };

// One row per finished puzzle, written by saveCompletion when a room completes with every
// piece placed. Rows are never deleted, so the total is the site's whole history.
async function countCompletions(database: Reader, now: number): Promise<CompletionStats> {
  const result = await database
    .prepare('SELECT (SELECT COUNT(*) FROM puzzle_results WHERE completed_at >= ?) AS today, (SELECT COUNT(*) FROM puzzle_results) AS total')
    .bind(beijingDayStart(now)).all();
  const row = result.results[0] ?? {};
  return { completedToday: Number(row.today) || 0, completedTotal: Number(row.total) || 0 };
}

// A finished puzzle is rare next to a lobby poll every few seconds, so the numbers are
// memoised instead of being counted on every request. The Beijing day is part of the key:
// after midnight the first visitor of the new day sees a fresh count rather than yesterday's.
//
// The database is a parameter rather than a module-level import so this file stays free of the
// Cloudflare runtime and can be unit-tested; the lobby route hands it localDb().
const CACHE_MS = 30000;
let cache: { database: object; day: number; expiresAt: number; stats: CompletionStats } | undefined;

export async function completionStats(now: number, database: Reader): Promise<CompletionStats> {
  const day = dailyPuzzleDay(now);
  if (cache && cache.database === database && cache.day === day && now < cache.expiresAt) return { ...cache.stats };
  const stats = await countCompletions(database, now);
  cache = { database: database as object, day, expiresAt: now + CACHE_MS, stats };
  return { ...stats };
}
