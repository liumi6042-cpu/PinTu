import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createMobileService} from '../server/mobile-service.mjs';
import {PHOTOS,photoGuidance,gridForDimensions} from '../outputs/mobile/engine.mjs';
import {soloCanAfford,soloNeedsAutoSupply} from '../lib/solo-play.ts';

const rid=()=>randomBytes(16).toString('hex');
const owner='c'.repeat(64);
const photo=PHOTOS.find(p=>{const d=photoGuidance(p.id),g=gridForDimensions(d.width,d.height,48);return p.galleryVisible!==false&&g.count===48;});

test('server: autoSupply defaults on, migrates legacy profiles once, and preserves manual opt-out across restarts',()=>{
 mkdirSync('work',{recursive:true});
 const folder=mkdtempSync(resolve('work/auto-supply-migrate-'));
 const databasePath=resolve(folder,'mobile.sqlite');
 const db=new DatabaseSync(databasePath);
 try{
  // Seed a legacy profile with autoSupply:false before service startup.
  db.exec('CREATE TABLE IF NOT EXISTS mobile_profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
  const legacyId='d'.repeat(64);
  db.prepare('INSERT INTO mobile_profiles VALUES(?,?)').run(legacyId,JSON.stringify({id:legacyId,name:'老玩家',level:5,xp:0,totalXp:50,energy:20,energyAt:1000,giftProgress:0,supply:{energy:1,create:3},autoSupply:false,createdAt:1000,firstRoomId:null,firstRoomCompleted:true,starterSelectionAvailable:false,lastReward:null}));

  let service=createMobileService({shareRewards:false,databasePath,adEnabled:true,now:()=>2000});
  const call=(who,url,body,method)=>service.handle({identity:who,url,method:method??(body?'POST':'GET'),body});

  assert.equal(call(legacyId,'/api/mobile/profile').data.autoSupply,true,'legacy profile migrated to autoSupply=true');
  assert.equal(call(owner,'/api/mobile/profile').data.autoSupply,true,'new profile starts with autoSupply=true');

  // Player manually opts out in Settings.
  assert.equal(call(legacyId,'/api/mobile/profile',{autoSupply:false},'PATCH').data.autoSupply,false);
  service.close();

  // Restart service: migration does not re-enable manually opted-out player.
  service=createMobileService({shareRewards:false,databasePath,adEnabled:true,now:()=>3000});
  assert.equal(service.handle({identity:legacyId,url:'/api/mobile/profile',method:'GET'}).data.autoSupply,false,'explicit opt-out survives restart');
  service.close();
 }finally{
  db.close();rmSync(folder,{recursive:true,force:true});
 }
});

test('server: exhausting energy auto-opens in order (task gift -> ten gift -> stored pack -> invite-refill) and respects opt-out',()=>{
 mkdirSync('work',{recursive:true});
 const folder=mkdtempSync(resolve('work/auto-open-order-'));
 const databasePath=resolve(folder,'mobile.sqlite');
 let now=Date.parse('2026-11-27T12:00:00+08:00');
 const service=createMobileService({shareRewards:false,databasePath,adEnabled:true,now:()=>now,randomInt:min=>min});
 const db=new DatabaseSync(databasePath);
 const call=(url,body,extra={})=>service.handle({identity:owner,url,method:body?'POST':'GET',body,...extra});
 const patch=updates=>{const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);Object.assign(p,updates);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),owner);};
 try{
  call('/api/mobile/profile');
  patch({level:10,xp:0,energy:0,energyAt:now,firstRoomCompleted:true,starterSelectionAvailable:false,autoSupply:true,supply:{energy:1,create:3}});

  // Seed one of each gift type: ten-5 (earlier timestamp to verify priority beats timestamp), cooperation-10, invite-refill.
  const tenId=rid(),taskId=rid(),inviteId=rid();
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(tenId,owner,'ten-5',4,0,'ten:1',now-5000);
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(taskId,owner,'cooperation-10',10,2,'daily:2026-11-27:cooperation-10',now-3000);
  db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(taskId,JSON.stringify({title:'小试身手礼包',energyMin:10,energyMax:10,xp:2,coins:5}));
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(inviteId,owner,'invite-refill',0,3,'invite:friend1',now-1000);
  db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(inviteId,JSON.stringify({title:'补满体力包',effect:'full-energy',energyMin:0,energyMax:0,xp:3,coins:10}));

  assert.equal(call('/api/mobile/profile').data.autoEnergyGiftCount,3);

  const created=call('/api/rooms',{mode:'selected',imageId:photo.id,pieces:48,visibility:'private',requestId:rid()});
  assert.equal(created.status,201);
  const ticket=created.data,auth={authorization:'Bearer '+ticket.token},roomPath='/api/rooms/'+ticket.room.id;
  let room=ticket.room;
  const mergeNext=()=>{
   const group=room.puzzle.groups.find(g=>!g.locked);
   assert.equal(call(roomPath,{type:'claim',groupId:group.id,requestId:rid()},auth).status,200);
   const res=call(roomPath,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},auth);
   if(res.status===200)room=res.data;
   return res;
  };

  // 1st exhaustion: opens task gift (cooperation-10) BEFORE older ten-5 and supply pack.
  const step1=mergeNext();
  assert.equal(step1.status,200);
  assert.equal(step1.data.profile.energy,9,'0 + 10 (task gift) - 1 (merge)');
  assert.equal(step1.data.profile.supply.energy,1,'supply pack untouched');
  assert.equal(step1.data.profile.autoEnergyGiftCount,2);
  assert.deepEqual(step1.data.mobileContribution.autoSupplyUsed,{
   id:taskId,source:'gift',kind:'cooperation-10',title:'小试身手礼包',energy:10,xp:2,coins:5,levels:0,fullEnergy:false,
  });

  // 2nd exhaustion: opens ten-5 gift next.
  patch({energy:0,energyAt:now});
  const step2=mergeNext();
  assert.equal(step2.status,200);
  assert.equal(step2.data.profile.energy,3,'0 + 4 (ten-5) - 1 (merge)');
  assert.equal(step2.data.profile.supply.energy,1,'supply pack still untouched');
  assert.equal(step2.data.mobileContribution.autoSupplyUsed.kind,'ten-5');
  assert.equal(step2.data.mobileContribution.autoSupplyUsed.title,'十格小礼');
  assert.equal(step2.data.mobileContribution.autoSupplyUsed.energy,4);

  // 3rd exhaustion: opens stored supply pack (supply.energy) before invite-refill gift.
  patch({energy:0,energyAt:now});
  const step3=mergeNext();
  assert.equal(step3.status,200);
  assert.equal(step3.data.profile.supply.energy,0);
  assert.equal(step3.data.profile.energy,step3.data.profile.energyCap-1);
  assert.equal(step3.data.mobileContribution.autoSupplyUsed.source,'supply');
  assert.equal(step3.data.mobileContribution.autoSupplyUsed.title,'补满体力包');
  assert.equal(step3.data.mobileContribution.autoSupplyUsed.fullEnergy,true);

  // 4th exhaustion: opens invite-refill gift last.
  patch({energy:0,energyAt:now});
  const step4=mergeNext();
  assert.equal(step4.status,200);
  assert.equal(step4.data.profile.autoEnergyGiftCount,0);
  assert.equal(step4.data.profile.energy,step4.data.profile.energyCap-1);
  assert.equal(step4.data.mobileContribution.autoSupplyUsed.source,'gift');
  assert.equal(step4.data.mobileContribution.autoSupplyUsed.kind,'invite-refill');
  assert.equal(step4.data.mobileContribution.autoSupplyUsed.fullEnergy,true);
  assert.equal(step4.data.mobileContribution.autoSupplyUsed.coins,10);

  // 5th exhaustion: no gifts or packs left -> 402 ENERGY_EMPTY.
  patch({energy:0,energyAt:now});
  const step5=mergeNext();
  assert.equal(step5.status,402);
  assert.equal(step5.data.code,'ENERGY_EMPTY');

  // Verify solo batch auto-opens gifts and reports mobileContributions[].autoSupplyUsed.
  const batchGiftId=rid();
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(batchGiftId,owner,'ten-5',3,0,'ten:2',now);
  patch({energy:0,energyAt:now});
  const batchGroup=room.puzzle.groups.find(g=>!g.locked);
  const batchRes=call(roomPath,{type:'batch',ops:[{requestId:rid(),groupId:batchGroup.id,dx:0,dy:0}]},auth);
  assert.equal(batchRes.status,200);
  assert.equal(batchRes.data.soloBatch.stopped,null);
  assert.equal(batchRes.data.mobileContributions.length,1);
  assert.equal(batchRes.data.mobileContributions[0].autoSupplyUsed.id,batchGiftId);
  assert.equal(batchRes.data.profile.energy,2,'0 + 3 - 1');
  room=batchRes.data;

  // Verify explicit opt-out (autoSupply=false) does NOT open gifts or packs.
  const optOutGift=rid();
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(optOutGift,owner,'ten-5',5,0,'ten:3',now);
  patch({energy:0,energyAt:now,autoSupply:false,supply:{energy:2,create:3}});
  const step6=mergeNext();
  assert.equal(step6.status,402);
  assert.equal(step6.data.code,'ENERGY_EMPTY');
  assert.equal(call('/api/mobile/profile').data.supply.energy,2);
  assert.equal(call('/api/mobile/profile').data.autoEnergyGiftCount,1);
 }finally{
  db.close();service.close();rmSync(folder,{recursive:true,force:true});
 }
});

test('client: solo affordability includes gifts, triggers immediate flush on exhaustion, and GameApp announces toast once',async()=>{
 const base={enabled:true,energy:0,cap:60,cost:1,xp:1,autoSupply:true,supplyEnergy:0,autoGiftCount:3,free:false};
 assert.equal(soloCanAfford(base,0),true,'autoSupply + autoGiftCount allows dropping at 0 energy');
 assert.equal(soloCanAfford({...base,autoSupply:false},0),false);
 assert.equal(soloCanAfford({...base,autoGiftCount:0},0),false);
 assert.equal(soloNeedsAutoSupply(base,1),true,'1 snapped op at 0 energy flushes immediately');
 assert.equal(soloNeedsAutoSupply({...base,energy:2},1),false,'still has energy left');
 assert.equal(soloNeedsAutoSupply({...base,energy:2},3),true,'exceeded local energy -> flush now');

 const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
 const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const notes=[],sounds=[];
 const app=Object.create(GameApp.prototype);
 app.announcedAutoSupplyIds=new Set();
 app.note=text=>notes.push(text);
 app.platform={playSound:url=>sounds.push(url)};
 app.tasks=null;

 app.announceAutoSupply({id:'g1',source:'gift',kind:'cooperation-10',title:'小试身手礼包',energy:10,xp:2,coins:5,fullEnergy:false});
 app.announceAutoSupply({id:'g1',source:'gift',kind:'cooperation-10',title:'小试身手礼包',energy:10,xp:2,coins:5,fullEnergy:false});
 app.announceAutoSupply({id:'s1',source:'supply',kind:'energy',title:'补满体力包',energy:60,xp:0,coins:0,fullEnergy:true});

 assert.equal(notes.length,2,'duplicate id is announced only once');
 assert.equal(notes[0],'体力已用完，已自动开启「小试身手礼包」：体力 +10 · 经验 +2 · 金币 +5');
 assert.equal(notes[1],'体力已用完，已自动使用「补满体力包」，体力已补满');
 assert.equal(sounds.length,1,'coin chime plays when auto-opened gift awards coins');
});
