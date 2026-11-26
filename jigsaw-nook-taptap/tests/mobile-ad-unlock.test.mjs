import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
import {GALLERY_VISIBLE_PHOTOS} from '../outputs/mobile/engine.mjs';

// 治愈时光: 2 completed rewarded ads unlock one picture permanently; capped at 2 unlock ads / 1 unlock per Beijing day.
const rid=()=>randomBytes(16).toString('hex'),DAY=86400000;
const ids=GALLERY_VISIBLE_PHOTOS.slice(0,5).map(photo=>photo.id),[free,ad1,ad2,ad3,ad4]=ids;
const album=(id,imageIds,extra={})=>({id,title:id,description:'',imageIds,coverImageId:imageIds[0],showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[],...extra});
const albums={schema:'jigsaw-albums/v1',albums:[album('free',[free]),album('healing-time',[ad1,ad2,ad3,ad4],{showOnPc:false,purchasable:true,price:1,milestones:[{id:'milestone-3',target:3,coins:30,decorationId:null}]})]};
function fixture(options={}){
 let clock=Date.parse('2030-06-01T10:00:00+08:00');
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'ad-unlock-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>clock,adEnabled:true,albumContent:{read:()=>albums},...options}),db=new DatabaseSync(databasePath),identity='a'.repeat(64);
 const call=(url,body,who=identity)=>service.handle({identity:who,url,method:body===undefined?'GET':'POST',body});
 call('/api/mobile/profile');
 const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);
 profile.starterSelectionAvailable=false;profile.supply.create=3;db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),identity);
 const create=imageId=>call('/api/rooms',{mode:'selected',pieces:48,visibility:'public',imageId,requestId:rid()});
 const unlock=imageId=>{const requestId=rid(),challenge=call('/api/mobile/collection/unlock/challenge',{imageId,requestId});assert.equal(challenge.status,200,JSON.stringify(challenge.data));
  return {requestId,rewardToken:challenge.data.rewardToken,redeem:(extra={})=>call('/api/mobile/collection/unlock/redeem',{imageId,requestId,rewardToken:challenge.data.rewardToken,completed:true,...extra})};};
 return {call,create,unlock,db,identity,advanceDays(days){clock+=days*DAY;},close(){db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('ad album is locked, exposes 2-ad daily quota metadata, and refuses coin purchase',()=>{
 const f=fixture();try{
  const gallery=f.call('/api/mobile/gallery').data;assert.deepEqual(gallery.freeImageIds,[free]);assert.deepEqual(gallery.packedImageIds.sort(),[ad1,ad2,ad3,ad4].sort());
  const pack=f.call('/api/mobile/collection').data.packs.find(item=>item.id==='healing-time');
  assert.equal(pack.unlock,'ad');assert.equal(pack.owned,false);assert.equal(pack.unlocked,0);
  assert.equal(pack.adRequired,2);assert.equal(pack.dailyLimit,2);assert.equal(pack.dailyUsed,0);assert.equal(pack.dailyUnlockLimit,1);
  assert.ok(pack.images.every(image=>image.owned===false&&image.adProgress===0&&image.adRequired===2));
  assert.equal(f.call('/api/mobile/collection').data.albums.find(item=>item.id==='healing-time').unlock,'ad');
  f.db.prepare('INSERT INTO mobile_collection_wallets VALUES(?,10000,0,NULL)').run(f.identity);
  const bought=f.call('/api/mobile/collection/buy',{packId:'healing-time',requestId:rid()});assert.equal(bought.status,409);assert.equal(bought.data.code,'AD_UNLOCK_ONLY');
  assert.equal(f.call('/api/mobile/profile').data.collection.coins,10000);
  const locked=f.create(ad1);assert.equal(locked.status,403);assert.equal(locked.data.code,'PACK_LOCKED');assert.match(locked.data.error,/广告/);
 }finally{f.close();}
});

test('two completed ads unlock one picture per Beijing day; replay is idempotent and resets next day',()=>{
 const f=fixture();try{
  // Watch 1/2: records progress without unlocking ownership yet.
  const first=f.unlock(ad1),step1=first.redeem();assert.equal(step1.status,200,JSON.stringify(step1.data));
  assert.deepEqual(step1.data.unlocked,{imageId:ad1,alreadyOwned:false,unlocked:false,progress:1,required:2,dailyUsed:1,dailyLimit:2,dailyUnlocked:0,dailyUnlockLimit:1});
  assert.equal(step1.data.packs.find(item=>item.id==='healing-time').unlocked,0);
  assert.equal(step1.data.packs.find(item=>item.id==='healing-time').images[0].adProgress,1);
  assert.equal(f.create(ad1).data.code,'PACK_LOCKED','1/2 progress does not unlock yet');
  // Replaying Watch 1 does not double-count progress.
  assert.equal(first.redeem().status,200);
  assert.equal(f.call('/api/mobile/collection').data.packs.find(item=>item.id==='healing-time').dailyUsed,1);
  // Watch 2/2: unlocks ad1 permanently and exhausts today's quota (2 ads / 1 unlock).
  const second=f.unlock(ad1),step2=second.redeem();assert.equal(step2.status,200,JSON.stringify(step2.data));
  assert.deepEqual(step2.data.unlocked,{imageId:ad1,alreadyOwned:false,unlocked:true,progress:2,required:2,dailyUsed:2,dailyLimit:2,dailyUnlocked:1,dailyUnlockLimit:1});
  const pack=step2.data.packs.find(item=>item.id==='healing-time');assert.equal(pack.unlocked,1);assert.equal(pack.owned,false);assert.equal(pack.dailyUsed,2);
  assert.deepEqual(pack.images.map(image=>image.owned),[true,false,false,false]);
  assert.equal(second.redeem().status,200,'same request replays');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE owner=? AND kind='image'").get(f.identity).n,1);
  assert.equal(f.create(ad1).status,201);
  assert.equal(f.create(ad2).data.code,'PACK_LOCKED');
  // Already unlocked picture returns IMAGE_UNLOCKED; another picture same day hits daily limit.
  assert.equal(f.call('/api/mobile/collection/unlock/challenge',{imageId:ad1,requestId:rid()}).data.code,'IMAGE_UNLOCKED');
  const capped=f.call('/api/mobile/collection/unlock/challenge',{imageId:ad2,requestId:rid()});assert.equal(capped.status,409);assert.equal(capped.data.code,'AD_UNLOCK_DAILY_LIMIT');
  // Next Beijing day resets daily quota so ad2 can be unlocked, and over 3 more days the pack completes.
  for(const id of [ad2,ad3,ad4]){
   f.advanceDays(1);
   assert.equal(f.unlock(id).redeem().data.unlocked.unlocked,false);
   assert.equal(f.unlock(id).redeem().data.unlocked.unlocked,true);
  }
  assert.equal(f.call('/api/mobile/collection').data.packs.find(item=>item.id==='healing-time').owned,true);
 }finally{f.close();}
});

test('splitting two ads across two pictures still enforces max one picture unlock per day',()=>{
 const f=fixture();try{
  // Day 1: 1 ad on ad1 (1/2) + 1 ad on ad2 (1/2) -> daily watches 2/2, unlocks 0/1.
  assert.equal(f.unlock(ad1).redeem().data.unlocked.progress,1);
  assert.equal(f.unlock(ad2).redeem().data.unlocked.progress,1);
  assert.equal(f.call('/api/mobile/collection/unlock/challenge',{imageId:ad3,requestId:rid()}).data.code,'AD_UNLOCK_DAILY_LIMIT');
  // Day 2: 1st ad finishes ad1 (unlocked! dailyUnlocked=1/1); 2nd ad cannot also unlock ad2 today,
  // but may start ad3 (0/2 -> 1/2) without exceeding 1 unlock/day.
  f.advanceDays(1);
  assert.equal(f.unlock(ad1).redeem().data.unlocked.unlocked,true);
  const secondUnlock=f.call('/api/mobile/collection/unlock/challenge',{imageId:ad2,requestId:rid()});
  assert.equal(secondUnlock.status,409);assert.equal(secondUnlock.data.code,'AD_UNLOCK_DAILY_LIMIT');
  const startThird=f.unlock(ad3).redeem();assert.equal(startThird.status,200);assert.equal(startThird.data.unlocked.progress,1);assert.equal(startThird.data.unlocked.unlocked,false);
 }finally{f.close();}
});

test('redeem needs the matching completed challenge and pending challenges count toward daily cap until cancelled',()=>{
 const f=fixture();try{
  const u=f.unlock(ad1);
  assert.equal(u.redeem({completed:false}).data.code,'AD_EXPIRED');
  const other=f.call('/api/mobile/collection/unlock/redeem',{imageId:ad2,requestId:u.requestId,rewardToken:u.rewardToken,completed:true});assert.equal(other.status,403);assert.equal(other.data.code,'AD_REQUIRED');
  const stranger=f.call('/api/mobile/collection/unlock/redeem',{imageId:ad1,requestId:u.requestId,rewardToken:u.rewardToken,completed:true},'b'.repeat(64));assert.equal(stranger.status,403);
  const v=f.unlock(ad3);
  // Two unredeemed challenges fill the daily pending budget until one is cancelled.
  const third=f.call('/api/mobile/collection/unlock/challenge',{imageId:ad4,requestId:rid()});assert.equal(third.status,409);assert.equal(third.data.code,'AD_UNLOCK_DAILY_LIMIT');
  assert.equal(f.call('/api/mobile/collection/unlock/cancel',{imageId:ad3,requestId:v.requestId,rewardToken:v.rewardToken}).status,200);
  assert.equal(v.redeem().data.code,'AD_EXPIRED','cancelled chance cannot be redeemed');
  assert.equal(f.call('/api/mobile/collection/unlock/challenge',{imageId:ad4,requestId:rid()}).status,200,'cancelling frees the pending slot');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE kind='image'").get().n,0);
 }finally{f.close();}
});

test('free pictures, missing ads and the web runtime cannot use the ad unlock',()=>{
 const f=fixture();try{
  const bad=f.call('/api/mobile/collection/unlock/challenge',{imageId:free,requestId:rid()});assert.equal(bad.status,400);assert.equal(bad.data.code,'INVALID_AD_IMAGE');
 }finally{f.close();}
 const g=fixture({adEnabled:false});try{
  const off=g.call('/api/mobile/collection/unlock/challenge',{imageId:ad1,requestId:rid()});assert.equal(off.status,503);assert.equal(off.data.code,'ADS_UNAVAILABLE');
 }finally{g.close();}
});
