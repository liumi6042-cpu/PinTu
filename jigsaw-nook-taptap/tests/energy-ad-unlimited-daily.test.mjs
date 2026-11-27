import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createMobileService} from '../server/mobile-service.mjs';
import {ENERGY_AD_DAILY_LIMIT,applyContribution,newProfile} from '../server/mobile-economy.mjs';
import {PHOTOS,photoGuidance,gridForDimensions} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex');
const owner='e'.repeat(64);
const photo=PHOTOS.find(p=>{const d=photoGuidance(p.id),g=gridForDimensions(d.width,d.height,48);return p.galleryVisible!==false&&g.count===48;});

test('economy: applyContribution skips energy cost and autoSupply when unlimitedEnergy is true',()=>{
 const p=newProfile('u',0);
 p.level=5;p.energy=0;p.autoSupply=true;p.supply.energy=2;p.xp=0;p.giftProgress=0;
 const reward=applyContribution(p,{unlimitedEnergy:true,now:100,randomInt:()=>1});
 assert.ok(reward);
 assert.equal(reward.energySpent,0);
 assert.equal(reward.autoUsed,false);
 assert.equal(p.energy,0);
 assert.equal(p.supply.energy,2,'stored packs stay untouched');
 assert.equal(p.xp,1);
 assert.equal(p.giftProgress,1);
});

test('server: 5 energy ads unlock unlimited energy for the Beijing calendar day and reset at midnight',()=>{
 mkdirSync('work',{recursive:true});
 const folder=mkdtempSync(resolve('work/energy-ad-unlimited-'));
 const databasePath=resolve(folder,'mobile.sqlite');
 const at=(hour,minute=0,day=27)=>Date.parse(`2026-11-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`);
 let now=at(10,0,27);
 const service=createMobileService({shareRewards:false,databasePath,adEnabled:true,now:()=>now,randomInt:min=>min});
 const db=new DatabaseSync(databasePath);
 const call=(url,body,extra={})=>service.handle({identity:owner,url,method:body?'POST':'GET',body,...extra});
 const watchEnergyAd=()=>{
  const input={kind:'energy',requestId:rid()};
  const challenge=call('/api/mobile/supply/challenge',input);
  assert.equal(challenge.status,200);
  const redeemInput={...input,rewardToken:challenge.data.rewardToken,completed:true};
  const redeemed=call('/api/mobile/supply/redeem',redeemInput);
  return {input,redeemInput,redeemed};
 };
 try{
  const initial=call('/api/mobile/profile').data;
  assert.deepEqual(initial.energyAdToday,{count:0,limit:ENERGY_AD_DAILY_LIMIT,unlimited:false});
  assert.equal(initial.unlimitedEnergyToday,false);

  // Cancelled / unredeemed ad challenge must NOT count toward the 5-ad daily limit.
  const cancelled={kind:'energy',requestId:rid()};
  const cancelledChallenge=call('/api/mobile/supply/challenge',cancelled);
  assert.equal(cancelledChallenge.status,200);
  assert.equal(call('/api/mobile/supply/cancel',{...cancelled,rewardToken:cancelledChallenge.data.rewardToken}).status,200);
  assert.equal(call('/api/mobile/profile').data.energyAdToday.count,0);

  // Mark first room done so normal merges consume energy.
  const patch=updates=>{const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);Object.assign(p,updates);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),owner);};
  patch({level:5,xp:0,firstRoomCompleted:true,starterSelectionAvailable:false,energy:10,autoSupply:true});

  // Watch 4 energy ads, using each pack after watching so stock stays under 3.
  for(let i=1;i<=4;i++){
   patch({energy:10});
   const {redeemed}=watchEnergyAd();
   assert.equal(redeemed.status,200);
   assert.equal(redeemed.data.supply.energy,1);
   assert.deepEqual(redeemed.data.energyAdToday,{count:i,limit:5,unlimited:false});
   assert.equal(redeemed.data.unlimitedEnergyToday,false);
   const used=call('/api/mobile/supply/use',{kind:'energy',requestId:rid()});
   assert.equal(used.status,200);
   assert.equal(used.data.supply.energy,0);
  }

  // Drop energy to 0 before the 5th ad to verify the 5th ad unlocks unlimited energy and tops up current energy.
  patch({energy:0,autoSupply:true});
  const fifth=watchEnergyAd();
  assert.equal(fifth.redeemed.status,200);
  assert.equal(fifth.redeemed.data.supply.energy,1,'5th ad pack stays stored for tomorrow');
  assert.deepEqual(fifth.redeemed.data.energyAdToday,{count:5,limit:5,unlimited:true});
  assert.equal(fifth.redeemed.data.unlimitedEnergyToday,true);
  assert.equal(fifth.redeemed.data.energy,fifth.redeemed.data.energyCap);

  // Replaying the 5th redeem request remains idempotent.
  const replayFifth=call('/api/mobile/supply/redeem',fifth.redeemInput);
  assert.equal(replayFifth.status,200);
  assert.equal(replayFifth.data.unlimitedEnergyToday,true);
  assert.equal(replayFifth.data.supply.energy,1);

  // 6th energy ad challenge is rejected with ENERGY_UNLIMITED_TODAY.
  const sixth=call('/api/mobile/supply/challenge',{kind:'energy',requestId:rid()});
  assert.equal(sixth.status,409);
  assert.equal(sixth.data.code,'ENERGY_UNLIMITED_TODAY');

  // Using a stored energy pack while unlimited is rejected so packs are preserved for tomorrow.
  patch({energy:0});
  const useBlocked=call('/api/mobile/supply/use',{kind:'energy',requestId:rid()});
  assert.equal(useBlocked.status,409);
  assert.equal(useBlocked.data.code,'ENERGY_UNLIMITED_TODAY');
  assert.equal(call('/api/mobile/profile').data.supply.energy,1);

  // Opening an invite-refill full-energy gift is also rejected while unlimited.
  db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),owner,'invite-refill',0,0,'invite:test',now);
  const openBlocked=call('/api/mobile/gifts/open',{kind:'invite-refill',quantity:1,requestId:rid()});
  assert.equal(openBlocked.status,409);
  assert.equal(openBlocked.data.code,'ENERGY_UNLIMITED_TODAY');

  // Creation ticket ads are unaffected by the energy ad limit.
  patch({supply:{energy:1,create:1}});
  const createInput={kind:'create',requestId:rid()},createChallenge=call('/api/mobile/supply/challenge',createInput);
  assert.equal(createChallenge.status,200);
  const createRedeemed=call('/api/mobile/supply/redeem',{...createInput,rewardToken:createChallenge.data.rewardToken,completed:true});
  assert.equal(createRedeemed.status,200);
  assert.equal(createRedeemed.data.supply.create,3);

  // Merging pieces in a real room consumes 0 energy even when energy=0 and autoSupply=true.
  const roomRes=call('/api/rooms',{mode:'selected',imageId:photo.id,pieces:48,visibility:'private',requestId:rid()});
  assert.equal(roomRes.status,201);
  const ticket=roomRes.data,auth={authorization:'Bearer '+ticket.token},roomPath='/api/rooms/'+ticket.room.id;
  const group=ticket.room.puzzle.groups.find(g=>!g.locked);
  assert.equal(call(roomPath,{type:'claim',groupId:group.id,requestId:rid()},auth).status,200);
  const beforeXp=call('/api/mobile/profile').data.totalXp;
  const merged=call(roomPath,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},auth);
  assert.equal(merged.status,200);
  assert.equal(merged.data.profile.energy,0,'no energy deducted');
  assert.equal(merged.data.profile.supply.energy,1,'autoSupply did not burn stored pack');
  assert.equal(merged.data.profile.totalXp,beforeXp+1,'XP still granted during unlimited energy');

  // Still unlimited at 23:59 Beijing time; resets at 00:00 next Beijing day.
  now=at(23,59,27);
  assert.equal(call('/api/mobile/profile').data.unlimitedEnergyToday,true);

  now=at(0,0,28);
  const nextDay=call('/api/mobile/profile').data;
  assert.deepEqual(nextDay.energyAdToday,{count:0,limit:5,unlimited:false});
  assert.equal(nextDay.unlimitedEnergyToday,false);
  assert.equal(nextDay.supply.energy,1,'pack from yesterday is preserved');

  // Next day: energy ads work again starting from 1/5.
  const nextAd=watchEnergyAd();
  assert.equal(nextAd.redeemed.status,200);
  assert.deepEqual(nextAd.redeemed.data.energyAdToday,{count:1,limit:5,unlimited:false});
  assert.equal(nextAd.redeemed.data.supply.energy,2);
 }finally{
  db.close();service.close();rmSync(folder,{recursive:true,force:true});
 }
});

test('client: 5th energy ad alerts and shows unlimited energy state, blocks extra energy ads, and renders unlimited UI',async()=>{
 const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
 const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const events=[],alerts=[],memory=new Map();
 const profile={code:'123456789',level:5,xp:10,xpToNext:100,energy:20,energyCap:55,newcomer:false,adEligible:true,autoSupply:false,supply:{energy:0,create:3},energyAdToday:{count:3,limit:5,unlimited:false},unlimitedEnergyToday:false};
 const app=Object.create(GameApp.prototype);
 app.run=fn=>fn();
 app.note=(message,permanent)=>events.push(['note',message,Boolean(permanent)]);
 app.platform={
  config:{id:'taptap',apiBase:'https://example.test/h5',gameName:'拼图小窝'},
  randomId:()=>'a'.repeat(32),
  storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},
  watchAd:async unit=>(events.push(['ad',unit]),'completed'),
  alert:message=>alerts.push(message),
  playSound:url=>events.push(['sound',url]),
 };
 app.client={
  profile,
  config:{adRewardEnabled:true,rewardedAdUnitId:'1054324',capabilities:{energy:true,ads:true,createTickets:true}},
  async post(path,body){
   events.push([path,{...body}]);
   if(path.endsWith('/challenge'))return {rewardToken:'b'.repeat(64)};
   if(path.endsWith('/redeem')&&body.kind==='energy'){
    profile.supply.energy++;
    profile.energyAdToday.count++;
    if(profile.energyAdToday.count>=profile.energyAdToday.limit){
     profile.energyAdToday.unlimited=true;
     profile.unlimitedEnergyToday=true;
     profile.energy=profile.energyCap;
    }
   }
   return profile;
  },
  async refresh(){events.push(['refresh']);},
 };

 // 4th ad: progress toast, no alert yet.
 await app.claimSupply('energy');
 assert.equal(profile.energyAdToday.count,4);
 assert.equal(alerts.length,0);
 assert.match(events.filter(e=>e[0]==='note').at(-1)[1],/今日广告 4\/5/);

 // 5th ad: unlocks unlimited energy, fires persistent note + alert dialog.
 await app.claimSupply('energy');
 assert.equal(profile.unlimitedEnergyToday,true);
 assert.equal(alerts.length,1);
 assert.match(alerts[0],/今日无限体力/);
 assert.match(alerts[0],/无限使用/);
 const lastNote=events.filter(e=>e[0]==='note').at(-1);
 assert.match(lastNote[1],/已解锁今日无限体力/);
 assert.equal(lastNote[2],true);

 // 6th attempt: blocked client-side before playing any ad.
 const adsBefore=events.filter(e=>e[0]==='ad').length;
 await assert.rejects(()=>app.claimSupply('energy'),/今日已解锁无限体力/);
 assert.equal(events.filter(e=>e[0]==='ad').length,adsBefore);

 // Rendering TasksPagePanel shows unlimited energy status and disables energy ad & use buttons.
 const buttons=[],texts=[];
 app.stage={w:390,h:844,palette:{ink:'#111',muted:'#666',berry:'#a45',line:'#ddd',cream:'#fff'},ctx:{save(){},restore(){},fillRect(){},set fillStyle(_v){},set globalAlpha(_v){}},measure:t=>String(t).length*10,
  panel(){},frame(){},icon(){},meter(){},hit(){},text:(t)=>texts.push(String(t)),button:(_r,label,_fn,opts)=>buttons.push({label,disabled:Boolean(opts?.disabled)})};
 Object.defineProperties(app,{colors:{value:app.stage.palette},bodyTop:{value:80,writable:true},bodyBottom:{value:800,writable:true},scroll:{value:0,writable:true},extent:{value:0,writable:true}});
 app.tasks={day:'2026-11-27',giftProgress:3,giftMinimum:1,giftMaximum:5,giftXp:0,giftCoins:0,giftCount:0,tasks:[],inventory:[],invitation:{code:'abcdef123456',bound:false,joinedCount:0,qualifiedCount:0,todayRewarded:0,dailyLimit:3,requiredContributions:3,shareDailyLimit:1,todayShared:0}};
 app.scrolled=fn=>fn();app.paragraph=(_t,_x,y)=>y+20;app.giftVisible=()=>true;app.rewardText=()=>'';app.invalidate=()=>{};app.prepareRewardedAd=()=>{};
 app.drawTasksPage();
 assert.ok(texts.some(t=>t.includes('今日无限体力生效中')),'shows unlimited banner in supplies');
 assert.deepEqual(buttons.find(b=>b.label==='今日无限体力'),{label:'今日无限体力',disabled:true});
 assert.deepEqual(buttons.find(b=>b.label==='已无限'),{label:'已无限',disabled:true});
});
