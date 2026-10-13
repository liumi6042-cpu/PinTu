import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createStore} from '../store.mjs';
import {readSource} from '../source.mjs';
import {createTaskRewardCoordinator} from '../task-rewards.mjs';
import {renderTaskRewards,readTaskRewardForm,updateTaskRewardInput} from '../public/task-rewards-ui.js';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../../jigsaw-nook-taptap/server/task-reward-settings.mjs';

const projectRoot=resolve(import.meta.dirname,'../..'),source=readSource(projectRoot),copy=structuredClone;
const legacyDocument=()=>{const document=copy(DEFAULT_TASK_REWARD_SETTINGS);for(const task of document.tasks)delete task.coins;for(const key of ['invitationShare','invitationFriend','tenGrid'])delete document[key].coins;return document;};
function fixture(t){
 const parent=join(projectRoot,'content-admin/work');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'qa-task-coins-'));
 const store=createStore(join(dir,'admin'),source);t.after(()=>{store.close();assert.ok(resolve(dir).startsWith(parent+sep));rmSync(dir,{recursive:true});});
 return {store,dir,bridgeDir:join(dir,'task-rewards')};
}

test('shared coin fields default to zero in the read view while legacy saved rewards and revision remain byte-identical',t=>{
 const {store,bridgeDir}=fixture(t),legacy=legacyDocument();legacy.tasks[0].energy=37;legacy.tasks[0].xp=7;legacy.tenGrid.energyMaxByTier=[8,10,12];
 store.initializeTaskRewards(legacy,123);const before=store.db.prepare("SELECT revision,document,updated_at FROM task_reward_settings WHERE id='current'").get();
 const coordinator=createTaskRewardCoordinator({store,bridgeDir}),loaded=coordinator.sync();
 assert.equal(loaded.revision,before.revision);assert.equal(loaded.document.tasks[0].energy,37);assert.equal(loaded.document.tasks[0].xp,7);
 for(const task of loaded.document.tasks)assert.equal(task.coins,0);
 for(const key of ['invitationShare','invitationFriend','tenGrid'])assert.equal(loaded.document[key].coins,0);
 assert.deepEqual(store.db.prepare("SELECT revision,document,updated_at FROM task_reward_settings WHERE id='current'").get(),before);
 const configuration=JSON.parse(readFileSync(join(bridgeDir,'configuration.json'),'utf8'));assert.equal(configuration.tasks[0].coins,0);assert.equal(configuration.tasks[0].energy,37);
});

test('coins save with the shared rewards without changing energy, XP or albums; invalid coin values and stale saves do not partially apply',t=>{
 const {store,bridgeDir}=fixture(t),legacy=legacyDocument();legacy.invitationShare.xp=13;store.initializeTaskRewards(legacy,123);
 const coordinator=createTaskRewardCoordinator({store,bridgeDir}),initial=coordinator.sync(),album=store.draft(store.activeDraftId());
 const document=copy(initial.document);document.tasks.forEach((task,index)=>{task.coins=index+1;});document.invitationShare.coins=25;document.invitationFriend.coins=30;document.tenGrid.coins=4;
 const saved=coordinator.save(initial.revision,document,'coin-fixture');assert.deepEqual(saved.document,document);assert.deepEqual(store.draft(album.id),album);
 for(let index=0;index<legacy.tasks.length;index++){assert.equal(saved.document.tasks[index].energy,legacy.tasks[index].energy);assert.equal(saved.document.tasks[index].xp,legacy.tasks[index].xp);}
 assert.equal(saved.document.invitationShare.xp,13);assert.deepEqual(saved.document.tenGrid.energyMaxByTier,legacy.tenGrid.energyMaxByTier);
 const bytes=readFileSync(join(bridgeDir,'configuration.json'),'utf8');
 for(const value of [-1,0.5,'3',100001]){const invalid=copy(document);invalid.tasks[0].coins=value;assert.throws(()=>coordinator.save(saved.revision,invalid,'invalid-fixture'),error=>error.code==='INVALID_TASK_REWARDS');assert.deepEqual(store.taskRewards(),saved);assert.equal(readFileSync(join(bridgeDir,'configuration.json'),'utf8'),bytes);}
 assert.throws(()=>coordinator.save(initial.revision,initial.document,'stale-fixture'),error=>error.code==='TASK_REWARD_REVISION_CONFLICT');assert.deepEqual(store.taskRewards(),saved);
});

test('task form includes every shared coin field and preserves old energy and experience values',()=>{
 const document=legacyDocument(),before=copy(document),html=renderTaskRewards({document,dirty:true});
 const fields=[...document.tasks.map(task=>task.id+'-coins'),'share-coins','friend-coins','ten-coins'];
 for(const name of fields)assert.match(html,new RegExp('name="'+name+'"[^>]*value="0"'));
 assert.match(html,/网页与小程序共用金币和经验奖励/);assert.match(html,/体力只在小程序使用/);
 document.tasks.forEach((task,index)=>updateTaskRewardInput(document,task.id+'-coins',String(index+1)));
 updateTaskRewardInput(document,'share-coins','11');updateTaskRewardInput(document,'friend-coins','12');updateTaskRewardInput(document,'ten-coins','13');
 for(let index=0;index<document.tasks.length;index++){assert.equal(document.tasks[index].energy,before.tasks[index].energy);assert.equal(document.tasks[index].xp,before.tasks[index].xp);}
 const rendered=renderTaskRewards({document}),values=new Map([...rendered.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"/g)].map(match=>[match[1],match[2]]));
 const OriginalFormData=globalThis.FormData;globalThis.FormData=class{constructor(form){this.form=form;}get(name){return this.form.get(name);}};
 try{assert.deepEqual(readTaskRewardForm(values),document);}finally{globalThis.FormData=OriginalFormData;}
});

test('same-revision old browser saves retain missing coin fields while explicit zero still clears them',t=>{
 const {store,bridgeDir}=fixture(t),coordinator=createTaskRewardCoordinator({store,bridgeDir}),initial=coordinator.sync(),configured=copy(initial.document);
 configured.tasks.forEach((task,index)=>{task.coins=10+index;});configured.invitationShare.coins=21;configured.invitationFriend.coins=22;configured.tenGrid.coins=23;
 const saved=coordinator.save(initial.revision,configured,'new-browser-fixture'),oldBrowser=copy(saved.document);
 for(const task of oldBrowser.tasks)delete task.coins;for(const key of ['invitationShare','invitationFriend','tenGrid'])delete oldBrowser[key].coins;
 oldBrowser.tasks[0].xp++;const retained=coordinator.save(saved.revision,oldBrowser,'old-browser-fixture');
 assert.deepEqual(retained.document.tasks.map(task=>task.coins),[10,11,12,13,14]);
 for(const key of ['invitationShare','invitationFriend','tenGrid'])assert.equal(retained.document[key].coins,configured[key].coins);
 assert.equal(retained.document.tasks[0].xp,saved.document.tasks[0].xp+1);assert.equal(Object.hasOwn(oldBrowser.tasks[0],'coins'),false,'the submitted object remains unchanged');
 const clear=copy(retained.document);clear.tasks[0].coins=0;clear.invitationShare.coins=0;clear.invitationFriend.coins=0;clear.tenGrid.coins=0;
 const cleared=coordinator.save(retained.revision,clear,'explicit-zero-fixture');assert.equal(cleared.document.tasks[0].coins,0);
 for(const key of ['invitationShare','invitationFriend','tenGrid'])assert.equal(cleared.document[key].coins,0);
 assert.throws(()=>coordinator.save(saved.revision,oldBrowser,'stale-browser-fixture'),error=>error.code==='TASK_REWARD_REVISION_CONFLICT');assert.deepEqual(store.taskRewards(),cleared);
});
