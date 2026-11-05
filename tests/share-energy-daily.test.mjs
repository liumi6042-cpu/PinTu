import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
const rid=()=>randomBytes(16).toString('hex'),owner='c'.repeat(64);
// Beijing 2026-11-05 10:00 = 02:00 UTC; the game day flips at 20:00 Beijing (12:00 UTC).
const at=(hour,minute=0,day=5)=>Date.UTC(2026,10,day,hour-8,minute);

test('分享领体力包 works once per game day; the day flips at 20:00 Beijing; 建房券 and ads are not limited',()=>{
 let now=at(10);const service=createMobileService({databasePath:':memory:',adEnabled:true,shareRewards:true,dailyTurnoverHour:20,now:()=>now});
 const call=(url,body)=>service.handle({identity:owner,url,method:body?'POST':'GET',body});
 const share=kind=>{const input={kind,requestId:rid(),context:'supply'},c=call('/api/mobile/share/challenge',input);if(c.status!==200)return {challenge:c};return {challenge:c,redeem:()=>call('/api/mobile/share/redeem',{...input,rewardToken:c.data.rewardToken,completed:true}),input:{...input,rewardToken:c.data.rewardToken,completed:true}};};
 try{
  assert.equal(call('/api/mobile/profile').data.shareEnergyClaimedToday,false);
  const first=share('energy'),parallel=share('energy');assert.equal(first.challenge.status,200);assert.equal(parallel.challenge.status,200,'two open shares before either is redeemed');
  const done=first.redeem();assert.equal(done.status,200);assert.equal(done.data.supply.energy,1);assert.equal(done.data.shareEnergyClaimedToday,true);
  const again=share('energy').challenge;assert.equal(again.status,409);assert.equal(again.data.code,'SHARE_DAILY_LIMIT');assert.match(again.data.error,/每天限 1 次，北京时间 20 点后/);
  const second=parallel.redeem();assert.equal(second.status,409);assert.equal(second.data.code,'SHARE_DAILY_LIMIT');assert.equal(call('/api/mobile/profile').data.supply.energy,1);
  assert.equal(call('/api/mobile/share/redeem',first.input).status,200,'a retried receipt still answers');assert.equal(call('/api/mobile/profile').data.supply.energy,1);
  const ticket=share('create').challenge;assert.notEqual(ticket.data.code,'SHARE_DAILY_LIMIT','建房券 sharing is not limited (a new profile is simply full)');
  const ad={kind:'energy',requestId:rid()},token=call('/api/mobile/supply/challenge',ad).data.rewardToken;assert.equal(call('/api/mobile/supply/redeem',{...ad,rewardToken:token,completed:true}).status,200,'video energy is not limited');
  now=at(19,59);assert.equal(share('energy').challenge.status,409);assert.equal(call('/api/mobile/profile').data.shareEnergyClaimedToday,true);
  now=at(20,0);assert.equal(call('/api/mobile/profile').data.shareEnergyClaimedToday,false);
  const next=share('energy');assert.equal(next.challenge.status,200,JSON.stringify(next.challenge.data));assert.equal(next.redeem().status,200);assert.equal(share('energy').challenge.status,409);
  now=at(21,0,6);assert.equal(call('/api/mobile/profile').data.shareEnergyClaimedToday,false);assert.equal(share('energy').challenge.data.code,'SUPPLY_FULL','next evening only the full stock (3/3) stops it');
 }finally{service.close();}
});
