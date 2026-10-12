import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beijingDate,tomorrowDate,nextOpenDailyDate,dailyImageState} from '../public/daily-state.js';

test('daily labels use Beijing midnight',()=>{
 const before=Date.parse('2026-10-12T15:59:59.000Z');
 assert.equal(beijingDate(before),'2026-10-12');
 assert.equal(beijingDate(before+1000),'2026-10-13');
 assert.equal(tomorrowDate(before),'2026-10-13');
});
test('automatic preview skips reserved dates and crosses months in Beijing time',()=>{
 const plans=[{imageId:'manual',date:'2026-11-02'},{imageId:'queued',date:'2026-11-03'}];
 const now=Date.parse('2026-10-31T16:00:00Z');
 assert.equal(nextOpenDailyDate(plans,{now}),'2026-11-04');
 assert.equal(nextOpenDailyDate(plans,{now,excludeId:'manual'}),'2026-11-02');
});
test('a past plan without a confirmed appearance remains unconfirmed',()=>{
 const result=dailyImageState({imageId:'test-photo',today:'2026-10-14',plans:[{imageId:'test-photo',date:'2026-10-13',albumId:'test-album'}]});
 assert.equal(result.code,'awaiting');assert.equal(result.locked,false);
});
test('appearance and enrollment facts distinguish today from collection',()=>{
 const input={imageId:'test-photo',today:'2026-10-13',plans:[{imageId:'test-photo',date:'2026-10-13',albumId:'test-album'}],appearances:[{imageId:'test-photo',date:'2026-10-13',albumId:'test-album'}]};
 assert.equal(dailyImageState(input).code,'today');assert.equal(dailyImageState(input).locked,true);
 assert.equal(dailyImageState({...input,today:'2026-10-14'}).code,'appeared');
 const result=dailyImageState({...input,enrollments:[{imageId:'test-photo',firstAppearanceDate:'2026-10-13',albumId:'test-album'}]});
 assert.equal(result.code,'enrolled');assert.equal(result.locked,true);
});
