import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,levels,tick,lobby} from './mobile-level-card-fixture.mjs';

const layouts=[[390,844,'drawTabBar'],[844,390,'drawNavRail'],[1280,800,'drawDesktopShell']];
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const redDots=f=>f.fills.filter(fill=>fill.color==='#b46177'&&fill.r.w===8&&fill.r.h===8);

for(const [width,height,draw]of layouts)test(`${width}x${height}: story leads the five destinations and opens, selects`,async()=>{
 const f=fixture({width,height}),items=f.app.navItems;
 assert.equal(items.length,5);assert.deepEqual(items.map(([route])=>route),['chapter','lobby','gallery','collection','friends']);assert.deepEqual(items[0],['chapter','故事','story']);
 f.app[draw]();assert.equal(f.texts.filter(text=>text==='故事').length,1);assert.ok(f.icons.some(icon=>icon.key==='story'));assert.equal(redDots(f).length,1);
 const label=f.glyphs.find(glyph=>glyph.value==='故事');
 const hit=f.hits.find(({r})=>label.x>=r.x&&label.x<r.x+r.w&&label.y>=r.y&&label.y<r.y+r.h);assert.ok(hit);hit.fn();await tick();assert.equal(f.app.route,'chapter');assert.equal(f.app.navVisible,true);assert.equal(f.created.length,0);
 f.clear();f.app[draw]();const selected=f.glyphs.find(glyph=>glyph.value==='故事');assert.equal(selected.color,f.stage.palette.ink);
 if(draw==='drawTabBar')assert.ok(f.fills.some(fill=>fill.color==='#a85567'&&fill.r.x>=0&&fill.r.x<width*.2));
 else{const frame=f.frames.find(frame=>frame.key==='button-cream-selected'&&overlaps(frame.r,{x:selected.x,y:selected.y,w:12,h:12}));assert.ok(frame);}
});

test('story badge requires an unlocked level in the current account and available chapter',()=>{
 const f=fixture();
 for(const [data,expected]of [[levels(0),1],[levels(3),1],[levels(6),0],[levels(0,'unavailable'),0],[null,0],[{chapters:[],current:null},0]]){
  f.app.levels=data;f.clear();f.app.navBadge('chapter',30,40);assert.equal(redDots(f).length,expected);
 }
 f.app.levels=levels();f.app.levels.chapters[0].levels[3].status='cleared';f.clear();f.app.navBadge('chapter',30,40);assert.equal(redDots(f).length,0);
 f.app.levels=levels();f.app.levelsOwner='other';f.clear();f.app.navBadge('chapter',30,40);assert.equal(redDots(f).length,0);
});

for(const [width,height]of [[320,640],[390,844],[844,390],[1280,800]])test(`${width}x${height}: lobby task shortcut fits, keeps the gift badge and returns from tasks`,async()=>{
 for(const orientation of [false,true])for(const giftCount of [0,2]){
  const f=fixture({width,height});if(orientation)f.platform.setOrientation=async()=>{};f.client.profile.giftCount=giftCount;
  const draw=()=>width>=1000?f.app.drawDesktopShell():f.app.drawHeader();draw();
  const label=f.glyphs.find(glyph=>glyph.value==='任务'),gift=f.icons.find(icon=>icon.key==='gift');assert.ok(label);assert.ok(gift);assert.ok(label.x>width/2);
  const hit=f.hits.find(({r})=>r.w===64&&r.h===40&&overlaps(r,gift.r));assert.ok(hit);assert.ok(hit.r.x+hit.r.w<=width);assert.ok(gift.r.x>=hit.r.x&&gift.r.x+gift.r.w<=hit.r.x+hit.r.w);
  for(const button of f.buttons)assert.ok(!overlaps(hit.r,button.r));
  for(const other of f.hits)if(other!==hit)assert.ok(!overlaps(hit.r,other.r));
  const dots=redDots(f).filter(fill=>overlaps(fill.r,hit.r)).length;f.clear();f.app.navBadge('tasks',30,40);assert.equal(dots,redDots(f).length);assert.equal(dots,giftCount?1:0);
  hit.fn();await tick();assert.equal(f.app.route,'tasks');assert.equal(f.app.tabRoute,false);assert.equal(f.app.navVisible,false);
  f.clear();draw();const back=f.buttons.find(button=>button.opts?.icon==='back');assert.ok(back);back.fn();await tick();assert.equal(f.app.route,'lobby');
 }
});

test('story remains readable as an empty state when levels are absent, unavailable or fail to load',async()=>{
 for(const data of [null,levels(0,'unavailable'),{chapters:[],current:null},'offline']){
  const f=fixture({data:null});f.client.json=async()=>{if(data==='offline')throw Error('404');return data;};
  f.app.openTab('chapter');await tick();assert.equal(f.app.route,'chapter');assert.equal(f.app.message,'');
  f.app.drawChapter();assert.ok(f.texts.includes('小窝的故事'));assert.ok(f.texts.includes('故事暂未开放，请稍后再来看看'));assert.equal(f.app.extent,0);assert.equal(f.created.length,0);
  f.app.navBadge('chapter',30,40);assert.equal(redDots(f).length,0);
 }
});

test('lobby geometry no longer depends on chapter progress and drawn story text ignores seriesTitle',()=>{
 for(const [width,height]of layouts){
  let baseline;
  for(const data of [null,levels(0),levels(3),levels(6),levels(0,'unavailable')]){
   const f=fixture({width,height,data}),heroes=lobby(f);if(!baseline)baseline=heroes;else assert.deepEqual(heroes,baseline);
   f.app.drawChapter();assert.ok(!f.texts.some(text=>text.includes('拾光物语')));assert.ok(!f.texts.some(text=>text.includes('继续第')));
  }
 }
});

test('level completion, chapter completion and share copy ignore the server series title and keep completion actions',async()=>{
 for(const chapterComplete of [false,true]){
  const f=fixture(),levelId=chapterComplete?'ch1-6':'ch1-4';f.client.config.capabilities.cheers=false;
  f.app.room={ticket:{playerId:'self'},state:{cols:5,rows:7},snapshot:{id:'level-room',title:'早餐店',levelId,members:[],completedAt:1,mobileResult:{coins:1,fragments:1,levelClear:{levelId,chapterComplete,nextLevelId:chapterComplete?null:'ch1-5',firstClear:true,energy:30}}}};
  f.app.drawCompletionPicture=()=>{};f.app.drawCompletionContent(12,80,366,false);
  assert.ok(!f.texts.some(text=>text.includes('拾光物语')));assert.ok(f.buttons.some(button=>button.label==='翻开这一页'));assert.ok(f.buttons.some(button=>button.label===(chapterComplete?'去大厅':'下一关')));
  if(chapterComplete)assert.ok(f.texts.includes('开张完成！'));
  let share;f.app.shareFromGame=async value=>{share=value;return 'cancelled';};f.app.note=()=>{};f.buttons.find(button=>button.label==='分享成品').fn();await tick();assert.ok(share);assert.ok(!share.title.includes('拾光物语'));
 }
});
