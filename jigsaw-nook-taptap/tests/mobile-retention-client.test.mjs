import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {beijingDay,breathScale,chapterProgress,completionFooter,completionPrimary,readShownDay,readStreakSeen,streakBadge,streakHint,streakToast,teaserLine,weeklyCell,weeklyGiftAutoShow,weeklyGrantText,weeklyTaskRow} from '../mobile/retention.ts';
const heroBundle=await build({stdin:{contents:'export {drawDailyHeroPanel} from "./mobile/panels/lobby-gallery-panel";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {drawDailyHeroPanel}=await import('data:text/javascript;base64,'+Buffer.from(heroBundle.outputFiles[0].text).toString('base64'));

const days=[['energy-pack',{amount:1}],['coins',{amount:50}],['create-ticket',{amount:1}],['coins',{amount:80}],['energy-pack',{amount:1}],['coins',{amount:120}],['decoration',{decorationId:'grandma-hairpin',coins:100}]];
const view=(claimed,available)=>({claimed,available,loginDays:claimed+1,done:claimed>=7,tomorrowDay:null,days:days.map(([kind,extra],i)=>({day:i+1,kind,...extra,state:i+1<=claimed?'claimed':i+1===claimed+1&&available?'today':'future'}))});

test('weekly gift cells and grant texts', ()=>{
 const v=view(2,true);
 assert.deepEqual(v.days.map(day=>weeklyCell(day).label),['体力包 ×1','金币 50','建房券 ×1','金币 80','体力包 ×1','金币 120','奶奶的发夹']);
 assert.equal(weeklyCell(v.days[6]).icon,'hairpin');assert.equal(weeklyCell(v.days[6]).extra,'+100 金币');
 assert.equal(weeklyCell(v.days[0]).title,'第 1 天');
 assert.equal(weeklyGrantText({day:1,kind:'energy-pack',amount:1,coins:0,fallback:false}),'领到补满体力包 ×1');
 assert.equal(weeklyGrantText({day:1,kind:'energy-pack',amount:0,coins:50,fallback:true}),'体力包满了，改发 50 金币');
 assert.equal(weeklyGrantText({day:3,kind:'create-ticket',amount:0,coins:50,fallback:true}),'建房券满了，改发 50 金币');
 assert.equal(weeklyGrantText({day:7,kind:'decoration',amount:0,coins:100,decorationId:'grandma-hairpin',fallback:false}),'领到奶奶的发夹和 100 金币');
 assert.equal(weeklyGrantText({day:2,kind:'coins',amount:0,coins:50,fallback:false}),'领到 50 金币');
});

test('weekly gift pops once per Beijing day, never for newcomers or old backends', ()=>{
 const base={capable:true,view:view(0,true),newcomer:false,shownDay:null,today:'2026-11-01'};
 assert.equal(weeklyGiftAutoShow(base),true);
 assert.equal(weeklyGiftAutoShow({...base,capable:false}),false);
 assert.equal(weeklyGiftAutoShow({...base,view:null}),false);
 assert.equal(weeklyGiftAutoShow({...base,newcomer:true}),false);
 assert.equal(weeklyGiftAutoShow({...base,shownDay:'2026-11-01'}),false);
 assert.equal(weeklyGiftAutoShow({...base,shownDay:'2026-10-31'}),true);
 assert.equal(weeklyGiftAutoShow({...base,view:view(3,false)}),false);
 assert.equal(weeklyGiftAutoShow({...base,view:view(7,false)}),false);
 assert.equal(readShownDay('{"shownDay":"2026-11-01"}'),'2026-11-01');assert.equal(readShownDay('oops'),null);assert.equal(readShownDay(null),null);
 assert.equal(beijingDay(Date.parse('2026-10-31T15:59:59.999Z')),'2026-10-31');assert.equal(beijingDay(Date.parse('2026-10-31T16:00:00Z')),'2026-11-01');
});

test('tasks row reopens the gift until all seven are taken', ()=>{
 assert.equal(weeklyTaskRow(view(2,true)),'七日礼 · 今天可领第 3 天');
 assert.equal(weeklyTaskRow({...view(3,false),tomorrowDay:4}),'七日礼 · 明天领第 4 天');
 assert.equal(weeklyTaskRow(view(7,false)),null);assert.equal(weeklyTaskRow(null),null);
});

test('daily streak badge, hint and toasts', ()=>{
 assert.equal(streakBadge(0),'');assert.equal(streakBadge(4),'连续 4 天');
 assert.equal(streakHint({count:2,todayDone:false,next:{at:3,coins:60,in:1}}),'今天拼一块就能续上');
 assert.equal(streakHint({count:2,todayDone:true,next:{at:3,coins:60,in:1}}),'再 1 天得 60 金币');
 assert.equal(streakHint({count:0,todayDone:false,next:null}),null);
 const award={day:'2026-11-01',streak:3,coins:60,at:5000};
 const first=streakToast({count:3,todayDone:true,lastAward:award},{awardAt:0,day:'2026-10-31'},'2026-11-01');
 assert.equal(first.text,'每日拼图连续 3 天，金币 +60');
 assert.equal(streakToast({count:3,todayDone:true,lastAward:award},first.seen,'2026-11-01'),null);
 const plain=streakToast({count:2,todayDone:true,lastAward:null},{awardAt:0,day:'2026-10-31'},'2026-11-01');
 assert.equal(plain.text,'每日拼图连续 2 天');assert.equal(streakToast({count:2,todayDone:true,lastAward:null},plain.seen,'2026-11-01'),null);
 assert.equal(streakToast({count:2,todayDone:false,lastAward:null},{awardAt:0,day:null},'2026-11-01'),null);
 assert.deepEqual(readStreakSeen('bad'),{awardAt:0,day:null});
});

test('completion always offers one next step', ()=>{
 assert.deepEqual(completionPrimary({levelLabel:'下一关',dailyDone:false}),{kind:'level',label:'下一关'});
 assert.deepEqual(completionPrimary({levelLabel:'下一章',dailyDone:true}),{kind:'level',label:'下一章'});
 assert.deepEqual(completionPrimary({levelLabel:'去大厅',dailyDone:false}),{kind:'daily',label:'去拼今日拼图'});
 assert.deepEqual(completionPrimary({levelLabel:null,dailyDone:false}),{kind:'daily',label:'去拼今日拼图'});
 assert.deepEqual(completionPrimary({levelLabel:null,dailyDone:true}),{kind:'album',label:'去图集看看'});
 assert.equal(completionFooter({tomorrowDay:4,now:Date.parse('2026-11-01T02:00:00Z')}),'明天还能领第 4 天礼物');
 assert.equal(completionFooter({tomorrowDay:null,now:Date.parse('2026-11-01T11:59:00Z')}),'今晚 8 点换新的每日拼图');
 assert.equal(completionFooter({tomorrowDay:null,now:Date.parse('2026-11-01T12:00:00Z')}),'明晚 8 点换新的每日拼图');
});

test('story clears show chapter progress, the next album reward and a one-line teaser', ()=>{
 const milestones=[{target:3,coins:50,earned:false},{target:6,coins:120,earned:false}];
 assert.deepEqual(chapterProgress({chapterTitle:'第一章',cleared:2,total:6,milestones}),{progress:'第一章 2/6',reward:'再拼 1 关领 50 金币'});
 assert.deepEqual(chapterProgress({chapterTitle:'第一章',cleared:3,total:6,milestones:[{...milestones[0],earned:true},milestones[1]]}),{progress:'第一章 3/6',reward:'再拼 3 关领 120 金币'});
 assert.equal(chapterProgress({chapterTitle:'第一章',cleared:6,total:6,milestones}).reward,null);
 assert.equal(chapterProgress({chapterTitle:'第一章',cleared:1,total:6,milestones:[]}).reward,null);
 assert.equal(teaserLine('第二天一早，阿福带小禾来到早餐街。',10),'第二天一早，阿福带…');
 assert.equal(teaserLine('短句',10),'短句');assert.equal(teaserLine('',10),null);
 assert.equal(breathScale(0),1);assert.ok(breathScale(800)>1.03);assert.equal(breathScale(800,true),1);
});

test('daily hero renders finished count as a right-aligned title-row badge without crowding meta or colliding with long titles', ()=>{
 const render=({title='石桥边的春水',dailyFinished=128,compact=false,w=366,h=310}={})=>{
  const texts=[],frames=[];
  const measure=(text,size=14)=>[...String(text)].reduce((sum,ch)=>sum+(/[\x00-\x7f]/.test(ch)?size*.56:size),0);
  const host={
   stage:{
    ctx:{globalAlpha:1,fillStyle:'',save(){},restore(){},fillRect(){}},
    measure,
    color:value=>value,
    frame(r,id){frames.push({r,id});},
    image(){},hit(){},button(){},ornaments(){},
    text(value,x,y,size,color,weight,maxWidth){texts.push({value:String(value),x,y,size,color,weight,maxWidth});},
   },
   colors:{ink:'#642238',muted:'#8a5a5f',berry:'#c7808b',onAccent:'#fffaf0',placeholder:'#efdfcc'},
   client:{profile:{id:'p1'},asset:s=>s},
   busy:false,
   dailyPhoto:{title,src:'/puzzles/a.webp',thumbSrc:'/puzzles/a.webp'},
   dailyStreak:{count:2,todayDone:false,next:{at:3,coins:60,in:1}},
   dailyLabel:'今日拼图 · 11月29日',
   dailyLeft:'还剩 23 小时 21 分',
   dailyFinished,
   heroTextHeight:c=>c?90:114,
   launchDaily(){},inviteToDaily(){},
  };
  const endY=drawDailyHeroPanel.call(host,{x:12,y:100,w,h},compact);
  return {texts,frames,endY};
 };

 // Portrait with normal title: meta row keeps only date + countdown; badge sits on title row right edge.
 const portrait=render({title:'石桥边的春水',dailyFinished:128,compact:false,w:366});
 const meta=portrait.texts.find(t=>t.value.startsWith('今日拼图'));
 assert.equal(meta.value,'今日拼图 · 11月29日');
 const titleDraw=portrait.texts.find(t=>t.value==='石桥边的春水');
 const badgeText=portrait.texts.find(t=>t.value==='已有 128 人拼完');
 const badgeFrame=portrait.frames.find(f=>f.id==='button-cream-selected');
 assert.ok(titleDraw&&badgeText&&badgeFrame,'title and right-aligned finished badge render');
 assert.equal(titleDraw.size,22);
 assert.equal(badgeFrame.r.h,22);
 assert.equal(badgeFrame.r.y,titleDraw.y);
 assert.ok(titleDraw.x+titleDraw.maxWidth<badgeFrame.r.x,'title area never overlaps finished badge');
 assert.equal(badgeFrame.r.x+badgeFrame.r.w,12+366-14,'badge aligns to inner right edge');

 // Long title + large count: title shrinks smoothly without overlapping badge.
 const longCase=render({title:'春风拂过的海边小镇花田物语',dailyFinished:12800,compact:false,w:366});
 const longTitle=longCase.texts.find(t=>t.value==='春风拂过的海边小镇花田物语');
 const longBadge=longCase.frames.find(f=>f.id==='button-cream-selected');
 assert.ok(longTitle.size<22&&longTitle.size>=15,'long title scales down cleanly');
 assert.ok(longTitle.x+longTitle.maxWidth<longBadge.r.x,'scaled long title stays clear of badge');

 // Compact landscape: slim badge fits beside compact title.
 const compact=render({title:'石桥边的春水',dailyFinished:99,compact:true,w:270,h:190});
 const compactBadge=compact.frames.find(f=>f.id==='button-cream-selected');
 const compactText=compact.texts.find(t=>t.value==='已有 99 人拼完');
 assert.ok(compactBadge&&compactText);
 assert.equal(compactBadge.r.h,18);assert.equal(compactText.size,10);

 // Zero finished count: no badge drawn and title takes full inner width.
 const zero=render({title:'石桥边的春水',dailyFinished:0,compact:false,w:366});
 assert.equal(zero.frames.some(f=>f.id==='button-cream-selected'),false);
 assert.equal(zero.texts.find(t=>t.value==='石桥边的春水').maxWidth,366-28);
});
