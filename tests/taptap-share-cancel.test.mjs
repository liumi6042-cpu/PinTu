import test from 'node:test';import assert from 'node:assert/strict';
import {shareOnTapTap,subscribeTapShareReturn,TAP_SHARE_AWAY_MS} from '../mobile/taptap-share.ts';
function hostFixture(){let listener,shown,off=0;return {host:{onShareMessage:value=>listener=value,offShareMessage:()=>off++,showShareboard:value=>{shown=value;value.success({errMsg:'showShareboard:ok'});}},get listener(){return listener;},get shown(){return shown;},get off(){return off;}};}

test('cancellation in success, failure or panel completion resolves immediately without a channel',async()=>{
 for(const callback of ['channelSuccess','channelFailure','panelSuccess','panelFailure','panelComplete']){
  const f=hostFixture(),promise=shareOnTapTap(f.host,{});const event={errMsg:'share:fail cancel'};
  if(callback==='channelSuccess')f.listener.success(event);else if(callback==='channelFailure')f.listener.fail(event);else f.shown[callback==='panelSuccess'?'success':callback==='panelFailure'?'fail':'complete'](event);
  assert.equal(await promise,'cancelled');assert.equal(f.off,1);
 }
});

test('manual cancellation unregisters once; late success cannot grant or complete the next attempt',async()=>{
 const f=hostFixture(),controller=new AbortController();let detached=0;
 const first=shareOnTapTap(f.host,{},45000,undefined,{signal:controller.signal,subscribeReturn:()=>()=>detached++}),old=f.listener;
 controller.abort();assert.equal(await first,'cancelled');assert.equal(detached,1);assert.equal(f.off,1);
 let settled=false;const next=shareOnTapTap(f.host,{}).then(value=>(settled=true,value));old.success({channel:'wechat'});await Promise.resolve();assert.equal(settled,false);
 f.listener.success({channel:'wechat'});assert.equal(await next,'shared');assert.equal(f.off,2);
});

test('return without a result resolves in 800ms, but delayed success during the grace period wins',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const completed of [false,true]){
  const f=hostFixture();let returned,detached=0,settled=false;
  const promise=shareOnTapTap(f.host,{},45000,undefined,{subscribeReturn:fn=>(returned=fn,()=>detached++)}).then(value=>(settled=true,value));
  t.mock.timers.tick(5000);await Promise.resolve();assert.equal(settled,false,'opening a panel alone must not start the return timer');
  returned();returned();t.mock.timers.tick(799);await Promise.resolve();assert.equal(settled,false);
  if(completed)f.listener.success({channel:'qq'});else t.mock.timers.tick(1);
  assert.equal(await promise,completed?'shared':'cancelled');assert.equal(detached,1);assert.equal(f.off,1);
  t.mock.timers.tick(50000);assert.equal(f.off,1);
 }
});

test('empty registration and successful panel completion do not imply cancellation or sharing',async()=>{
 const f=hostFixture(),controller=new AbortController();let settled=false;
 const promise=shareOnTapTap(f.host,{},45000,undefined,{signal:controller.signal}).then(value=>(settled=true,value));
 f.listener.success({});f.shown.complete({errMsg:'showShareboard:ok'});await Promise.resolve();assert.equal(settled,false);
 controller.abort();assert.equal(await promise,'cancelled');
});

test('the return observer requires a real transition or game touch and removes all subscriptions',()=>{
 const environment={window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),canvas:new EventTarget()};let hide,show,count=0;const removed=[];
 const host={onHide:fn=>hide=fn,onShow:fn=>show=fn,offHide:fn=>removed.push(fn),offShow:fn=>removed.push(fn)};
 const infos=[];let clock=0;const detach=subscribeTapShareReturn(host,environment,info=>{count++;infos.push(info);},()=>clock);
 show();environment.window.dispatchEvent(new Event('focus'));environment.document.dispatchEvent(new Event('visibilitychange'));assert.equal(count,0);
 hide();clock+=3000;show();assert.equal(count,1);assert.deepEqual(infos[0],{background:true,awayMs:3000});environment.document.hidden=true;environment.document.dispatchEvent(new Event('visibilitychange'));environment.document.hidden=false;environment.document.dispatchEvent(new Event('visibilitychange'));assert.equal(count,2);
 environment.window.dispatchEvent(new Event('blur'));environment.window.dispatchEvent(new Event('focus'));assert.equal(count,3);
 environment.canvas.dispatchEvent(new Event('pointerdown'));environment.canvas.dispatchEvent(new Event('touchstart'));assert.equal(count,5);
 detach();assert.deepEqual(removed,[hide,show]);environment.canvas.dispatchEvent(new Event('pointerdown'));environment.window.dispatchEvent(new Event('blur'));environment.window.dispatchEvent(new Event('focus'));assert.equal(count,5);
});

test('a real trip to another app (WeChat sends no result) counts as shared after a short grace',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const late of ['none','qq','cancel']){
  const f=hostFixture();let returned,settled=false;
  const promise=shareOnTapTap(f.host,{},45000,undefined,{subscribeReturn:fn=>(returned=fn,()=>{})}).then(value=>(settled=true,value));
  returned({background:true,awayMs:TAP_SHARE_AWAY_MS+500});returned({background:false,awayMs:0});
  t.mock.timers.tick(1499);await Promise.resolve();assert.equal(settled,false);
  if(late==='qq')f.listener.success({channel:'qq'});else if(late==='cancel')f.listener.success({errMsg:'share:fail cancel'});else t.mock.timers.tick(1);
  assert.equal(await promise,late==='cancel'?'cancelled':'shared');
 }
});

test('a quick round trip or a touch first still resolves as cancelled, but a later real trip upgrades it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 {const f=hostFixture();let returned;const promise=shareOnTapTap(f.host,{},45000,undefined,{subscribeReturn:fn=>(returned=fn,()=>{})});
  returned({background:true,awayMs:TAP_SHARE_AWAY_MS-1});t.mock.timers.tick(800);assert.equal(await promise,'cancelled');}
 {const f=hostFixture();let returned;const promise=shareOnTapTap(f.host,{},45000,undefined,{subscribeReturn:fn=>(returned=fn,()=>{})});
  returned({background:false,awayMs:0});t.mock.timers.tick(400);returned({background:true,awayMs:6000});t.mock.timers.tick(800);t.mock.timers.tick(700);assert.equal(await promise,'shared');}
});

test('the return observer reports background trips from the page visibility and touches after hiding',()=>{
 const environment={window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),canvas:new EventTarget()};let clock=0;const infos=[];
 const detach=subscribeTapShareReturn(undefined,environment,info=>infos.push(info),()=>clock);
 environment.window.dispatchEvent(new Event('blur'));environment.document.hidden=true;environment.document.dispatchEvent(new Event('visibilitychange'));clock+=4000;
 environment.document.hidden=false;environment.document.dispatchEvent(new Event('visibilitychange'));environment.window.dispatchEvent(new Event('focus'));
 assert.deepEqual(infos,[{background:true,awayMs:4000}]);
 environment.document.hidden=true;environment.document.dispatchEvent(new Event('visibilitychange'));environment.canvas.dispatchEvent(new Event('pointerdown'));assert.deepEqual(infos[1],{background:false,awayMs:0},'a touch never claims a trip');clock+=1000;environment.document.hidden=false;environment.document.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(infos[2],{background:true,awayMs:1000});detach();
});
