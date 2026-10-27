import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";export * from "./mobile/orientation-choice";export {createWebPlatform} from "./mobile/platform-web";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,orientationPreferenceKey,orientationPickerKey,readOrientationPreference,saveOrientationPreference,createWebPlatform}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture({width=844,height=390,top=0,bottom=0,storage=new Map()}={}){
 const texts=[],buttons=[],frames=[],panels=[],hits=[],icons=[],turns=[],reads=[],ctx=new Proxy({save(){},restore(){},fillRect(){}},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:height,ctx,palette:{ink:'#642238',muted:'#8a5a5f',overlay:'#3c203c80'},text:(value,x,y,size,color,weight,maxWidth)=>texts.push({value,x,y,size,color,weight,maxWidth}),button:(r,label,fn,opts={})=>{buttons.push({r,label,fn,opts});frames.push({r,key:'button-'+(opts.selected?'selected':'normal')});if(!opts.disabled)hits.push({r,fn});},panel:r=>panels.push(r),icon:(key,r)=>icons.push({key,r}),hit:(r,fn)=>hits.push({r,fn}),measure:value=>String(value).length*12,input(){},invalidate(){},background(){},withViewport:(_r,fn)=>fn()};
 const app=Object.create(GameApp.prototype),client={config:{capabilities:{}},profile:{},account:{id:'owner-a'}},platform={config:{id:'taptap',apiBase:'https://game.test/api'},viewport:()=>({width:stage.w,height:stage.h,top,bottom}),storage:{get:key=>{reads.push(key);return storage.get(key)??null;},set:(key,value)=>storage.set(key,value)},setOrientation:async value=>{turns.push(value);},orientationChoiceAvailable:()=>true};
 Object.assign(app,{stage,client,platform,navItems:[['lobby'],['gallery'],['collection'],['tasks'],['friends']],privacyAccepted:true,privacyEpoch:0,ready:true,destroyed:false,busy:false,modal:null,route:'lobby',room:null,orientationEntryReady:true,orientationPickerState:'unknown',orientationChoice:null,orientationSwitching:false,message:'',social:{close(){}},invalidate:()=>stage.invalidate(),stopCheers(){},drawHeader(){},drawScene(){},drawTabBar(){},drawNavRail(){},drawPrivacyChoice(){},drawLoading(){},drawNotice(){},lobbyColumn:()=>null});
 return {app,client,platform,stage,texts,buttons,frames,panels,hits,icons,turns,storage,reads,clear:()=>{texts.length=buttons.length=frames.length=panels.length=hits.length=icons.length=0;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function offer(f){f.app.draw();assert.equal(f.app.modal,null);await tick();assert.equal(f.app.modal,'orientation');}

test('first eligible lobby offers once after drawing and confirmation prevents reopening in this session or the next',async()=>{
 const f=fixture();await offer(f);assert.equal(f.app.orientationChoice,'landscape');f.app.draw();assert.equal(f.reads.filter(key=>key===orientationPickerKey).length,1);f.app.confirmOrientation();f.app.draw();await tick();assert.equal(f.app.modal,null);assert.equal(f.app.orientationPickerState,'done');assert.equal(f.reads.filter(key=>key===orientationPickerKey).length,1);
 const next=fixture({storage:f.storage});next.app.draw();await tick();assert.equal(next.app.modal,null);assert.equal(next.app.orientationPickerState,'done');
});

test('entry, route, room, other dialogs, readiness, platform and privacy guards defer the offer without reading storage',async()=>{
 const cases=[f=>f.app.route='chapter',f=>f.app.room={},f=>f.app.orientationEntryReady=false,f=>f.platform.orientationChoiceAvailable=()=>false,f=>delete f.platform.orientationChoiceAvailable,f=>delete f.platform.setOrientation,f=>f.platform.config.id='web',f=>f.platform.config.id='wechat',f=>f.app.ready=false,f=>f.app.modal='settings',f=>f.app.busy=true,f=>f.app.privacyAccepted=false,f=>f.app.loginDialogActive=true];
 for(const change of cases){const f=fixture();change(f);const modal=f.app.modal;f.app.maybeOfferOrientation();assert.equal(f.app.modal,modal);assert.equal(f.app.orientationPickerState,'unknown');assert.equal(f.reads.length,0);}
 const f=fixture();f.app.draw();f.app.destroyed=true;await tick();assert.equal(f.app.modal,null);assert.equal(f.reads.length,0);
});

test('confirmed or throwing storage is read only once per session and suppresses the offer',async()=>{
 for(const throws of [false,true]){const f=fixture({storage:new Map([[orientationPickerKey,'1']])});let reads=0;f.platform.storage.get=()=>{reads++;if(throws)throw Error('存储不可用');return '1';};f.app.draw();await tick();f.app.draw();await tick();assert.equal(f.app.modal,null);assert.equal(f.app.orientationPickerState,'done');assert.equal(reads,1);}
});

test('initial content waits for the level-entry decision, including direct links',async()=>{
 for(const direct of [false,true]){const f=fixture();f.app.orientationEntryReady=false;let finish;const pending=new Promise(resolve=>finish=resolve);Object.assign(f.app,{loadLevels:()=>pending,loadGallery:async()=>{},loadRoomHistory:async()=>{},loadLobby:async()=>{},handleQuery:async()=>{},social:{refresh:async()=>{}},checkLevelEntry:async()=>{assert.equal(f.app.orientationEntryReady,false);f.app.route='chapter';}});const loading=f.app.loadInitialContent(direct?{room:'a'.repeat(32)}:{});f.app.draw();await tick();assert.equal(f.app.modal,null);finish();await loading;assert.equal(f.app.orientationEntryReady,true);assert.equal(f.app.route,direct?'lobby':'chapter');f.app.draw();await tick();assert.equal(f.app.modal,direct?'orientation':null);}
});

test('portrait tile switches once, blocks concurrent switches and keeps the picker open after rotation',async()=>{
 const f=fixture();await offer(f);let finish;f.platform.setOrientation=value=>{f.turns.push(value);return new Promise(resolve=>finish=resolve);};f.app.drawModal();const tile=f.buttons[1],hit=f.hits.find(hit=>hit.r===tile.r);assert.ok(hit);hit.fn();hit.fn();assert.deepEqual(f.turns,['portrait']);assert.equal(f.app.orientationChoice,'portrait');assert.equal(f.app.busy,false);assert.equal(f.app.modal,'orientation');f.clear();f.app.drawModal();assert.equal(f.buttons[0].opts.disabled,true);assert.equal(f.buttons[1].opts.disabled,false);assert.equal(f.buttons.at(-1).opts.disabled,true);
 f.stage.w=390;f.stage.h=844;finish();await tick();assert.equal(f.app.orientationSwitching,false);assert.equal(f.app.modal,'orientation');f.clear();f.app.drawModal();assert.equal(f.buttons[1].opts.selected,true);await f.app.chooseOrientation('portrait');assert.deepEqual(f.turns,['portrait']);
});

test('failed switching restores actual orientation and shows the error without entering busy mode',async()=>{
 const f=fixture();await offer(f);f.platform.setOrientation=async()=>{throw Error('切换失败');};f.app.drawModal();f.hits.find(hit=>hit.r===f.buttons[1].r).fn();await tick();assert.equal(f.app.orientationChoice,'landscape');assert.equal(f.app.message,'切换失败');assert.equal(f.app.orientationSwitching,false);assert.equal(f.app.busy,false);assert.equal(f.app.modal,'orientation');
});

test('confirm and Android back persist the current choice and close the picker, even when storage cannot write',async()=>{
 for(const back of [false,true]){const f=fixture();await offer(f);f.app.orientationChoice='portrait';if(back)f.app.closeModal();else{f.app.drawModal();f.buttons.find(button=>button.label==='确认').fn();}assert.equal(f.storage.get(orientationPreferenceKey),'portrait');assert.equal(f.storage.get(orientationPickerKey),'1');assert.equal(f.app.orientationChoice,null);assert.equal(f.app.modal,null);assert.equal(f.app.orientationPickerState,'done');}
 const f=fixture({width:390,height:844});f.app.modal='orientation';f.app.closeModal();assert.equal(f.storage.get(orientationPreferenceKey),'portrait');f.platform.storage.set=()=>{throw Error('只读');};f.app.modal='orientation';assert.doesNotThrow(()=>f.app.confirmOrientation());assert.equal(f.app.modal,null);
});

test('in-game orientation toggle remembers only successful explicit switches',async()=>{
 for(const [width,height,value]of [[390,844,'landscape'],[844,390,'portrait']]){const f=fixture({width,height});await f.app.toggleOrientation();assert.deepEqual(f.turns,[value]);assert.equal(f.storage.get(orientationPreferenceKey),value);assert.equal(f.storage.has(orientationPickerKey),false);f.platform.setOrientation=async()=>{throw Error('切换失败');};await f.app.toggleOrientation();assert.equal(f.storage.get(orientationPreferenceKey),value);}
});

test('picker panel, tiles and confirm fit portrait and landscape safe areas with centered Chinese copy',()=>{
 for(const [width,height]of [[390,844],[844,390]])for(const [top,bottom]of [[0,0],[24,20]]){const f=fixture({width,height,top,bottom});f.app.orientationChoice='portrait';f.app.drawOrientationPicker();const panel=f.panels[0],confirm=f.buttons.find(button=>button.label==='确认');assert.equal(f.panels.length,1);assert.equal(f.buttons.length,3);assert.equal(panel.w,Math.min(width-32,420));assert.ok(panel.x>=0&&panel.x+panel.w<=width);assert.ok(panel.y>=top&&panel.y+panel.h<=height-bottom);assert.equal(panel.y+panel.h/2,top+(height-top-bottom)/2);assert.ok(f.buttons.every(({r})=>r.x>=panel.x&&r.x+r.w<=panel.x+panel.w&&r.y>=panel.y&&r.y+r.h<=panel.y+panel.h));assert.equal(confirm.r.h,42);assert.equal(confirm.opts.tone,'berry');assert.ok(f.buttons.slice(0,2).every(({r})=>r.h>=84&&r.h<=116));assert.equal(f.buttons[1].r.x-f.buttons[0].r.x-f.buttons[0].r.w,12);assert.equal(f.buttons[1].opts.selected,true);assert.equal(f.icons[0].key,'check');assert.deepEqual(f.hits[0].r,{x:0,y:0,w:width,h:height});assert.doesNotThrow(()=>f.hits[0].fn());assert.equal(f.texts.find(text=>text.value==='之后也能点右上角的旋转按钮随时切换').maxWidth,panel.w-40);assert.ok(f.texts.some(text=>text.value==='选择屏幕方向'&&text.size===20&&text.weight===700));}
});

test('orientation storage helpers accept only supported values and tolerate storage failures',()=>{
 const storage=new Map(),port={get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)};assert.equal(readOrientationPreference(port),null);storage.set(orientationPreferenceKey,'auto');assert.equal(readOrientationPreference(port),null);for(const value of ['portrait','landscape']){saveOrientationPreference(port,value);assert.equal(readOrientationPreference(port),value);}assert.equal(readOrientationPreference({get(){throw Error('只读');}}),null);assert.doesNotThrow(()=>saveOrientationPreference({set(){throw Error('只读');}},'portrait'));
});

test('TapTap capability excludes PC hosts and requires the native device orientation API',t=>{
 const globals={window:{},document:{baseURI:'https://package.test/game/',scripts:[]},location:{href:'https://package.test/game/',origin:'https://package.test'}};for(const [key,value]of Object.entries(globals)){const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key]);}
 const platform=createWebPlatform({id:'taptap',gameName:'测试',apiBase:'https://game.test/api',assetBase:'https://game.test/assets'},{style:{}});
 for(const value of ['windows','Windows','mac','macos','MacOS','pc','PC','android','ios',undefined]){window.tap={setDeviceOrientation(){},getSystemInfoSync:()=>({platform:value})};assert.equal(platform.orientationChoiceAvailable(),!['windows','mac','macos','pc'].includes(value?.toLowerCase()));}
 window.tap={setDeviceOrientation(){}};assert.equal(platform.orientationChoiceAvailable(),true);window.tap={setDeviceOrientation(){},getSystemInfoSync(){throw Error('不可用');}};assert.equal(platform.orientationChoiceAvailable(),false);window.tap={};assert.equal(platform.orientationChoiceAvailable(),false);delete window.tap;assert.equal(platform.orientationChoiceAvailable(),false);
});
