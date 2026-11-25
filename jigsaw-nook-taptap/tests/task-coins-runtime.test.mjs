import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {defaultTaskRewardSettings} from '../server/task-reward-settings.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='c'.repeat(64),now=Date.parse('2026-10-13T04:00:00Z');
function fixture(){
 mkdirSync(resolve('work'),{recursive:true});const directory=mkdtempSync(resolve('work/task-coins-runtime-')),databasePath=resolve(directory,'mobile.sqlite');
 let settings=defaultTaskRewardSettings();settings.invitationShare.coins=23;settings.tasks[0].coins=17;
 const options={databasePath,now:()=>now,taskRewardSettings:{read:()=>settings}};
 let service=createMobileService(options);const db=new DatabaseSync(databasePath);
 const call=(url,body)=>service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body});
 const ok=(url,body)=>{const result=call(url,body);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
 const profile=ok('/api/mobile/profile');
 const seed=(kind,coins,withMetadata=true)=>{const id=rid();db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(id,owner,kind,10,2,'fixture:'+id,now);if(withMetadata)db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(id,JSON.stringify({title:'测试礼包',energyMin:10,energyMax:10,xp:2,coins}));return id;};
 return{db,call,ok,seed,profile,get settings(){return settings;},set settings(value){settings=value;},restart(){service.close();service=createMobileService(options);},close(){db.close();service.close();assert.ok(directory.startsWith(resolve('work')+'\\'));rmSync(directory,{recursive:true,force:true});}};
}

test('service share coins use the collection wallet and retain exact replay across settings and restart',()=>{
 const f=fixture();try{
  const input={requestId:rid(),shared:true},first=f.ok('/api/mobile/invitations/share',input);assert.equal(first.shared.coins,23);assert.equal(first.profile.collection.coins,23);assert.equal(first.profile.lastReward.coins,23);
  f.settings.invitationShare.coins=41;assert.deepEqual(f.ok('/api/mobile/invitations/share',input),first);
  const second=f.ok('/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.equal(second.shared.coins,41);assert.equal(second.profile.collection.coins,64);
  f.restart();assert.deepEqual(f.ok('/api/mobile/invitations/share',input),first);assert.equal(f.ok('/api/mobile/profile').collection.coins,64);
  f.ok('/api/mobile/invitations/share',{requestId:rid(),shared:true});const capped=f.ok('/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.equal(capped.shared.coins,0);assert.equal(capped.profile.collection.coins,105);
 }finally{f.close();}
});

test('service opens mixed legacy and new coin gifts once without taking current configuration amounts',()=>{
 const f=fixture();try{
  f.seed('cooperation-10',0,false);f.seed('cooperation-10',17);f.settings.tasks[0].coins=99;
  const input={kind:'cooperation-10',quantity:2,requestId:rid()},opened=f.ok('/api/mobile/gifts/open',input);assert.equal(opened.opened.coins,17);assert.equal(opened.opened.energy,20);assert.equal(opened.opened.xp,4);assert.equal(opened.profile.collection.coins,17);
  f.restart();assert.deepEqual(f.ok('/api/mobile/gifts/open',input),opened);assert.equal(f.ok('/api/mobile/profile').collection.coins,17);assert.equal(f.call('/api/mobile/gifts/open',{...input,requestId:rid()}).data.code,'GIFT_EMPTY');
  assert.equal(f.db.prepare("SELECT COUNT(*) count FROM mobile_collection_ledger WHERE owner=? AND source LIKE 'task:gift:%'").get(owner).count,2);
 }finally{f.close();}
});

test('service wallet failure rolls back gift consumption, experience and request receipt together',()=>{
 const f=fixture();try{
  f.seed('cooperation-10',17);const before=f.ok('/api/mobile/profile'),input={kind:'cooperation-10',quantity:1,requestId:rid()};
  f.db.exec("CREATE TRIGGER deny_task_coin_award BEFORE INSERT ON mobile_collection_ledger WHEN NEW.source LIKE 'task:%' BEGIN SELECT RAISE(ABORT,'fixture coin failure'); END");
  assert.equal(f.call('/api/mobile/gifts/open',input).status,500);const after=f.ok('/api/mobile/profile');assert.equal(after.totalXp,before.totalXp);assert.equal(after.energy,before.energy);assert.equal(after.giftCount,1);assert.equal(after.collection.coins,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM mobile_requests WHERE owner=? AND request_id=?').get(owner,input.requestId).count,0);
  f.db.exec('DROP TRIGGER deny_task_coin_award');const retried=f.ok('/api/mobile/gifts/open',input);assert.equal(retried.opened.coins,17);assert.equal(retried.profile.giftCount,0);assert.equal(retried.profile.collection.coins,17);
 }finally{f.close();}
});

test('legacy share replay lacking coins is returned unchanged and never receives configured new coins',()=>{
 const f=fixture();try{
  const input={requestId:rid()},legacy={shared:{energy:20,xp:10,levels:2,alreadyRewarded:false}},hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  f.db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)').run(owner,'invitation-share',input.requestId,hash,JSON.stringify(legacy),now);
  assert.deepEqual(f.ok('/api/mobile/invitations/share',input),legacy);assert.equal(f.ok('/api/mobile/profile').collection.coins,0);
 }finally{f.close();}
});
