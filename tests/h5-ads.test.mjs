import test from 'node:test';
import assert from 'node:assert/strict';
import {showRewardedAd} from '../h5/ads.ts';
globalThis.window={setTimeout,clearTimeout};
test('missing TapTap runtime never reports watched',async()=>{assert.equal(await showRewardedAd('real-ad-unit'),'unavailable');});
test('only isEnded true counts as a completed platform watch',async()=>{
 for(const [closed,expected] of [[{isEnded:true},'completed'],[{isEnded:false},'closed'],[{},'closed']]){
  let close,destroyed=false;window.tap={createRewardedVideoAd:()=>({load:async()=>{},show:async()=>queueMicrotask(()=>close(closed)),onClose:fn=>{close=fn;},offClose:()=>{},onError:()=>{},offError:()=>{},destroy:()=>{destroyed=true;}})};
  assert.equal(await showRewardedAd('real-ad-unit'),expected);assert.equal(destroyed,true);
 }
});
test('load failure and missing placement do not simulate success',async()=>{
 window.tap={createRewardedVideoAd:()=>({load:async()=>{throw Error('unavailable');},show:async()=>{},onClose:()=>{},onError:()=>{},destroy:()=>{}})};
 assert.equal(await showRewardedAd('real-ad-unit'),'failed');assert.equal(await showRewardedAd(''),'unavailable');
});
