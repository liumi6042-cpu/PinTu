import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createStore} from '../store.mjs';
import {readSource} from '../source.mjs';
import {createTaskRewardCoordinator} from '../task-rewards.mjs';
import {createAdminServer} from '../server.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS,taskRewardConfigurationDigest} from '../../jigsaw-nook-taptap/server/task-reward-settings.mjs';

const projectRoot=resolve(import.meta.dirname,'../..'),source=readSource(projectRoot),copy=structuredClone;
function directory(t){
 const parent=join(projectRoot,'content-admin/work');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'qa-task-rewards-'));
 return {dir,cleanup(){assert.ok(resolve(dir).startsWith(parent+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('task rewards preserve defaults, persist separately from image drafts, and export a public digest',t=>{
 const {dir,cleanup}=directory(t),bridgeDir=join(dir,'bridge');let store=createStore(join(dir,'admin'),source);
 t.after(()=>{store.close();cleanup();});
 let coordinator=createTaskRewardCoordinator({store,bridgeDir,now:()=>123});
 const original=store.draft(store.activeDraftId()),initial=coordinator.sync();
 assert.equal(initial.revision,1);assert.equal(initial.updatedAt,123);assert.deepEqual(initial.document,DEFAULT_TASK_REWARD_SETTINGS);
 const document=copy(initial.document);document.tasks[0].energy=37;document.tasks[0].xp=13;
 document.invitationShare.energy=18;document.tenGrid.energyMaxByTier=[8,10,12];
 const saved=coordinator.save(initial.revision,document,'test-editor');
 assert.equal(saved.revision,2);assert.deepEqual(saved.document,document);
 assert.deepEqual(store.draft(original.id),original,'reward edits must not save or change any album draft');
 assert.equal(store.listAudit().filter(item=>item.action==='save-task-rewards').length,1);
 const bridge=JSON.parse(readFileSync(join(bridgeDir,'configuration.json'),'utf8'));
 const {configDigest,...publicSettings}=bridge;assert.equal(configDigest,taskRewardConfigurationDigest(publicSettings));assert.deepEqual(publicSettings,document);
 for(const forbidden of ['username','password','players','sessions','assets','albums'])assert.equal(Object.hasOwn(bridge,forbidden),false);
 store.close();store=createStore(join(dir,'admin'),source);
 coordinator=createTaskRewardCoordinator({store,bridgeDir,now:()=>456});
 assert.deepEqual(coordinator.sync(),saved,'restarting the CMS must preserve saved values rather than restoring defaults');
});

test('invalid values and a stale task revision cannot partially update saved settings or the game bridge',t=>{
 const {dir,cleanup}=directory(t),store=createStore(join(dir,'admin'),source),bridgeDir=join(dir,'bridge');t.after(()=>{store.close();cleanup();});
 const coordinator=createTaskRewardCoordinator({store,bridgeDir}),initial=coordinator.sync(),bytes=readFileSync(join(bridgeDir,'configuration.json'),'utf8');
 for(const mutate of [
  document=>{document.tasks[0].energy=-1;},document=>{document.tasks[0].xp=1.5;},
  document=>{document.tasks[0].energy='10';},document=>{document.tasks[0].id='cooperation-other';},
  document=>{document.tasks.push(copy(document.tasks[0]));},document=>{document.invitationShare.dailyLimit=0;},
  document=>{document.tenGrid.energyMin=7;document.tenGrid.energyMaxByTier=[5,6,7];},
  document=>{document.invitationFriend.effect='paid-refill';},document=>{document.unexpected=true;},
 ]){
  const document=copy(initial.document);mutate(document);
  assert.throws(()=>coordinator.save(initial.revision,document,'test-editor'),error=>error.code==='INVALID_TASK_REWARDS');
  assert.deepEqual(store.taskRewards(),initial);assert.equal(readFileSync(join(bridgeDir,'configuration.json'),'utf8'),bytes);
 }
 const document=copy(initial.document);document.tasks[1].xp++;
 const saved=coordinator.save(1,document,'test-editor'),savedBytes=readFileSync(join(bridgeDir,'configuration.json'),'utf8');
 assert.throws(()=>coordinator.save(1,initial.document,'stale-editor'),error=>error.status===409&&error.code==='TASK_REWARD_REVISION_CONFLICT');
 assert.deepEqual(store.taskRewards(),saved);assert.equal(readFileSync(join(bridgeDir,'configuration.json'),'utf8'),savedBytes);
});

test('task reward HTTP endpoints require the administrator session and CSRF, and use independent concurrency',async t=>{
 const {dir,cleanup}=directory(t),app=createAdminServer({projectRoot,dataDir:dir,source,appearanceDir:join(dir,'appearances')});
 t.after(async()=>{await app.close();cleanup();});await new Promise(resolveListen=>app.server.listen(0,'127.0.0.1',resolveListen));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(path,method='GET',body,token=csrf){
  const headers={cookie};if(body!==undefined)Object.assign(headers,{'content-type':'application/json',origin,'x-csrf-token':token});
  const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
 }
 assert.equal((await request('/api/task-rewards')).status,401);
 const setup=await request('/api/setup','POST',{username:'rewards-test',password:'Task-rewards-test-password-2026'});assert.equal(setup.status,200);
 cookie=setup.cookie;csrf=setup.body.csrfToken;
 const loaded=await request('/api/task-rewards');assert.equal(loaded.status,200);assert.deepEqual(loaded.body.document,DEFAULT_TASK_REWARD_SETTINGS);
 const draft=app.store.draft(app.store.activeDraftId()),document=copy(loaded.body.document);document.tasks[4].energy=19;
 const body={revision:loaded.body.revision,document};assert.equal((await request('/api/task-rewards','PUT',body,'invalid')).status,403);
 const saved=await request('/api/task-rewards','PUT',body);assert.equal(saved.status,200);assert.equal(saved.body.revision,2);assert.equal(saved.body.document.tasks[4].energy,19);
 assert.equal((await request('/api/task-rewards','PUT',body)).status,409);assert.deepEqual(app.store.draft(draft.id),draft);
});
