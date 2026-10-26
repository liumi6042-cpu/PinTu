import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";export {GameClient} from "./mobile/client";export {Stage} from "./mobile/ui";export {MOBILE_PRIVACY_CONSENT_KEY} from "./mobile/privacy-policy";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,GameClient,Stage,MOBILE_PRIVACY_CONSENT_KEY}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=async()=>{for(let index=0;index<24;index++)await Promise.resolve();};
const privacyKey=MOBILE_PRIVACY_CONSENT_KEY;
const ok=data=>({status:200,data,headers:{}}),token='f'.repeat(64),roomId='a'.repeat(32);
const profile={code:'123456789',name:'测试玩家',level:3,xp:2,totalXp:42,xpToNext:20,energy:20,energyCap:40,supply:{energy:0,create:0},giftProgress:0,giftCount:0,autoSupply:false,adEligible:false,ownedRooms:[],serverTime:10000,collection:{coins:123,fragments:17,ownedPackIds:[],ownedImageIds:[],equipped:null}};

function fixture(t,{width=390,cookie=false,stored=false,initialQuery={},request}={}){
 const calls=[],text=[],buttons=[],events={hide:new Set(),show:new Set()},storage=new Map(),intervals=new Map();let intervalId=0,invalidations=0,restores=0;
 t.mock.method(globalThis,'setInterval',(fn,ms)=>{intervals.set(++intervalId,{fn,ms});return intervalId;});t.mock.method(globalThis,'clearInterval',id=>intervals.delete(id));
 const ctx=new Proxy({measureText:value=>({width:String(value).length*7}),fillText:value=>text.push(String(value)),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(target,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)});
 const canvas=()=>({width:1,height:1,style:{},getContext:()=>ctx});
 const config={mobileMode:cookie?'web-managed-shared':'mobile-v3-isolated',rewardedAdUnitId:'',adRewardEnabled:false,capabilities:{energy:!cookie,ads:false,albumTarget:cookie?'pc':'mobile-shared',createTickets:!cookie}};
 const platform={canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){if(value)queueMicrotask(()=>this.onload?.());}}),config:{id:'web',gameName:'测试拼图',apiBase:'https://startup.test/h5',assetBase:'https://startup.test/h5/assets',...(cookie?{identityMode:'web-cookie'}:{})},viewport:()=>({width,height:width>=1000?800:844,dpr:1,top:0,bottom:0}),storage:{get:key=>storage.get(key)||null,set:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key)},randomId:()=> 'e'.repeat(32),initialQuery,restoreWebIdentity:async()=>{restores++;},onHide:fn=>(events.hide.add(fn),()=>events.hide.delete(fn)),onShow:fn=>(events.show.add(fn),()=>events.show.delete(fn)),frame:()=>1,cancelFrame(){},openUrl:url=>calls.push({navigation:url})};
 if(stored)storage.set('jigsaw:h5-session:'+platform.config.apiBase,token);
 const standard=input=>{
  const path=new URL(input.url).pathname;
  if(path.endsWith('/config'))return ok(config);
  if(path.endsWith('/session'))return ok({token});
  if(path.endsWith('/api/mobile/profile')||path.endsWith('/api/taptap/bind'))return ok({...profile,...(cookie?{account:{id:'account-a',name:'测试玩家',username:'test'}}:{})});
  if(path.endsWith('/api/lobby'))return ok({rooms:[],nextCursor:null});
  if(path.endsWith('/api/mobile/gallery'))return ok({imageIds:[],packedImageIds:[],freeImageIds:[],photos:[]});
  if(path.endsWith('/api/mobile/social'))return ok({self:{code:profile.code,name:profile.name,level:3},friends:[],blocked:[],requests:{incoming:[],outgoing:[]},conversations:[],unread:0});
  throw Error('Unexpected request '+input.url);
 };
 platform.tapTapIdentity=async()=>({code:'synthetic-login-code',nickname:'测试玩家'});
 platform.request=async input=>{calls.push(input);return request?request(input,standard):standard(input);};
 const client=new GameClient(platform),stage=new Stage(platform,path=>client.asset(path)),app=new GameApp(platform,client,stage),invalidate=stage.invalidate;
 stage.invalidate=()=>{invalidations++;invalidate();};
 const button=stage.button.bind(stage);stage.button=(r,label,fn,opts)=>{buttons.push({r:{...r,x:r.x+stage.offset.x,y:r.y+stage.offset.y},label});return button(r,label,fn,opts);};
 const draw=()=>{text.length=0;buttons.length=0;stage.begin();app.draw();stage.endFrame();return [...text];};
 const click=label=>{const item=buttons.find(item=>item.label===label);assert.ok(item,'rendered button '+label);const point={id:1,x:item.r.x+item.r.w/2,y:item.r.y+item.r.h/2};assert.equal(stage.hasHit(point.x,point.y),true,'the actual Stage hit is interactive');app.input({type:'down',points:[point],changed:[point]});app.input({type:'up',points:[],changed:[point]});};
 const emit=query=>{for(const fn of events.show)fn(query);};
 const close=()=>{app.destroy();stage.destroy();};t.after(close);
 return{app,client,stage,platform,calls,text,buttons,events,intervals,draw,click,emit,close,restores:()=>restores,invalidations:()=>invalidations,standard};
}

test('real narrow and desktop shells render before config/profile and cannot issue player actions',async t=>{
 for(const width of [390,1440]){
  const config=deferred(),data=deferred(),f=fixture(t,{width,request:(input,standard)=>input.url.endsWith('/config')?config.promise:input.url.endsWith('/api/mobile/profile')?data.promise:standard(input)});
  const starting=f.app.start();let rendered=f.draw();assert.ok(rendered.includes('拼图大厅'));assert.ok(rendered.some(value=>value.includes('—')));assert.ok(!rendered.some(value=>value.includes('正在连接游戏')));assert.equal(f.stage.hits.length,0,'the real shell exposes no actions before identity');assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,undefined);assert.equal(f.intervals.size,0);
  for(const item of f.buttons){const point={id:1,x:item.r.x+item.r.w/2,y:item.r.y+item.r.h/2};f.app.input({type:'down',points:[point],changed:[point]});f.app.input({type:'up',points:[],changed:[point]});}assert.equal(f.calls.length,1);
  config.resolve(f.standard(f.calls[0]));await settle();rendered=f.draw();assert.ok(rendered.includes('拼图大厅'));assert.equal(f.app.ready,false);assert.equal(f.stage.hits.length,0);assert.equal(f.calls.filter(input=>input.method==='POST'&&input.url.includes('/api/')).length,0,'only session creation is permitted before profile');
  data.resolve(ok(profile));await starting;assert.equal(f.app.ready,true);assert.equal(f.calls.filter(input=>input.url.endsWith('/session')).length,1);assert.equal(f.intervals.size,3);f.close();
 }
});

test('repeated start and show share one startup and one listener/timer set',async t=>{
 const config=deferred(),f=fixture(t,{stored:true,request:(input,standard)=>input.url.endsWith('/config')?config.promise:standard(input)});
 const first=f.app.start(),second=f.app.start();f.emit({});f.emit({});assert.equal(f.calls.length,1);assert.equal(f.events.hide.size,1);assert.equal(f.events.show.size,1);
 config.resolve(f.standard(f.calls[0]));await Promise.all([first,second]);await settle();assert.equal(f.calls.filter(input=>input.url.endsWith('/config')).length,1);assert.equal(f.calls.filter(input=>input.url.endsWith('/api/mobile/profile')).length,1);assert.equal(f.calls.filter(input=>input.url.endsWith('/session')).length,0);assert.equal(f.intervals.size,3);await f.app.start();assert.equal(f.intervals.size,3);assert.equal(f.events.show.size,1);
});

test('failed startup stays in the real lobby and its Stage retry recovers without duplicate hooks',async t=>{
 let attempt=0;const f=fixture(t,{request:(input,standard)=>input.url.endsWith('/config')&&++attempt===1?Promise.reject(Error('离线，请重试')):standard(input)});
 await f.app.start();const rendered=f.draw();assert.ok(rendered.includes('拼图大厅'));assert.ok(rendered.join('').includes('离线，请重试'));assert.equal(f.app.ready,false);assert.equal(f.stage.hits.length,1,'only the inline retry is available');f.click('重新连接');await f.app.start();await settle();assert.equal(f.app.ready,true);assert.equal(attempt,2);assert.equal(f.events.show.size,1);assert.equal(f.intervals.size,3);
});

test('cookie profile 401 presents inline login and retry restores the original identity order',async t=>{
 let reads=0;const f=fixture(t,{cookie:true,request:(input,standard)=>input.url.endsWith('/api/mobile/profile')&&++reads===1?{status:401,headers:{},data:{error:'请登录',code:'IDENTITY_REQUIRED'}}:standard(input)});
 await f.app.start();let rendered=f.draw();assert.ok(rendered.includes('拼图大厅'));assert.ok(rendered.includes('登录 / 注册'));assert.equal(f.client.authRequired,true);assert.equal(f.client.profile,null);assert.equal(f.calls.some(input=>input.url.endsWith('/session')),false);assert.equal(f.restores(),1);
 f.click('重新连接');await f.app.start();await settle();assert.equal(f.app.ready,true);assert.equal(f.client.authRequired,false);assert.equal(f.client.account.id,'account-a');assert.equal(f.restores(),2);assert.equal(reads,2);assert.equal(f.intervals.size,3);rendered=f.draw();assert.ok(rendered.includes('123'));
 let staleAction=0;const point={id:1,x:24,y:24};f.stage.begin();f.stage.hit({x:10,y:10,w:40,h:40},()=>staleAction++);f.app.input({type:'down',points:[point],changed:[point]});f.client.authRequired=true;f.client.profile=null;f.client.account=null;f.client.onChange();f.app.input({type:'up',points:[],changed:[point]});assert.equal(staleAction,0,'losing identity cancels an already pressed action');
});

test('compact linked agreement precedes player requests and opens complete policy on demand',async t=>{
 const f=fixture(t);f.platform.config.id='taptap';
 await f.app.start();assert.equal(f.calls.length,0);let text=f.draw();assert.ok(text.join('').includes('点击同意确认协议'));assert.ok(!text.join('').includes('香港'));assert.equal(f.platform.storage.get(privacyKey),null);
 f.click('暂不同意');await settle();assert.equal(f.calls.length,0);f.draw();
 const link=f.stage.hits.find(hit=>hit.r.h===38&&hit.r.w<70);assert.ok(link,'协议 text has its own real hit target');
 const point={id:1,x:link.r.x+link.r.w/2,y:link.r.y+link.r.h/2};f.app.input({type:'down',points:[point],changed:[point]});f.app.input({type:'up',points:[],changed:[point]});
 text=f.draw();assert.ok(text.join('').includes('王卉'));assert.ok(text.join('').includes('xiedengdian@163.com'));assert.ok(text.join('').includes('香港'));assert.ok(text.join('').includes('测试版本'));assert.equal(f.calls.length,0);
 f.click('同意');await f.app.start();await settle();assert.equal(f.app.ready,true);assert.equal(f.calls.filter(x=>x.url.endsWith('/session')).length,1);
 const consent=JSON.parse(f.platform.storage.get(privacyKey));assert.equal(consent.necessary,true);assert.equal(consent.hongKongStorage,true);
 f.app.withdrawPrivacy();f.draw();assert.equal(f.app.ready,false);assert.equal(f.intervals.size,0);assert.equal(f.platform.storage.get(privacyKey),null);const count=f.calls.length;f.emit({});await settle();assert.equal(f.calls.length,count,'withdrawn app has no profile refresh subscription');
});

test('withdrawal cancels a late first-lobby chain without social requests or replacement polling',async t=>{
 const lobby=deferred(),f=fixture(t,{request:(input,standard)=>input.url.includes('/api/lobby?')?lobby.promise:standard(input)});f.platform.config.id='taptap';
 f.app.acceptPrivacy();await settle();assert.equal(f.app.ready,true);assert.ok(f.calls.some(input=>input.url.includes('/api/lobby?')));
 const starting=f.app.startupPending;f.app.withdrawPrivacy();const count=f.calls.length;lobby.resolve(ok({rooms:[],nextCursor:null}));await starting;await settle();assert.equal(f.calls.length,count);assert.equal(f.intervals.size,0);assert.equal(f.app.ready,false);
});

test('an invitation shown during identity startup joins once before unrelated content',async t=>{
 const data=deferred(),join=deferred(),attached=[],f=fixture(t,{stored:true,request:(input,standard)=>input.url.endsWith('/api/mobile/profile')?data.promise:input.url.endsWith('/join')?join.promise:standard(input)});
 // Room attachment owns image/room loops, outside startup ordering. Keep the
 // real query, run, GameClient join and ticket validation up to that boundary.
 f.app.attachTicket=async ticket=>{attached.push(ticket);f.app.route='room';};
 const starting=f.app.start();await settle();f.emit({room:roomId});f.emit({room:roomId});assert.ok(f.draw().includes('拼图大厅'));data.resolve(ok(profile));await settle();assert.equal(f.calls.filter(input=>input.url.endsWith('/join')).length,1);assert.equal(f.calls.some(input=>input.url.includes('/api/lobby')||input.url.endsWith('/api/mobile/gallery')),false);
 join.resolve(ok({token:'b'.repeat(32),playerId:'player',room:{id:roomId}}));await starting;await settle();assert.equal(attached.length,1);assert.equal(f.calls.some(input=>input.url.includes('/api/lobby')),false);assert.equal(f.calls.filter(input=>input.url.endsWith('/api/mobile/gallery')).length,1);assert.equal(f.intervals.size,3);f.emit({room:roomId});await settle();assert.equal(attached.length,1,'the already handled show query cannot join twice');
});

test('an empty show during profile loading preserves the initial room invitation',async t=>{
 const data=deferred(),join=deferred(),attached=[],f=fixture(t,{stored:true,initialQuery:{room:roomId},request:(input,standard)=>input.url.endsWith('/api/mobile/profile')?data.promise:input.url.endsWith('/join')?join.promise:standard(input)});
 f.app.attachTicket=async ticket=>{attached.push(ticket);f.app.route='room';};
 const starting=f.app.start();await settle();assert.equal(f.calls.filter(input=>input.url.endsWith('/api/mobile/profile')).length,1);f.emit({});assert.ok(f.draw().includes('拼图大厅'));
 data.resolve(ok(profile));await settle();assert.equal(f.calls.filter(input=>input.url.endsWith('/api/rooms/'+roomId+'/join')).length,1,'the real client joins the initial invitation');assert.equal(f.calls.some(input=>input.url.endsWith('/api/mobile/gallery')||input.url.includes('/api/lobby')),false,'initial room admission remains ahead of unrelated lists');
 join.resolve(ok({token:'b'.repeat(32),playerId:'player',room:{id:roomId}}));await starting;await settle();assert.equal(attached.length,1);assert.equal(f.calls.filter(input=>input.url.endsWith('/join')).length,1);assert.equal(f.calls.some(input=>input.url.includes('/api/lobby')),false);
});

test('destroy during config or profile ignores late success/failure and creates no timers',async t=>{
 for(const phase of ['config','profile'])for(const fail of [false,true]){
  const gate=deferred(),f=fixture(t,{stored:true,request:(input,standard)=>input.url.endsWith(phase==='config'?'/config':'/api/mobile/profile')?gate.promise:standard(input)}),starting=f.app.start();await settle();f.close();const invalidations=f.invalidations();if(fail)gate.reject(Error('late failure'));else gate.resolve(phase==='config'?f.standard(f.calls[0]):ok(profile));await starting;await settle();assert.equal(f.app.ready,false);assert.equal(f.intervals.size,0);assert.equal(f.events.show.size,0);assert.equal(f.client.onChange,undefined);assert.equal(f.invalidations(),invalidations);assert.equal(f.app.board,null);
 }
});

test('a join resolved after destroy or authentication loss cannot attach a room',async t=>{
 for(const reason of ['destroy','auth']){
  const join=deferred(),f=fixture(t,{stored:true,request:(input,standard)=>input.url.endsWith('/join')?join.promise:standard(input)});await f.app.start();const entering=f.app.enterRoom(roomId);await settle();if(reason==='destroy')f.close();else f.client.authRequired=true;
  join.resolve(ok({token:'b'.repeat(32),playerId:'player',room:{id:roomId}}));await entering;assert.equal(f.app.room,null);assert.equal(f.app.board,null);assert.equal(f.app.cursor,null);assert.equal(f.app.route,'lobby');
 }
});

test('actual settings only expose nickname reauthorization in the self-test package and its Stage button can cancel',async t=>{
 for(const enabled of [false,true]){const gate=deferred(),f=fixture(t);f.platform.config.id='taptap';f.platform.config.tapAuthorizationTest=enabled;const options=[];
  f.platform.tapTapIdentity=async input=>{options.push(input);if(input?.forceAuthorization)return gate.promise;return {code:'initial-code',nickname:'测试玩家'};};f.platform.tapAuthorizationPending=()=>options.some(o=>o?.forceAuthorization);f.platform.cancelIdentity=()=>{if(options.some(o=>o?.forceAuthorization))gate.reject(Error('cancelled test'));};
  f.app.acceptPrivacy();await f.app.start();f.app.showModal('settings');f.draw();assert.equal(f.buttons.some(b=>b.label==='重新走昵称授权'),enabled);if(!enabled)continue;
  f.click('重新走昵称授权');await settle();assert.equal(options.at(-1).forceAuthorization,true);assert.equal(f.app.busy,true);assert.equal(f.app.modal,null);f.draw();f.click('取消登录');await settle();assert.equal(f.app.busy,false);assert.equal(f.app.ready,true);assert.ok(f.client.profile);
 }
});

test('one native approval confirms the agreement and logs in without a second authorization step',async t=>{
 const f=fixture(t),gate=deferred(),listeners=new Set(),panels=[];let pending=false,accept,failed,visible=true;
 f.platform.config.id='taptap';f.platform.tapAuthorizationPending=()=>pending;f.platform.onIdentityChange=fn=>(listeners.add(fn),()=>listeners.delete(fn));
 f.platform.setIdentityButtonVisible=v=>{visible=v;};
 f.platform.prepareTapConsent=(yes,no)=>{accept=yes;failed=no;pending=true;for(const fn of listeners)fn();};
 f.platform.tapTapIdentity=()=>gate.promise;
 const panel=f.stage.panel.bind(f.stage);f.stage.panel=(r,...rest)=>{panels.push({...r});return panel(r,...rest);};
 await f.app.start();const text=f.draw(),consentPanel=panels.at(-1);assert.equal(f.calls.length,0);assert.equal(f.platform.storage.get(privacyKey),null);assert.ok(text.join('').includes('点击同意确认协议'));assert.ok(text.includes('同意并登录'));assert.deepEqual(f.buttons.map(b=>b.label),['暂不同意']);
 // 阅读协议不授权，且原生按钮隐藏，避免覆盖详细条款。
 const link=f.stage.hits.find(hit=>hit.r.h===38&&hit.r.w<70),point={id:1,x:link.r.x+link.r.w/2,y:link.r.y+link.r.h/2};f.app.input({type:'down',points:[point],changed:[point]});f.app.input({type:'up',points:[],changed:[point]});f.draw();assert.equal(visible,false);assert.equal(f.calls.length,0);f.click('返回登录');f.draw();assert.equal(visible,true);
 // 模拟唯一一次原生按钮点击完成授权，同时记录协议，然后继续同一个登录Promise。
 pending=false;accept();for(const fn of listeners)fn();await settle();panels.length=0;assert.ok(f.draw().includes('正在连接…'));assert.deepEqual(panels.at(-1),consentPanel);assert.ok(f.platform.storage.get(privacyKey));assert.equal(f.client.profile,null);
 gate.resolve({code:'approved-code',nickname:'测试玩家'});await f.app.start();assert.equal(f.app.ready,true);assert.equal(f.app.loginDialogActive,false);assert.ok(!f.draw().includes('同意并登录'));assert.equal(f.calls.filter(c=>c.url.endsWith('/api/taptap/bind')).length,1);f.close();assert.equal(listeners.size,0);
});

test('settings expose the real ad test button only for the server allowlisted TapTap account',async t=>{
 const f=fixture(t);f.platform.config.id='taptap';f.app.acceptPrivacy();await f.app.start();f.app.showModal('settings');f.draw();assert.equal(f.buttons.some(b=>b.label==='广告观看测试'||b.label==='插屏广告测试'),false);
 f.client.profile.taptap={bound:true,diagnostics:true};f.client.config.rewardedAdUnitId='1071218';let ads=0;f.platform.watchAd=async unit=>{assert.equal(unit,'1071218');ads++;return 'completed';};f.platform.alert=()=>{};f.draw();assert.equal(f.buttons.some(b=>b.label==='广告观看测试'),true);const before=f.calls.length;f.click('广告观看测试');await settle();assert.equal(ads,1);assert.equal(f.calls.length,before);
 f.platform.showInterstitialAd=async unit=>{assert.equal(unit,'1071588');ads++;return 'closed';};f.draw();f.click('插屏广告测试');await settle();assert.equal(ads,2);assert.equal(f.calls.length,before);
});

function tapConsentFixture(t,{prepare='pending'}={}){
 const f=fixture(t),listeners=new Set(),lines=[];const state={pending:false,retries:0,cancels:0,identityCalls:0,failed:null};
 f.platform.config.id='taptap';f.platform.tapAuthorizationPending=()=>state.pending;f.platform.onIdentityChange=fn=>(listeners.add(fn),()=>listeners.delete(fn));
 f.platform.loginLog={add:text=>lines.push(text),lines:()=>lines};f.platform.tapAuthorizationDebug=()=>'视口 390×844';
 f.platform.prepareTapConsent=(yes,no)=>{state.failed=no;if(prepare==='fail'){queueMicrotask(()=>no(Error('TapTap登录接口尚未就绪')));return;}state.pending=true;for(const fn of listeners)fn();};
 f.platform.retryTapAuthorizationButton=()=>{state.retries++;return true;};
 f.platform.cancelIdentity=()=>{state.cancels++;if(state.pending){state.pending=false;const no=state.failed;queueMicrotask(()=>no?.(Error('cancelled')));}};
 f.platform.tapTapIdentity=async()=>{state.identityCalls++;throw Error('the guest path must not ask TapTap again');};
 // 画布上的“同意并登录”与“暂不同意”同宽同高，位于其右侧。
 const tapRight=()=>{f.draw();const refuse=f.buttons.find(b=>b.label==='暂不同意');assert.ok(refuse);const point={id:1,x:refuse.r.x+refuse.r.w+8+refuse.r.w/2,y:refuse.r.y+refuse.r.h/2};assert.equal(f.stage.hasHit(point.x,point.y),true);f.app.input({type:'down',points:[point],changed:[point]});f.app.input({type:'up',points:[],changed:[point]});};
 return {...f,state,lines,tapRight};
}

test('a 同意并登录 tap the native button missed twice enters as a guest with the agreement recorded',async t=>{
 const f=tapConsentFixture(t);await f.app.start();assert.ok(f.draw().includes('同意并登录'));assert.ok(f.lines.some(line=>line.startsWith('登录弹窗显示')));
 // 第一次落到画布：同步重建原生按钮并提示再点一次，不发请求、不记录同意。
 f.tapRight();assert.equal(f.state.retries,1);assert.equal(f.calls.length,0);assert.equal(f.platform.storage.get(privacyKey),null);assert.ok(f.draw().join('').includes('仍无反应将以游客身份进入'));
 // 第二次仍落到画布：这次点击即同意协议，取消原生授权，以游客身份进入。
 f.tapRight();await settle();await f.app.start();assert.equal(f.state.cancels,1);assert.equal(f.state.identityCalls,0);assert.ok(f.platform.storage.get(privacyKey));
 assert.equal(f.app.ready,true);assert.equal(f.client.tapGuest,true);assert.equal(f.app.message,'TapTap登录暂时不可用，已用游客身份进入，进度会保留');
 assert.deepEqual(f.calls.slice(0,3).map(c=>new URL(c.url).pathname),['/h5/config','/h5/session','/h5/api/mobile/profile']);assert.equal(f.calls.filter(c=>c.url.endsWith('/api/taptap/bind')).length,0);
 assert.ok(f.lines.some(line=>line.startsWith('转入游客模式 · 原生按钮两次未接住点击')));
});

test('暂不同意 never enters the game, and a failed TapTap preparation turns 同意并登录 into a guest entry',async t=>{
 const refused=tapConsentFixture(t);await refused.app.start();refused.draw();refused.click('暂不同意');await settle();
 assert.equal(refused.state.cancels,1);const text=refused.draw();assert.ok(refused.buttons.some(b=>b.label==='重新连接'));assert.ok(!refused.buttons.some(b=>b.label==='同意并登录'));assert.ok(!text.includes('同意并登录'));
 refused.click('重新连接');await settle();assert.equal(refused.calls.length,0);assert.equal(refused.platform.storage.get(privacyKey),null);assert.equal(refused.app.ready,false);
 const failed=tapConsentFixture(t,{prepare:'fail'});await failed.app.start();await settle();failed.draw();assert.ok(failed.draw().join('').includes('将以游客身份进入'));
 failed.click('同意并登录');await settle();await failed.app.start();assert.ok(failed.platform.storage.get(privacyKey));assert.equal(failed.app.ready,true);assert.equal(failed.client.tapGuest,true);assert.equal(failed.state.identityCalls,0);
});

test('the login log opens from the login dialog and from settings, hides the native button and copies without player data',async t=>{
 const f=tapConsentFixture(t);let visible=true,copied='';f.platform.setIdentityButtonVisible=v=>{visible=v;};f.platform.copyText=async text=>{copied=text;return true;};
 await f.app.start();f.draw();const link=f.stage.hits.find(hit=>hit.r.h===30),point={id:1,x:link.r.x+link.r.w/2,y:link.r.y+link.r.h/2};f.app.input({type:'down',points:[point],changed:[point]});f.app.input({type:'up',points:[],changed:[point]});
 const text=f.draw();assert.ok(text.includes('登录日志'));assert.equal(visible,false);assert.ok(text.some(line=>line.includes('登录弹窗显示')));f.click('复制');await settle();assert.ok(copied.includes('登录弹窗显示'));assert.equal(f.app.message,'登录日志已复制');
 f.click('关闭');f.draw();assert.equal(visible,true);assert.ok(f.draw().includes('同意并登录'));
});

test('on a host without nickname APIs one 同意并登录 click logs in with the login code only',async t=>{
 const f=tapConsentFixture(t,{prepare:'fail'});const bodies=[];f.platform.tapNicknameUnavailable=()=>true;
 f.platform.tapTapIdentity=async()=>{f.state.identityCalls++;return {code:'pc-after-click',nickname:'',nicknameUnavailable:true};};
 const standard=f.standard;f.platform.request=async input=>{f.calls.push(input);if(input.url.endsWith('/api/taptap/bind'))bodies.push(input.body);return standard(input);};
 await f.app.start();await settle();assert.ok(f.draw().join('').includes('此客户端不支持昵称授权'));assert.equal(f.calls.length,0);assert.equal(f.state.identityCalls,0);
 f.click('同意并登录');await settle();await f.app.start();
 assert.ok(f.platform.storage.get(privacyKey));assert.equal(f.app.ready,true);assert.equal(f.state.identityCalls,1);assert.equal(f.client.tapGuest,false);assert.deepEqual(bodies,[{code:'pc-after-click'}]);
 assert.ok(f.lines.some(line=>line.includes('改为仅登录绑定')));assert.notEqual(f.app.message,'TapTap登录暂时不可用，已用游客身份进入，进度会保留');
});
