import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beijingDate,tomorrowDate,nextOpenDailyDate,dailyImageState} from '../public/daily-state.js';

test('daily labels use Beijing midnight',()=>{
 const before=Date.parse('2026-10-12T15:59:59.000Z');
 assert.equal(beijingDate(before),'2026-10-12');
 assert.equal(beijingDate(before+1000),'2026-10-13');
 assert.equal(tomorrowDate(before),'2026-10-13');
});
test('manual date suggestion ignores automatic candidates including old reserved slots',()=>{
 const plans=[{imageId:'manual',date:'2026-11-02'},{imageId:'queued',date:null,autoPublish:true},{imageId:'old-auto',date:'2026-11-03',autoDate:true}];
 const now=Date.parse('2026-10-31T16:00:00Z');
 assert.equal(nextOpenDailyDate(plans,{now}),'2026-11-03');
 assert.equal(nextOpenDailyDate(plans,{now,excludeId:'manual'}),'2026-11-02');
});
test('automatic candidates have no date until an actual appearance',()=>{
 const input={imageId:'auto-photo',today:'2026-10-13',plans:[{imageId:'auto-photo',date:null,albumId:'album',autoPublish:true}]};
 const pending=dailyImageState(input);assert.equal(pending.code,'automatic');assert.equal(pending.locked,false);
 assert.doesNotMatch(pending.detail,/null/);
 const appeared=dailyImageState({...input,appearances:[{imageId:'auto-photo',date:'2026-10-13',albumId:'album',planned:true}]});
 assert.equal(appeared.code,'today');assert.equal(appeared.locked,true);
});
test('library fallback records appearance without promising another album enrollment',()=>{
 const input={imageId:'library-photo',today:'2026-10-15',appearances:[{imageId:'library-photo',date:'2026-10-13',albumId:null,planned:false},{imageId:'library-photo',date:'2026-10-15',albumId:null,planned:false}]};
 assert.equal(dailyImageState(input).code,'today');assert.equal(dailyImageState(input).locked,false);
 assert.equal(dailyImageState({...input,today:'2026-10-16'}).code,'library');
 assert.doesNotMatch(dailyImageState(input).detail,/自动收录/);
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
