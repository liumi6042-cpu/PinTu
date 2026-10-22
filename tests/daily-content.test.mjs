import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createDailyContent,validateDailyConfiguration,dailyConfigurationDigest,dailyContentDate} from '../server/daily-content.mjs';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {PHOTOS,RESTORABLE_PHOTOS,GALLERY_VISIBLE_PHOTOS,dailyPuzzle} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64);
const daily=PHOTOS.find(photo=>photo.dailyOnly),otherDaily=PHOTOS.find(photo=>photo.dailyOnly&&photo.id!==daily.id);
const album=(id='daily-anime',showOnMobile=true)=>({id,title:'二次元',description:'每日作品收录',showOnPc:true,showOnMobile,purchasable:false,price:0,decorationId:null,milestones:[]});
function fixture(entries=[{date:'2026-10-13',imageId:daily.id,albumId:'daily-anime'}],albums=[album()]){
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'daily-content-test-')),configurationPath=join(dir,'configuration.json'),appearanceDir=join(dir,'appearances');
 let clock=Date.parse('2026-10-12T04:00:00Z');
 const write=(plans=entries,groups=albums)=>{const value={schema:'jigsaw-daily-content/v1',timezone:'Asia/Shanghai',entries:plans,albums:groups};writeFileSync(configurationPath,JSON.stringify({...value,configDigest:dailyConfigurationDigest(value)}));};write();
 const writeV2=({entries:plans=[],candidates=[],pool=[],groups=albums}={})=>{const value={schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:plans,automaticCandidates:candidates,fallbackImageIds:pool,albums:groups};writeFileSync(configurationPath,JSON.stringify({...value,configDigest:dailyConfigurationDigest(value)}));};
 const content=createDailyContent({configurationPath,appearanceDir,photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>clock,randomInt:(min,max)=>max-1});
 return {content,configurationPath,appearanceDir,write,writeV2,get now(){return clock;},set now(value){clock=value;},close(){content.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('pure daily validation retains v1/v2 normalization and rejects unavailable photos without mutating input',()=>{
 const f=fixture();
 try{
  for(const version of [1,2]){
   if(version===2)f.writeV2({candidates:[{imageId:daily.id,albumId:'daily-anime'}],pool:[daily.id]});
   const input=JSON.parse(readFileSync(f.configurationPath,'utf8')),before=JSON.stringify(input),validated=validateDailyConfiguration(input,{photos:RESTORABLE_PHOTOS});
   assert.equal(validated.version,version);assert.equal(validated.albumById.get('daily-anime').title,'二次元');assert.equal(JSON.stringify(input),before);
   assert.deepEqual(validated.automaticCandidates,version===1?[]:input.automaticCandidates);assert.deepEqual(validated.fallbackImageIds,version===1?[]:input.fallbackImageIds);
   assert.throws(()=>validateDailyConfiguration(input,{photos:RESTORABLE_PHOTOS.map(photo=>photo.id===daily.id?{...photo,status:'draft'}:photo)}),error=>error.code==='DAILY_CONTENT_INVALID');
   assert.throws(()=>validateDailyConfiguration({...input,configDigest:'0'.repeat(64)},{photos:RESTORABLE_PHOTOS}),error=>error.code==='DAILY_CONTENT_INVALID');
  }
 }finally{f.close();}
});

test('injected complete configuration matches file mode for selection, appearance and next-day album/gallery behavior',()=>{
 for(const version of [1,2]){
  const f=fixture();let injected;
  try{
   if(version===2)f.writeV2({entries:[{date:'2026-10-13',imageId:daily.id,albumId:'daily-anime'}],candidates:[{imageId:otherDaily.id,albumId:'daily-anime'}],pool:[daily.id,otherDaily.id]});
   const input=JSON.parse(readFileSync(f.configurationPath,'utf8'));
   injected=createDailyContent({readConfiguration:()=>input,appearanceDir:join(f.appearanceDir,'injected-'+version),photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>f.now,randomInt:(min,max)=>max-1});
   const current=Date.parse('2026-10-13T03:00:00Z'),next=Date.parse('2026-10-13T16:00:00Z');
   const actual=f.content.tick(current),expected=injected.tick(current);
   assert.deepEqual(actual,expected);
   assert.equal(injected.select(current).id,f.content.select(current).id);assert.equal(expected.configDigest,input.configDigest);
   assert.deepEqual(injected.targetAlbums(),f.content.targetAlbums());assert.deepEqual(injected.managedImageIds(next),f.content.managedImageIds(next));
   assert.deepEqual(injected.albumEntries(next),f.content.albumEntries(next));assert.deepEqual(injected.galleryPhotos(next),f.content.galleryPhotos(next));
  }finally{injected?.close();f.close();}
 }
});

test('injected configuration switches for future selections while the actual current-day receipt stays frozen',()=>{
 const f=fixture();let injected,reads=0;
 try{
  f.writeV2({entries:[{date:'2026-10-12',imageId:daily.id,albumId:'daily-anime'}],pool:[daily.id]});
  let current=JSON.parse(readFileSync(f.configurationPath,'utf8'));
  injected=createDailyContent({readConfiguration:()=>{reads++;return current;},appearanceDir:join(f.appearanceDir,'injected'),photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>f.now,randomInt:min=>min});
  const original=injected.tick(f.now);
  f.writeV2({entries:[{date:'2026-10-12',imageId:otherDaily.id,albumId:'daily-anime'},{date:'2026-10-13',imageId:otherDaily.id,albumId:'daily-anime'}],pool:[otherDaily.id]});
  current=JSON.parse(readFileSync(f.configurationPath,'utf8'));
  assert.deepEqual(injected.tick(f.now),original);
  f.now=Date.parse('2026-10-13T01:00:00Z');assert.equal(injected.tick(f.now).imageId,otherDaily.id);
  const before=reads;injected.galleryPhotos(f.now);assert.equal(reads-before,1,'one gallery operation reads one complete configuration');
 }finally{injected?.close();f.close();}
});

test('invalid injected digest or unreadable configuration never creates an appearance receipt',()=>{
 const f=fixture();let injected;
 try{
  let input={...JSON.parse(readFileSync(f.configurationPath,'utf8')),configDigest:'0'.repeat(64)},unavailable=false;
  const appearanceDir=join(f.appearanceDir,'injected');
  injected=createDailyContent({readConfiguration:()=>{if(unavailable)throw new Error('unavailable');return input;},appearanceDir,photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>f.now});
  assert.throws(()=>injected.tick(f.now),error=>error.code==='DAILY_CONTENT_INVALID');assert.equal(existsSync(appearanceDir),false);
  unavailable=true;assert.throws(()=>injected.tick(f.now),error=>error.code==='DAILY_CONTENT_INVALID');assert.equal(existsSync(appearanceDir),false);
  unavailable=false;input=JSON.parse(readFileSync(f.configurationPath,'utf8'));assert.ok(injected.tick(f.now));assert.deepEqual(readdirSync(appearanceDir),['2026-10-12.json']);
 }finally{injected?.close();f.close();}
});

test('public schedule freezes actual current appearance, skips past plans and rejects changed digest/unavailable assets',()=>{
 const f=fixture([{date:'2026-10-11',imageId:daily.id,albumId:'daily-anime'},{date:'2026-10-13',imageId:daily.id,albumId:'daily-anime'}]);
 try{
  assert.equal(dailyContentDate(Date.parse('2026-10-12T15:59:59Z')),'2026-10-12');
  assert.equal(dailyContentDate(Date.parse('2026-10-12T16:00:00Z')),'2026-10-13');
  assert.equal(f.content.tick(f.now).planned,false);
  assert.deepEqual(readdirSync(f.appearanceDir),['2026-10-12.json']);
  f.now=Date.parse('2026-10-12T16:00:00Z');assert.equal(f.content.select(f.now).id,daily.id);
  const frozen=readFileSync(join(f.appearanceDir,'2026-10-13.json'),'utf8');
  f.write([{date:'2026-10-13',imageId:otherDaily.id,albumId:'daily-anime'}]);
  assert.equal(f.content.select(f.now).id,daily.id);assert.equal(readFileSync(join(f.appearanceDir,'2026-10-13.json'),'utf8'),frozen);
  const changed=JSON.parse(readFileSync(f.configurationPath,'utf8'));changed.entries[0].imageId=daily.id;writeFileSync(f.configurationPath,JSON.stringify(changed));
  assert.throws(()=>f.content.select(f.now),error=>error.code==='DAILY_CONTENT_INVALID');
  f.write([{date:'2026-10-13',imageId:'new-not-yet-in-game-v1',albumId:'daily-anime'}]);
  assert.throws(()=>f.content.select(f.now),error=>error.code==='DAILY_CONTENT_INVALID');
 }finally{f.close();}
});

test('first-day completion facts retain difficulties and rewards while ordinary/public album entry opens only next Beijing day',()=>{
 const f=fixture(),db=new DatabaseSync(':memory:');
 try{
  const collection=createMobileCollection({db,photos:f.content.collectiblePhotos(),dailyContent:f.content});
  assert.ok(!f.content.galleryPhotos(f.now).some(photo=>photo.id===daily.id));
  f.now=Date.parse('2026-10-13T03:00:00Z');f.content.tick(f.now);
  const room={id:rid(),completedAt:f.now,puzzle:{imageId:daily.id},mobilePieces:108};
  assert.equal(collection.complete(owner,{...room,id:rid()},2,f.now).catalog.qualified,false);
  const first=collection.complete(owner,room,3,f.now);assert.equal(first.catalog.qualified,true);assert.equal(first.catalog.difficulty,108);
  const wallet=collection.summary(owner,f.now);assert.deepEqual(collection.complete(owner,room,3,f.now),first);assert.deepEqual(collection.summary(owner,f.now),wallet);
  assert.ok(!collection.view(owner,f.now).albums.some(item=>item.id==='daily-anime'));
  f.now=Date.parse('2026-10-13T16:00:00Z');
  const published=collection.view(owner,f.now).albums.find(item=>item.id==='daily-anime');
  assert.equal(published.images[0].id,daily.id);assert.equal(published.images[0].collected,true);assert.deepEqual(published.images[0].difficulties,[108]);assert.equal(published.total,1);
  assert.ok(f.content.galleryPhotos(f.now).some(photo=>photo.id===daily.id));
  collection.complete(owner,{...room,id:rid(),mobilePieces:48},3,f.now);
  assert.deepEqual(collection.view(owner,f.now).albums.find(item=>item.id==='daily-anime').images[0].difficulties,[48,108]);
  f.write(undefined,[album('daily-anime',false)]);
  assert.ok(!collection.view(owner,f.now).albums.some(item=>item.id==='daily-anime'));assert.ok(!f.content.galleryPhotos(f.now).some(photo=>photo.id===daily.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_artworks WHERE owner=?').get(owner).n,2);
 }finally{db.close();f.close();}
});

test('paid daily additions expand existing ownership, never replace original pack price/members/reward receipts',()=>{
 const pack=catalog.packs[0],group={...album(pack.id),purchasable:true,price:999},f=fixture([{date:'2026-10-13',imageId:daily.id,albumId:pack.id}],[group]),db=new DatabaseSync(':memory:');
 try{
  const collection=createMobileCollection({db,photos:f.content.collectiblePhotos(),dailyContent:f.content});
  db.prepare("INSERT INTO mobile_collection_wallets VALUES(?,1000,0,'berry-spark')").run(owner);
  collection.buy(owner,pack.id,f.now);assert.equal(collection.summary(owner,f.now).coins,1000-pack.price);
  assert.deepEqual(collection.summary(owner,f.now).ownedImageIds,pack.imageIds);
  f.now=Date.parse('2026-10-13T00:00:00Z');f.content.tick(f.now);
  collection.complete(owner,{id:rid(),completedAt:f.now,puzzle:{imageId:daily.id},mobilePieces:108},3,f.now);
  f.now=Date.parse('2026-10-13T16:00:00Z');
  const view=collection.view(owner,f.now),actual=view.packs.find(item=>item.id===pack.id);
  assert.equal(actual.price,pack.price);assert.deepEqual(actual.imageIds,[...pack.imageIds,daily.id]);assert.equal(collection.ownsImage(owner,daily.id,f.now),true);assert.equal(collection.randomAllowed('b'.repeat(64),daily.id,f.now),false);
  const completion={id:rid(),completedAt:f.now,puzzle:{imageId:pack.imageIds[0]},mobilePieces:48};
  const first=collection.complete(owner,completion,3,f.now),balance=collection.summary(owner,f.now).coins;
  assert.deepEqual(collection.complete(owner,completion,3,f.now),first);assert.equal(collection.summary(owner,f.now).coins,balance);
  assert.equal(view.albums.find(item=>item.id===pack.id).milestones.length,catalog.milestones.length);
 }finally{db.close();f.close();}
});

test('service activates schedule without room traffic and gates ordinary planned photo until real first appearance ends',()=>{
 const ordinary=GALLERY_VISIBLE_PHOTOS.find(photo=>!catalog.packs.some(pack=>pack.imageIds.includes(photo.id))),f=fixture([{date:'2026-10-13',imageId:ordinary.id,albumId:'daily-anime'}]);let service;
 const call=(url,body)=>service.handle({identity:owner,url,method:body?'POST':'GET',body});
 try{
  service=createMobileService({dailyContent:f.content,now:()=>f.now,randomInt:min=>min});
  assert.equal(readdirSync(f.appearanceDir).length,1,'startup records currently available selection');
  assert.ok(!call('/api/mobile/gallery').data.imageIds.includes(ordinary.id));
  assert.equal(call('/api/rooms',{mode:'selected',imageId:ordinary.id,pieces:108,requestId:rid()}).data.code,'INVALID_IMAGE');
  f.now=Date.parse('2026-10-13T03:00:00Z');assert.equal(call('/api/daily').data.photo.id,ordinary.id);
  assert.ok(!call('/api/mobile/gallery').data.imageIds.includes(ordinary.id));
  const created=call('/api/rooms',{mode:'daily',pieces:108,requestId:rid()});assert.equal(created.status,201);assert.equal(created.data.room.puzzle.imageId,ordinary.id);
  const ticket=created.data,path='/api/rooms/'+ticket.room.id;let current=ticket.room;
  while(current.completedAt===null){
   const group=current.puzzle.groups.find(group=>!group.locked);
   const action=body=>service.handle({identity:owner,url:path,method:'POST',body,authorization:'Bearer '+ticket.token});
   assert.equal(action({type:'claim',groupId:group.id,requestId:rid()}).status,200);
   const placed=action({type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()});assert.equal(placed.status,200);current=placed.data;
  }
  assert.equal(current.mobileResult.catalog.qualified,true);assert.equal(current.mobileResult.catalog.difficulty,108);
  f.now=Date.parse('2026-10-13T16:00:00Z');assert.ok(call('/api/mobile/gallery').data.imageIds.includes(ordinary.id));
  assert.ok(call('/api/mobile/collection').data.albums.find(item=>item.id==='daily-anime').images.some(image=>image.id===ordinary.id&&image.collected));
 }finally{service?.close();f.close();}
});

test('a planned artwork is shown in one target album while original paid entitlement and reward membership remain intact',()=>{
 const pack=catalog.packs[0],imageId=pack.imageIds[0],f=fixture([{date:'2026-10-13',imageId,albumId:'daily-anime'}]),db=new DatabaseSync(':memory:');
 try{
  const collection=createMobileCollection({db,photos:f.content.collectiblePhotos(),dailyContent:f.content});
  f.now=Date.parse('2026-10-13T00:00:00Z');f.content.tick(f.now);
  f.now=Date.parse('2026-10-13T16:00:00Z');const view=collection.view(owner,f.now);
  assert.deepEqual(view.albums.filter(item=>item.images.some(image=>image.id===imageId)).map(item=>item.id),['daily-anime']);
  assert.ok(view.packs.find(item=>item.id===pack.id).imageIds.includes(imageId));
  assert.equal(collection.randomAllowed(owner,imageId,f.now),false,'original paid purchase contract is preserved');
 }finally{db.close();f.close();}
});

test('default service keeps static daily/gallery and failed receipt writes cannot claim successful activation',()=>{
 const now=Date.parse('2026-10-12T04:00:00Z'),service=createMobileService({now:()=>now}),f=fixture();
 try{
  assert.equal(service.handle({identity:owner,method:'GET',url:'/api/daily'}).data.photo.id,dailyPuzzle(now).id);
  assert.deepEqual(service.handle({identity:owner,method:'GET',url:'/api/mobile/gallery'}).data.imageIds,GALLERY_VISIBLE_PHOTOS.map(photo=>photo.id));
  writeFileSync(f.appearanceDir,'file blocks directory');
  assert.throws(()=>f.content.tick(f.now));
 }finally{service.close();f.close();}
});

test('manual today outranks undated candidates; auto selections never repeat unpublished work and lock all instances for the day',()=>{
 const f=fixture(),scheduled=PHOTOS.find(photo=>!photo.dailyOnly),free=GALLERY_VISIBLE_PHOTOS.find(photo=>photo.id!==scheduled.id);
 const plans=[{date:'2026-10-12',imageId:scheduled.id,albumId:'daily-anime'}],candidates=[{imageId:daily.id,albumId:'daily-anime'},{imageId:otherDaily.id,albumId:'daily-anime'}];
 let second;
 try{
  f.writeV2({entries:plans,candidates,pool:[scheduled.id,daily.id,otherDaily.id,free.id]});
  assert.equal(f.content.tick(f.now).source,'scheduled');assert.equal(f.content.select(f.now).id,scheduled.id);
  f.now=Date.parse('2026-10-13T01:00:00Z');const automatic=f.content.tick(f.now);
  assert.equal(automatic.source,'automatic');assert.equal(automatic.imageId,otherDaily.id);assert.equal(automatic.albumId,'daily-anime');
  f.writeV2({entries:[...plans,{date:'2026-10-13',imageId:free.id,albumId:'daily-anime'}],candidates,pool:[free.id]});
  second=createDailyContent({configurationPath:f.configurationPath,appearanceDir:f.appearanceDir,photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>f.now,randomInt:min=>min});
  assert.equal(second.select(f.now).id,otherDaily.id,'persisted actual selection survives later config or another instance');
  f.writeV2({entries:plans,candidates,pool:[scheduled.id,daily.id,otherDaily.id,free.id]});
  f.now=Date.parse('2026-10-14T01:00:00Z');assert.equal(f.content.tick(f.now).imageId,daily.id);
  f.now=Date.parse('2026-10-15T01:00:00Z');const exhausted=f.content.tick(f.now);
  assert.equal(exhausted.source,'library');assert.equal(exhausted.imageId,free.id);assert.equal(exhausted.albumId,null);assert.equal(exhausted.planned,false);
  assert.deepEqual(readdirSync(f.appearanceDir).sort(),['2026-10-12.json','2026-10-13.json','2026-10-14.json','2026-10-15.json']);
 }finally{second?.close();f.close();}
});

test('all-album fallback includes configured archived, hidden and paid pictures but excludes unreleased manual works and unassigned daily defaults',()=>{
 const archived=RESTORABLE_PHOTOS.find(photo=>photo.id==='coral-garden'),future=PHOTOS.find(photo=>!photo.dailyOnly),f=fixture();let service;
 const paid={...album('new-paid-album',false),purchasable:true,price:180};
 try{
  f.writeV2({entries:[{date:'2026-10-20',imageId:future.id,albumId:paid.id}],pool:[archived.id,future.id],groups:[paid]});
  const fact=f.content.tick(f.now);assert.equal(fact.source,'library');assert.equal(fact.imageId,archived.id);
  assert.ok(!f.content.galleryPhotos(f.now).some(photo=>photo.id===archived.id),'daily fallback does not expose hidden archived work in ordinary gallery');
  service=createMobileService({dailyContent:f.content,now:()=>f.now});
  const profile=()=>service.handle({identity:owner,method:'GET',url:'/api/mobile/profile'}).data;
  const before=profile(),created=service.handle({identity:owner,method:'POST',url:'/api/rooms',body:{mode:'daily',pieces:108,requestId:rid()}});
  assert.equal(created.status,201);assert.equal(created.data.room.puzzle.imageId,archived.id);assert.equal(created.data.room.requestedPieces,108);
  const after=profile();assert.equal(after.supply.create,before.supply.create);assert.equal(after.starterSelectionAvailable,before.starterSelectionAvailable);
  assert.deepEqual(after.collection.ownedPackIds,[]);assert.deepEqual(after.collection.ownedImageIds,[]);
  f.now=Date.parse('2026-10-13T01:00:00Z');f.writeV2({entries:[{date:'2026-10-20',imageId:future.id,albumId:paid.id}],pool:[future.id],groups:[paid]});
  assert.throws(()=>f.content.tick(f.now),error=>error.code==='DAILY_CONTENT_INVALID','v2 empty eligible pool does not return old unassigned three');
 }finally{service?.close();f.close();}
});

test('new paid target permits free daily trial without ownership and becomes purchase-gated after actual next-day collection',()=>{
 const paid={...album('new-paid-album'),purchasable:true,price:180},f=fixture(),db=new DatabaseSync(':memory:');let service;
 try{
  f.writeV2({candidates:[{imageId:daily.id,albumId:paid.id}],pool:[daily.id],groups:[paid]});
  const collection=createMobileCollection({db,photos:f.content.collectiblePhotos(),dailyContent:f.content});
  service=createMobileService({dailyContent:f.content,now:()=>f.now});
  const created=service.handle({identity:owner,method:'POST',url:'/api/rooms',body:{mode:'daily',requestId:rid()}});
  assert.equal(created.status,201);assert.equal(created.data.room.puzzle.imageId,daily.id);assert.equal(collection.ownsImage(owner,daily.id,f.now),false);
  f.now=Date.parse('2026-10-13T01:00:00Z');const view=collection.view(owner,f.now);
  assert.equal(view.albums.find(item=>item.id===paid.id).images[0].id,daily.id);
  assert.equal(collection.randomAllowed(owner,daily.id,f.now),false);assert.equal(collection.ownsImage(owner,daily.id,f.now),false);assert.ok(collection.packedImageIds(f.now).includes(daily.id));
  assert.deepEqual(collection.summary(owner,f.now).ownedPackIds,[]);
 }finally{service?.close();db.close();f.close();}
});

test('gateway records no first appearance before serving or after a failed bind, then activates on successful listening',async()=>{
 const f=fixture(),occupied=createServer();let gateway;
 try{
  f.writeV2({candidates:[{imageId:daily.id,albumId:'daily-anime'}],pool:[daily.id]});
  const service=createMobileService({dailyContent:f.content,now:()=>f.now,deferDailyStart:true});
  assert.equal(existsSync(f.appearanceDir),false,'constructing service alone does not confirm publication');
  gateway=createH5Gateway({upstream:'http://127.0.0.1',allowedOrigins:['http://127.0.0.1'],mobileService:service});
  await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  const error=await new Promise(resolve=>{gateway.once('error',resolve);gateway.listen(occupied.address().port,'127.0.0.1');});
  assert.equal(error.code,'EADDRINUSE');assert.equal(existsSync(f.appearanceDir),false,'failed listen never publishes a candidate');
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
  assert.deepEqual(readdirSync(f.appearanceDir),['2026-10-12.json']);assert.equal(f.content.select(f.now).id,daily.id);
 }finally{
  if(gateway)await new Promise(resolve=>gateway.close(resolve));
  await new Promise(resolve=>occupied.close(resolve));f.close();
 }
});
