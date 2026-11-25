import test from 'node:test';import assert from 'node:assert/strict';
import {showRewardedAd,prepareRewardedAd,disposeRewardedAd} from '../h5/ads.ts';
globalThis.window={setTimeout,clearTimeout};
function runtime({closeResult={isEnded:true},failFirst=false,failAlways=false,errorEvent=false,autoClose=true}={}){
 let close,error,created=0,shown=0,loads=0,destroyed=0;
 window.tap={createRewardedVideoAd:()=>{created++;return {load:async()=>{loads++;},show:async()=>{shown++;if(failAlways||(failFirst&&shown===1))throw Error('not ready');if(errorEvent)setTimeout(()=>error(Error('playback failed')),0);else if(autoClose)setTimeout(()=>{close(closeResult);close(closeResult);},0);},onClose:fn=>{close=fn;},offClose:()=>{},onError:fn=>{error=fn;},offError:()=>{},destroy:()=>{destroyed++;}};}};
 return {stats:()=>({created,shown,loads,destroyed}),close:result=>close(result)};
}
test.afterEach(()=>disposeRewardedAd());
test('missing TapTap runtime or placement never reports watched',async()=>{delete window.tap;assert.equal(await showRewardedAd('unit'),'unavailable');runtime();assert.equal(await showRewardedAd(''),'unavailable');});
test('only complete native close events count; duplicate callbacks settle once',async()=>{
 for(const [closed,expected]of [[{isEnded:true},'completed'],[{isEnded:false},'closed'],[{},'closed']]){disposeRewardedAd();runtime({closeResult:closed});assert.equal(await showRewardedAd('unit'),expected);}
});
test('preload never displays ads and a single native instance is reused',async()=>{
 const mock=runtime();prepareRewardedAd('unit');await Promise.resolve();assert.deepEqual(mock.stats(),{created:1,shown:0,loads:1,destroyed:0});
 assert.equal(await showRewardedAd('unit'),'completed');assert.equal(await showRewardedAd('unit'),'completed');assert.equal(mock.stats().created,1);assert.equal(mock.stats().shown,2);disposeRewardedAd();assert.equal(mock.stats().destroyed,1);
});
test('show failure performs one load and one retry',async()=>{const mock=runtime({failFirst:true});assert.equal(await showRewardedAd('unit'),'completed');assert.equal(mock.stats().shown,2);assert.equal(mock.stats().loads,2);});
test('retry exhaustion or playback error never reports complete',async()=>{let mock=runtime({failAlways:true});assert.equal(await showRewardedAd('unit'),'failed');assert.equal(mock.stats().shown,2);disposeRewardedAd();mock=runtime({errorEvent:true});assert.equal(await showRewardedAd('unit'),'failed');assert.equal(mock.stats().shown,1);});
test('parallel watches are refused and disposal cancels without reward',async()=>{runtime({autoClose:false});const first=showRewardedAd('unit');assert.equal(await showRewardedAd('unit'),'unavailable');disposeRewardedAd();assert.equal(await first,'failed');});
