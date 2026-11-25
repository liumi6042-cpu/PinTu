import test from 'node:test';
import assert from 'node:assert/strict';
import {activityConnectionGoal,creditActivity} from '../public/flower-garden/catalog.mjs';
const now=Date.UTC(2026,8,26,12),day='2026-09-26';
const fresh=()=>({activity:{startedAt:now,days:[],claimed:0,lastClaimDay:'',dismissed:false}});
const credit=(s,id,count,total=400,at=now,pieces=300)=>creditActivity(s,{roomId:id,contribution:count,total,completedAt:at,pieces});

test('either 50% of one completed puzzle or 150 connections across completed puzzles qualifies',()=>{
 assert.equal(activityConnectionGoal,150);
 const single=fresh();assert.equal(credit(single,'one',50,100),true);
 const s=fresh();assert.equal(credit(s,'one',80),false);
 assert.equal(credit(s,'one',80),false);assert.equal(s.activity.contributions[day],80);
 assert.equal(credit(s,'two',69),false);assert.equal(s.activity.contributions[day],149);
 assert.equal(credit(s,'three',1),true);assert.deepEqual(s.activity.days,[day]);
 assert.equal(credit(s,'four',200),false);assert.equal(s.activity.days.length,1);
});
test('daily counters stay separate and unfinished, small or pre-activity puzzles do not count',()=>{
 const s=fresh();assert.equal(credit(s,'old',150,400,now-1),false);
 assert.equal(credit(s,'small',100,100,now,108),false);
 assert.equal(credit(s,'unfinished',150,400,NaN),false);
 assert.equal(credit(s,'today',100),false);
 assert.equal(credit(s,'tomorrow',50,400,now+86400000),false);
 assert.equal(s.activity.contributions[day],100);assert.equal(s.activity.contributions['2026-09-27'],50);
 assert.equal(credit(s,'tomorrow-next',100,400,now+86400000),true);
 assert.deepEqual(s.activity.days,['2026-09-27']);
});
test('already earned activity days and their rewards are preserved',()=>{
 const s=fresh();s.activity.days=[day];s.activity.contributions={[day]:100};
 assert.equal(credit(s,'old-retry',100),false);assert.deepEqual(s.activity.days,[day]);
});

