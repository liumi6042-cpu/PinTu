import test from 'node:test';import assert from 'node:assert/strict';
import {welcomeSlot,welcomeSlotKey,welcomeDue,pickWelcomeLine,welcomeTieIn,readWelcomeRecord,beijingClock,welcomeStart,WELCOME_LINES,WELCOME_AWAY_LINE} from '../mobile/welcome-greeting.ts';

// Beijing wall clock on a given October 2026 day.
const at=(hour,minute,day=31)=>Date.UTC(2026,9,day,hour-8,minute);
const slot=(hour,minute,day)=>welcomeSlot(at(hour,minute,day)).id;
const context=(now,extra={})=>({now,lastVisit:now-3600000,dailyFinished:false,story:null,energyFull:false,...extra});

test('slot boundaries follow Beijing time',()=>{
 assert.equal(slot(4,59),'small');assert.equal(slot(5,0),'dawn');
 assert.equal(slot(8,59),'dawn');assert.equal(slot(9,0),'morning');
 assert.equal(slot(11,29),'morning');assert.equal(slot(11,30),'noon');
 assert.equal(slot(13,59),'noon');assert.equal(slot(14,0),'afternoon');
 assert.equal(slot(17,59),'afternoon');assert.equal(slot(18,0),'dusk');
 assert.equal(slot(19,59),'dusk');assert.equal(slot(20,0),'evening');
 assert.equal(slot(22,59),'evening');assert.equal(slot(23,0),'late');
 assert.equal(slot(0,0),'late');assert.equal(slot(1,59),'late');assert.equal(slot(2,0),'small');
 assert.equal(welcomeSlot(at(20,0)).greeting,'晚上好');assert.equal(welcomeSlot(at(2,30)).greeting,'还没睡呀');
 assert.equal(beijingClock(at(21,30)),'21:30');assert.equal(beijingClock(at(0,5)),'00:05');
});

test('深夜 after midnight belongs to the evening it started',()=>{
 assert.equal(welcomeSlotKey(at(23,30,30)),welcomeSlotKey(at(1,30,31)));
 assert.notEqual(welcomeSlotKey(at(23,30,30)),welcomeSlotKey(at(23,30,31)));
 assert.notEqual(welcomeSlotKey(at(15,0,30)),welcomeSlotKey(at(15,0,31)));
});

test('greets once per slot and never within three hours',()=>{
 assert.equal(welcomeDue(null,at(9,0)),true);
 const shown=at(16,0),record={at:shown,key:welcomeSlotKey(shown),line:'',visit:shown};
 assert.equal(welcomeDue(record,at(17,59)),false,'same 下午 slot');
 assert.equal(welcomeDue(record,at(18,30)),false,'new slot but under three hours');
 assert.equal(welcomeDue(record,at(19,0)),true);
 assert.equal(welcomeDue(record,at(16,0,32)),true,'same slot on the next day');
 const late={at:at(23,10,30),key:welcomeSlotKey(at(23,10,30)),line:'',visit:0};
 assert.equal(welcomeDue(late,at(2,30,31)),true,'凌晨 is its own slot once three hours passed');
 assert.equal(welcomeDue({...late,at:at(1,0,31),key:welcomeSlotKey(at(1,0,31))},at(2,30,31)),false);
 assert.equal(readWelcomeRecord('not json'),null);assert.equal(readWelcomeRecord(JSON.stringify({at:5,key:'x'})).visit,5);
});

test('lines rotate within the slot and skip the previous one',()=>{
 const evening=welcomeSlot(at(21,0));
 for(const last of WELCOME_LINES.evening)for(const r of [0,.5,.999])assert.notEqual(pickWelcomeLine(evening,last,()=>r),last);
 assert.ok(WELCOME_LINES.evening.includes(pickWelcomeLine(evening,'',()=>0)));
});

test('tie-ins follow the priority order and stay quiet late at night',()=>{
 const story={title:'早餐街',left:3};
 assert.deepEqual(welcomeTieIn(context(at(19,40),{lastVisit:at(19,40,26),story})),{kind:'away',text:'今日拼图已经备好',icon:'piece',line:WELCOME_AWAY_LINE});
 assert.equal(welcomeTieIn(context(at(19,40),{story})).text,'每日拼图还有 20 分钟换新');
 assert.equal(welcomeTieIn(context(at(19,40),{story,dailyFinished:true})).kind,'story');
 assert.equal(welcomeTieIn(context(at(20,5),{story})).text,'今晚的每日拼图刚上新');
 assert.equal(welcomeTieIn(context(at(22,0),{story})).text,'「早餐街」还差 3 关');
 assert.equal(welcomeTieIn(context(at(15,0),{energyFull:true})).kind,'energy');
 assert.equal(welcomeTieIn(context(at(23,30),{energyFull:true})),null);
 assert.equal(welcomeTieIn(context(at(3,0),{energyFull:true,story})).kind,'story');
 assert.equal(welcomeTieIn(context(at(15,0))),null);
});

test('开拼 rejoins, then joins an open daily table, then creates one',()=>{
 const room=(id,extra={})=>({id,imageId:'daily-a',players:2,completed:false,placed:20,pieces:108,...extra});
 const rooms=[room('other',{imageId:'b',placed:80}),room('full',{players:8,placed:90}),room('busy',{placed:60}),room('fresh',{placed:5}),room('done',{completed:true}),room('closing',{placed:100}),room('locked',{acceptingNew:false,placed:70}),room('small-cap',{players:4,maxPlayers:4,placed:70})];
 assert.deepEqual(welcomeStart({own:[{id:'old',completed:true},{id:'gone',unavailable:true},{id:'mine'}],rooms,dailyImageId:'daily-a'}),{kind:'rejoin',roomId:'mine'});
 assert.deepEqual(welcomeStart({own:[{id:'old',completed:true}],rooms,dailyImageId:'daily-a'}),{kind:'join',roomId:'busy'});
 assert.deepEqual(welcomeStart({own:[],rooms:rooms.filter(r=>!['busy','fresh'].includes(r.id)),dailyImageId:'daily-a'}),{kind:'create'});
 assert.deepEqual(welcomeStart({own:[],rooms,dailyImageId:null}),{kind:'create'});
});

test('a record saved on the old 4-hour-ahead daily clock only blocks its own slot',()=>{
 const shifted=at(22,15),record={at:shifted,key:welcomeSlotKey(shifted),line:'',visit:shifted};
 assert.equal(welcomeSlot(at(18,17)).greeting,'傍晚好','18:17 Beijing is 傍晚');
 assert.equal(welcomeDue(record,at(18,17)),true,'v53 greeted "晚上好" from the shifted clock; the real 傍晚 slot may still greet');
 assert.equal(welcomeDue(record,at(20,30)),false,'the real 晚上 slot was already used by that record');
});
