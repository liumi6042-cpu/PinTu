import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {defaultTaskRewardSettings,validateTaskRewardSettings,buildTaskRewardConfiguration,createTaskRewardSettings,tenGridReward} from '../server/task-reward-settings.mjs';
import {createMobileTasks,TASK_REWARDS,mobileTaskDay} from '../server/mobile-tasks.mjs';
import {applyContribution,newProfile} from '../server/mobile-economy.mjs';
import {createMobileService} from '../server/mobile-service.mjs';

function fixture(){
 mkdirSync(resolve('work'),{recursive:true});const directory=mkdtempSync(resolve('work/task-reward-config-test-')),configurationPath=resolve(directory,'rewards.json');
 let settings=defaultTaskRewardSettings(),now=Date.parse('2026-10-13T04:00:00Z');
 const write=document=>{settings=structuredClone(document);writeFileSync(configurationPath+'.tmp',JSON.stringify(buildTaskRewardConfiguration(settings)));renameSync(configurationPath+'.tmp',configurationPath);};write(settings);
 const loader=createTaskRewardSettings({configurationPath}),db=new DatabaseSync(':memory:'),profiles=new Map();
 const readProfile=owner=>{if(!profiles.has(owner))profiles.set(owner,{...newProfile(owner,now),level:50,totalXp:12000,energy:10});return profiles.get(owner);};
 const tasks=createMobileTasks({db,readProfile,saveProfile:p=>profiles.set(p.id,p),readSettings:()=>loader.read(),areFriends:()=>true});
 const room={id:'fixture-room',members:[{guestId:'owner',lastSeen:now},{guestId:'partner',lastSeen:now}]};
 let sequence=0;const record=(owner,pendingGift)=>{room.members.forEach(member=>member.lastSeen=now);return tasks.record(readProfile(owner),room,'event-'+(++sequence),pendingGift,now,60000);};
 return {db,loader,tasks,room,readProfile,record,write,configurationPath,get settings(){return structuredClone(settings);},get now(){return now;},set now(value){now=value;},close(){db.close();assert.ok(directory.startsWith(resolve('work')+'\\'));rmSync(directory,{recursive:true,force:true});}};
}

test('public defaults preserve every task value and validation rejects unrelated or ambiguous changes',()=>{
 const settings=defaultTaskRewardSettings();assert.deepEqual(settings.tasks,TASK_REWARDS.map(({id,energy,xp})=>({id,energy,xp})));
 assert.deepEqual(settings.invitationShare,{energy:20,xp:10,dailyLimit:3});assert.deepEqual(settings.invitationFriend,{effect:'full-energy',xp:0});
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
