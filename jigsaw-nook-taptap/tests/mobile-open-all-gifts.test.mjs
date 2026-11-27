import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({
 stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'node',target:'es2020',
});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=mobile-open-all-gifts-test-bundle.mjs').toString('base64'));

function fixture({inventory,post,energyEnabled=true}={}){
 let rid=0,refreshes=0,sounds=0,milestones=0;
 const posts=[],notes=[],applied=[];
 const app=Object.create(GameApp.prototype);
 Object.defineProperty(app,'energyEnabled',{value:energyEnabled,configurable:true});
 Object.assign(app,{
  busy:false,
  destroyed:false,
  orientationEntryPending:null,
  attempts:new Map(),
  tasks:{inventory,tasks:[],invitation:{code:'ABC',requiredContributions:3,dailyLimit:3,capBonus:0,capBonusMaximum:5}},
  platform:{
   config:{id:'taptap'},
   randomId:()=>'req-'+(++rid),
   playSound:()=>{sounds++;},
  },
  telemetry:{milestone:()=>{milestones++;}},
  client:{
   profile:{level:19,energy:100,energyCap:70,collection:{coins:0,fragments:0}},
   config:{capabilities:{energy:energyEnabled}},
   post:async(path,body)=>{posts.push({path,body});return post(body);},
   refresh:async()=>{refreshes++;},
  },
  applyTasks(data){applied.push(data);},
  checkLevelMilestone(){},
  invalidate(){},
  note:text=>notes.push(text),
 });
 return {app,posts,notes,applied,counts:()=>({refreshes,sounds,milestones})};
}

test('openAllGifts batches a 152-gift stack into 20-item requests, refreshes once, and summarizes total rewards',async()=>{
 const f=fixture({
  inventory:[{kind:'ten-7',title:'十格小礼',count:152,effect:'reward',energyMin:1,energyMax:7,xp:2,coins:3}],
  post:body=>{
   assert.ok(body.quantity>=1&&body.quantity<=20,'each batch obeys server 1..20 limit');
   return {
    opened:{kind:body.kind,quantity:body.quantity,energy:body.quantity*5,xp:body.quantity*2,coins:body.quantity*3},
    inventory:[],tasks:[],invitation:{},
   };
  },
 });

 await f.app.openAllGifts();

 assert.deepEqual(f.posts.map(p=>p.body.quantity),[20,20,20,20,20,20,20,12]);
 assert.equal(new Set(f.posts.map(p=>p.body.requestId)).size,8,'every batch uses a distinct requestId');
 assert.equal(f.app.attempts.size,0,'all completed attempt keys are cleared');
 assert.deepEqual(f.counts(),{refreshes:1,sounds:1,milestones:1});
 assert.deepEqual(f.notes,['已开启 152 份礼包 · 体力 +760 · 经验 +304 · 金币 +456']);
});

test('openAllGifts opens multiple gift types, skips full-energy packs when energy is enabled, and notifies when only full-energy remains',async()=>{
 const f=fixture({
  inventory:[
   {kind:'ten-7',title:'十格小礼',count:25,effect:'reward',energyMin:1,energyMax:7,xp:1,coins:0},
   {kind:'invite-refill',title:'补满体力包',count:3,effect:'full-energy',energyMin:0,energyMax:0,xp:0,coins:0},
   {kind:'coop-10',title:'今日拼合礼',count:4,effect:'reward',energyMin:10,energyMax:10,xp:2,coins:5},
  ],
  post:body=>({
   opened:{kind:body.kind,quantity:body.quantity,energy:body.quantity*2,xp:body.quantity,coins:body.kind==='coop-10'?body.quantity*5:0},
   inventory:[],tasks:[],invitation:{},
  }),
 });

 await f.app.openAllGifts();
 assert.deepEqual(f.posts.map(p=>[p.body.kind,p.body.quantity]),[['ten-7',20],['ten-7',5],['coop-10',4]]);
 assert.deepEqual(f.notes,['已开启 29 份礼包 · 体力 +58 · 经验 +29 · 金币 +20']);

 const onlyRefill=fixture({
  inventory:[{kind:'invite-refill',title:'补满体力包',count:2,effect:'full-energy',energyMin:0,energyMax:0,xp:0,coins:0}],
  post:()=>{throw Error('should not post');},
 });
 await onlyRefill.app.openAllGifts();
 assert.equal(onlyRefill.posts.length,0);
 assert.deepEqual(onlyRefill.notes,['补满体力包请按需单个开启']);
});

test('mid-batch failure refreshes partial rewards and clears 4xx keys while retaining network-error keys for retry',async()=>{
 let call=0;
 const f=fixture({
  inventory:[{kind:'ten-7',title:'十格小礼',count:50,effect:'reward',energyMin:1,energyMax:7,xp:1,coins:2}],
  post:body=>{
   call++;
   if(call===2)throw Object.assign(Error('剩余礼包数量不足，请刷新后重试'),{status:409,code:'GIFT_EMPTY'});
   return {opened:{kind:body.kind,quantity:body.quantity,energy:40,xp:20,coins:10},inventory:[],tasks:[],invitation:{}};
  },
 });

 await f.app.openAllGifts();
 assert.equal(f.posts.length,2);
 assert.equal(f.app.attempts.size,0,'answered 409 clears failed batch key');
 assert.deepEqual(f.counts(),{refreshes:1,sounds:1,milestones:1});
 assert.equal(f.notes[0],'已开启 20 份礼包（体力 +40 · 经验 +20 · 金币 +10），其余中断：剩余礼包数量不足，请刷新后重试');

 // Pure network failure on first batch keeps requestId so retry is idempotent.
 let fail=true;
 const net=fixture({
  inventory:[{kind:'ten-7',title:'十格小礼',count:5,effect:'reward',energyMin:1,energyMax:7,xp:1,coins:0}],
  post:body=>{
   if(fail){fail=false;throw Error('连接超时');}
   return {opened:{kind:body.kind,quantity:body.quantity,energy:10,xp:5,coins:0},inventory:[],tasks:[],invitation:{}};
  },
 });
 await net.app.openGift('ten-7',5);
 assert.equal(net.notes[0],'连接超时');
 assert.equal(net.app.attempts.size,1);
 await net.app.openGift('ten-7',5);
 assert.equal(net.posts[0].body.requestId,net.posts[1].body.requestId,'network retry reuses the same requestId');
 assert.equal(net.app.attempts.size,0);
});
