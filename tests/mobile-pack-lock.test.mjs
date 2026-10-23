import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
function fixture(options={}){
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'pack-lock-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>1800000000000,...options}),db=new DatabaseSync(databasePath),identity='a'.repeat(64);
 const call=(url,body)=>service.handle({identity,url,method:body===undefined?'GET':'POST',body});
 call('/api/mobile/profile');
 const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);
 profile.starterSelectionAvailable=false;profile.supply.create=3;db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),identity);
 const stock=()=>call('/api/mobile/profile').data.supply.create;
 const create=(imageId,extra={})=>call('/api/rooms',{mode:'selected',pieces:48,visibility:'public',imageId,requestId:rid(),...extra});
 return {call,create,stock,db,identity,close(){db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('locked selected image rejects before spending a ticket; buying its pack allows creation',()=>{
 const f=fixture();try{
  const gallery=f.call('/api/mobile/gallery').data,collection=f.call('/api/mobile/collection').data;
  const pack=collection.packs.find(pack=>pack.imageIds.some(id=>gallery.packedImageIds.includes(id)&&gallery.imageIds.includes(id)));
  assert.ok(pack);const imageId=pack.imageIds.find(id=>gallery.packedImageIds.includes(id)&&gallery.imageIds.includes(id)),before=f.stock();
  const rejected=f.create(imageId);assert.equal(rejected.status,403);assert.equal(rejected.data.code,'PACK_LOCKED');assert.equal(rejected.data.error,'这张图在未解锁的图包里，请先解锁图包');assert.equal(f.stock(),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_rooms').get().n,0);
  // The first free selection cannot bypass an album lock either.
  const p=JSON.parse(f.db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(f.identity).data);p.starterSelectionAvailable=true;f.db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),f.identity);
  assert.equal(f.create(imageId).data.code,'PACK_LOCKED');assert.equal(f.stock(),before);
  f.db.prepare('INSERT INTO mobile_collection_wallets VALUES(?,10000,0,NULL)').run(f.identity);
  assert.equal(f.call('/api/mobile/collection/buy',{packId:pack.id,requestId:rid()}).status,200);
  const opened=f.create(imageId);assert.equal(opened.status,201,JSON.stringify(opened.data));assert.equal(opened.data.room.puzzle.imageId,imageId);assert.equal(f.stock(),before,'owned public image stays free');
 }finally{f.close();}
});

test('free selected image can use a creation ticket',()=>{
 const f=fixture();try{
  const gallery=f.call('/api/mobile/gallery').data,imageId=gallery.freeImageIds.find(id=>gallery.imageIds.includes(id)),before=f.stock();assert.ok(imageId);
  const created=f.create(imageId);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(f.stock(),before-1);
 }finally{f.close();}
});

test('every random candidate excludes locked pack images',()=>{
 let index=0;const candidates=[];const f=fixture({randomInt:(min,max)=>{candidates.push([min,max]);return index;}});try{
  const gallery=f.call('/api/mobile/gallery').data,locked=new Set(gallery.packedImageIds);
  // Force every possible pool index, removing each test room from the player's list.
  const first=f.create(undefined,{mode:'random'});assert.equal(first.status,201,JSON.stringify(first.data));assert.ok(!locked.has(first.data.room.puzzle.imageId));
  const poolSize=candidates.at(-1)[1];assert.ok(poolSize>0);assert.ok(poolSize<gallery.imageIds.length);
  let roomId=first.data.room.id;
  for(index=1;index<poolSize;index++){
   assert.equal(f.call('/api/my-rooms',{action:'remove',roomId}).status,200);
   const created=f.create(undefined,{mode:'random'});assert.equal(created.status,201,JSON.stringify(created.data));
   assert.ok(!locked.has(created.data.room.puzzle.imageId));roomId=created.data.room.id;
  }
  assert.equal(f.stock(),3);
 }finally{f.close();}
});

test('web selected-image creation retains its existing behavior',()=>{
 const f=fixture({runtimeProfile:'web'});try{
  const gallery=f.call('/api/mobile/gallery').data,imageId=gallery.packedImageIds.find(id=>gallery.imageIds.includes(id));assert.ok(imageId);
  const created=f.create(imageId);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(f.stock(),3);
 }finally{f.close();}
});
