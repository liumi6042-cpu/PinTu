import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './mobile-level-card-fixture.mjs';

const tipKey='jigsaw:settings-tip:v1',tip='点头像打开设置：声音、夜间模式、画面';
function drawTip(f){f.clear();f.app.settingsTipDrawn=false;f.app.settingsTipAnchor=null;f.app.drawHeader();f.app.drawSettingsTip();}
function tap(f,x=300,y=200){const p={id:1,x,y};f.app.input({type:'down',points:[p],changed:[p]});f.app.input({type:'up',points:[],changed:[p]});}

test('portrait and landscape avatars keep settings hits and gain a small gear badge',()=>{
 for(const [width,height]of [[320,740],[390,844],[844,390],[768,1024]]){
  const f=fixture({width,height}),circles=[];f.stage.ctx.arc=(...args)=>circles.push({args,color:f.stage.ctx.fillStyle});drawTip(f);
  const avatar=f.icons.find(icon=>icon.key==='avatar').r,gear=f.icons.find(icon=>icon.key==='tools').r;
  assert.equal(gear.w,16);assert.equal(gear.h,16);assert.ok(gear.x>avatar.x+avatar.w/2);assert.ok(gear.y>avatar.y+avatar.h/2);
  assert.ok(gear.x+gear.w<=avatar.x+avatar.w+6);assert.ok(gear.y+gear.h<=avatar.y+avatar.h+6);
  assert.ok(circles.some(({args,color})=>args[0]===gear.x+8&&args[1]===gear.y+8&&args[2]===11&&color===f.stage.palette.cream));
  const hit=f.hits.find(hit=>hit.r.x===avatar.x&&hit.r.y<=avatar.y&&hit.r.h>=avatar.h);assert.ok(hit);hit.fn();assert.equal(f.app.modal,'settings');
 }
});

test('the real lobby draw shows the tip after the header and defers it behind a modal',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height});Object.assign(f.stage,{background(){},withViewport(r,draw){const {w,h}=this;this.w=r.w;this.h=r.h;try{draw();}finally{this.w=w;this.h=h;}}});
  Object.assign(f.app,{drawScene(){},drawNavRail(){},drawTabBar(){},drawModal(){}});
  f.app.draw();assert.ok(f.texts.includes(tip));assert.equal(f.app.settingsTipDrawn,true);
  f.clear();f.app.modal='orientation';f.app.draw();assert.ok(!f.texts.includes(tip));assert.equal(f.app.settingsTipDrawn,false);
  f.app.modal=null;f.app.draw();assert.equal(f.app.settingsTipDrawn,true);
 }
});

test('the first lobby tip is dismissed by any tap, writes once and stays dismissed after restart',()=>{
 const storage=new Map(),f=fixture({storage}),writes=[],inputs=[];
 f.platform.storage.set=(key,value)=>{writes.push([key,value]);storage.set(key,value);};f.stage.input=input=>{inputs.push(input.type);return true;};
 drawTip(f);assert.ok(f.texts.includes(tip));assert.equal(storage.has(tipKey),false);assert.equal(f.app.settingsTipDrawn,true);
 tap(f);drawTip(f);tap(f);assert.deepEqual(writes,[[tipKey,'1']]);assert.equal(f.app.settingsTipDrawn,false);assert.ok(!f.texts.includes(tip));assert.deepEqual(inputs,['down','up','down','up']);
 const restarted=fixture({storage});drawTip(restarted);assert.equal(restarted.app.settingsTipDrawn,false);assert.ok(!restarted.texts.includes(tip));
});

test('orientation, privacy, story and modal overlays defer the tip without marking it read',()=>{
 const blockers=[{modal:'orientation'},{modal:'settings'},{modal:'history'},{modal:'levelComic'},{orientationEntryPending:Promise.resolve()},{privacyAccepted:false},{privacyDocument:'privacy',privacyAccepted:false},{loginDialogActive:true},{loginLogOpen:true},{storyIntro:{text:'故事',until:0}},{ready:false},{route:'chapter'},{route:'room'}];
 for(const blocker of blockers){
  const f=fixture();Object.assign(f.app,blocker);drawTip(f);assert.equal(f.app.settingsTipDrawn,false,JSON.stringify(blocker));assert.ok(!f.texts.includes(tip));assert.equal(f.storage.has(tipKey),false);
  Object.assign(f.app,{modal:null,orientationEntryPending:null,privacyAccepted:true,privacyDocument:null,loginDialogActive:false,loginLogOpen:false,storyIntro:null,ready:true,route:'lobby'});
  drawTip(f);assert.equal(f.app.settingsTipDrawn,true);assert.ok(f.texts.includes(tip));
 }
});

test('a modal opened after the tip was drawn cannot mark the hidden tip read',()=>{
 const f=fixture();drawTip(f);f.app.showModal('settings');tap(f);assert.equal(f.storage.has(tipKey),false);
 f.app.showModal(null);drawTip(f);assert.ok(f.texts.includes(tip));tap(f);assert.equal(f.storage.get(tipKey),'1');
});

test('the lobby tip follows the avatar through the landscape rail and fits narrow screens',()=>{
 for(const [width,height]of [[320,740],[390,844],[844,390]]){
  const f=fixture({width,height}),panels=[];f.stage.measure=(value,size=12)=>Array.from(String(value)).length*size;f.stage.panel=r=>panels.push(r);drawTip(f);
  const avatar=f.icons.find(icon=>icon.key==='avatar').r,anchor=f.app.settingsTipAnchor,bubble=panels.at(-1);
  assert.equal(anchor.x,avatar.x+(f.app.navVisible&&f.app.layout==='phoneLandscape'?72:0));assert.ok(bubble.x>=8);assert.ok(bubble.x+bubble.w<=width-8);assert.ok(bubble.y>avatar.y+avatar.h);
  assert.equal(f.glyphs.filter(g=>tip.includes(g.value)).map(g=>g.value).join(''),tip);
 }
});

test('history buttons use the same full label and measure space for the piece icon',()=>{
 for(const compact of [false,true]){
  const f=fixture({width:844,height:390}),measure=f.stage.measure,calls=[];
  f.stage.measure=(...args)=>{calls.push(args);return measure(...args);};f.app.drawRoomHeader(20,100,360,compact);
  const button=f.buttons.find(button=>button.label==='历史拼图');assert.ok(button);assert.equal(button.opts.icon,'piece');assert.ok(calls.some(([label,size,weight])=>label==='历史拼图'&&size===12&&weight===750));assert.ok(button.r.w>=measure(button.label)+17+12);assert.ok(button.r.x+button.r.w<=380);
  button.fn();assert.equal(f.app.modal,'history');
  f.clear();f.stage.segments=()=>{};f.app.modal='settings';f.app.drawModal();assert.ok(f.buttons.some(button=>button.label==='历史拼图'));assert.ok(!f.buttons.some(button=>button.label==='拼图历史'));
 }
});

test('album previews show uncollected art at full opacity and retain small collection pills',()=>{
 const f=fixture(),album={images:[{id:'owned',title:'已收集图片',thumbSrc:'/owned.webp',collected:true,difficulties:[]},{id:'unowned',title:'未收集图片',thumbSrc:'/unowned.webp',collected:false,difficulties:[]}]};
 f.app.drawAlbumImages(album,12,100,366,3);assert.equal(f.images.length,2);assert.ok(f.images.every(image=>image.alpha===1&&image.filter==='none'));assert.ok(f.texts.includes('已收藏'));assert.ok(f.texts.includes('未收集'));
 for(const image of f.images){assert.ok(!f.frames.some(frame=>frame.r.x===image.r.x&&frame.r.y===image.r.y&&frame.r.w===image.r.w&&frame.r.h===image.r.h));assert.ok(!f.icons.some(icon=>icon.key==='lock'&&icon.r.y<image.r.y+image.r.h&&icon.r.y+icon.r.h>image.r.y));}
 assert.equal(f.icons.filter(icon=>icon.key==='lock').length,1);assert.ok(f.icons.find(icon=>icon.key==='lock').r.y>f.images[1].r.y+f.images[1].r.h);
});
