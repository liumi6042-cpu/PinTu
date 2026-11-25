import test from 'node:test';
import assert from 'node:assert/strict';
import { beijingWeek,recordKind } from '../lib/ranking-policy.ts';
test('weekly rankings change exactly at Monday midnight in Beijing, including the year boundary',()=>{
 const sunday=beijingWeek(Date.parse('2026-09-06T15:59:59.999Z')),monday=beijingWeek(Date.parse('2026-09-06T16:00:00Z'));
 assert.equal(sunday.end,monday.start);assert.equal(new Date(monday.start).toISOString(),'2026-09-06T16:00:00.000Z');assert.equal(monday.end-monday.start,7*86400000);
 assert.equal(new Date(beijingWeek(Date.parse('2027-01-01T00:00:00Z')).start).toISOString(),'2026-12-27T16:00:00.000Z');
});
test('only strictly faster verified completions are new personal bests',()=>{assert.equal(recordKind(1000,null),'first');assert.equal(recordKind(1000,1001),'improved');assert.equal(recordKind(1000,1000),'tied');assert.equal(recordKind(1000,999),'finished');});
