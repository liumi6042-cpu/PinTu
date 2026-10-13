import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {join,resolve,sep} from 'node:path';
import {createStore} from '../store.mjs';
import {readSource} from '../source.mjs';
import {createGameSettingsCoordinator} from '../game-settings.mjs';
import {createTaskRewardCoordinator} from '../task-rewards.mjs';
import {createAdminServer} from '../server.mjs';
import {DEFAULT_GAME_SETTINGS,gameConfigurationDigest} from '../../jigsaw-nook-taptap/server/game-settings.mjs';

const projectRoot=resolve(import.meta.dirname,'../..'),source=readSource(projectRoot),copy=structuredClone;
function directory(){
 const parent=join(projectRoot,'content-admin/work');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'qa-game-settings-'));
 return {dir,cleanup(){assert.ok(resolve(dir).startsWith(parent+sep));rmSync(dir,{recursive:true,force:true});}};
}
test('game settings persist independently from albums and tasks, with public atomic export',t=>{
 const {dir,cleanup}=directory(),bridgeDir=join(dir,'bridge');let store=createStore(join(dir,'admin'),source);t.after(()=>{store.close();cleanup();});
 createTaskRewardCoordinator({store,bridgeDir:join(dir,'task-bridge')}).sync();const tasks=store.taskRewards();
 let coordinator=createGameSettingsCoordinator({store,bridgeDir,now:()=>123});const draft=store.draft(store.activeDraftId()),initial=coordinator.sync();
 assert.equal(initial.revision,1);assert.equal(initial.updatedAt,123);assert.deepEqual(initial.document,DEFAULT_GAME_SETTINGS);
 const document=copy(initial.document);document.energy.upgradeRefill='none';document.progression.earlyXp=[5,10,20,30,40,50,60,70,80,90];
 document.decorations[1].cost=50;document.decorations[3].enabled=false;
 const saved=coordinator.save(1,document,'fixture-editor');assert.equal(saved.revision,2);assert.deepEqual(saved.document,document);
 assert.deepEqual(store.draft(draft.id),draft);assert.deepEqual(store.taskRewards(),tasks);
 const bridge=JSON.parse(readFileSync(join(bridgeDir,'configuration.json'),'utf8')),{configDigest,...publicValues}=bridge;
 assert.equal(configDigest,gameConfigurationDigest(publicValues));assert.deepEqual(publicValues,document);
 assert.equal(store.listAudit().filter(item=>item.action==='save-game-settings').length,1);
 for(const key of ['username','password','players','sessions','assets','albums'])assert.equal(Object.hasOwn(bridge,key),false);
 store.close();store=createStore(join(dir,'admin'),source);coordinator=createGameSettingsCoordinator({store,bridgeDir,now:()=>456});assert.deepEqual(coordinator.sync(),saved);
});
test('invalid configuration and stale revisions preserve saved settings and bridge bytes',t=>{
 const {dir,cleanup}=directory(),store=createStore(join(dir,'admin'),source),bridgeDir=join(dir,'bridge');t.after(()=>{store.close();cleanup();});
 const coordinator=createGameSettingsCoordinator({store,bridgeDir}),initial=coordinator.sync(),originalBytes=readFileSync(join(bridgeDir,'configuration.json'),'utf8');
 const invalid=copy(initial.document);invalid.energy.maximumCap=20;
 assert.throws(()=>coordinator.save(1,invalid,'fixture-editor'),error=>error.code==='INVALID_GAME_SETTINGS');assert.deepEqual(store.gameSettings(),initial);assert.equal(readFileSync(join(bridgeDir,'configuration.json'),'utf8'),originalBytes);
 const document=copy(initial.document);document.energy.upgradeRefill='fixed';document.energy.upgradeEnergy=5;const saved=coordinator.save(1,document,'fixture-editor'),bytes=readFileSync(join(bridgeDir,'configuration.json'),'utf8');
 assert.throws(()=>coordinator.save(1,initial.document,'stale-editor'),error=>error.status===409&&error.code==='GAME_SETTINGS_REVISION_CONFLICT');assert.deepEqual(store.gameSettings(),saved);assert.equal(readFileSync(join(bridgeDir,'configuration.json'),'utf8'),bytes);
});
test('game settings HTTP access requires session and CSRF, and does not save album drafts',async t=>{
 const {dir,cleanup}=directory(),app=createAdminServer({projectRoot,dataDir:dir,source,appearanceDir:join(dir,'appearances')});
 t.after(async()=>{await app.close();cleanup();});await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(path,method='GET',body,token=csrf){
  const headers={cookie};if(body!==undefined)Object.assign(headers,{'content-type':'application/json',origin,'x-csrf-token':token});
  // OS-selected test ports may be browser-blocked ports; exercise the local
  // HTTP server directly rather than applying fetch's browser port blacklist.
  return new Promise((done,reject)=>{
   const req=httpRequest(origin+path,{method,headers},response=>{
    let bytes='';response.setEncoding('utf8');response.on('data',part=>{bytes+=part;});response.on('error',reject);
    response.on('end',()=>{try{done({status:response.statusCode,body:JSON.parse(bytes),cookie:(response.headers['set-cookie']??[]).map(value=>value.split(';')[0]).join('; ')});}catch(error){reject(error);}});
   });
   req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
 }
 assert.equal((await request('/api/game-settings')).status,401);
 const setup=await request('/api/setup','POST',{username:'game-settings-fixture',password:'Game-settings-fixture-password-2026'});assert.equal(setup.status,200);cookie=setup.cookie;csrf=setup.body.csrfToken;
 const loaded=await request('/api/game-settings');assert.equal(loaded.status,200);assert.deepEqual(loaded.body.document,DEFAULT_GAME_SETTINGS);
 const boot=await request('/api/bootstrap');assert.deepEqual(boot.body.gameSettings,loaded.body);
 const draft=app.store.draft(app.store.activeDraftId()),document=copy(loaded.body.document);document.energy.contributionCost=2;
 const body={revision:loaded.body.revision,document};assert.equal((await request('/api/game-settings','PUT',body,'invalid')).status,403);
 const saved=await request('/api/game-settings','PUT',body);assert.equal(saved.status,200);assert.equal(saved.body.revision,2);assert.equal(saved.body.document.energy.contributionCost,2);
 assert.equal((await request('/api/game-settings','PUT',body)).status,409);assert.deepEqual(app.store.draft(draft.id),draft);
});
