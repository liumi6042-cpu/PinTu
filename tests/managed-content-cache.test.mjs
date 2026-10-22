import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMobileManagedContent as createReader} from '../server/mobile-managed-content.mjs';
import {createDailyContent} from '../server/daily-content.mjs';
import {contentJsonBytes,contentSha256,contentValueDigest,CONTENT_RELEASE_FILES} from '../server/content-release.mjs';
import {buildGameConfiguration,defaultGameSettings} from '../server/game-settings.mjs';
import {buildTaskRewardConfiguration,defaultTaskRewardSettings} from '../server/task-reward-settings.mjs';

const sign=value=>({...value,configDigest:contentValueDigest(value)});
function fixture(){
 const root=fs.mkdtempSync(join(tmpdir(),'jigsaw-typed-cache-')),assetDir=join(root,'public'),appearanceDir=join(root,'appearances');
 fs.mkdirSync(join(root,'releases'));fs.mkdirSync(appearanceDir);fs.mkdirSync(join(assetDir,'puzzles'),{recursive:true});
 const photos=['one','two'].map(name=>({id:'cache-'+name,title:name,status:'published',width:2048,height:2048,src:'/puzzles/'+name+'.webp',thumbSrc:'/puzzles/'+name+'-thumb.webp'}));
 for(const photo of photos)for(const path of [photo.src,photo.thumbSrc])fs.writeFileSync(join(assetDir,path.slice(1)),'artwork fixture');
 const publish=(releaseId,coins=1)=>{
  const directory=join(root,'releases',releaseId);fs.mkdirSync(directory);
  const game=defaultGameSettings();game.collection.contributionCoins=coins;
  const tasks=defaultTaskRewardSettings();tasks.tasks[0].coins=coins;
  const album={id:'cache-album',title:releaseId,description:'',imageIds:photos.map(photo=>photo.id),coverImageId:photos[0].id,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]};
  const {imageIds:_imageIds,coverImageId:_cover,...dailyAlbum}=album;
  const documents={albums:sign({schema:'jigsaw-albums/v1',albums:[album]}),daily:sign({schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:photos.map((photo,index)=>({date:'2026-10-'+(16+index),imageId:photo.id,albumId:album.id})),automaticCandidates:[],fallbackImageIds:photos.map(photo=>photo.id),albums:[dailyAlbum]}),gameSettings:buildGameConfiguration(game),taskRewards:buildTaskRewardConfiguration(tasks)};
  const files=Object.entries(documents).map(([key,value])=>{const path=CONTENT_RELEASE_FILES[key],bytes=contentJsonBytes(value);fs.writeFileSync(join(directory,path),bytes);return {path,bytes:bytes.length,sha256:contentSha256(bytes)};});
  const bytes=contentJsonBytes({schema:'jigsaw-managed-release/v1',releaseId,createdAt:'2026-10-16T00:00:00.000Z',sourceVersions:{draftId:'typed-cache',draftRevision:1,gameRevision:1,taskRevision:1},files});fs.writeFileSync(join(directory,'manifest.json'),bytes);
  return {schema:'jigsaw-content-pointer/v1',releaseId,manifestSha256:contentSha256(bytes)};
 };
 return {root,assetDir,appearanceDir,photos,publish,point:pointer=>fs.writeFileSync(join(root,'current.json'),contentJsonBytes(pointer)),reader:()=>createReader({directory:root,photos,assetDir,appearanceDir}),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('typed cache reuses validated objects; hot path does no JSON read, image realpath or per-image stat',()=>{
 const f=fixture(),originalRead=fs.readFileSync,originalRealpath=fs.realpathSync,originalStat=fs.lstatSync;let reads=0,realpaths=0,imageStats=0;
 try{
  f.point(f.publish('a'));const reader=f.reader(),first=reader.read();
  fs.readFileSync=(...args)=>{reads++;return originalRead(...args);};fs.realpathSync=(...args)=>{realpaths++;return originalRealpath(...args);};fs.lstatSync=(path,...args)=>{if(String(path).endsWith('.webp'))imageStats++;return originalStat(path,...args);};syncBuiltinESMExports();
  for(let i=0;i<20;i++){const value=reader.read();assert.equal(value.documents,first.documents);assert.equal(value.gameSettings,first.gameSettings);assert.ok(Object.isFrozen(value.taskRewards));}
  assert.equal(reads,0);assert.equal(realpaths,0);assert.equal(imageStats,0);
 }finally{fs.readFileSync=originalRead;fs.realpathSync=originalRealpath;fs.lstatSync=originalStat;syncBuiltinESMExports();f.close();}
});

test('typed cache follows publish and rollback without mixing old album, task or growth objects',()=>{
 const f=fixture();
 try{
  const a=f.publish('a',2),b=f.publish('b',7);f.point(a);const reader=f.reader(),first=reader.read();f.point(b);const second=reader.read();
  assert.equal(second.releaseId,'b');assert.equal(second.albums.albums[0].title,'b');assert.equal(second.gameSettings.collection.contributionCoins,7);assert.equal(second.taskRewards.tasks[0].coins,7);
  f.point(a);assert.equal(reader.read().gameSettings.collection.contributionCoins,2);assert.equal(first.taskRewards.tasks[0].coins,2);
 }finally{f.close();}
});

test('deleting a delivered image or corrupting the active pointer fails closed after a warm hit',()=>{
 const f=fixture();
 try{
  const a=f.publish('a');f.point(a);const reader=f.reader();reader.read();reader.read();const thumbnail=join(f.assetDir,f.photos[0].thumbSrc.slice(1));fs.unlinkSync(thumbnail);
  assert.throws(()=>reader.read(),{status:503,code:'CONTENT_RELEASE_UNAVAILABLE'});
  fs.writeFileSync(thumbnail,'restored artwork');assert.equal(reader.read().releaseId,'a');fs.writeFileSync(join(f.root,'current.json'),'broken');assert.throws(()=>reader.read(),{status:503,code:'CONTENT_RELEASE_UNAVAILABLE'});
 }finally{f.close();}
});

test('reused configuration never caches the selected daily or its appearance facts across Beijing midnight',()=>{
 const f=fixture();
 try{
  f.point(f.publish('a'));const reader=f.reader(),first=reader.read(),before=Date.parse('2026-10-16T23:59:59+08:00'),after=Date.parse('2026-10-17T00:00:01+08:00');
  const daily=snapshot=>snapshot.dailyRuntime??createDailyContent({readConfiguration:()=>snapshot.documents.daily,appearanceDir:f.appearanceDir,photos:f.photos,fallback:()=>f.photos[0]});
  assert.equal(daily(first).select(before).id,f.photos[0].id);const next=reader.read();assert.equal(next.documents,first.documents);assert.equal(daily(next).select(after).id,f.photos[1].id);
  assert.deepEqual(daily(next).albumEntries(after,'pc')[0].imageIds,[f.photos[0].id]);assert.equal(fs.readdirSync(f.appearanceDir).length,2);
 }finally{f.close();}
});
