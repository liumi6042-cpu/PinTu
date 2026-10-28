import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,levels,tick} from './mobile-level-card-fixture.mjs';
import {orientationPreferenceKey,launchOrientation,readOrientationPreference,saveOrientationPreference} from '../mobile/orientation-choice.ts';

function orientationFixture(options){
 const f=fixture(options),turns=[],storageReads=[];
 f.platform.setOrientation=async value=>{turns.push(value);};
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

test('initial content keeps the first ch1-1 launch and direct-link handling',async()=>{
 const first=orientationFixture({newcomer:true,data:levels(0)});
 await first.app.loadInitialContent({});
 assert.equal(first.created.length,1);assert.equal(first.created[0].levelId,'ch1-1');
 assert.equal(first.app.route,'room');assert.equal(first.app.modal,null);assert.deepEqual(first.turns,[]);
 const direct=orientationFixture({newcomer:true,data:levels(0)}),queries=[];
 direct.app.handleQuery=async query=>{queries.push(query);};
 const query={room:'a'.repeat(32)};await direct.app.loadInitialContent(query);
 direct.app.draw();await tick();assert.deepEqual(queries,[query]);
 assert.equal(direct.created.length,0);assert.equal(direct.app.modal,null);assert.deepEqual(direct.turns,[]);
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

test('launch orientation defaults to portrait and respects valid saved preferences',()=>{
 const storage=new Map(),port={get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)};
 assert.equal(launchOrientation(port),'portrait');assert.equal(readOrientationPreference(port),null);
 storage.set(orientationPreferenceKey,'auto');assert.equal(launchOrientation(port),'portrait');
 for(const value of ['landscape','portrait']){saveOrientationPreference(port,value);assert.equal(readOrientationPreference(port),value);assert.equal(launchOrientation(port),value);}
 const broken={get(){throw Error('不可用');},set(){throw Error('只读');}};
 assert.equal(launchOrientation(broken),'portrait');assert.doesNotThrow(()=>saveOrientationPreference(broken,'portrait'));
});
