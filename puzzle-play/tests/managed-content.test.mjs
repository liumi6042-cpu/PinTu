import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {contentJsonBytes,contentSha256,contentValueDigest} from '../server/content-release.mjs';
import {managedPhotos,readNodeManagedContent} from '../server/managed-content.node.mjs';
import {buildGameConfiguration,defaultGameSettings} from '../server/game-settings.mjs';
import {buildTaskRewardConfiguration,defaultTaskRewardSettings} from '../server/task-reward-settings.mjs';
import {buildAlbumConfiguration} from '../server/album-content.mjs';
import {createDailyContent} from '../server/daily-content.mjs';
import {checkContentRelease} from '../scripts/check-content-release.mjs';
import guidance from '../content/puzzle-guidance.json' with {type:'json'};

globalThis.__contentTestEnv={};
registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'test:managed-content-env',shortCircuit:true};
 if(specifier.startsWith('.')&&!/\.[cm]?[jt]s$/.test(specifier)){try{return next(specifier+'.ts',context);}catch{}}
 return next(specifier,context);
},load(url,context,next){if(url==='test:managed-content-env')return {format:'module',source:'export const env=globalThis.__contentTestEnv;',shortCircuit:true};return next(url,context);}});
const {effectiveManagedAlbums,managedDailyPuzzle,managedGalleryPhotos}=await import('../lib/managed-content.ts');
const photos=managedPhotos.slice(0,2),ids=photos.map(photo=>photo.id),clock=Date.parse('2026-10-13T12:00:00+08:00');
const signed=value=>({...value,configDigest:contentValueDigest(value)});
function fixture(){
 const parent=resolve('work/managed-content-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(resolve(parent,'release-'));
 function publish(releaseId,coins=3){
  const directory=resolve(root,'releases',releaseId);mkdirSync(directory,{recursive:true});
  const game=defaultGameSettings();game.collection.contributionCoins=coins;
  const tasks=defaultTaskRewardSettings();tasks.tasks[0].coins=coins;
  const album={id:'test-album',title:'测试相册',description:'',imageIds:ids,coverImageId:ids[0],showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]};
  const {imageIds:_images,coverImageId:_cover,...dailyAlbum}=album;
  const docs={
   'albums.json':buildAlbumConfiguration({schema:'jigsaw-albums/v1',albums:[album]},{photos,decorations:game.decorations}),
   'daily.json':signed({schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:[],automaticCandidates:ids.map(imageId=>({imageId,albumId:album.id})),fallbackImageIds:ids,albums:[dailyAlbum]}),
   'game-settings.json':buildGameConfiguration(game),'task-rewards.json':buildTaskRewardConfiguration(tasks),
  };
  const files=Object.entries(docs).map(([path,doc])=>{const bytes=contentJsonBytes(doc);writeFileSync(resolve(directory,path),bytes);return {path,bytes:bytes.length,sha256:contentSha256(bytes)};});
  const manifest=contentJsonBytes({schema:'jigsaw-managed-release/v1',releaseId,createdAt:new Date(clock).toISOString(),sourceVersions:{draftId:'test',draftRevision:1,gameRevision:1,taskRevision:1},files});
  writeFileSync(resolve(directory,'manifest.json'),manifest);
  const pointer={schema:'jigsaw-content-pointer/v1',releaseId,manifestSha256:contentSha256(manifest)};writeFileSync(resolve(root,'current.json'),contentJsonBytes(pointer));
  return {directory,pointer,docs};
 }
 return {root,publish,read:()=>readNodeManagedContent({directory:root,appearanceDir:resolve(root,'daily'),photos}),close:()=>rmSync(root,{recursive:true,force:true})};
}

test('missing pointer stays legacy; switching versions keeps each operation pinned; corruption fails closed',()=>{
 const f=fixture();try{
  assert.equal(f.read(),null);const first=f.publish('version-a',3),a=f.read();f.publish('version-b',9);const b=f.read();
  assert.equal(a.releaseId,'version-a');assert.equal(a.gameSettings.collection.contributionCoins,3);assert.equal(a.taskRewards.tasks[0].coins,3);
  assert.equal(b.releaseId,'version-b');assert.equal(b.gameSettings.collection.contributionCoins,9);assert.equal(b.taskRewards.tasks[0].coins,9);
  writeFileSync(resolve(f.root,'releases/version-b/task-rewards.json'),'{}');assert.throws(f.read,{status:503,code:'CONTENT_RELEASE_UNAVAILABLE'});
  assert.equal(a.documents.gameSettings.configDigest,first.docs['game-settings.json'].configDigest);
  assert.ok(Object.isFrozen(a.gameSettings.collection));
 }finally{f.close();}
});

test('every delivered photo carries measured dimensions; missing dimensions fail preflight',()=>{
 assert.equal(managedPhotos.length,134);
 for(const photo of managedPhotos){assert.ok(Number.isSafeInteger(photo.width)&&photo.width>0,photo.id);assert.ok(Number.isSafeInteger(photo.height)&&photo.height>0,photo.id);assert.equal(photo.width,guidance[photo.id].width);assert.equal(photo.height,guidance[photo.id].height);}
 const historical=managedPhotos.find(photo=>photo.id==='coral-garden');assert.equal(historical.width,1774);assert.equal(historical.height,887);
 const f=fixture();try{f.publish('bad-dimensions');assert.throws(()=>readNodeManagedContent({directory:f.root,photos:photos.map(photo=>({...photo,width:undefined}))}),{status:503});}finally{f.close();}
});

test('readonly preflight checks exact immutable version and does not create appearances',()=>{
 const f=fixture();try{
  const {directory,pointer}=f.publish('readonly');const before=readdirSync(f.root);
  const env={JIGSAW_CONTENT_RELEASE_DIR:directory,JIGSAW_CONTENT_RELEASE_ID:pointer.releaseId,JIGSAW_CONTENT_MANIFEST_SHA256:pointer.manifestSha256};
  assert.equal(checkContentRelease(env).contentReleaseId,'readonly');assert.deepEqual(readdirSync(f.root),before);
  assert.throws(()=>checkContentRelease({...env,JIGSAW_CONTENT_MANIFEST_SHA256:'0'.repeat(64)}));
  assert.throws(()=>checkContentRelease({...env,JIGSAW_CONTENT_RELEASE_ID:'another-version'}));
  f.read();assert.deepEqual(readdirSync(f.root),before);
 }finally{f.close();}
});

test('shared daily receipt gives both services the same image and actual premieres enter albums next Beijing midnight',()=>{
 const f=fixture();try{
  f.publish('daily');const snapshot=f.read();assert.deepEqual(effectiveManagedAlbums(snapshot,clock),[]);
  const selected=managedDailyPuzzle(snapshot,clock);
  const mobile=createDailyContent({readConfiguration:()=>snapshot.documents.daily,appearanceDir:resolve(f.root,'daily'),photos,fallback:()=>null,randomInt:()=>selected.id===ids[0]?1:0});
  assert.equal(mobile.select(clock+1000).id,selected.id,'existing shared receipt defeats a different random draw');
  assert.deepEqual(effectiveManagedAlbums(snapshot,clock),[]);
  const nextDay=Date.parse('2026-10-14T00:00:00+08:00');assert.deepEqual(effectiveManagedAlbums(snapshot,nextDay)[0].imageIds,[selected.id]);
  const second=managedDailyPuzzle(snapshot,nextDay);assert.notEqual(second.id,selected.id,'unreleased automatic artwork has priority');
  const nextNextDay=nextDay+86400000;assert.equal(effectiveManagedAlbums(snapshot,nextNextDay)[0].imageIds.length,2);
  const fallback=managedDailyPuzzle(snapshot,nextNextDay);assert.ok(ids.includes(fallback.id),'all-album fallback works after automatic candidates are exhausted');
  const receipt=JSON.parse(readFileSync(resolve(f.root,'daily','2026-10-15.json'),'utf8'));assert.equal(receipt.source,'library');
 }finally{f.close();}
});

test('player albums hide empty and unavailable content without changing saved membership, price or visibility',()=>{
 const f=fixture();try{
  f.publish('empty-albums');const original=f.read(),template=original.albums.albums[0];
  const albums=[
   {...template,id:'empty',imageIds:[],coverImageId:null},
   {...template,id:'unavailable',imageIds:['not-delivered'],coverImageId:'not-delivered'},
   {...template,id:'mobile-only',imageIds:[ids[0]],showOnPc:false},
   {...template,id:'mixed',imageIds:[ids[0],ids[1]],purchasable:true,price:71},
  ];
  const before=JSON.stringify(albums),released=new Set();
  const snapshot={...original,albums:{...original.albums,albums},dailyRuntime:{...original.dailyRuntime,managedImageIds:()=>new Set([ids[1]]),releasedImageIds:()=>released,albumEntries:()=>[]}};
  const visible=effectiveManagedAlbums(snapshot,clock);
  assert.deepEqual(visible.map(album=>album.id),['mixed']);
  assert.deepEqual(visible[0].imageIds,[ids[0]]);assert.equal(visible[0].price,71);assert.equal(visible[0].purchasable,true);
  assert.deepEqual(managedGalleryPhotos(snapshot,clock).map(photo=>photo.id),[ids[0]]);
  released.add(ids[1]);assert.deepEqual(effectiveManagedAlbums(snapshot,clock)[0].imageIds,ids);
  assert.equal(JSON.stringify(albums),before,'visibility is derived without rewriting saved album data');
 }finally{f.close();}
});
