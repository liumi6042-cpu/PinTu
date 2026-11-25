import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createAdminServer} from '../server.mjs';
import {readSource} from '../source.mjs';
import {readManagedRelease} from '../contracts/content-release.mjs';

const projectRoot=resolve(import.meta.dirname,'../..'),work=join(projectRoot,'content-admin/work'),source=readSource(projectRoot);
const configuration={schema:'jigsaw-publish-transport/v1',host:'fixture-host',remoteRoot:'/srv/sites/jigsaw-content',targets:[
 {id:'web',healthUrl:'http://127.0.0.1:3010/healthz',preflightCommand:['/usr/bin/node','/fixture/private/web.mjs']},
 {id:'mobile',healthUrl:'http://127.0.0.1:3011/healthz',preflightCommand:['/usr/bin/node','/fixture/private/mobile.mjs']},
]};
function receipt(release){return {schema:'jigsaw-content-publish-receipt/v1',releaseId:release.manifest.releaseId,ok:true,phase:'active',targets:['web','mobile'].map(id=>({id,ok:true,contentReleaseId:release.manifest.releaseId})),rollback:{attempted:false}};}
async function fixture(t,publisher){
 mkdirSync(work,{recursive:true});const directory=mkdtempSync(join(work,'qa-release-api-'));
 const app=createAdminServer({projectRoot,source,dataDir:directory,appearanceDir:join(directory,'appearances'),publisher});
 t.after(async()=>{await app.close();assert.ok(resolve(directory).startsWith(work+sep));rmSync(directory,{recursive:true});});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(path,method='GET',body,options={}){
  const headers=options.auth===false?{}:{cookie};if(body!==undefined)Object.assign(headers,{'content-type':'application/json',origin,...(options.csrf===false?{}:{'x-csrf-token':csrf})});
  const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};
 }
 const setup=await request('/api/setup','POST',{username:'release-fixture',password:'Release-Fixture-Password-2026'});assert.equal(setup.status,200);
 cookie=setup.cookies.map(value=>value.split(';')[0]).join('; ');csrf=setup.body.csrfToken;
 const saved=()=>({draft:app.store.draft(app.store.activeDraftId()),game:app.store.gameSettings(),tasks:app.store.taskRewards()});
 return {directory,app,request,saved,configure(){writeFileSync(join(directory,'publish-config.json'),JSON.stringify(configuration));}};
}

test('release routes require session and CSRF; preview only uses saved data and missing connection never activates',async t=>{
 let calls=0;const {directory,app,request,saved}=await fixture(t,async release=>{calls++;return receipt(release);});
 const before=saved();
 assert.equal((await request('/api/releases/status','GET',undefined,{auth:false})).status,401);
 assert.equal((await request('/api/releases/prepare','POST',{}, {csrf:false})).status,403);
 assert.equal((await request('/api/releases/prepare','POST',{releaseDir:'C:/private'})).status,400);
 assert.equal((await request('/api/releases/status?path=C:/private')).status,400);
 const status=await request('/api/releases/status');assert.equal(status.status,200);assert.equal(status.body.configured,false);assert.equal(status.body.current,null);
 const preview=await request('/api/releases/prepare','POST',{});assert.equal(preview.status,201,JSON.stringify(preview.body));
 assert.deepEqual(preview.body.sourceVersions,{draftId:before.draft.id,draftRevision:before.draft.revision,gameRevision:before.game.revision,taskRevision:before.tasks.revision});
 assert.equal(preview.body.summary.albumCount,before.draft.document.albums.length);assert.equal(preview.body.summary.pendingImageCount,source.assets.filter(asset=>asset.lifecycle==='pending'&&!asset.runtimeAvailable).length);
 assert.equal(preview.body.files.length,5);assert.equal(readManagedRelease(join(directory,'content-releases')),null);
 const confirmation={releaseId:preview.body.releaseId,manifestSha256:preview.body.manifestSha256};
 const noConfig=await request('/api/releases/confirm','POST',confirmation);assert.equal(noConfig.status,503);assert.equal(noConfig.body.code,'PUBLISH_NOT_CONFIGURED');assert.equal(calls,0);
 assert.deepEqual(saved(),before,'previews and failed confirmation never replace saved albums, growth or rewards');
 assert.equal((await request('/api/releases/confirm','POST',{...confirmation,host:'arbitrary-host'})).status,400);
 writeFileSync(join(directory,'publish-config.json'),'{"private":"C:/private/key","host":');
 const invalidStatus=await request('/api/releases/status');assert.equal(invalidStatus.body.configured,false);assert.doesNotMatch(JSON.stringify(invalidStatus.body),/C:\/private|publish-config\.json/);
 const invalid=await request('/api/releases/confirm','POST',confirmation);assert.equal(invalid.status,503);assert.equal(invalid.body.code,'INVALID_PUBLISH_CONFIG');assert.equal(calls,0);
 assert.equal(app.releases!==undefined,true);
});

test('API confirmation rejects stale edits, activates both targets, and preserves safe failure receipts with the last published version',async t=>{
 let calls=0,fail=false;
 const {directory,request,saved,app,configure}=await fixture(t,async(release,config)=>{
  calls++;assert.equal(config.host,configuration.host);
  if(fail){const error=Object.assign(new Error('/fixture/private/failed-key'),{code:'PUBLISH_PREFLIGHT_FAILED',receipt:{...receipt(release),ok:false,phase:'preflight',code:'PUBLISH_PREFLIGHT_FAILED',message:'/fixture/private/token',privatePath:'/fixture/private/key',targets:[{id:'web',ok:true,stderr:'/fixture/private/web'},{id:'mobile',ok:false,stderr:'/fixture/private/mobile'}]}});throw error;}
  return {...receipt(release),privatePath:'/fixture/private/key',message:'/fixture/private/token'};
 });
 configure();assert.equal((await request('/api/releases/status')).body.configured,true);
 const first=(await request('/api/releases/prepare','POST',{})).body;
 const edited=structuredClone(app.store.gameSettings().document);edited.energy.initial=29;
 const growth=await request('/api/game-settings','PUT',{revision:app.store.gameSettings().revision,document:edited});assert.equal(growth.status,200);
 const stale=await request('/api/releases/confirm','POST',{releaseId:first.releaseId,manifestSha256:first.manifestSha256});assert.equal(stale.status,409);assert.equal(stale.body.code,'CONTENT_SOURCE_CHANGED');assert.equal(calls,0);
 const prepared=(await request('/api/releases/prepare','POST',{})).body,before=saved();
 const confirmed=await request('/api/releases/confirm','POST',{releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256});assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
 assert.equal(confirmed.body.targets.targets.length,2);assert.equal(confirmed.body.targets.targets.every(item=>item.ok),true);assert.doesNotMatch(JSON.stringify(confirmed.body),/fixture\/private|privatePath/);
 assert.equal(readManagedRelease(join(directory,'content-releases')).manifest.releaseId,prepared.releaseId);assert.deepEqual(saved(),before);
 const second=(await request('/api/releases/prepare','POST',{})).body;fail=true;
 const failed=await request('/api/releases/confirm','POST',{releaseId:second.releaseId,manifestSha256:second.manifestSha256});assert.equal(failed.status,503);assert.equal(failed.body.receipt.targets.find(item=>item.id==='mobile').ok,false);assert.doesNotMatch(JSON.stringify(failed.body),/fixture\/private|privatePath|stderr/);
 const state=(await request('/api/releases/status')).body;assert.equal(state.current.releaseId,prepared.releaseId);assert.equal(state.lastPublish.releaseId,prepared.releaseId);
 assert.equal(state.audits.findLast(item=>item.kind==='failed').receipt.targets.find(item=>item.id==='mobile').ok,false);assert.doesNotMatch(JSON.stringify(state),/fixture\/private|privatePath|stderr|publish-config\.json/);
 assert.deepEqual(saved(),before);assert.equal(calls,2);
});

test('edits made while publishing remain a newer saved draft while the confirmed release stays pinned',async t=>{
 let saveDuringPublish;
 const {directory,request,app,configure}=await fixture(t,async release=>{saveDuringPublish();return receipt(release);});configure();
 const prepared=(await request('/api/releases/prepare','POST',{})).body,gameBefore=app.store.gameSettings();
 saveDuringPublish=()=>{const next=structuredClone(gameBefore.document);next.energy.initial=17;app.gameSettings.save(gameBefore.revision,next,'fixture-editor');};
 const result=await request('/api/releases/confirm','POST',{releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256});assert.equal(result.status,200);
 const active=readManagedRelease(join(directory,'content-releases'));assert.equal(active.documents.gameSettings.energy.initial,gameBefore.document.energy.initial);
 assert.equal(app.store.gameSettings().document.energy.initial,17);assert.equal(app.store.gameSettings().revision,gameBefore.revision+1);
 assert.equal(JSON.parse(readFileSync(join(directory,'game-settings/configuration.json'),'utf8')).energy.initial,17);
});
