import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readManagedRelease,contentJsonBytes,contentSha256,contentValueDigest,CONTENT_RELEASE_FILES} from '../server/content-release.mjs';
import {createMobileManagedContent,validateMobileContentRelease} from '../server/mobile-managed-content.mjs';
import {buildGameConfiguration,defaultGameSettings} from '../server/game-settings.mjs';
import {buildTaskRewardConfiguration,defaultTaskRewardSettings} from '../server/task-reward-settings.mjs';
import {RESTORABLE_PHOTOS} from '../outputs/mobile/engine.mjs';

const project=resolve(import.meta.dirname,'..'),work=join(project,'work'),assetDir=join(project,'public'),assetPaths=JSON.parse(fs.readFileSync(join(project,'h5/asset-manifest.json'),'utf8'));
const photo=RESTORABLE_PHOTOS.find(photo=>photo.status==='published'&&[photo.src,photo.thumbSrc].every(path=>assetPaths.includes(path)&&fs.existsSync(join(assetDir,path.slice(1)))));
assert.ok(photo,'a delivered original and thumbnail from the real runtime catalog');
const signed=value=>({...value,configDigest:contentValueDigest(value)});
function documents(label='A'){
 const album={id:'runtime-album',title:'运行相册 '+label,description:label,imageIds:[photo.id],coverImageId:photo.id,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]};
 const {imageIds:_imageIds,coverImageId:_cover,...dailyAlbum}=album;
 const games=defaultGameSettings(),tasks=defaultTaskRewardSettings();games.collection.contributionCoins=label==='A'?2:7;tasks.invitationShare.coins=label==='A'?3:8;
 return {albums:signed({schema:'jigsaw-albums/v1',albums:[album]}),daily:signed({schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:[{date:'2026-10-13',imageId:photo.id,albumId:album.id}],automaticCandidates:[],fallbackImageIds:[photo.id],albums:[dailyAlbum]}),gameSettings:buildGameConfiguration(games),taskRewards:buildTaskRewardConfiguration(tasks),assets:signed({schema:'jigsaw-content-assets/v1',images:[{id:photo.id,available:true}]})};
}
function fixture(){
 fs.mkdirSync(work,{recursive:true});const directory=fs.mkdtempSync(join(work,'managed-content-test-'));fs.mkdirSync(join(directory,'releases'));
 const publish=(releaseId,docs=documents())=>{const releaseDir=join(directory,'releases',releaseId);fs.mkdirSync(releaseDir);const files=Object.entries(docs).map(([key,value])=>{const bytes=contentJsonBytes(value),path=CONTENT_RELEASE_FILES[key];fs.writeFileSync(join(releaseDir,path),bytes);return{path,bytes:bytes.length,sha256:contentSha256(bytes)};});
  const manifest={schema:'jigsaw-managed-release/v1',releaseId,createdAt:'2026-10-13T12:00:00.000Z',sourceVersions:{draftId:'isolated-test',draftRevision:1,gameRevision:1,taskRevision:1},files},bytes=contentJsonBytes(manifest);fs.writeFileSync(join(releaseDir,'manifest.json'),bytes);return{releaseId,releaseDir,manifest,docs,manifestSha256:contentSha256(bytes)};};
 const point=release=>fs.writeFileSync(join(directory,'current.json'),contentJsonBytes({schema:'jigsaw-content-pointer/v1',releaseId:release.releaseId,manifestSha256:release.manifestSha256}));
 const close=()=>{assert.ok(directory.startsWith(work+sep));fs.rmSync(directory,{recursive:true,force:true});};
 return{directory,publish,point,close,readOptions:{directory,photos:RESTORABLE_PHOTOS,assetDir,assetPaths}};
}
function inventory(directory){const result=[];function walk(path){for(const entry of fs.readdirSync(path,{withFileTypes:true})){const full=join(path,entry.name);result.push({path:full.slice(directory.length+1),kind:entry.isDirectory()?'directory':'file',sha256:entry.isFile()?contentSha256(fs.readFileSync(full)):null});if(entry.isDirectory())walk(full);}}walk(directory);return result.sort((a,b)=>a.path.localeCompare(b.path));}

test('one pointer read pins all typed runtime documents while a later operation observes the atomic publication',()=>{
 const f=fixture(),originalRead=fs.readFileSync;
 try{
  const a=f.publish('release-a',documents('A')),b=f.publish('release-b',documents('B'));f.point(a);let pointerReads=0;
  fs.readFileSync=function(path,...args){const bytes=originalRead.call(this,path,...args);if(resolve(String(path))===join(f.directory,'current.json')){pointerReads++;if(pointerReads===1)f.point(b);}return bytes;};syncBuiltinESMExports();
  const reader=createMobileManagedContent(f.readOptions),first=reader.read();assert.equal(pointerReads,1);assert.equal(first.releaseId,'release-a');assert.equal(first.albums.albums[0].description,'A');assert.equal(first.daily.albums[0].description,'A');assert.equal(first.gameSettings.collection.contributionCoins,2);assert.equal(first.taskRewards.invitationShare.coins,3);
  const second=reader.read();assert.equal(pointerReads,2);assert.equal(second.releaseId,'release-b');assert.equal(second.albums.albums[0].description,'B');assert.equal(second.daily.albums[0].description,'B');assert.equal(second.gameSettings.collection.contributionCoins,7);assert.equal(second.taskRewards.invitationShare.coins,8);
  assert.equal(first.gameSettings.collection.contributionCoins,2,'held operation stays on its original complete release');assert.ok(Object.isFrozen(first.documents.albums.albums));assert.ok(Object.isFrozen(first.gameSettings.energy));
 }finally{fs.readFileSync=originalRead;syncBuiltinESMExports();f.close();}
});

test('missing pointer supports legacy configuration but an existing invalid publication never silently falls back',()=>{
 const f=fixture();try{
  const reader=createMobileManagedContent(f.readOptions);assert.equal(reader.read(),null);assert.equal(readManagedRelease(undefined),null);assert.throws(()=>readManagedRelease(f.directory,{strict:true}));
  fs.writeFileSync(join(f.directory,'current.json'),'not-json');assert.throws(()=>reader.read(),{code:'CONTENT_RELEASE_UNAVAILABLE',status:503});
  const a=f.publish('release-a');f.point(a);assert.equal(reader.read().releaseId,a.releaseId);fs.writeFileSync(join(a.releaseDir,'game-settings.json'),'{}');assert.throws(()=>reader.read(),{code:'CONTENT_RELEASE_UNAVAILABLE',status:503});
 }finally{f.close();}
});

test('runtime rejects tampered, missing and linked release inputs with no substitute document',()=>{
 const f=fixture();try{
  const tampered=f.publish('tampered');f.point(tampered);fs.appendFileSync(join(tampered.releaseDir,'albums.json'),' ');assert.throws(()=>readManagedRelease(f.directory),/文件校验不匹配/);
  const missing=f.publish('missing');f.point(missing);fs.unlinkSync(join(missing.releaseDir,'daily.json'));assert.throws(()=>createMobileManagedContent(f.readOptions).read(),{code:'CONTENT_RELEASE_UNAVAILABLE'});
  const valid=f.publish('valid'),linkedDir=join(f.directory,'releases','linked');fs.symlinkSync(valid.releaseDir,linkedDir,process.platform==='win32'?'junction':'dir');assert.throws(()=>readManagedRelease(f.directory,{releaseId:'linked',strict:true}),/符号链接/);assert.throws(()=>readManagedRelease(f.directory,{releaseId:'../valid',strict:true}),/版本标识/);
 }finally{f.close();}
});

test('runtime typed validation rejects signed but invalid rules, unknown artwork and daily albums from another release',()=>{
 const f=fixture();try{
  const rules=documents();const {configDigest:_digest,...game}=rules.gameSettings;game.energy.initial=game.energy.baseCap+1;rules.gameSettings=signed(game);const badRules=f.publish('bad-rules',rules);f.point(badRules);assert.throws(()=>createMobileManagedContent(f.readOptions).read(),{code:'CONTENT_RELEASE_UNAVAILABLE'});
  const unknown=documents();unknown.albums=signed({schema:'jigsaw-albums/v1',albums:[{...unknown.albums.albums[0],imageIds:['unshipped-image'],coverImageId:'unshipped-image'}]});delete unknown.assets;const badImage=f.publish('unknown-image',unknown);f.point(badImage);assert.throws(()=>createMobileManagedContent(f.readOptions).read(),{code:'CONTENT_RELEASE_UNAVAILABLE'});
  const other=documents(),{configDigest:_dailyDigest,...daily}=other.daily;daily.albums[0].id='other-release-album';daily.entries[0].albumId='other-release-album';other.daily=signed(daily);const crossed=f.publish('crossed-daily',other);f.point(crossed);const raw=readManagedRelease(f.directory);assert.throws(()=>validateMobileContentRelease(raw,f.readOptions),/不存在的相册/);
 }finally{f.close();}
});

test('resource preflight checks both catalog registration and actual original/thumbnail delivery without writing receipts',()=>{
 const f=fixture();try{
  const a=f.publish('release-a');f.point(a);const raw=readManagedRelease(f.directory),before=inventory(a.releaseDir),full=validateMobileContentRelease(raw,f.readOptions);assert.deepEqual(full.summary,{albumCount:1,imageCount:1,taskCount:defaultTaskRewardSettings().tasks.length});
  assert.throws(()=>validateMobileContentRelease(raw,{...f.readOptions,assetPaths:assetPaths.filter(path=>path!==photo.thumbSrc)}),/未登记/);
  const emptyAssets=join(f.directory,'empty-assets');fs.mkdirSync(emptyAssets);assert.throws(()=>validateMobileContentRelease(raw,{...f.readOptions,assetDir:emptyAssets}),/尚未交付/);fs.rmdirSync(emptyAssets);
  const pending=documents();pending.assets=signed({schema:'jigsaw-content-assets/v1',images:[{id:photo.id,available:false}]});const release=f.publish('pending',pending);assert.throws(()=>readManagedRelease(f.directory,{releaseId:release.releaseId}),/尚未交付/);
  assert.deepEqual(inventory(a.releaseDir),before,'pure validation leaves the release unchanged');assert.equal(fs.existsSync(join(f.directory,'appearances')),false);
 }finally{f.close();}
});

test('CLI validates explicit release and expected manifest SHA while ignoring another current release and creating no runtime data',()=>{
 const f=fixture();try{
  const a=f.publish('release-a'),b=f.publish('release-b',documents('B'));f.point(a);const before=inventory(f.directory),forbidden=join(f.directory,'runtime-data');
  const env={...process.env,JIGSAW_CONTENT_DIR:f.directory,JIGSAW_CONTENT_RELEASE_DIR:b.releaseDir,JIGSAW_CONTENT_RELEASE_ID:b.releaseId,JIGSAW_CONTENT_MANIFEST_SHA256:b.manifestSha256,MOBILE_ASSET_DIR:assetDir,MOBILE_DB:join(forbidden,'mobile.sqlite'),H5_SESSION_DB:join(forbidden,'sessions.sqlite'),MOBILE_DAILY_APPEARANCES:join(forbidden,'appearances')};
  const run=changes=>spawnSync(process.execPath,[join(project,'scripts/check-content-release.mjs')],{cwd:project,env:{...env,...changes},encoding:'utf8',windowsHide:true,timeout:15000});
  const good=run({});assert.equal(good.status,0,good.stderr);const result=JSON.parse(good.stdout.trim());assert.equal(result.ok,true);assert.equal(result.contentReleaseId,b.releaseId);assert.equal(result.manifestSha256,b.manifestSha256);assert.equal(result.configDigests.taskRewards,b.docs.taskRewards.configDigest);assert.equal(result.albumCount,1);assert.equal(result.imageCount,1);
  for(const change of [{JIGSAW_CONTENT_MANIFEST_SHA256:'0'.repeat(64)},{JIGSAW_CONTENT_RELEASE_ID:a.releaseId}]){const rejected=run(change);assert.notEqual(rejected.status,0);assert.equal(JSON.parse(rejected.stderr.trim()).ok,false);}
  assert.deepEqual(inventory(f.directory),before,'successful and rejected preflight runs are read-only');assert.equal(fs.existsSync(forbidden),false,'no players, SQLite or appearance receipts are created');
 }finally{f.close();}
});
