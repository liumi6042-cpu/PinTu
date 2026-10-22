import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {defaultTaskRewardSettings,validateTaskRewardSettings,validateTaskRewardConfiguration,taskRewardConfigurationDigest,buildTaskRewardConfiguration,createTaskRewardSettings,tenGridReward} from '../server/task-reward-settings.mjs';
import {createMobileTasks,TASK_REWARDS,mobileTaskDay} from '../server/mobile-tasks.mjs';
import {createMobileCollection} from '../server/mobile-collection.mjs';
import {RESTORABLE_PHOTOS} from '../outputs/mobile/engine.mjs';
import {applyContribution,newProfile} from '../server/mobile-economy.mjs';
import {createMobileService} from '../server/mobile-service.mjs';

function fixture(){
 mkdirSync(resolve('work'),{recursive:true});const directory=mkdtempSync(resolve('work/task-reward-config-test-')),configurationPath=resolve(directory,'rewards.json');
 let settings=defaultTaskRewardSettings(),now=Date.parse('2026-10-13T04:00:00Z');
 const write=document=>{settings=structuredClone(document);writeFileSync(configurationPath+'.tmp',JSON.stringify(buildTaskRewardConfiguration(settings)));renameSync(configurationPath+'.tmp',configurationPath);};write(settings);
 const loader=createTaskRewardSettings({configurationPath}),db=new DatabaseSync(':memory:'),profiles=new Map();
 const readProfile=owner=>{if(!profiles.has(owner))profiles.set(owner,{...newProfile(owner,now),level:50,totalXp:12000,energy:10});return profiles.get(owner);};
 const collection=createMobileCollection({db,photos:RESTORABLE_PHOTOS});
 const tasks=createMobileTasks({db,readProfile,saveProfile:p=>profiles.set(p.id,p),readSettings:()=>loader.read(),areFriends:()=>true,awardCoins:(owner,source,coins,clock)=>collection.awardTaskCoins(owner,source,coins,clock)});
 const room={id:'fixture-room',members:[{guestId:'owner',lastSeen:now},{guestId:'partner',lastSeen:now}]};
 let sequence=0;const record=(owner,pendingGift)=>{room.members.forEach(member=>member.lastSeen=now);return tasks.record(readProfile(owner),room,'event-'+(++sequence),pendingGift,now,60000);};
 return {db,loader,tasks,collection,room,readProfile,record,write,configurationPath,get settings(){return structuredClone(settings);},get now(){return now;},set now(value){now=value;},close(){db.close();assert.ok(directory.startsWith(resolve('work')+'\\'));rmSync(directory,{recursive:true,force:true});}};
}

test('public defaults preserve every task value and validation rejects unrelated or ambiguous changes',()=>{
 const settings=defaultTaskRewardSettings();assert.deepEqual(settings.tasks,TASK_REWARDS.map(({id,energy,xp,coins})=>({id,energy,xp,coins})));
 assert.deepEqual(settings.invitationShare,{energy:20,xp:10,dailyLimit:3,coins:0});assert.deepEqual(settings.invitationFriend,{effect:'full-energy',xp:0,coins:0});
 assert.deepEqual([0,20,50].map(level=>tenGridReward(settings,level).energyMax),[5,6,7]);
 for(const mutate of [s=>s.tasks.push(s.tasks[0]),s=>s.tasks[0].energy=-1,s=>s.tasks[0].xp=1.5,s=>s.invitationFriend.effect='fixed',s=>s.invitationShare.dailyLimit=21,s=>s.tenGrid.energyMin=0,s=>s.tenGrid.energyMaxByTier[1]=0,s=>s.privateKey='forbidden']){const changed=structuredClone(settings);mutate(changed);assert.throws(()=>validateTaskRewardSettings(changed),error=>error.code==='INVALID_TASK_REWARDS');}
});

test('a running service loads new rewards immediately but request replay retains its original receipt',()=>{
 const f=fixture(),identity='a'.repeat(64);let service;
 try{
  service=createMobileService({databasePath:':memory:',now:()=>f.now,taskRewardConfigurationPath:f.configurationPath});
  const call=requestId=>service.handle({identity,method:'POST',url:'/api/mobile/invitations/share',body:{requestId}});
  const first=call('1'.repeat(32));assert.equal(first.status,200);assert.equal(first.data.shared.energy,20);assert.equal(first.data.shared.xp,10);
  const next=f.settings;next.invitationShare={energy:43,xp:17,dailyLimit:5};f.write(next);
  const second=call('2'.repeat(32));assert.equal(second.data.shared.energy,43);assert.equal(second.data.shared.xp,17);assert.equal(second.data.invitation.shareDailyLimit,5);assert.deepEqual(call('1'.repeat(32)),first);
  const invalid={...buildTaskRewardConfiguration(next),configDigest:'0'.repeat(64)};writeFileSync(f.configurationPath,JSON.stringify(invalid));assert.equal(call('3'.repeat(32)).data.code,'TASK_REWARDS_UNAVAILABLE');
  f.write(next);assert.equal(call('3'.repeat(32)).data.shared.energy,43);assert.equal(call('3'.repeat(32)).data.invitation.todayShared,3);
 }finally{service?.close();f.close();}
});

test('same-day milestones cannot regrant after settings change and old/new inventories keep issued amounts',()=>{
 const f=fixture();try{
  const owner=f.readProfile('owner');f.db.prepare('INSERT INTO mobile_task_daily VALUES(?,?,9,0)').run(owner.id,mobileTaskDay(f.now));f.record('partner');f.record('owner');
  const issued=f.db.prepare("SELECT energy,xp FROM mobile_task_gifts WHERE owner=? AND kind='cooperation-10'").get(owner.id);assert.deepEqual({...issued},{energy:10,xp:2});
  const next=f.settings;next.tasks[0]={id:'cooperation-10',energy:25,xp:9};f.write(next);f.record('owner');
  const earned=f.tasks.view(owner,f.now).tasks.find(task=>task.id==='cooperation-10');assert.equal(earned.energy,10);assert.equal(earned.xp,2);assert.equal(earned.earned,true);assert.equal(f.tasks.view(owner,f.now).inventory.find(gift=>gift.kind==='cooperation-10').energyMin,10);
  const unearned=f.tasks.view(f.readProfile('new-player'),f.now).tasks.find(task=>task.id==='cooperation-10');assert.equal(unearned.energy,25);assert.equal(unearned.xp,9);assert.equal(unearned.earned,false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND kind='cooperation-10'").get(owner.id).n,1);
  f.now+=86400000;f.db.prepare('INSERT INTO mobile_task_daily VALUES(?,?,9,0)').run(owner.id,mobileTaskDay(f.now));f.record('partner');f.record('owner');
  const mixed=f.tasks.view(owner,f.now).inventory.find(gift=>gift.kind==='cooperation-10');assert.equal(mixed.energyMin,10);assert.equal(mixed.energyMax,25);assert.equal(mixed.xpMin,2);assert.equal(mixed.xpMax,9);
  const opened=f.tasks.open(owner,{kind:'cooperation-10',quantity:2,requestId:'open-fixture'},f.now);assert.equal(opened.energy,35);assert.equal(opened.xp,11);assert.equal(owner.totalXp,12011);
 }finally{f.close();}
});

test('ten-grid gifts use the current tier range and XP once but keep their issue-time reward after editing',()=>{
 const f=fixture();try{
  const settings=f.settings;settings.tenGrid={energyMin:3,energyMaxByTier:[9,11,13],xp:4};f.write(settings);
  const owner=f.readProfile('owner');owner.giftProgress=9;
  const reward=applyContribution(owner,{protectedRoom:true,now:f.now,randomInt:(min,max)=>max-1,taskRewards:f.loader.read()});assert.equal(reward.pendingGift.energy,13);assert.equal(reward.pendingGift.maximum,7);f.record(owner.id,reward.pendingGift);
  const next=f.settings;next.tenGrid={energyMin:1,energyMaxByTier:[5,6,7],xp:99};f.write(next);
  const view=f.tasks.view(owner,f.now),gift=view.inventory.find(gift=>gift.kind==='ten-7');assert.equal(view.giftMaximum,7);assert.equal(view.giftMinimum,1);assert.equal(view.giftXp,99);assert.equal(gift.energyMin,3);assert.equal(gift.energyMax,13);assert.equal(gift.xp,4);
  const opened=f.tasks.open(owner,{kind:'ten-7',quantity:1,requestId:'open-fixture'},f.now);assert.equal(opened.energy,13);assert.equal(opened.xp,4);assert.equal(owner.giftProgress,0);
 }finally{f.close();}
});

test('invitation refill XP is captured when issued and old refill gifts still restore with their old XP',()=>{
 const f=fixture();try{
  const owner=f.readProfile('owner'),code=f.tasks.view(owner,f.now).invitation.code;
  const qualify=invitee=>{const profile=f.readProfile(invitee);f.tasks.accept(profile,{code},f.now);for(let index=0;index<3;index++)f.record(invitee);};qualify('first-invitee');
  const next=f.settings;next.invitationFriend.xp=13;f.write(next);f.now++;qualify('second-invitee');
  const gift=f.tasks.view(owner,f.now).inventory.find(gift=>gift.kind==='invite-refill');assert.equal(gift.xpMin,0);assert.equal(gift.xpMax,13);
  const old=f.tasks.open(owner,{kind:'invite-refill',quantity:1,requestId:'first-open'},f.now);assert.equal(old.xp,0);assert.equal(old.energy,90);assert.equal(owner.energy,100);
  owner.energy=10;const latest=f.tasks.open(owner,{kind:'invite-refill',quantity:1,requestId:'second-open'},f.now);assert.equal(latest.xp,13);assert.equal(latest.energy,90);assert.equal(owner.energy,100);assert.equal(owner.totalXp,12013);
 }finally{f.close();}
});

test('optional task coins preserve legacy digests and are validated before normalization',()=>{
 const legacy=defaultTaskRewardSettings();
 for(const task of legacy.tasks)delete task.coins;
 for(const key of ['invitationShare','invitationFriend','tenGrid'])delete legacy[key].coins;
 const oldConfiguration={...legacy,configDigest:taskRewardConfigurationDigest(legacy)},normalized=validateTaskRewardConfiguration(oldConfiguration);
 assert.ok(normalized.tasks.every(task=>task.coins===0));
 for(const key of ['invitationShare','invitationFriend','tenGrid'])assert.equal(normalized[key].coins,0);
 assert.equal(validateTaskRewardConfiguration(buildTaskRewardConfiguration(legacy)).tenGrid.coins,0);
 const mixed=structuredClone(legacy);mixed.tasks[0].coins=17;mixed.invitationShare.coins=23;
 const normalizedMixed=validateTaskRewardConfiguration({...mixed,configDigest:taskRewardConfigurationDigest(mixed)});
 assert.equal(normalizedMixed.tasks[0].coins,17);assert.equal(normalizedMixed.invitationShare.coins,23);assert.equal(normalizedMixed.invitationFriend.coins,0);
 for(const change of [config=>config.tasks[0].coins=1,config=>config.tenGrid.coins=1]){
  const tampered=structuredClone(oldConfiguration);change(tampered);assert.throws(()=>validateTaskRewardConfiguration(tampered),{code:'INVALID_TASK_REWARDS'});
 }
 for(const value of [-1,1.5,100001,null,'3'])for(const key of ['tasks','invitationShare','invitationFriend','tenGrid']){
  const bad=defaultTaskRewardSettings();(key==='tasks'?bad.tasks[0]:bad[key]).coins=value;
  assert.throws(()=>validateTaskRewardSettings(bad),{code:'INVALID_TASK_REWARDS'});
 }
 const boundary=defaultTaskRewardSettings();boundary.tasks[0].coins=100000;assert.equal(validateTaskRewardSettings(boundary).tasks[0].coins,100000);
});

test('mixed task inventories retain issue-time coins and never backfill legacy gifts',()=>{
 const f=fixture();try{
  const settings=f.settings;settings.tasks[0].coins=12;f.write(settings);
  const owner=f.readProfile('owner'),legacyId='0'.repeat(32);
  f.db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(legacyId,owner.id,'cooperation-10',5,1,'legacy-fixed',f.now-1);
  f.db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(legacyId,JSON.stringify({title:'伙伴初遇礼包',energyMin:5,energyMax:5,xp:1}));
  f.db.prepare('INSERT INTO mobile_task_daily VALUES(?,?,9,0)').run(owner.id,mobileTaskDay(f.now));f.record('partner');f.record(owner.id);
  const gift=f.tasks.view(owner,f.now).inventory.find(item=>item.kind==='cooperation-10');assert.equal(gift.coinsMin,0);assert.equal(gift.coinsMax,12);
  const next=f.settings;next.tasks[0].coins=99;f.write(next);f.record(owner.id);
  assert.equal(f.tasks.view(owner,f.now).tasks.find(item=>item.id==='cooperation-10').coins,12);
  const opened=f.tasks.open(owner,{kind:'cooperation-10',quantity:2,requestId:'mixed-open'},f.now);
  assert.equal(opened.coins,12);assert.equal(opened.energy,15);assert.equal(opened.xp,3);assert.equal(f.collection.summary(owner.id,f.now).coins,12);
  assert.equal(f.collection.awardTaskCoins(owner.id,'gift:'+legacyId,99,f.now),0,'zero historical award is not upgraded retroactively');
  assert.equal(f.collection.summary(owner.id,f.now).coins,12);
  assert.throws(()=>f.tasks.open(owner,{kind:'cooperation-10',quantity:1,requestId:'empty-open'},f.now),{code:'GIFT_EMPTY'});
 }finally{f.close();}
});

test('ten-grid and invited-friend gifts freeze configured coins before later edits',()=>{
 const f=fixture();try{
  const settings=f.settings;settings.tenGrid.coins=7;settings.invitationFriend.coins=19;f.write(settings);
  const owner=f.readProfile('owner');owner.giftProgress=9;
  const contribution=applyContribution(owner,{protectedRoom:true,now:f.now,randomInt:(_min,max)=>max-1,taskRewards:f.loader.read()});assert.equal(contribution.pendingGift.coins,7);f.record(owner.id,contribution.pendingGift);
  const invitee=f.readProfile('new-invitee');f.tasks.accept(invitee,{code:f.tasks.view(owner,f.now).invitation.code},f.now);for(let index=0;index<3;index++)f.record(invitee.id);
  const next=f.settings;next.tenGrid.coins=70;next.invitationFriend.coins=190;f.write(next);
  const view=f.tasks.view(owner,f.now);assert.equal(view.giftCoins,70);assert.equal(view.inventory.find(item=>item.kind==='ten-7').coins,7);assert.equal(view.inventory.find(item=>item.kind==='invite-refill').coins,19);
  const tiny=f.tasks.open(owner,{kind:'ten-7',quantity:1,requestId:'ten-open'},f.now);assert.equal(tiny.coins,7);
  owner.energy=10;const refill=f.tasks.open(owner,{kind:'invite-refill',quantity:1,requestId:'refill-open'},f.now);assert.equal(refill.coins,19);assert.equal(refill.energy,90);assert.equal(f.collection.summary(owner.id,f.now).coins,26);
 }finally{f.close();}
});

test('task coin grants share the collection ledger and transaction rollback preserves all grants',()=>{
 const f=fixture();try{
  const settings=f.settings;settings.invitationShare.coins=21;f.write(settings);const owner=f.readProfile('owner'),before=structuredClone(owner);
  f.db.exec('BEGIN IMMEDIATE');
  const shared=f.tasks.share(owner,{requestId:'rollback-share'},f.now);assert.equal(shared.coins,21);assert.equal(f.collection.summary(owner.id,f.now).coins,21);
  f.db.exec('ROLLBACK');Object.assign(owner,before);
  assert.equal(f.collection.summary(owner.id,f.now).coins,0);assert.equal(f.tasks.view(owner,f.now).invitation.todayShared,0);
  const retried=f.tasks.share(owner,{requestId:'rollback-share'},f.now);assert.equal(retried.coins,21);
  assert.equal(f.collection.awardTaskCoins(owner.id,'share:rollback-share',400,f.now),0);assert.equal(f.collection.summary(owner.id,f.now).coins,21);
  assert.equal(f.db.prepare("SELECT COUNT(*) count FROM mobile_collection_ledger WHERE source LIKE 'task:%'").get().count,1);
 }finally{f.close();}
});
