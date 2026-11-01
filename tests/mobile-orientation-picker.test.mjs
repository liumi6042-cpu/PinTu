import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,levels,tick} from './mobile-level-card-fixture.mjs';
import {createWebPlatform} from '../mobile/platform-web.ts';
import {orientationPreferenceKey,launchOrientation,readOrientationPreference,requestLaunchOrientation,saveOrientationPreference} from '../mobile/orientation-choice.ts';

function orientationFixture(options){
 const f=fixture(options),turns=[],storageReads=[];
 f.platform.orientationChoiceAvailable=()=>true;
 f.platform.setOrientation=async value=>{turns.push(value);[f.stage.w,f.stage.h]=value==='landscape'?[844,390]:[390,844];};
 const get=f.platform.storage.get;
 f.platform.storage.get=key=>{storageReads.push(key);return get(key);};
 Object.assign(f.stage,{background(){},segments(){},withViewport:(_r,draw)=>draw()});
 Object.assign(f.app,{drawScene(){},drawNavRail(){},drawTabBar(){}});
 return {...f,turns,storageReads};
}

test('first lobby and story visits never offer a picker or request orientation',async()=>{
 for(const [width,height]of [[390,844],[844,390]])for(const route of ['lobby','chapter'])for(const oldPicker of [false,true]){
  const storage=new Map(oldPicker?[['jigsaw:orientation-picker:v1','1']]:[]),f=orientationFixture({width,height,storage});
  f.app.route=route;
  for(let i=0;i<2;i++){f.app.draw();await tick();assert.equal(f.app.modal,null);}
  assert.deepEqual(f.turns,[]);assert.deepEqual(f.storageReads,[]);
  assert.equal(storage.size,oldPicker?1:0);
 }
});

function cards(f){f.clear();f.app.drawModal();return f.buttons.filter(button=>typeof button.opts?.selected==='boolean');}

test('first entry waits before loading rooms and preselects the actual orientation',async()=>{
 for(const [width,height,selected]of [[390,844,1],[844,390,0]]){
  const f=orientationFixture({width,height,newcomer:true,data:levels(0),storage:new Map([['jigsaw:orientation-picker:v1','1']])});
  let done=false;const pending=f.app.loadInitialContent({}).then(()=>done=true);
  await tick();assert.equal(done,false);assert.equal(f.app.modal,'orientation');
  assert.equal(f.created.length,0);assert.deepEqual(f.reads,[]);assert.deepEqual(f.turns,[]);assert.equal(f.app.busy,false);
  const tiles=cards(f);assert.equal(tiles.length,2);assert.equal(tiles[selected].opts.selected,true);assert.equal(tiles[1-selected].opts.selected,false);
  assert.ok(f.texts.includes('选择屏幕方向'));assert.ok(f.texts.includes('横屏'));assert.ok(f.texts.includes('竖屏'));
  // Other modal requests, room actions and entry checks cannot steal this first choice.
  f.app.showModal('settings');await f.app.checkLevelEntry();await f.app.launch({mode:'level',levelId:'ch1-1'});
  assert.equal(f.app.modal,'orientation');assert.equal(f.app.chapterEntryChecked,false);assert.equal(f.created.length,0);assert.equal(f.app.busy,false);
  f.buttons.find(button=>button.label==='确认').fn();assert.equal(f.app.modal,null);
  assert.equal(f.storage.get(orientationPreferenceKey),selected===0?'landscape':'portrait');
  await pending;assert.equal(f.created.length,1);assert.equal(f.created[0].levelId,'ch1-1');assert.equal(f.app.route,'room');
 }
});

test('cards switch immediately and save only successful or current choices',async()=>{
 for(const [width,height,current,target,index]of [[390,844,'portrait','landscape',0],[844,390,'landscape','portrait',1]]){
  const f=orientationFixture({width,height}),pending=f.app.offerFirstOrientation();
  cards(f)[index].fn();await tick();assert.deepEqual(f.turns,[target]);assert.equal(f.storage.get(orientationPreferenceKey),target);
  assert.equal(cards(f)[index].opts.selected,true);assert.equal(f.app.modal,'orientation');
  f.app.closeModal();await pending;
  const same=orientationFixture({width,height}),wait=same.app.offerFirstOrientation();
  cards(same)[1-index].fn();await tick();assert.deepEqual(same.turns,[]);assert.equal(same.storage.get(orientationPreferenceKey),current);
  same.app.closeModal();await wait;
 }
});

test('failed and concurrent picker switches keep the actual selection and saved preference',async()=>{
 const f=orientationFixture(),pending=f.app.offerFirstOrientation();let fail;
 f.platform.setOrientation=value=>{f.turns.push(value);return new Promise((_resolve,reject)=>fail=reject);};
 const turn=f.app.chooseOrientation('landscape');await f.app.chooseOrientation('landscape');
 assert.deepEqual(f.turns,['landscape']);assert.ok(cards(f).every(card=>card.opts.disabled));
 f.app.closeModal();assert.equal(f.app.modal,'orientation');assert.equal(f.storage.has(orientationPreferenceKey),false);
 fail(Error('切屏失败'));await turn;
 assert.equal(f.app.message,'切屏失败');assert.equal(f.storage.has(orientationPreferenceKey),false);
 assert.equal(cards(f)[1].opts.selected,true);assert.equal(cards(f)[0].opts.selected,false);
 f.app.closeModal();await pending;
});

test('confirm, close button, Escape and back save actual direction and continue ch1-1',async()=>{
 for(const action of ['confirm','close','escape','back']){
  const f=orientationFixture({newcomer:true,data:levels(0)}),pending=f.app.loadInitialContent({});await tick();
  cards(f);f.stage.w=844;f.stage.h=390; // Confirmation uses the actual viewport, even after an external change.
  if(action==='confirm')f.buttons.find(button=>button.label==='确认').fn();
  else if(action==='close')f.buttons.find(button=>button.opts?.icon==='close').fn();
  else if(action==='escape')f.app.input({type:'key',key:'Escape',keyDown:true,points:[],changed:[]});
  else f.app.back();
  assert.equal(f.app.modal,null);assert.equal(f.storage.get(orientationPreferenceKey),'landscape');
  await pending;assert.equal(f.created.length,1);assert.equal(f.created[0].levelId,'ch1-1');
 }
});

test('saved choices, PC, missing capabilities and non-TapTap enter directly without writing a preference',async()=>{
 for(const mode of ['landscape','portrait','pc','web','wechat','missing','no-set']){
  const f=orientationFixture({newcomer:true,data:levels(0)});
  if(['landscape','portrait'].includes(mode))f.storage.set(orientationPreferenceKey,mode);
  if(mode==='pc')f.platform.orientationChoiceAvailable=()=>false;
  if(mode==='missing')delete f.platform.orientationChoiceAvailable;
  if(mode==='no-set')delete f.platform.setOrientation;
  if(['web','wechat'].includes(mode))f.platform.config.id=mode;
  const writes=[];const set=f.platform.storage.set;f.platform.storage.set=(key,value)=>{writes.push(key);set(key,value);};
  await f.app.loadInitialContent({});assert.equal(f.app.modal,null);assert.equal(f.created.length,1);assert.equal(f.created[0].levelId,'ch1-1');
  assert.equal(writes.includes(orientationPreferenceKey),false);assert.deepEqual(f.turns,[]);
 }
});

test('unreadable orientation storage skips the picker',async()=>{
 const f=orientationFixture({newcomer:true,data:levels(0)}),get=f.platform.storage.get;
 f.platform.storage.get=key=>{if(key===orientationPreferenceKey)throw Error('不可用');return get(key);};
 await f.app.loadInitialContent({});assert.equal(f.app.modal,null);assert.equal(f.created.length,1);assert.equal(f.storage.has(orientationPreferenceKey),false);
});

test('direct links and foreground links wait for the choice, keeping room entry priority',async()=>{
 const f=orientationFixture({newcomer:true,data:levels(0)}),queries=[],query={room:'a'.repeat(32)};
 f.app.handleQuery=async query=>queries.push(query);
 const pending=f.app.loadInitialContent(query);await tick();assert.equal(f.app.modal,'orientation');assert.deepEqual(queries,[]);
 f.app.closeModal();await pending;assert.deepEqual(queries,[query]);assert.equal(f.created.length,0);
 // Exercise the real startup hook, including the login mask and resume during rotation.
 const resumed=orientationFixture({newcomer:true,data:levels(0)});let show;
 resumed.app.ready=false;resumed.app.loginDialogActive=true;resumed.app.soloOutboxesFlushed=true;
 resumed.platform.onShow=fn=>{show=fn;return()=>{};};resumed.app.syncOffline=()=>{};
 resumed.client.refresh=async()=>{};resumed.app.handleQuery=async query=>queries.push(query);
 const startup=resumed.app.start();await tick();assert.equal(resumed.app.loginDialogActive,false);assert.equal(resumed.app.modal,'orientation');
 resumed.app.draw();assert.ok(resumed.texts.includes('选择屏幕方向'));
 const foreground={room:'b'.repeat(32)};show(foreground);show({});assert.equal(queries.length,1);assert.equal(resumed.created.length,0);
 resumed.app.closeModal();await startup;
 for(const timer of resumed.app.timers)clearInterval(timer);
 assert.deepEqual(queries,[query,foreground]);assert.equal(resumed.created.length,0);
});

test('offline whitelist permits the picker and cancelled startup never launches',async()=>{
 const f=orientationFixture({newcomer:true,data:levels(0)});f.app.offline.active=true;f.app.ready=false;
 const pending=f.app.offerFirstOrientation();assert.equal(f.app.modal,'orientation');f.app.closeModal();await pending;
 const cancelled=orientationFixture({newcomer:true,data:levels(0)}),startup=cancelled.app.loadInitialContent({});await tick();
 cancelled.app.destroyed=true;cancelled.app.finishOrientationOffer();await startup;
 assert.equal(cancelled.created.length,0);assert.equal(cancelled.storage.has(orientationPreferenceKey),false);
});

test('native first-entry availability excludes desktop hosts and missing rotation',t=>{
 for(const [key,value]of Object.entries({window:{},document:{baseURI:'https://game.test/'},location:{href:'https://game.test/',origin:'https://game.test'}})){
  const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key]);
 }
 const p=createWebPlatform({id:'taptap',gameName:'拼图',apiBase:'https://game.test/api',assetBase:'https://game.test/assets'},{style:{}});
 assert.equal(p.orientationChoiceAvailable(),false);
 for(const platform of ['Windows','mac','macOS','PC','android','ios']){
  window.tap={setDeviceOrientation(){},getSystemInfoSync:()=>({platform})};
  assert.equal(p.orientationChoiceAvailable(),['android','ios'].includes(platform));
 }
 window.tap.getSystemInfoSync=()=>{throw Error('不可用');};assert.equal(p.orientationChoiceAvailable(),false);
 // TapTap PC refuses TapSystemInfo (an error object, no platform) but its preload exposes H5GameAPI.
 window.tap={setDeviceOrientation(){},getSystemInfoSync:()=>({errno:1,errMsg:'bridge:fail invalid request data'})};assert.equal(p.orientationChoiceAvailable(),true);assert.equal(p.tapPcHost(),false);
 window.H5GameAPI={tapCustomCommandSync(){}};assert.equal(p.orientationChoiceAvailable(),false);assert.equal(p.tapPcHost(),true);
 window.tap.getSystemInfoSync=()=>({platform:'android'});assert.equal(p.orientationChoiceAvailable(),true);assert.equal(p.tapPcHost(),false);
 delete window.H5GameAPI;
});

test('TapTap PC hides every orientation control and never rotates',async()=>{
 for(const [width,height]of [[486,918],[1632,864]]){
  const f=orientationFixture({width,height});f.platform.config.id='taptap';f.platform.tapPcHost=()=>true;
  for(const route of ['lobby','chapter']){f.app.route=route;f.clear();f.app.drawHeader();assert.ok(!f.buttons.some(button=>button.opts?.icon==='orientation'));}
  for(const modal of ['settings','tools']){f.clear();f.app.modal=modal;f.app.drawModal();assert.ok(!f.buttons.some(button=>/^切换[横竖]屏$/.test(button.label)));}
  f.app.modal=null;await f.app.toggleOrientation();assert.deepEqual(f.turns,[]);assert.equal(f.storage.has(orientationPreferenceKey),false);
 }
});

test('phone first launch waits for the startup portrait turn, then preselects where the screen ended up',async()=>{
 for(const outcome of ['turned','failed']){
  const f=orientationFixture({width:844,height:390,newcomer:true,data:levels(0)});let settle;
  f.platform.startupOrientation=new Promise((resolve,reject)=>settle={resolve,reject});
  const pending=f.app.loadInitialContent({});await tick();
  assert.equal(f.app.modal,null);assert.equal(f.created.length,0);assert.equal(f.app.busy,false);
  f.app.showModal('settings');assert.equal(f.app.modal,null);
  if(outcome==='turned'){[f.stage.w,f.stage.h]=[390,844];settle.resolve();}else settle.reject(Error('旋转失败'));
  await tick();await tick();assert.equal(f.app.modal,'orientation');assert.equal(f.app.message??'','');
  const tiles=cards(f),selected=outcome==='turned'?1:0;assert.equal(tiles[selected].opts.selected,true);assert.equal(tiles[1-selected].opts.selected,false);
  f.buttons.find(button=>button.label==='确认').fn();assert.equal(f.storage.get(orientationPreferenceKey),outcome==='turned'?'portrait':'landscape');
  await pending;assert.equal(f.created.length,1);assert.equal(f.created[0].levelId,'ch1-1');
 }
});

test('launch request: PC never rotates, saved choices are restored, phones start a first launch in portrait',async()=>{
 const make=({saved,available=true,pc=false,fail=false}={})=>{const storage=new Map(saved?[[orientationPreferenceKey,saved]]:[]),turns=[];
  return {turns,storage,platform:{storage:{get:key=>storage.get(key)??null},orientationChoiceAvailable:()=>available,tapPcHost:()=>pc,setOrientation:async value=>{turns.push(value);if(fail)throw Error('旋转失败');}}};};
 for(const saved of [undefined,'landscape','portrait']){const pc=make({saved,pc:true});assert.equal(requestLaunchOrientation(pc.platform),undefined);assert.deepEqual(pc.turns,[]);}
 for(const saved of ['landscape','portrait']){const back=make({saved});assert.equal(requestLaunchOrientation(back.platform),undefined);assert.deepEqual(back.turns,[saved]);assert.equal(back.storage.get(orientationPreferenceKey),saved);}
 const first=make(),request=requestLaunchOrientation(first.platform);assert.ok(request);await request;assert.deepEqual(first.turns,['portrait']);assert.equal(first.storage.has(orientationPreferenceKey),false);
 const failed=make({fail:true});await requestLaunchOrientation(failed.platform);assert.deepEqual(failed.turns,['portrait']);
 const unavailable=make({available:false});assert.equal(requestLaunchOrientation(unavailable.platform),undefined);assert.deepEqual(unavailable.turns,[]);
 assert.equal(requestLaunchOrientation({storage:{get:()=>null}}),undefined);
});

test('lobby and story header buttons switch in one click and remember the next launch',async()=>{
 for(const route of ['lobby','chapter'])for(const [width,height,target]of [[390,844,'landscape'],[844,390,'portrait']]){
  const f=orientationFixture({width,height});f.app.route=route;f.app.drawHeader();
  const button=f.buttons.find(button=>button.opts?.icon==='orientation');assert.ok(button);
  button.fn();await tick();assert.deepEqual(f.turns,[target]);
  assert.equal(f.storage.get(orientationPreferenceKey),target);assert.equal(launchOrientation(f.platform.storage),target);
  assert.equal(f.storage.has('jigsaw:orientation-picker:v1'),false);assert.equal(f.app.modal,null);
 }
});

test('settings and room tools retain the manual orientation action',async()=>{
 for(const modal of ['settings','tools'])for(const [width,height,target,label]of [[390,844,'landscape','切换横屏'],[844,390,'portrait','切换竖屏']]){
  const f=orientationFixture({width,height});f.app.modal=modal;f.app.drawModal();
  const button=f.buttons.find(button=>button.label===label);assert.ok(button);
  button.fn();await tick();assert.deepEqual(f.turns,[target]);assert.equal(f.storage.get(orientationPreferenceKey),target);assert.equal(f.app.modal,null);
 }
});

test('Web and non-TapTap headers and settings hide orientation controls',()=>{
 for(const id of ['web','wechat'])for(const [width,height]of [[390,844],[844,390]]){
  const f=orientationFixture({width,height});f.platform.config.id=id;
  for(const route of ['lobby','chapter']){f.app.route=route;f.clear();f.app.drawHeader();assert.ok(!f.buttons.some(button=>button.opts?.icon==='orientation'));}
  f.clear();f.app.modal='settings';f.app.drawModal();assert.ok(!f.buttons.some(button=>/^切换[横竖]屏$/.test(button.label)));
 }
});

test('failed and concurrent manual switches preserve the last successful preference',async()=>{
 const f=orientationFixture();let finish;
 f.platform.setOrientation=value=>{f.turns.push(value);return new Promise(resolve=>finish=resolve);};
 const pending=f.app.toggleOrientation();await f.app.toggleOrientation();assert.deepEqual(f.turns,['landscape']);
 assert.equal(f.storage.has(orientationPreferenceKey),false);finish();await pending;
 f.stage.w=844;f.stage.h=390;f.platform.setOrientation=async()=>{throw Error('切换失败');};
 await f.app.toggleOrientation();assert.equal(f.storage.get(orientationPreferenceKey),'landscape');assert.equal(f.app.message,'切换失败');assert.equal(f.app.busy,false);
 f.platform.setOrientation=async()=>{};f.platform.storage.set=()=>{throw Error('只读');};
 await f.app.toggleOrientation();assert.equal(f.app.busy,false);assert.equal(f.app.modal,null);
});

test('launch orientation makes no request without a saved choice and respects valid preferences',()=>{
 const storage=new Map(),port={get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)};
 assert.equal(launchOrientation(port),null);assert.equal(readOrientationPreference(port),null);
 storage.set(orientationPreferenceKey,'auto');assert.equal(launchOrientation(port),null);
 for(const value of ['landscape','portrait']){saveOrientationPreference(port,value);assert.equal(readOrientationPreference(port),value);assert.equal(launchOrientation(port),value);}
 const broken={get(){throw Error('不可用');},set(){throw Error('只读');}};
 assert.equal(launchOrientation(broken),null);assert.doesNotThrow(()=>saveOrientationPreference(broken,'portrait'));
});
