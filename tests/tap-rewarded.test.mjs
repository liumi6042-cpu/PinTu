import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['mobile/tap-rewarded.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createTapRewarded,adErrorText}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
function fixture({show=()=>{},load=()=>{}}={}){
 const calls=[],listeners={},events=[];let creates=0;
 const ad={load:async()=>{calls.push('load');return load();},show:async()=>{calls.push('show');return show();},onLoad:fn=>listeners.load=fn,onError:fn=>listeners.error=fn,onClose:fn=>listeners.close=fn,destroy:()=>calls.push('destroy')};
 const rewarded=createTapRewarded(()=>({createRewardedVideoAd(options){creates++;events.push(['create',options.adUnitId]);return ad;}}),(stage,unit,error)=>events.push([stage,unit,error]));
 return {rewarded,calls,listeners,events,creates:()=>creates};
}

test('one instance per slot, created and preloaded early; a click shows first',async()=>{
 const f=fixture();f.rewarded.prepare('p1');f.rewarded.prepare('p1');assert.equal(f.creates(),1);assert.deepEqual(f.calls,['load']);
 const watching=f.rewarded.watch('p1');await settle();assert.deepEqual(f.calls,['load','show']);f.listeners.close({isEnded:true});assert.equal(await watching,'completed');
 const again=f.rewarded.watch('p1');await settle();f.listeners.close({});assert.equal(await again,'closed');assert.equal(f.creates(),1);assert.equal(f.calls.includes('destroy'),false);
 f.rewarded.prepare('l1');assert.equal(f.creates(),2);
});

test('a show that is not ready reloads once and shows again; onError before display does not end the attempt',async()=>{
 let ready=false,loads=0;const f=fixture({show:()=>{if(!ready)throw {errCode:1004,errMsg:'not ready'};},load:()=>{if(++loads>1)ready=true;else throw {errCode:1004};}});
 const watching=f.rewarded.watch('p1');f.listeners.error({errCode:1004});await settle();await settle();
 assert.deepEqual(f.calls.slice(-3),['show','load','show']);f.listeners.close({isEnded:true});assert.equal(await watching,'completed');
});

test('load failure reports the official error meaning; no slot or host is unavailable',async()=>{
 const f=fixture({show:()=>{throw {errCode:1004};},load:()=>{throw {errCode:1008,errMsg:'closed'};}});
 assert.equal(await f.rewarded.watch('p1'),'failed');assert.equal(f.rewarded.failure(),'错误码 1008 广告单元已关闭');assert.ok(f.events.some(e=>e[0]==='加载失败'));
 assert.equal(adErrorText({errno:1002}),'错误码 1002 广告单元无效');assert.equal(adErrorText('x'),'');
 const none=createTapRewarded(()=>undefined,()=>{});assert.equal(await none.watch('p1'),'unavailable');assert.equal(await fixture().rewarded.watch(''),'unavailable');
});

test('nothing on screen within 10 s fails fast; once shown only onClose ends the wait',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const hung=fixture({show:()=>new Promise(()=>{})}),pending=hung.rewarded.watch('p1');await settle();t.mock.timers.tick(9999);await settle();
 let settled=false;pending.then(()=>settled=true);await settle();assert.equal(settled,false);t.mock.timers.tick(1);assert.equal(await pending,'failed');assert.equal(hung.rewarded.failure(),'超时');assert.ok(hung.events.some(e=>e[0]==='展示超时（10秒）'));
 const f=fixture(),watching=f.rewarded.watch('p1');await settle();t.mock.timers.tick(60000);await settle();f.listeners.close({isEnded:true});assert.equal(await watching,'completed');
 const lost=fixture(),late=lost.rewarded.watch('p1');await settle();t.mock.timers.tick(180000);assert.equal(await late,'closed');
});

test('an error after the ad is on screen fails the attempt and a late close is ignored',async()=>{
 const f=fixture(),watching=f.rewarded.watch('p1');await settle();f.listeners.error({errCode:1003});assert.equal(await watching,'failed');f.listeners.close({isEnded:true});
 assert.equal(f.rewarded.failure(),'错误码 1003 内部错误');
});
