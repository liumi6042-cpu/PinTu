import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {defaultGameSettings} from '../server/game-settings.mjs';
import {newProfile,applyExperience,applyContribution,restoreEnergy,energyCap,xpForLevel,completionDistribution} from '../server/mobile-economy.mjs';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileTasks} from '../server/mobile-tasks.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {GALLERY_VISIBLE_PHOTOS,photoGuidance,gridForDimensions} from '../outputs/mobile/engine.mjs';
const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),now=1800000000000;
const completed=(imageId)=>({id:rid(),completedAt:now,puzzle:{imageId},mobilePieces:48});

test('configured progression, cost, refill modes and recovery preserve existing progress and overflow',()=>{
 const settings=defaultGameSettings();Object.assign(settings.progression,{earlyXp:Array(10).fill(5),laterXpStep:7,laterXpMaximum:40});
 Object.assign(settings.energy,{initial:8,baseCap:10,capPerLevel:2,maximumCap:20,contributionCost:3,contributionXp:5,firstRoomFree:false,upgradeRefill:'none',naturalRecoveryMinutes:2});
 assert.equal(xpForLevel(11,settings),12);assert.equal(xpForLevel(20,settings),40);assert.equal(energyCap(20,settings),20);
 const p=newProfile(owner,0,settings);assert.equal(p.energy,8);
 const reward=applyContribution(p,{now:1,randomInt:min=>min,protectedRoom:true,gameSettings:settings});
 assert.equal(reward.energySpent,3);assert.equal(reward.xp,5);assert.equal(p.level,1);assert.equal(p.energy,5);
 p.energy=2;assert.equal(applyContribution(p,{now:2,randomInt:min=>min,gameSettings:settings}),null);
 p.autoSupply=true;p.supply.energy=1;applyContribution(p,{now:3,randomInt:min=>min,gameSettings:settings});assert.equal(p.energy,9);assert.equal(p.supply.energy,0);
 for(const[mode,expected]of [['none',1],['fixed',4],['full',12]]){
  settings.energy.upgradeRefill=mode;settings.energy.upgradeEnergy=3;const q=newProfile(owner,0,settings);q.energy=1;applyExperience(q,5,1,settings);assert.equal(q.energy,expected);if(mode==='none')assert.equal(q.energyAt,0,'no-refill upgrades retain the recovery clock');
 }
 p.energy=27;restoreEnergy(p,120003,settings);assert.equal(p.energy,27,'lower caps retain awarded overflow');
 p.energy=0;p.energyAt=0;restoreEnergy(p,240001,settings);assert.equal(p.energy,2);
 settings.energy.naturalRecoveryMinutes=0;restoreEnergy(p,900000,settings);assert.equal(p.energy,2);
 p.xp=20;const level=p.level;applyExperience(p,0,900001,settings);assert.equal(p.level,level,'zero XP grants cannot retroactively upgrade after editing thresholds');
 settings.energy.firstRoomFree=true;settings.energy.contributionXp=0;p.energy=0;
 assert.equal(applyContribution(p,{now:900002,protectedRoom:true,randomInt:min=>min,gameSettings:settings}).energySpent,0);
 settings.energy.completionPools[48]=0;assert.deepEqual(completionDistribution({a:3,b:1},48,settings).map(row=>row.energy),[0,0]);
 settings.energy.completionPools[48]=8;assert.equal(completionDistribution({a:3,b:1},48,settings).reduce((sum,row)=>sum+row.energy,0),8);
});

test('collection settings apply to new grants, stable milestones and issued rewards survive edits',()=>{
 const db=new DatabaseSync(':memory:');let settings=defaultGameSettings();const c=createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS,readSettings:()=>settings}),pack=catalog.packs[0];
 try{
  Object.assign(settings.collection,{contributionCoins:4,completionCoinRatio:2,fragmentContributionStep:2,completionFragmentMinimum:0,completionFragmentMaximum:3,catalogMinimumContributions:1});
  const event=rid(),roomId=rid();assert.equal(c.contribution(owner,roomId,event,now),4);
  settings.collection.contributionCoins=9;assert.equal(c.contribution(owner,roomId,event,now),0);assert.equal(c.summary(owner).coins,4);
  settings.milestones[0].target=1;settings.milestones[0].coins=33;
  const room=completed(pack.imageIds[0]),reward=c.complete(owner,room,2,now);assert.equal(reward.coins,4);assert.equal(reward.fragments,1);assert.equal(reward.catalog.albumRewards[0].coins,33);
  settings.milestones[0].target=2;settings.milestones[0].coins=99;settings.collection.completionCoinRatio=10;
  assert.deepEqual(c.complete(owner,room,2,now),reward,'old completion receipt is immutable');
  const next=c.complete(owner,completed(pack.imageIds[1]),2,now);assert.deepEqual(next.catalog.albumRewards,[],'changing threshold keeps original milestone identity');
  const shown=c.view(owner,now).albums[0].milestones[0];assert.equal(shown.earned,true);assert.equal(shown.target,1);assert.equal(shown.coins,33);
  const decor=settings.decorations.find(item=>item.source==='craft');decor.cost=2;db.prepare('UPDATE mobile_collection_wallets SET fragments=10 WHERE owner=?').run(owner);
  c.craft(owner,decor.id,now);decor.enabled=false;decor.cost=100;decor.title='新的装饰名';decor.color='#123456';c.equip(owner,decor.id);
  assert.equal(c.equipped(owner).title,'新的装饰名');assert.equal(c.equipped(owner).color,'#123456');assert.ok(c.view(owner,now).decorations.find(item=>item.id===decor.id).owned);
  const other=settings.decorations.find(item=>item.source==='craft'&&item.id!==decor.id);other.enabled=false;
  assert.throws(()=>c.craft(owner,other.id,now),{code:'DECORATION_DISABLED'});assert.ok(!c.view(owner,now).decorations.some(item=>item.id===other.id));
  const albumDecor=settings.decorations.find(item=>item.id===pack.decorationId);albumDecor.enabled=false;settings.milestones[1].target=3;
  c.complete(owner,completed(pack.imageIds[2]),2,now);assert.equal(c.view(owner,now).decorations.find(item=>item.id===albumDecor.id).owned,true,'hidden shop items can still be earned from albums');
  assert.equal(c.view(owner,now).packs[0].price,pack.price);
 }finally{db.close();}
});

test('legacy milestones migrate their original rewards and never regrant after changing thresholds',()=>{
 const db=new DatabaseSync(':memory:'),pack=catalog.packs[0];let settings=defaultGameSettings();
 createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS});
 db.prepare('INSERT INTO mobile_collection_milestones VALUES(?,?,?,?)').run(owner,pack.id,3,now);
 db.prepare('INSERT INTO mobile_collection_ledger VALUES(?,?,?,?,?)').run(owner,'album:'+pack.id+':3',30,0,now);
 db.prepare('INSERT INTO mobile_collection_wallets VALUES(?,?,?,?)').run(owner,30,0,'berry-spark');
 settings.milestones[0].target=1;settings.milestones[0].coins=500;
 const c=createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS,readSettings:()=>settings});
 try{
  const shown=c.view(owner,now).albums[0].milestones[0];assert.equal(shown.earned,true);assert.equal(shown.target,3);assert.equal(shown.coins,30);
  assert.deepEqual(c.complete(owner,completed(pack.imageIds[0]),3,now).catalog.albumRewards,[]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_milestone_rewards WHERE owner=?').get(owner).n,1);
 }finally{db.close();}
});

test('service pins one configuration per request and does not recalculate existing level or gifts on read',()=>{
 let settings=defaultGameSettings(),reads=0;Object.assign(settings.progression,{earlyXp:Array(10).fill(2),laterXpStep:0,laterXpMaximum:2});Object.assign(settings.energy,{initial:11,upgradeRefill:'fixed',upgradeEnergy:2});
 const service=createMobileService({now:()=>now,gameSettings:{read(){reads++;return settings;}}});
 const call=(identity,url,body)=>service.handle({identity,url,body,method:body?'POST':'GET'});
 try{
  assert.equal(call(owner,'/api/mobile/profile').data.energy,11);const beforeReads=reads,input={requestId:rid()},issued=call(owner,'/api/mobile/invitations/share',input);
  assert.equal(reads,beforeReads+1);assert.equal(issued.data.profile.level,5);assert.equal(issued.data.profile.energy,41);
  settings=defaultGameSettings();Object.assign(settings.energy,{initial:1,baseCap:20,maximumCap:20,capPerLevel:0,naturalRecoveryMinutes:0});settings.progression.earlyXp=Array(10).fill(1);
  const current=call(owner,'/api/mobile/profile').data;assert.equal(current.level,5);assert.equal(current.energy,41);assert.equal(current.energyCap,20);assert.equal(current.naturalRecoveryAt,null);
  assert.equal(call('b'.repeat(64),'/api/mobile/profile').data.energy,1);
  assert.deepEqual(call(owner,'/api/mobile/invitations/share',input),issued);
 }finally{service.close();}
});

test('gift XP and full refill use configured progression and cap while preserving issued fixed amounts',()=>{
 const db=new DatabaseSync(':memory:'),settings=defaultGameSettings();Object.assign(settings.progression,{earlyXp:Array(10).fill(5),laterXpStep:0,laterXpMaximum:5});Object.assign(settings.energy,{baseCap:10,capPerLevel:2,maximumCap:20,upgradeRefill:'none'});
 const p=newProfile(owner,now,settings);p.energy=2;
 const tasks=createMobileTasks({db,readProfile:()=>p,saveProfile:()=>{},readGameSettings:()=>settings});
 try{
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),owner,'invite-refill',0,5,'fixture-refill',now);
  const opened=tasks.open(p,{kind:'invite-refill',quantity:1,requestId:rid()},now);assert.equal(p.level,1);assert.equal(opened.energy,10);assert.equal(p.energy,12);
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),owner,'invite-friend',10,2,'fixture-fixed',now);
  const fixed=tasks.open(p,{kind:'invite-friend',quantity:1,requestId:rid()},now);assert.equal(fixed.energy,10);assert.equal(fixed.xp,2);assert.equal(p.energy,22,'gift overflow is retained');
 }finally{db.close();}
});

test('mixed contribution settings retain exact XP totals in completion and replay receipts',()=>{
 let settings=defaultGameSettings();settings.progression.earlyXp=Array(10).fill(100000);settings.progression.laterXpMaximum=100000;Object.assign(settings.energy,{contributionCost:0,contributionXp:2,firstRoomFree:false,upgradeRefill:'none'});settings.energy.completionPools[48]=0;
 const service=createMobileService({now:()=>now,randomInt:min=>min,gameSettings:{read:()=>settings}}),photo=GALLERY_VISIBLE_PHOTOS.find(item=>{const size=photoGuidance(item.id);return gridForDimensions(size.width,size.height,48).count===48;});
 const call=(url,body,token)=>JSON.parse(JSON.stringify(service.handle({identity:owner,url,body,method:body?'POST':'GET',...(token?{authorization:'Bearer '+token}:{})})));
 try{
  const created=call('/api/rooms',{mode:'selected',imageId:photo.id,pieces:48,visibility:'public',requestId:rid()});assert.equal(created.status,201);
  const ticket=created.data,path='/api/rooms/'+ticket.room.id;let room=ticket.room,totalXp=0,count=0;
  while(room.completedAt===null){
   if(count===10)settings.energy.contributionXp=3;
   const group=room.puzzle.groups.find(item=>!item.locked);assert.equal(call(path,{type:'claim',groupId:group.id,requestId:rid()},ticket.token).status,200);
   const input={type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},result=call(path,input,ticket.token);assert.equal(result.status,200);room=result.data;totalXp+=room.mobileContribution?.creditedXp??0;count++;
   if(count===10){settings.energy.contributionXp=3;assert.deepEqual(call(path,input,ticket.token),result);}
  }
  assert.equal(room.mobileResult.xp,totalXp);assert.equal(room.profile.totalXp,totalXp);assert.equal(room.mobileResult.energy,0);assert.equal(room.mobileResult.contribution,count);
 }finally{service.close();}
});
