import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import editions from '../content/artwork-revisions.json' with {type:'json'};
import {createMobileService} from '../server/mobile-service.mjs';
import {RESTORABLE_PHOTOS,resolveRoomArtwork} from '../outputs/mobile/engine.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';

const rid=()=>randomBytes(16).toString('hex');
test('mobile rooms pin editions; old clients keep old artwork and cannot join an upgraded table',()=>{
 const photo=RESTORABLE_PHOTOS.find(item=>item.id==='lantern-dance-v1'),original={...photo};
 const old=editions.legacy[photo.id],latest=editions.versions[photo.id].find(item=>item.revision===editions.active[photo.id]);
 assert.ok(latest);
 const dir=mkdtempSync(resolve('work/mobile-artwork-test-')),databasePath=resolve(dir,'rooms.sqlite');
 assert.ok(dir.startsWith(resolve('work')+sep));
 const dailyContent={select:()=>photo,collectiblePhotos:()=>RESTORABLE_PHOTOS,galleryPhotos:()=>RESTORABLE_PHOTOS,albumEntries:()=>[],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),close(){}};
 const album={id:'artwork-preview',title:'画质检查',description:'',imageIds:[photo.id],coverImageId:photo.id,showOnPc:true,showOnMobile:true,purchasable:true,price:1,decorationId:null,milestones:[]};
 const service=createMobileService({databasePath,now:()=>1800000000000,deferDailyStart:true,dailyContent,albumContent:{read:()=>({schema:'jigsaw-albums/v1',albums:[album]})}});
 const db=new DatabaseSync(databasePath),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
 const call=(identity,url,body,capability=false,token)=>service.handle({identity,url,method:body===undefined?'GET':'POST',body,artworkSnapshot:capability,...(token?{authorization:'Bearer '+token}:{})});
 try{
  const input={mode:'selected',imageId:photo.id,pieces:108,visibility:'public',requestId:rid()};
  const gallery=call(a,'/api/mobile/gallery',undefined,true).data;assert.equal(gallery.photos.find(item=>item.id===photo.id).src,latest.src);assert.equal(gallery.daily.src,latest.src);assert.equal(call(a,'/api/mobile/gallery').data.photos,undefined);
  assert.equal(call(a,'/api/daily',undefined,true).data.photo.src,latest.src);assert.equal(call(a,'/api/daily').data.photo.src,original.src);
  const collection=call(a,'/api/mobile/collection',undefined,true).data;assert.equal(collection.albums[0].images[0].src,latest.src);assert.equal(collection.packs[0].coverSrc,latest.thumbSrc);assert.equal(call(a,'/api/mobile/collection').data.albums[0].images[0].src,original.src);
  const modern=call(a,'/api/rooms',input,true);assert.equal(modern.status,201,JSON.stringify(modern.data));assert.deepEqual(modern.data.room.artwork,latest);assert.equal(modern.data.room.photo.src,latest.src);
  const legacy=call(b,'/api/rooms',{...input,requestId:rid()});assert.equal(legacy.status,201);assert.deepEqual(legacy.data.room.artwork,old);assert.equal(legacy.data.room.photo.src,old.src);
  const modernPath='/api/rooms/'+modern.data.room.id,legacyPath='/api/rooms/'+legacy.data.room.id;
  assert.equal(call(c,modernPath+'/join',{requestId:rid()}).data.code,'ARTWORK_CLIENT_UPDATE_REQUIRED');
  assert.equal(call(a,modernPath,undefined,false,modern.data.token).data.code,'ARTWORK_CLIENT_UPDATE_REQUIRED');
  assert.equal(call(a,'/api/rooms',input).data.code,'ARTWORK_CLIENT_UPDATE_REQUIRED','old clients cannot replay a modern create receipt');
  const viewer=call(c,legacyPath+'/join',{requestId:rid()},true);assert.equal(viewer.status,200);assert.deepEqual(viewer.data.room.artwork,old);
  assert.ok(!call(c,'/api/lobby').data.rooms.some(room=>room.id===modern.data.room.id));
  const card=call(c,'/api/lobby',undefined,true).data.rooms.find(room=>room.id===modern.data.room.id);assert.equal(card.thumbSrc,latest.thumbSrc);assert.deepEqual(card.artwork,latest);
  // Installing a new catalog cannot reinterpret a room that predates artwork snapshots.
  const saved=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(legacy.data.room.id).data);delete saved.artwork;
  const puzzle=JSON.stringify(saved.puzzle);db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(saved),saved.id);
  const full=call(b,legacyPath,undefined,false,legacy.data.token);assert.equal(full.status,200);assert.deepEqual(full.data.room,undefined);assert.deepEqual(full.data.artwork,old);assert.equal(full.data.photo.src,old.src);assert.equal(JSON.stringify(full.data.puzzle),puzzle);
  const delta=call(b,legacyPath+'?since='+saved.revision,undefined,true,legacy.data.token);assert.equal(delta.data.kind,'delta');assert.deepEqual(delta.data.artwork,old);assert.equal(delta.data.photo.thumbSrc,old.thumbSrc);
  const stored=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(saved.id).data);assert.equal(stored.artwork,undefined);assert.equal(JSON.stringify(stored.puzzle),puzzle);
  assert.throws(()=>resolveRoomArtwork({...saved,artwork:{...latest,src:'https://untrusted.invalid/image.webp'}},RESTORABLE_PHOTOS),/房间图片版本/);
  const daily={mode:'daily',pieces:108,visibility:'public',requestId:rid()},modernDaily=call(a,'/api/rooms',daily,true),oldDaily=call(c,'/api/rooms',{...daily,requestId:rid()});
  assert.equal(modernDaily.status,201);assert.equal(oldDaily.status,201);assert.notEqual(modernDaily.data.room.id,oldDaily.data.room.id);
  assert.deepEqual(modernDaily.data.room.artwork,latest);assert.deepEqual(oldDaily.data.room.artwork,old);
  assert.equal(call('d'.repeat(64),'/api/rooms',{...daily,requestId:rid()},true).data.room.id,modernDaily.data.room.id,'daily reuse keeps the same edition');
  assert.equal(call(b,'/api/rooms',{...daily,requestId:rid()}).data.room.id,oldDaily.data.room.id);
  assert.equal(call(a,modernPath,{type:'leave'},false,modern.data.token).status,200,'old clients may still leave an upgraded table');
  assert.deepEqual(photo,original,'presentation overlays never mutate the base catalog');
 }finally{db.close();service.close();rmSync(dir,{recursive:true,force:true});}
});

test('gateway accepts the artwork capability preflight and passes its explicit value to mobile service',async()=>{
 const source='https://capability.example',seen=[];
 const gateway=createH5Gateway({upstream:'http://127.0.0.1:1',allowedOrigins:[source],mobileService:{close(){},handle(request){seen.push(request);return {status:200,data:{artworkSnapshot:request.artworkSnapshot}};}}});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+gateway.address().port;
 const call=(path,options={})=>fetch(base+path,{...options,headers:{Origin:source,...options.headers}});
 try{
  const preflight=await call('/h5/api/lobby',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-jigsaw-artwork-snapshot,x-jigsaw-h5-session'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/X-Jigsaw-Artwork-Snapshot/);
  const session=await (await call('/h5/session',{method:'POST',body:'{}'})).json(),headers={'X-Jigsaw-H5-Session':session.token};
  assert.equal((await (await call('/h5/api/lobby',{headers:{...headers,'X-Jigsaw-Artwork-Snapshot':'1'}})).json()).artworkSnapshot,true);
  assert.equal((await (await call('/h5/api/lobby',{headers})).json()).artworkSnapshot,false);
  assert.equal(seen.length,2);assert.match(seen[0].identity,/^[a-f0-9]{64}$/);
 }finally{await new Promise(resolve=>gateway.close(resolve));}
});
