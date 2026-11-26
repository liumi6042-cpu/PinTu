import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
import {GALLERY_VISIBLE_PHOTOS} from '../outputs/mobile/engine.mjs';

// 治愈时光: every picture of the ad album unlocks after one completed rewarded ad; coins never buy it.
const rid=()=>randomBytes(16).toString('hex'),now=1800000000000;
const ids=GALLERY_VISIBLE_PHOTOS.slice(0,4).map(photo=>photo.id),[free,ad1,ad2,ad3]=ids;
const album=(id,imageIds,extra={})=>({id,title:id,description:'',imageIds,coverImageId:imageIds[0],showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[],...extra});
const albums={schema:'jigsaw-albums/v1',albums:[album('free',[free]),album('healing-time',[ad1,ad2,ad3],{showOnPc:false,purchasable:true,price:1,milestones:[{id:'milestone-3',target:3,coins:30,decorationId:null}]})]};
function fixture(options={}){
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'ad-unlock-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>now,adEnabled:true,albumContent:{read:()=>albums},...options}),db=new DatabaseSync(databasePath),identity='a'.repeat(64);
 const call=(url,body,who=identity)=>service.handle({identity:who,url,method:body===undefined?'GET':'POST',body});
 call('/api/mobile/profile');
 const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);
 profile.starterSelectionAvailable=false;profile.supply.create=3;db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),identity);
 const create=imageId=>call('/api/rooms',{mode:'selected',pieces:48,visibility:'public',imageId,requestId:rid()});
 const unlock=imageId=>{const requestId=rid(),challenge=call('/api/mobile/collection/unlock/challenge',{imageId,requestId});assert.equal(challenge.status,200,JSON.stringify(challenge.data));
  return {requestId,rewardToken:challenge.data.rewardToken,redeem:(extra={})=>call('/api/mobile/collection/unlock/redeem',{imageId,requestId,rewardToken:challenge.data.rewardToken,completed:true,...extra})};};
 return {call,create,unlock,db,identity,close(){db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('ad album is locked, listed with unlock ad, and refuses coin purchase',()=>{
 const f=fixture();try{
  const gallery=f.call('/api/mobile/gallery').data;assert.deepEqual(gallery.freeImageIds,[free]);assert.deepEqual(gallery.packedImageIds.sort(),[ad1,ad2,ad3].sort());
  const pack=f.call('/api/mobile/collection').data.packs.find(item=>item.id==='healing-time');
  assert.equal(pack.unlock,'ad');assert.equal(pack.owned,false);assert.equal(pack.unlocked,0);assert.ok(pack.images.every(image=>image.owned===false));
  assert.equal(f.call('/api/mobile/collection').data.albums.find(item=>item.id==='healing-time').unlock,'ad');
  f.db.prepare('INSERT INTO mobile_collection_wallets VALUES(?,10000,0,NULL)').run(f.identity);
  const bought=f.call('/api/mobile/collection/buy',{packId:'healing-time',requestId:rid()});assert.equal(bought.status,409);assert.equal(bought.data.code,'AD_UNLOCK_ONLY');
  assert.equal(f.call('/api/mobile/profile').data.collection.coins,10000);
  const locked=f.create(ad1);assert.equal(locked.status,403);assert.equal(locked.data.code,'PACK_LOCKED');assert.match(locked.data.error,/广告/);
 }finally{f.close();}
});

test('one completed ad unlocks exactly one picture forever; replay is idempotent',()=>{
 const f=fixture();try{
  const u=f.unlock(ad1),done=u.redeem();assert.equal(done.status,200,JSON.stringify(done.data));assert.deepEqual(done.data.unlocked,{imageId:ad1,alreadyOwned:false});
  const pack=done.data.packs.find(item=>item.id==='healing-time');assert.equal(pack.unlocked,1);assert.equal(pack.owned,false);
  assert.deepEqual(pack.images.map(image=>image.owned),[true,false,false]);
  assert.equal(u.redeem().status,200,'same request replays');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE owner=? AND kind='image'").get(f.identity).n,1);
  const room=f.create(ad1);assert.equal(room.status,201,JSON.stringify(room.data));
  assert.equal(f.create(ad2).data.code,'PACK_LOCKED');
  const again=f.call('/api/mobile/collection/unlock/challenge',{imageId:ad1,requestId:rid()});assert.equal(again.status,409);assert.equal(again.data.code,'IMAGE_UNLOCKED');
  for(const id of [ad2,ad3])assert.equal(f.unlock(id).redeem().status,200);
  assert.equal(f.call('/api/mobile/collection').data.packs.find(item=>item.id==='healing-time').owned,true);
 }finally{f.close();}
});

test('redeem needs the matching completed challenge for that picture',()=>{
 const f=fixture();try{
  const u=f.unlock(ad1);
  assert.equal(u.redeem({completed:false}).data.code,'AD_EXPIRED');
  const other=f.call('/api/mobile/collection/unlock/redeem',{imageId:ad2,requestId:u.requestId,rewardToken:u.rewardToken,completed:true});assert.equal(other.status,403);assert.equal(other.data.code,'AD_REQUIRED');
  const stranger=f.call('/api/mobile/collection/unlock/redeem',{imageId:ad1,requestId:u.requestId,rewardToken:u.rewardToken,completed:true},'b'.repeat(64));assert.equal(stranger.status,403);
  const v=f.unlock(ad3);assert.equal(f.call('/api/mobile/collection/unlock/cancel',{imageId:ad3,requestId:v.requestId,rewardToken:v.rewardToken}).status,200);
  assert.equal(v.redeem().data.code,'AD_EXPIRED','cancelled chance cannot be redeemed');
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

test('four-seasons-table and curiosity-cabinet use the same per-picture ad unlock rule',()=>{
 for(const albumId of ['four-seasons-table','curiosity-cabinet']){
  const customAlbums={schema:'jigsaw-albums/v1',albums:[album('free',[free]),album(albumId,[ad1,ad2],{showOnPc:false,purchasable:true,price:1,milestones:[{id:'milestone-3',target:3,coins:30,decorationId:null}]})]};
  const f=fixture({albumContent:{read:()=>customAlbums}});try{
   const pack=f.call('/api/mobile/collection').data.packs.find(item=>item.id===albumId);
   assert.equal(pack.unlock,'ad');assert.equal(pack.owned,false);assert.equal(pack.unlocked,0);
   assert.equal(f.call('/api/mobile/collection/buy',{packId:albumId,requestId:rid()}).data.code,'AD_UNLOCK_ONLY');
   assert.equal(f.unlock(ad1).redeem().status,200);
   assert.equal(f.create(ad1).status,201);
   assert.equal(f.create(ad2).data.code,'PACK_LOCKED');
  }finally{f.close();}
 }
});
