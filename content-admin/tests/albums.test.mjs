import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {readSource} from '../source.mjs';
import {validateDraft} from '../model.mjs';
import {createStore} from '../store.mjs';
import {buildPublicAlbumDocument,createAlbumCoordinator} from '../albums.mjs';
import {createGameSettingsCoordinator} from '../game-settings.mjs';
import {createAdminServer} from '../server.mjs';
import {beijingDate,createDailyCoordinator} from '../daily.mjs';
import {validateAlbumConfiguration} from '../../jigsaw-nook-taptap/server/album-content.mjs';

const projectRoot=resolve(import.meta.dirname,'../..'),source=readSource(projectRoot),copy=structuredClone;
const emptyAlbum=id=>({id,title:'独立相册',description:'单独设置奖励',imageIds:[],coverImageId:null,styleGroupId:null,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]});
function directory(){
 const parent=join(projectRoot,'content-admin/work');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'qa-albums-'));
 return {dir,cleanup(){assert.ok(resolve(dir).startsWith(parent+sep));rmSync(dir,{recursive:true});}};
}

test('legacy milestone identities derive once and survive a threshold edit; IDs, targets and decorations are validated',()=>{
 const original=copy(source.baseline),snapshot=copy(original),document=validateDraft(original,source),album=document.albums.find(item=>item.milestones.length);
 assert.deepEqual(original,snapshot,'reading must not alter the source or saved document');
 assert.equal(album.milestones[0].id,'milestone-'+snapshot.albums.find(item=>item.id===album.id).milestones[0].target);
 const identity=album.milestones[0].id;album.milestones[0].target++;
 assert.equal(validateDraft(document,source).albums.find(item=>item.id===album.id).milestones[0].id,identity);
 for(const mutate of [
  value=>{value.albums[0].milestones[1].id=value.albums[0].milestones[0].id;},
  value=>{value.albums[0].milestones[1].target=value.albums[0].milestones[0].target;},
  value=>{value.albums[0].milestones[0].id='Invalid ID';},
  value=>{value.albums[0].milestones[0].decorationId='made-up-decoration';},
  value=>{value.albums[0].milestones[0].coins=100001;},
 ]){const invalid=validateDraft(source.baseline,source);mutate(invalid);assert.throws(()=>validateDraft(invalid,source),error=>error.code==='INVALID_DRAFT');}
});

test('public bridge includes every saved album, omits pending/unassigned images, and never rewrites albums or growth settings',t=>{
 const {dir,cleanup}=directory(),store=createStore(join(dir,'admin'),source);t.after(()=>{store.close();cleanup();});
 const settingsCoordinator=createGameSettingsCoordinator({store,bridgeDir:join(dir,'game-settings')});
 const settings=settingsCoordinator.sync(),edited=copy(settings.document);edited.energy.initial=30;
 settingsCoordinator.save(settings.revision,edited,'fixture-editor');const settingsBefore=store.gameSettings();
 const current=store.draft(store.activeDraftId()),document=copy(current.document),unassigned=document.albums.at(-1).imageIds.shift();
 document.albums.at(-1).coverImageId=document.albums.at(-1).imageIds[0];
 const pending=source.assets.find(asset=>asset.lifecycle==='pending').id,secondPending=source.assets.find(asset=>asset.lifecycle==='pending'&&asset.id!==pending).id,archived=source.assets.find(asset=>asset.lifecycle==='retained'&&asset.targets['mobile-shared'].status==='archived').id;
 const testSource=Object.defineProperty({...source,assets:source.assets.map(asset=>[pending,secondPending].includes(asset.id)?{...asset,runtimeAvailable:false}:asset)},'_private',{value:source._private});
 const destination=emptyAlbum('all-archived');destination.showOnMobile=false;destination.imageIds=[pending,archived];destination.coverImageId=pending;
 for(const album of document.albums){album.imageIds=album.imageIds.filter(id=>id!==archived);if(!album.imageIds.includes(album.coverImageId))album.coverImageId=album.imageIds[0]??null;}
 document.albums.push(destination,emptyAlbum('pending-only'));document.albums.at(-1).imageIds=[secondPending];document.albums.at(-1).coverImageId=document.albums.at(-1).imageIds[0];
 const saved=store.saveDraft(current.id,current.revision,document,'fixture-editor');
 const coordinator=createAlbumCoordinator({store,getSource:()=>testSource,bridgeDir:join(dir,'albums')}),configuration=coordinator.sync();
 assert.equal(configuration.albums.length,document.albums.length);
 const publicAlbum=configuration.albums.find(album=>album.id===destination.id);
 assert.deepEqual(publicAlbum.imageIds,[archived]);assert.equal(publicAlbum.coverImageId,archived);assert.equal(publicAlbum.showOnMobile,false);
 assert.deepEqual(configuration.albums.at(-1).imageIds,[]);assert.equal(configuration.albums.at(-1).coverImageId,null);
 assert.equal(configuration.albums.flatMap(album=>album.imageIds).includes(unassigned),false);
 assert.equal(configuration.albums.some(album=>album.imageIds.includes(pending)),false);
 assert.deepEqual(validateAlbumConfiguration(configuration),buildPublicAlbumDocument(saved.document,testSource));
 const path=join(dir,'albums/configuration.json'),before=statSync(path,{bigint:true}).mtimeNs;coordinator.sync();assert.equal(statSync(path,{bigint:true}).mtimeNs,before);
 assert.deepEqual(store.draft(saved.id),saved);assert.deepEqual(store.gameSettings(),settingsBefore);
});

test('daily receipt bookkeeping does not persist read-only milestone normalization',t=>{
 const {dir,cleanup}=directory(),store=createStore(join(dir,'admin'),source);t.after(()=>{store.close();cleanup();});
 const bridgeDir=join(dir,'daily'),appearanceDir=join(dir,'appearances'),at=Date.parse('2030-05-01T12:00:00+08:00');
 const coordinator=createDailyCoordinator({store,getSource:()=>source,validateDocument:validateDraft,bridgeDir,appearanceDir,now:()=>at});
 const original=store.draft(store.activeDraftId());coordinator.sync();
 const configuration=JSON.parse(readFileSync(join(bridgeDir,'configuration.json'),'utf8'));mkdirSync(appearanceDir,{recursive:true});
 const fact={schema:'jigsaw-daily-appearance/v2',target:'mobile-shared',date:beijingDate(at),imageId:configuration.fallbackImageIds[0],albumId:null,activatedAt:at,configDigest:configuration.configDigest,planned:false,source:'library'};
 writeFileSync(join(appearanceDir,fact.date+'.json'),JSON.stringify(fact));coordinator.sync();coordinator.sync();
 assert.deepEqual(store.draft(original.id),original);assert.equal(store.dailyAppearances().length,1);
});

test('saving one album exports its rewards immediately while growth settings retain independent CAS',async t=>{
 const {dir,cleanup}=directory(),app=createAdminServer({projectRoot,dataDir:dir,source,appearanceDir:join(dir,'appearances')});
 t.after(async()=>{await app.close();cleanup();});await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(path,method='GET',body){const headers={cookie};if(body!==undefined)Object.assign(headers,{'content-type':'application/json',origin,'x-csrf-token':csrf});const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};}
 const setup=await request('/api/setup','POST',{username:'albums-fixture',password:'Albums-fixture-password-2026'});cookie=setup.cookie;csrf=setup.body.csrfToken;
 const growth=app.store.gameSettings(),editedGrowth=copy(growth.document);editedGrowth.energy.initial=30;const savedGrowth=app.gameSettings.save(growth.revision,editedGrowth,'fixture-editor');
 const before=app.store.draft(app.store.activeDraftId()),loaded=await request('/api/drafts/'+before.id);assert.equal(loaded.status,200);assert.deepEqual(app.store.draft(before.id),before);
 const document=copy(loaded.body.document),free=document.albums.at(-1);free.decorationId=source._private.collection.decorations[0].id;free.milestones=[{id:'custom-first',target:2,coins:7,decorationId:source._private.collection.decorations[1].id}];
 const result=await request('/api/drafts/'+before.id,'PUT',{revision:before.revision,document});assert.equal(result.status,200,JSON.stringify(result.body));
 const configuration=JSON.parse(readFileSync(join(dir,'albums/configuration.json'),'utf8')),exported=configuration.albums.find(album=>album.id===free.id);
 assert.equal(exported.decorationId,free.decorationId);assert.deepEqual(exported.milestones,free.milestones);assert.deepEqual(app.store.gameSettings(),savedGrowth);
 assert.equal((await request('/api/drafts/'+before.id,'PUT',{revision:before.revision,document:before.document})).status,409);
 assert.deepEqual(app.store.gameSettings(),savedGrowth);assert.deepEqual(JSON.parse(readFileSync(join(dir,'albums/configuration.json'),'utf8')),configuration);
});

test('a source fingerprint change without content changes does not report a merge for derived reward IDs',async t=>{
 const {dir,cleanup}=directory(),originalStore=createStore(dir,source),before=originalStore.draft(originalStore.activeDraftId());originalStore.close();
 const incoming={...source,baseline:copy(source.baseline),fingerprint:source.fingerprint+'-metadata-only'};Object.defineProperty(incoming,'_private',{value:source._private});
 const app=createAdminServer({projectRoot,dataDir:dir,source:incoming,appearanceDir:join(dir,'appearances')});
 t.after(async()=>{await app.close();cleanup();});await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'source-only-fixture',password:'Source-only-fixture-password-2026'})});
 assert.equal(setup.status,200);const cookie=setup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const response=await fetch(origin+'/api/drafts/'+before.id,{headers:{cookie}});assert.equal(response.status,200);const loaded=await response.json();
 assert.equal(loaded.sourceNeedsMerge,false);assert.equal(loaded.document.albums[0].milestones[0].id,'milestone-3');
 assert.deepEqual(app.store.draft(before.id),before,'read-time normalization must not persist or change the saved revision');
});
