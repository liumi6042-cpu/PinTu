import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createReleaseCoordinator} from '../releases.mjs';
import {CONTENT_RELEASE_FILES,contentJsonBytes,contentSha256,contentValueDigest,readManagedRelease,validateContentManifest} from '../contracts/content-release.mjs';

const work=resolve(import.meta.dirname,'../work');
const configuration=value=>({...value,configDigest:contentValueDigest(value)});
function fixture(t){
 mkdirSync(work,{recursive:true});const directory=mkdtempSync(join(work,'qa-release-'));
 t.after(()=>{assert.ok(resolve(directory).startsWith(work+sep));rmSync(directory,{recursive:true});});
 const root=join(directory,'content'),value={
  sourceVersions:{draftId:'fixture-album-draft',draftRevision:10,gameRevision:5,taskRevision:3},
  documents:{
   albums:configuration({schema:'jigsaw-albums/v1',albums:[{id:'paper-animals',imageIds:['image-1'],showOnPc:true,showOnMobile:true,milestones:[]}]}),
   daily:configuration({schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:[],automaticCandidates:[],fallbackImageIds:['image-1'],albums:[]}),
   gameSettings:configuration({schema:'jigsaw-game-settings/v1',energy:{initial:30},progression:{earlyXp:[2,5,10]}}),
   taskRewards:configuration({schema:'jigsaw-task-rewards/v1',tasks:[{id:'cooperation-1',energy:5,xp:2,coins:3}]}),
  },summary:{pendingImages:53},
 };
 return {root,value};
}
function change(value,revision=true){
 if(revision)value.sourceVersions.gameRevision++;
 const {configDigest,...document}=value.documents.gameSettings;document.energy.initial++;
 value.documents.gameSettings=configuration(document);
}

test('preview is read-only; preparing creates four immutable public configs without activating or copying pending images',async t=>{
 const {root,value}=fixture(t),before=structuredClone(value);
 const coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value});
 const preview=await coordinator.preview();assert.equal(existsSync(root),false);assert.equal(preview.summary.pendingImages,53);
 const prepared=await coordinator.prepare('fixture-editor');
 assert.equal(prepared.summary.albumCount,1);assert.equal(prepared.summary.playableImageCount,1);
 assert.deepEqual(prepared.sourceVersions,value.sourceVersions);assert.equal(readManagedRelease(root),null);
 const release=readManagedRelease(root,{releaseId:prepared.releaseId,strict:true});
 assert.equal(release.manifestSha256,prepared.manifestSha256);assert.deepEqual(release.documents,value.documents);
 assert.deepEqual(readdirSync(release.releaseDir).sort(),['albums.json','daily.json','game-settings.json','manifest.json','task-rewards.json']);
 assert.deepEqual(value,before,'preparing must not alter saved data');
 assert.equal(Object.isFrozen(release.documents.albums.albums[0]),true);
 for(const item of release.files){const bytes=readFileSync(join(release.releaseDir,item.path));assert.equal(bytes.length,item.bytes);assert.equal(contentSha256(bytes),item.sha256);}
 const savedFiles=new Map(release.files.map(file=>[file.path,readFileSync(join(release.releaseDir,file.path))]));
 await coordinator.confirm(prepared,'fixture-editor');
 assert.equal(readManagedRelease(root).manifest.releaseId,prepared.releaseId);
 for(const [name,bytes] of savedFiles)assert.deepEqual(readFileSync(join(release.releaseDir,name)),bytes);
});

test('confirmation rejects newer revisions and changed content even when revisions were not advanced',async t=>{
 const {root,value}=fixture(t);let calls=0;
 const coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value,publish:()=>{calls++;}});
 const prepared=await coordinator.prepare();change(value);
 await assert.rejects(coordinator.confirm(prepared),error=>error.code==='CONTENT_SOURCE_CHANGED');
 assert.equal(readManagedRelease(root),null);assert.equal(calls,0);
 const second=await coordinator.prepare();change(value,false);
 await assert.rejects(coordinator.confirm(second),error=>error.code==='CONTENT_SOURCE_CHANGED');
 assert.equal(readManagedRelease(root),null);assert.equal(calls,0);
});

test('failed target activation keeps the committed pointer; successful update retains the previous immutable release',async t=>{
 const {root,value}=fixture(t);let fail=false,calls=0;
 const coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value,publish:async release=>{
  calls++;assert.equal(Object.isFrozen(release),true);if(fail)throw Object.assign(new Error('fixture target failed'),{code:'TARGET_FAILURE'});
  return {web:{releaseId:release.manifest.releaseId,verifiedCall:calls},miniProgram:{releaseId:release.manifest.releaseId}};
 }});
 const first=await coordinator.prepare(),firstResult=await coordinator.confirm(first);
 assert.equal(firstResult.status,'published');const pinned=readManagedRelease(root),oldPointer=readFileSync(join(root,'current.json'),'utf8');
 change(value);const second=await coordinator.prepare();fail=true;
 await assert.rejects(coordinator.confirm(second),error=>error.code==='TARGET_FAILURE');
 assert.equal(readFileSync(join(root,'current.json'),'utf8'),oldPointer);assert.equal(readManagedRelease(root).manifest.releaseId,first.releaseId);
 fail=false;await coordinator.confirm(second);const live=readManagedRelease(root);
 assert.equal(live.manifest.releaseId,second.releaseId);assert.equal(pinned.manifest.releaseId,first.releaseId);
 assert.equal(pinned.documents.gameSettings.energy.initial,30);assert.equal(live.documents.gameSettings.energy.initial,31);
 assert.deepEqual(JSON.parse(readFileSync(join(root,'previous.json'),'utf8')),pinned.pointer);
 assert.equal(readManagedRelease(root,{releaseId:first.releaseId}).documents.gameSettings.energy.initial,30);
 const previousBytes=readFileSync(join(root,'previous.json'),'utf8'),currentBytes=readFileSync(join(root,'current.json'),'utf8');
 const again=await coordinator.confirm(second);assert.equal(again.alreadyCurrent,true);assert.equal(calls,4);
 assert.ok(Number.isFinite(Date.parse(again.publishedAt)));assert.equal(again.targets.web.releaseId,second.releaseId);assert.equal(again.targets.web.verifiedCall,4);
 assert.equal(readFileSync(join(root,'previous.json'),'utf8'),previousBytes);assert.equal(readFileSync(join(root,'current.json'),'utf8'),currentBytes);
 const lastSuccess=readFileSync(join(root,'last-publish.json'),'utf8');fail=true;
 await assert.rejects(coordinator.confirm(second),error=>error.code==='TARGET_FAILURE');assert.equal(calls,5);
 assert.equal(readFileSync(join(root,'previous.json'),'utf8'),previousBytes);assert.equal(readFileSync(join(root,'current.json'),'utf8'),currentBytes);
 assert.equal(readFileSync(join(root,'last-publish.json'),'utf8'),lastSuccess,'a stale local receipt must never replace a failed remote verification');
 const status=await coordinator.status();assert.equal(status.current.releaseId,second.releaseId);assert.equal(status.previous.releaseId,first.releaseId);
 assert.ok(status.audits.some(item=>item.kind==='failed'));assert.equal(status.lastPublish.targets.web.releaseId,second.releaseId);
 rmSync(join(root,'last-publish.json'));fail=false;
 const noCachedReceipt=await coordinator.confirm(second);assert.equal(noCachedReceipt.alreadyCurrent,true);assert.equal(noCachedReceipt.targets.web.verifiedCall,6);
 assert.ok(Number.isFinite(Date.parse(noCachedReceipt.publishedAt)));assert.equal(readFileSync(join(root,'previous.json'),'utf8'),previousBytes);
});

test('only a missing pointer permits legacy fallback; malformed hashes, paths and public documents fail closed',async t=>{
 const {root,value}=fixture(t),coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value});
 assert.equal(readManagedRelease(root),null);assert.throws(()=>readManagedRelease(root,{strict:true}),error=>error.code==='CONTENT_RELEASE_UNAVAILABLE');
 const prepared=await coordinator.prepare(),release=readManagedRelease(root,{releaseId:prepared.releaseId});
 assert.throws(()=>readManagedRelease(root,{releaseId:'../escape'}),error=>error.code==='INVALID_CONTENT_RELEASE');
 const traversal=structuredClone(release.manifest);traversal.files[0].path='../albums.json';assert.throws(()=>validateContentManifest(traversal),error=>error.code==='INVALID_CONTENT_RELEASE');
 const duplicate=structuredClone(release.manifest);duplicate.files[1]=duplicate.files[0];assert.throws(()=>validateContentManifest(duplicate),error=>error.code==='INVALID_CONTENT_RELEASE');
 const albumFile=join(release.releaseDir,'albums.json'),originalAlbum=readFileSync(albumFile);
 writeFileSync(albumFile,Buffer.concat([originalAlbum,Buffer.from(' ')]));
 assert.throws(()=>readManagedRelease(root,{releaseId:prepared.releaseId}),error=>error.code==='INVALID_CONTENT_RELEASE');
 writeFileSync(albumFile,originalAlbum);await coordinator.confirm(prepared);
 const pointer=JSON.parse(readFileSync(join(root,'current.json'),'utf8'));pointer.manifestSha256='0'.repeat(64);writeFileSync(join(root,'current.json'),JSON.stringify(pointer));
 assert.throws(()=>readManagedRelease(root),error=>error.code==='INVALID_CONTENT_RELEASE');
});

test('optional assets are metadata only and unsupported private documents cannot enter a release',async t=>{
 const {root,value}=fixture(t),coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value});
 value.documents.assets=configuration({schema:'jigsaw-content-assets/v1',images:[{id:'image-1',available:true},{id:'pending-image',available:false}]});
 const prepared=await coordinator.prepare(),release=readManagedRelease(root,{releaseId:prepared.releaseId});
 assert.deepEqual(release.documents.assets,value.documents.assets);assert.equal(release.files.length,5);
 const originalAlbums=value.documents.albums,{configDigest,...albums}=structuredClone(originalAlbums);albums.albums[0].imageIds.push('pending-image');value.documents.albums=configuration(albums);
 await assert.rejects(coordinator.prepare(),error=>error.code==='INVALID_CONTENT_RELEASE');value.documents.albums=originalAlbums;
 value.documents.assets=configuration({schema:'jigsaw-content-assets/v1',images:[{id:'image-1',available:true,path:'C:/private/source.png'}]});
 await assert.rejects(coordinator.prepare(),error=>error.code==='INVALID_CONTENT_RELEASE');
 delete value.documents.assets;value.documents.database={schema:'sqlite',path:'private.sqlite'};
 await assert.rejects(coordinator.prepare(),error=>error.code==='INVALID_RELEASE_SNAPSHOT');
 assert.deepEqual(Object.keys(CONTENT_RELEASE_FILES),['albums','daily','gameSettings','taskRewards','assets']);
});

test('application validation runs before preparing; concurrent confirmations cannot race pointer activation',async t=>{
 const {root,value}=fixture(t);let allow=false,finish;
 const coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value,validate:()=>{if(!allow)throw new Error('pending asset not delivered');},publish:()=>new Promise(resolvePublish=>{finish=resolvePublish;})});
 await assert.rejects(coordinator.prepare(),/pending asset not delivered/);assert.equal(existsSync(root),false);
 allow=true;const prepared=await coordinator.prepare();const confirmation=coordinator.confirm(prepared);
 while(!finish)await new Promise(resolveTick=>setImmediate(resolveTick));
 await assert.rejects(coordinator.confirm(prepared),error=>error.code==='CONTENT_RELEASE_BUSY');
 finish({web:'ready',miniProgram:'ready'});await confirmation;
 assert.equal(readManagedRelease(root).manifest.releaseId,prepared.releaseId);
});

test('a tampered configuration digest is rejected even if an altered file and manifest have matching outer hashes',async t=>{
 const {root,value}=fixture(t),coordinator=createReleaseCoordinator({releaseDir:root,readSnapshot:()=>value});
 const prepared=await coordinator.prepare(),release=readManagedRelease(root,{releaseId:prepared.releaseId});
 const album=structuredClone(release.documents.albums);album.albums[0].imageIds.push('not-delivered');
 const bytes=contentJsonBytes(album);writeFileSync(join(release.releaseDir,'albums.json'),bytes);
 const manifest=structuredClone(release.manifest),file=manifest.files.find(item=>item.path==='albums.json');file.bytes=bytes.length;file.sha256=contentSha256(bytes);
 writeFileSync(join(release.releaseDir,'manifest.json'),contentJsonBytes(manifest));
 assert.throws(()=>readManagedRelease(root,{releaseId:prepared.releaseId}),error=>error.code==='INVALID_CONTENT_RELEASE');
});
