import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {buildAlbumConfiguration,createAlbumContent,validateAlbumDocument} from '../server/album-content.mjs';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {defaultGameSettings} from '../server/game-settings.mjs';
import {GALLERY_VISIBLE_PHOTOS,RESTORABLE_PHOTOS} from '../outputs/mobile/engine.mjs';

const owner='a'.repeat(64),now=1800000000000;
const album=(id,imageIds,milestones=[],extra={})=>({id,title:id,description:'',imageIds,coverImageId:imageIds[0]??null,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones,...extra});
const document=albums=>({schema:'jigsaw-albums/v1',albums});
const milestone=(id,target,coins,decorationId=null)=>({id,target,coins,decorationId});
const room=imageId=>({id:randomBytes(16).toString('hex'),completedAt:now,puzzle:{imageId},mobilePieces:48});
const ids=GALLERY_VISIBLE_PHOTOS.slice(0,4).map(photo=>photo.id);
function transaction(db,action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}

test('album bridge validates current artwork and decorations and reloads without altering game settings',()=>{
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/album-config-test-')),path=resolve(dir,'configuration.json'),settings=defaultGameSettings();
 try{
  const initial=document([album('custom-free',ids.slice(0,2),[milestone('first',1,7,'cream-bow')])]);
  writeFileSync(path,JSON.stringify(buildAlbumConfiguration(initial)));
  const reader=createAlbumContent({configurationPath:path,photos:RESTORABLE_PHOTOS,readSettings:()=>settings});
  assert.deepEqual(reader.read(),initial);assert.ok(Object.isFrozen(reader.read().albums[0].milestones));
  const changed=structuredClone(initial);changed.albums[0].milestones[0].coins=88;writeFileSync(path,JSON.stringify(buildAlbumConfiguration(changed)));
  assert.equal(reader.read().albums[0].milestones[0].coins,88);assert.deepEqual(settings,defaultGameSettings());
  const bad=structuredClone(initial);bad.albums[0].imageIds=['not-an-artwork'];bad.albums[0].coverImageId=null;
  assert.throws(()=>validateAlbumDocument(bad,{photos:RESTORABLE_PHOTOS,decorations:settings.decorations}),{code:'INVALID_ALBUM_CONFIGURATION'});
  bad.albums[0].imageIds=ids.slice(0,1);bad.albums[0].milestones[0].decorationId='not-a-decoration';
  assert.throws(()=>validateAlbumDocument(bad,{photos:RESTORABLE_PHOTOS,decorations:settings.decorations}),{code:'INVALID_ALBUM_CONFIGURATION'});
  writeFileSync(path,JSON.stringify({...buildAlbumConfiguration(initial),configDigest:'0'.repeat(64)}));assert.throws(()=>reader.read(),{code:'ALBUM_CONFIGURATION_UNAVAILABLE'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a custom free album grants its own decoration once and keeps issued values after threshold edits',()=>{
 const db=new DatabaseSync(':memory:');let config=document([album('custom-free',ids.slice(0,2),[milestone('milestone-3',1,7,'cream-bow')])]);
 const c=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config});
 try{
  const first=room(ids[0]),reward=transaction(db,()=>c.complete(owner,first,3,now));
  assert.deepEqual(reward.catalog.albumRewards,[{albumId:'custom-free',title:'custom-free',target:1,coins:7,decorationId:'cream-bow'}]);
  assert.equal(c.view(owner,now).decorations.find(item=>item.id==='cream-bow').owned,true);
  assert.deepEqual(c.view(owner,now).decorations.find(item=>item.id==='cream-bow').rewardAlbums,[{id:'custom-free',title:'custom-free',target:1}]);
  assert.equal(c.view(owner,now).packs.length,0);
  config=document([album('custom-free',ids.slice(0,2),[milestone('milestone-3',2,99,'honey-star')])]);
  const second=transaction(db,()=>c.complete(owner,room(ids[1]),3,now));assert.deepEqual(second.catalog.albumRewards,[]);
  const shown=c.view(owner,now).albums[0].milestones[0];assert.equal(shown.target,1);assert.equal(shown.coins,7);assert.equal(shown.decorationId,'cream-bow');
  assert.equal(c.view(owner,now).decorations.find(item=>item.id==='honey-star').owned,false);
  assert.deepEqual(c.complete(owner,first,3,now),reward,'completion receipts keep original grants');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_milestone_rewards').get().n,1);
 }finally{db.close();}
});

test('managed membership replaces legacy members and global rewards while ownership and artwork history stay intact',()=>{
 const db=new DatabaseSync(':memory:'),original=catalog.packs[0];let config=document([album(original.id,[original.imageIds[0]],[],{purchasable:true,price:180})]);
 const c=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config});
 try{
  db.prepare("INSERT INTO mobile_collection_owned VALUES(?,?,?,?)").run(owner,'pack',original.id,now);
  transaction(db,()=>c.complete(owner,room(original.imageIds[0]),3,now));
  config=document([album(original.id,[original.imageIds[1]],[milestone('new-reward',1,13,'rose-butterfly')],{purchasable:true,price:180})]);
  const repeat=transaction(db,()=>c.complete(owner,room(original.imageIds[0]),3,now));assert.deepEqual(repeat.catalog.albumRewards,[]);
  const before=c.view(owner,now);assert.equal(before.albums.length,1);assert.equal(before.albums[0].total,1);assert.equal(before.albums[0].collected,0);
  assert.deepEqual(c.summary(owner,now).ownedPackIds,[original.id]);assert.deepEqual(new Set(c.summary(owner,now).ownedImageIds),new Set(original.imageIds));
  assert.equal(c.ownsImage(owner,original.imageIds[0],now),true,'a removed member retains its original purchased image entitlement');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_artworks').get().n,1,'removed images remain historical collectibles');
  const earned=transaction(db,()=>c.complete(owner,room(original.imageIds[1]),3,now));assert.equal(earned.catalog.albumRewards[0].coins,13);
  assert.equal(earned.catalog.albumRewards[0].decorationId,'rose-butterfly');assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_milestone_rewards').get().n,1);
  config.albums.push(album('moved-paid',[original.imageIds[0]],[],{purchasable:true,price:27}));
  assert.equal(c.randomAllowed(owner,original.imageIds[0],now),true,'old image rights survive reclassification into another paid album');
  assert.equal(c.randomAllowed('b'.repeat(64),original.imageIds[0],now),false);
  assert.equal(c.view(owner,now).albums[0].collected,1,'original album completion still uses only its current member');
 }finally{db.close();}
});

test('managed PC/mobile flags, unassigned images and new paid albums control actual gallery and random availability',()=>{
 const db=new DatabaseSync(':memory:'),config=document([album('mobile-only',[ids[0]],[],{showOnPc:false}),album('pc-only',[ids[1]],[],{showOnMobile:false}),album('new-paid',[ids[2]],[],{purchasable:true,price:12})]);
 const c=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config}),pc=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config,albumTarget:'pc'});
 try{
  assert.deepEqual(c.galleryPhotos(now).map(photo=>photo.id).sort(),[ids[0],ids[2]].sort());assert.deepEqual(pc.galleryPhotos(now).map(photo=>photo.id).sort(),[ids[1],ids[2]].sort());
  assert.equal(c.randomAllowed(owner,ids[0],now),true);assert.equal(c.randomAllowed(owner,ids[1],now),false);assert.equal(c.randomAllowed(owner,ids[3],now),false);assert.equal(c.randomAllowed(owner,ids[2],now),false);
  db.prepare("INSERT INTO mobile_collection_wallets VALUES(?,50,0,'berry-spark')").run(owner);
  transaction(db,()=>c.buy(owner,'new-paid',now));assert.equal(c.randomAllowed(owner,ids[2],now),true);assert.equal(c.summary(owner,now).coins,38);
 }finally{db.close();}
});

test('daily withholding and enrollment overlays honor current managed membership without duplicate albums',()=>{
 const db=new DatabaseSync(':memory:');let released=new Set(),config=document([album('old-album',[]),album('new-album',[ids[0]])]);
 const dailyContent={managedImageIds:()=>new Set([ids[0]]),releasedImageIds:()=>released,albumEntries:()=>released.size?[{album:{id:'old-album'},imageIds:[ids[0]]}]:[]};
 const c=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config,dailyContent});
 try{
  assert.deepEqual(c.galleryPhotos(now),[]);released=new Set([ids[0]]);
  assert.equal(c.view(owner,now).albums[0].total,0);assert.equal(c.view(owner,now).albums[1].total,1,'new assignment wins over old daily album');
  config=document([album('old-album',[]),album('new-album',[])]);
  assert.equal(c.view(owner,now).albums[0].total,1,'the next-day overlay covers CMS enrollment lag');assert.equal(c.view(owner,now).albums[1].total,0);
 }finally{db.close();}
});

test('new paid purchases permanently retain their image rights after reclassification without rewarding old membership',()=>{
 const db=new DatabaseSync(':memory:');let config=document([album('custom-paid',[ids[0]],[],{purchasable:true,price:12})]);
 const c=createMobileCollection({db,photos:RESTORABLE_PHOTOS,readAlbums:()=>config});
 try{
  db.prepare("INSERT INTO mobile_collection_wallets VALUES(?,50,0,'berry-spark')").run(owner);
  const purchase=transaction(db,()=>c.buy(owner,'custom-paid',now));assert.deepEqual(purchase,{alreadyOwned:false,imageIds:[ids[0]]});
  config=document([album('custom-paid',[ids[1]],[milestone('first',1,9,'honey-star')],{purchasable:true,price:12}),album('different-paid',[ids[0]],[],{purchasable:true,price:27})]);
  assert.equal(c.ownsImage(owner,ids[0],now),true);assert.equal(c.randomAllowed(owner,ids[0],now),true);
  assert.deepEqual(new Set(c.summary(owner,now).ownedImageIds),new Set(ids.slice(0,2)));
  const result=transaction(db,()=>c.complete(owner,room(ids[0]),3,now));assert.deepEqual(result.catalog.albumRewards,[]);
  assert.equal(c.view(owner,now).albums[0].collected,0,'purchase rights do not count as current album completion');
  assert.deepEqual(transaction(db,()=>c.buy(owner,'custom-paid',now)),{alreadyOwned:true});assert.equal(c.summary(owner,now).coins,40,'repeat purchase does not charge again');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE owner=? AND kind='image'").get(owner).n,1);
 }finally{db.close();}
});

test('service loads a configured album catalog per operation and leaves configured growth values intact',()=>{
 const settings=defaultGameSettings();settings.energy.initial=30;settings.energy.naturalRecoveryMinutes=2;settings.energy.firstRoomFree=false;
 let config=document([album('first',[ids[0]])]);const service=createMobileService({now:()=>now,gameSettings:{read:()=>settings},albumContent:{read:()=>config}});
 const call=url=>service.handle({identity:owner,url,method:'GET'});
 try{
  assert.deepEqual(call('/api/mobile/gallery').data.imageIds,[ids[0]]);
  assert.equal(call('/api/mobile/profile').data.energy,30);assert.equal(call('/api/mobile/profile').data.economy.firstRoomFree,false);
  config=document([album('second',[ids[1]])]);assert.equal(call('/api/mobile/collection').data.albums[0].id,'second');assert.deepEqual(call('/api/mobile/gallery').data.imageIds,[ids[1]]);
  assert.equal(call('/api/mobile/profile').data.energy,30);assert.equal(call('/api/mobile/profile').data.economy.naturalRecoveryMinutes,2);
 }finally{service.close();}
});
