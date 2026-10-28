import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import sharp from 'sharp';
import {fullImageAlbumIds,planTapTapArtwork} from '../scripts/bundle-taptap-artwork.mjs';
import {buildOfflineCatalog,offlineRoomArtwork} from '../scripts/offline-catalog.mjs';
import {readOfflineCatalog} from '../lib/offline-catalog-types.ts';
import {createMobileLevels,readLevelConfiguration} from '../server/mobile-levels.mjs';
import {mobileGridForPhoto} from '../server/mobile-service.mjs';
import {RESTORABLE_PHOTOS,currentRoomArtwork} from '../outputs/mobile/engine.mjs';

async function fixture(t,{allDefaultChapters=false}={}){
 const base=resolve('data');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'offline-package-'));
 t.after(()=>{assert.ok(root.startsWith(base+sep));rmSync(root,{recursive:true,force:true});});
 mkdirSync(join(root,'public/puzzles'),{recursive:true});
 const photos=[];
 for(const [index,id] of ['free-photo','paid-photo',...Array.from({length:allDefaultChapters?24:6},(_,n)=>'story-'+(n+1))].entries()){
  const width=index%2?800:1280,height=800;
  const bytes=await sharp({create:{width,height,channels:3,background:'#aa8877'}}).webp().toBuffer(),hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const src=`/puzzles/${id}-optimized-${hash}.webp`,thumbSrc=`/puzzles/${id}-thumbnail-${hash}.webp`;
  for(const url of [src,thumbSrc])writeFileSync(join(root,'public',url),bytes);
  photos.push({id,title:id,category:'测试',width,height,src,optimizedSrc:src,thumbSrc,status:'published',origin:'project-ai-generated'});
 }
 const albums=[
  {id:'free',title:'免费',showOnMobile:true,imageIds:['free-photo'],purchasable:false,price:100},
  {id:'paid',title:'付费',showOnMobile:true,imageIds:['paid-photo'],purchasable:true,price:10},
  {id:'story',title:'隐藏剧情',showOnMobile:false,imageIds:photos.slice(2,8).map(p=>p.id),purchasable:true,price:10},
 ];
 let levels={schema:'jigsaw-levels/v1',seriesTitle:'故事',firstClearEnergy:30,chapters:[{id:'chapter',title:'第一章',albumId:'story',pieces:[12,16,20,24,30,35],lines:['开场',null]}]};
 if(allDefaultChapters){
  levels=readLevelConfiguration();albums[2].id=levels.chapters[0].albumId;
  for(const [index,chapter]of levels.chapters.entries())if(index>0)albums.push({id:chapter.albumId,title:chapter.title,showOnMobile:false,imageIds:photos.slice(2+index*6,2+(index+1)*6).map(p=>p.id),purchasable:false});
 }
 const plan=await planTapTapArtwork({root,catalog:photos,albums,levelAlbumIds:levels.chapters.map(chapter=>chapter.albumId)});
 return {root,photos,albums,levels,plan};
}

test('default selection excludes paid mobile albums, includes free and hidden story albums, and keeps all thumbnails',async t=>{
 const f=await fixture(t),plan=f.plan;
 assert.deepEqual(plan.albums.map(a=>a.id),['free','story']);assert.deepEqual(plan.paidAlbumsExcluded,['paid']);
 assert.equal(plan.files.filter(file=>file.kind==='puzzle').length,7);assert.equal(plan.thumbnailCount,8);
 for(const photo of f.photos)assert.ok(plan.mapping[photo.thumbSrc]);
 assert.equal(plan.mapping[f.photos[1].src],undefined);
 for(const kind of ['puzzle','thumbnail'])assert.equal(plan.bytesByKind[kind],plan.files.filter(f=>f.kind===kind).reduce((n,f)=>n+f.bytes,0));
 assert.equal(plan.totalBytes,plan.bytesByKind.puzzle+plan.bytesByKind.thumbnail);
 assert.deepEqual(fullImageAlbumIds({albums:[...f.albums,{id:'zero',showOnMobile:true,imageIds:['zero-photo'],purchasable:true,price:0},{id:'empty',showOnMobile:true,imageIds:[]}],levelAlbumIds:['story','story']}),['free','zero','story']);
});

test('explicit fullAlbumIds overrides both default and story selection, including an empty override',async t=>{
 const f=await fixture(t);
 for(const ids of [[],['paid']]){
  const plan=await planTapTapArtwork({...f,catalog:f.photos,levelAlbumIds:['story'],fullAlbumIds:ids});
  assert.deepEqual(plan.albums.map(a=>a.id),ids);assert.equal(plan.files.filter(file=>file.kind==='puzzle').length,ids.length);
  assert.deepEqual(plan.paidAlbumsExcluded,ids.length?[]:['paid']);assert.equal(plan.thumbnailCount,8);
 }
});

test('catalog uses server level view/order and exact room artwork/grid functions for each mode',async t=>{
 const f=await fixture(t),catalog=buildOfflineCatalog(f);
 assert.equal(catalog.schema,'jigsaw-offline/v1');assert.equal(catalog.seriesTitle,'故事');assert.equal(catalog.firstClearEnergy,30);
 assert.equal(catalog.chapters[0].levels.length,6);assert.equal(catalog.free.length,1);assert.equal(Object.keys(catalog.photos).length,7);
 for(const [index,level] of catalog.chapters[0].levels.entries()){
  const photo=f.photos.find(p=>p.id===level.imageId),artwork=currentRoomArtwork(photo,level.pieces,true),grid=mobileGridForPhoto({...photo,...artwork},level.pieces,'level');
  assert.equal(level.id,'chapter-'+(index+1));assert.equal(level.imageId,f.albums[2].imageIds[index]);assert.equal(Object.hasOwn(level,'status'),false);
  assert.deepEqual({cols:level.cols,rows:level.rows},{cols:grid.cols,rows:grid.rows});assert.deepEqual(catalog.photos[level.imageId].artwork,artwork);
  assert.equal(level.line,index===0?'开场':null);
  assert.equal(level.src,photo.src);assert.equal(level.thumbSrc,photo.thumbSrc);
 }
 for(const picture of catalog.free)for(const count of [48,108]){
  const photo=f.photos.find(p=>p.id===picture.imageId),artwork=currentRoomArtwork(photo,count,true),grid=mobileGridForPhoto({...photo,...artwork},count,'gallery');
  assert.deepEqual(picture.grids[count],{cols:grid.cols,rows:grid.rows});
 }
 assert.deepEqual(readOfflineCatalog(catalog),catalog);assert.ok(Buffer.byteLength(JSON.stringify(catalog))<50*1024);
});

test('all default chapters retain all story and source fields within the 50 KiB offline budget',async t=>{
 const f=await fixture(t,{allDefaultChapters:true}),catalog=buildOfflineCatalog(f),read=readOfflineCatalog(catalog),defaults=readLevelConfiguration();
 assert.deepEqual(read,catalog);assert.equal(catalog.chapters.length,4);assert.equal(Object.keys(catalog.photos).length,25);
 assert.equal(f.photos.length,26);assert.equal(f.photos.filter(photo=>photo.id.startsWith('story-')).length,24);
 assert.ok(f.albums.slice(2).every(album=>album.imageIds.length===6));assert.ok(catalog.chapters.every(chapter=>chapter.levels.length===6));assert.equal(new Set(catalog.chapters.flatMap(chapter=>chapter.levels.map(level=>level.imageId))).size,24);
 for(const [chapterIndex,chapter]of catalog.chapters.entries())for(const [index,level]of chapter.levels.entries()){
  const photo=f.photos.find(photo=>photo.id===level.imageId);assert.equal(level.src,photo.src);assert.equal(level.thumbSrc,photo.thumbSrc);assert.equal(Object.hasOwn(level,'status'),false);
  for(const key of ['timeLabel','intro','comic']){
   assert.equal(Object.hasOwn(level,key),chapterIndex>=1);
   if(chapterIndex>=1)assert.deepEqual(level[key],defaults.chapters[chapterIndex].story[index][key]);
  }
 }
 const bytes=Buffer.byteLength(JSON.stringify(catalog));assert.ok(bytes<50*1024,'offline catalog bytes: '+bytes);t.diagnostic('all-default-chapters offline catalog: '+bytes+' / '+(50*1024)+' bytes');
 read.chapters[1].levels[0].comic.panels[0].texts[0].text='changed';assert.notDeepEqual(read.chapters[1].levels[0].comic,catalog.chapters[1].levels[0].comic);
});

test('future server timeLabel/intro/comic and arbitrary JSON fields survive build and read unchanged',async t=>{
 const f=await fixture(t),story={timeLabel:'1992 年夏',intro:'奶奶推开了店门。',comic:{panels:[{crop:{x:0,y:0,width:0.5,height:1},caption:'第一天',bubbles:[{text:'开张啦',x:0.2,y:0.4}]}]},future:{flags:[true,false,null,1.25],nested:{text:'保留'}}};
 // Simulate the additive server view, without guessing future levels.json placement.
 const futureLevels=options=>{const server=createMobileLevels(options);return {...server,view(...args){const view=server.view(...args);Object.assign(view.chapters[0].levels[0],structuredClone(story));return view;}};};
 const catalog=buildOfflineCatalog(f,futureLevels),read=readOfflineCatalog(catalog),level=read.chapters[0].levels[0];
 for(const key of Object.keys(story))assert.deepEqual(level[key],story[key]);
 assert.equal(Object.hasOwn(level,'status'),false);assert.equal(Object.keys(catalog.photos).length,7,'comic must not add artwork');
 level.comic.panels[0].caption='changed';assert.equal(catalog.chapters[0].levels[0].comic.panels[0].caption,'第一天');
});

test('missing full image or thumbnail and unavailable levels fail the build clearly',async t=>{
 const f=await fixture(t);
 for(const url of [f.photos[2].src,f.photos[2].thumbSrc,f.photos[0].src,f.photos[0].thumbSrc]){
  const mapping={...f.plan.mapping};delete mapping[url];
  assert.throws(()=>buildOfflineCatalog({...f,plan:{...f.plan,mapping}}),/Offline artwork is not bundled/);
 }
 assert.throws(()=>buildOfflineCatalog({...f,albums:f.albums.filter(a=>a.id!=='story')}),/Offline level unavailable/);
});

test('compiled restorable artwork takes precedence, matching TapTap creation with the artwork snapshot header',()=>{
 const photo=RESTORABLE_PHOTOS.find(photo=>photo.id==='new-2b4be6fe98943de7-v1')??RESTORABLE_PHOTOS[0];
 const injected={...photo,width:7,height:999,src:'/puzzles/wrong.webp',thumbSrc:'/puzzles/wrong-thumb.webp'};
 assert.deepEqual(offlineRoomArtwork(injected,48),currentRoomArtwork(photo,48,false));
});

test('room artwork override bundles one full edition and preserves active and legacy thumbnails',async t=>{
 const f=await fixture(t),photo=f.photos[0],legacy=f.photos[2];
 const plan=await planTapTapArtwork({...f,catalog:f.photos,roomArtwork:[{id:photo.id,src:legacy.src,thumbSrc:legacy.thumbSrc}],fullAlbumIds:['free']});
 assert.ok(plan.mapping[legacy.src]);assert.ok(plan.mapping[legacy.thumbSrc]);assert.ok(plan.mapping[photo.thumbSrc]);
 assert.equal(plan.mapping[photo.src],undefined);assert.equal(plan.files.filter(f=>f.kind==='puzzle').length,1);
});

test('reader rejects malformed known fields, IDs, grids, artwork, duplicate and missing references without throwing',async t=>{
 const valid=buildOfflineCatalog(await fixture(t));
 for(const mutate of [
  c=>c.schema='other',c=>c.chapters=[],c=>c.firstClearEnergy=-1,c=>c.chapters[0].id='../bad',c=>c.chapters[0].levels[0].imageId='missing',
  c=>c.chapters[0].levels[0].cols=0,c=>c.chapters[0].levels[0].pieces=1.5,c=>c.chapters[0].levels[0].line=4,
  c=>c.chapters[0].levels.push(c.chapters[0].levels[0]),c=>c.free.push(c.free[0]),c=>c.free[0].grids['12']={cols:3,rows:4},
  c=>c.free[0].grids={},c=>c.free[0].grids['48'].rows=-1,c=>c.photos['free-photo'].src='/puzzles/../secret.webp',
  c=>c.photos['free-photo'].thumbSrc='https://example.test/puzzles/x.webp',c=>c.photos['free-photo'].width=0,
  c=>c.photos['free-photo'].artwork.src='/puzzles/different.webp',c=>c.photos['free-photo'].id='wrong',
 ]){const value=structuredClone(valid);mutate(value);assert.equal(readOfflineCatalog(value),null);}
 for(const value of [null,[],{},'text',undefined])assert.equal(readOfflineCatalog(value),null);
});

test('reader bounds unknown field depth/size and rejects non-JSON values, cycles, accessors and exotic objects',async t=>{
 const valid=buildOfflineCatalog(await fixture(t)),cycle={};cycle.self=cycle;
 const deep={};let cursor=deep;for(let n=0;n<20;n++){cursor.next={};cursor=cursor.next;}
 const sparse=[];sparse.length=2;
 for(const extra of [undefined,NaN,Infinity,1n,()=>{},Symbol(),new Date(),new Map(),new Set(),cycle,deep,sparse,'文'.repeat(20000),Object.defineProperty({},'getter',{enumerable:true,get(){throw Error('must not execute');}})]){
  const value=structuredClone(valid);value.chapters[0].levels[0].extension=extra;
  assert.equal(readOfflineCatalog(value),null);
 }
 const value=structuredClone(valid);value.chapters[0].levels[0].extension={ok:[null,true,false,0,-3,1.5,'text']};assert.ok(readOfflineCatalog(value));
 const hostile=new Proxy({},{getPrototypeOf(){throw Error('hostile');}});assert.equal(readOfflineCatalog(hostile),null);
});
