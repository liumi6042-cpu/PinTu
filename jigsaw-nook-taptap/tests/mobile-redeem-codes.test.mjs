import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {normalizeRedeemCode,generateRedeemCode,parseBeijingTime,readRedeemRewards,REDEEM_CODE_ALPHABET} from '../server/mobile-redeem.mjs';
import seedFile from '../config/redeem-codes.json' with {type:'json'};

const root=fileURLToPath(new URL('..',import.meta.url));
const rid=()=>randomBytes(16).toString('hex'),person=()=>randomBytes(32).toString('hex'),HOUR=3600000;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const seeds=codes=>({schema:'jigsaw-redeem-codes/v1',codes});
// Removed once every test has closed its services (Windows keeps open SQLite files locked).
const tempDirs=[];after(()=>{for(const dir of tempDirs)rmSync(dir,{recursive:true,force:true});});
const tempDir=()=>{const dir=mkdtempSync(join(tmpdir(),'jigsaw-redeem-'));tempDirs.push(dir);return dir;};

function fixture(t,codes,options={}){
 let now=Date.parse('2026-11-02T08:00:00Z');
 const service=createMobileService({now:()=>now,randomInt:min=>min,redeemSeeds:seeds(codes),...options});
 t.after(()=>service.close());
 const redeem=(owner,code,requestId=rid())=>service.handle({identity:owner,url:'/api/mobile/redeem',method:'POST',body:{code,requestId}});
 const ok=(owner,code,requestId)=>{const response=redeem(owner,code,requestId);assert.equal(response.status,200,JSON.stringify(response));return response.data;};
 const denied=(owner,code,status,errorCode)=>{const response=redeem(owner,code);assert.equal(response.status,status,JSON.stringify(response));assert.equal(response.data.code,errorCode);assert.equal(typeof response.data.error,'string');return response.data;};
 const profile=owner=>service.handle({identity:owner,url:'/api/mobile/profile',method:'GET'}).data;
 const collection=owner=>service.handle({identity:owner,url:'/api/mobile/collection',method:'GET'}).data;
 return {service,redeem,ok,denied,profile,collection,set:value=>{now=typeof value==='string'?Date.parse(value):value;},advance:ms=>{now+=ms;},now:()=>now};
}

test('codes are normalized (case, spaces, dashes, full-width) and generated without 0 O 1 I L',()=>{
 assert.equal(normalizeRedeemCode('  ab12-cd34 '),'AB12CD34');
 assert.equal(normalizeRedeemCode('ab 12\tcd—34'),'AB12CD34');
 assert.equal(normalizeRedeemCode('ＡＢ１２－ｃｄ３４'),'AB12CD34');
 assert.equal(normalizeRedeemCode('ab　12'),'AB12');
 assert.equal(normalizeRedeemCode(null),'');assert.equal(normalizeRedeemCode(1234),'');
 assert.equal(REDEEM_CODE_ALPHABET.length,31);assert.ok(!/[01OIL]/.test(REDEEM_CODE_ALPHABET));
 for(const length of [8,9,10])for(let i=0;i<200;i++){const code=generateRedeemCode(length);assert.equal(code.length,length);assert.match(code,/^[2-9A-HJKMNP-Z]+$/);}
 assert.throws(()=>generateRedeemCode(7));assert.throws(()=>generateRedeemCode(11));
 assert.equal(parseBeijingTime('2026-12-31 23:59',{end:true}),Date.parse('2026-12-31T23:59:59.999+08:00'));
 assert.equal(parseBeijingTime('2026-12-31',{end:true}),Date.parse('2026-12-31T23:59:59.999+08:00'));
 assert.equal(parseBeijingTime('2026-11-03 20:00'),Date.parse('2026-11-03T20:00:00+08:00'));
 assert.throws(()=>parseBeijingTime('2026-02-30'));assert.throws(()=>parseBeijingTime('tomorrow'));
 assert.throws(()=>readRedeemRewards({}));assert.throws(()=>readRedeemRewards({coins:-1}));assert.throws(()=>readRedeemRewards({energyPacks:4}));
 assert.throws(()=>readRedeemRewards({gems:5}));assert.throws(()=>readRedeemRewards({decorations:['a','a']}));assert.throws(()=>readRedeemRewards({decorations:['a',{id:'a',ifOwned:{fragments:1}}]}));
 assert.throws(()=>readRedeemRewards({decorations:[{id:'a',ifOwned:{}}]}));assert.throws(()=>readRedeemRewards({decorations:[{id:'a',ifOwned:{energy:5}}]}));assert.throws(()=>readRedeemRewards({decorations:[{id:'a',extra:1}]}));
 assert.deepEqual(readRedeemRewards({fragments:20,coins:0,decorations:['b',{id:'a',ifOwned:{fragments:20,coins:0}}]}),{fragments:20,decorations:['b',{id:'a',ifOwned:{fragments:20}}]});
 assert.throws(()=>readRedeemRewards({decorations:['nope']},{decorationIds:new Set(['cat-paw'])}));
});

test('the shipped group code: 8 safe characters, 50 energy + 猫爪 (20 碎片 if owned), once per account, no cap, never expires',t=>{
 assert.equal(seedFile.codes.length,1);
 const [seed]=seedFile.codes;
 assert.match(seed.code,/^[2-9A-HJKMNP-Z]{8}$/);
 assert.deepEqual({kind:seed.kind,rewards:seed.rewards,maxUses:seed.maxUses,startsAt:seed.startsAt,expiresAt:seed.expiresAt},{kind:'shared',rewards:{energy:50,decorations:[{id:'cat-paw',ifOwned:{fragments:20}}]},maxUses:undefined,startsAt:undefined,expiresAt:undefined});
 let now=Date.parse('2026-11-02T08:00:00Z');
 // The shipped file plus one extra code that hands out 猫爪 first, for the already-owned branch.
 const service=createMobileService({now:()=>now,randomInt:min=>min,redeemSeeds:seeds([...seedFile.codes,{code:'PAWFIRST',rewards:{decorations:['cat-paw']}}])});t.after(()=>service.close());
 const redeem=(owner,code)=>service.handle({identity:owner,url:'/api/mobile/redeem',method:'POST',body:{code,requestId:rid()}});
 const profile=owner=>service.handle({identity:owner,url:'/api/mobile/profile',method:'GET'}).data;
 const players=Array.from({length:4},person);
 for(const owner of players){
  const before=profile(owner).energy,response=redeem(owner,seed.code.toLowerCase());
  assert.equal(response.status,200,JSON.stringify(response));
  const {redeemed}=response.data;
  assert.deepEqual({energy:redeemed.energy,coins:redeemed.coins,fragments:redeemed.fragments},{energy:50,coins:0,fragments:0});
  assert.deepEqual(redeemed.decorations.map(item=>[item.id,item.title,item.status,item.fallback]),[['cat-paw','猫爪','granted',undefined]]);
  assert.equal(response.data.profile.energy,before+50);assert.equal(response.data.profile.collection.fragments,0);
 }
 const owner=person();
 assert.equal(redeem(owner,'PAWFIRST').data.redeemed.decorations[0].status,'granted');
 const fallback=redeem(owner,seed.code);
 assert.equal(fallback.status,200);
 assert.deepEqual({energy:fallback.data.redeemed.energy,fragments:fallback.data.redeemed.fragments},{energy:50,fragments:20});
 assert.deepEqual(fallback.data.redeemed.decorations.map(item=>[item.id,item.status,item.fallback]),[['cat-paw','owned',{coins:0,fragments:20}]]);
 assert.equal(fallback.data.profile.collection.fragments,20);
 assert.equal(redeem(players[0],seed.code).data.code,'REDEEM_ALREADY_CLAIMED');
 assert.equal(profile(players[0]).collection.fragments,0,'a repeat never pays the fallback');
 now=Date.parse('2030-06-01T00:00:00+08:00');assert.equal(redeem(person(),seed.code).status,200,'the group code never expires');
});

test('a shared code works once per account, counts uses and replays the same request without paying twice',t=>{
 const f=fixture(t,[{code:'GROUP2026',kind:'shared',rewards:{coins:120}}]),a=person(),b=person();
 const requestId=rid(),first=f.ok(a,'group-2026',requestId);
 assert.deepEqual(first.redeemed,{code:'GROUP2026',coins:120,fragments:0,energy:0,energyPacks:0,energyPacksSkipped:0,decorations:[]});
 assert.equal(first.profile.collection.coins,120);
 assert.deepEqual(f.ok(a,'group-2026',requestId),first,'the same request id replays the stored reply');
 assert.equal(f.profile(a).collection.coins,120);
 f.denied(a,'GROUP2026',409,'REDEEM_ALREADY_CLAIMED');
 assert.equal(f.profile(a).collection.coins,120);
 assert.equal(f.ok(b,'GROUP2026').redeemed.coins,120);
 assert.equal(f.redeem(a,'OTHER999',requestId).data.code,'REQUEST_CONFLICT');
});

test('a total cap stops a shared code; single-use codes go to the first account only',t=>{
 const f=fixture(t,[{code:'CAPPED22',kind:'shared',maxUses:2,rewards:{coins:10}},{code:'SINGLE7XK2',kind:'single',rewards:{coins:500}}]);
 const [a,b,c]=[person(),person(),person()];
 f.ok(a,'CAPPED22');f.ok(b,'CAPPED22');
 assert.match(f.denied(c,'CAPPED22',409,'REDEEM_CODE_USED_UP').error,/领完/);
 f.denied(a,'CAPPED22',409,'REDEEM_ALREADY_CLAIMED');
 assert.equal(f.ok(a,'single7xk2').redeemed.coins,500);
 assert.match(f.denied(b,'SINGLE7XK2',409,'REDEEM_CODE_USED_UP').error,/使用过/);
 f.denied(a,'SINGLE7XK2',409,'REDEEM_ALREADY_CLAIMED');
 assert.equal(f.profile(b).collection.coins,10);
});

test('start and expiry follow Beijing time; unknown and disabled codes are rejected',t=>{
 const f=fixture(t,[{code:'LATER333',rewards:{coins:5},startsAt:'2026-11-03 20:00',expiresAt:'2026-11-05 23:59'},{code:'OFF44444',rewards:{coins:5}}]),a=person();
 f.set('2026-11-03T19:59:59+08:00');
 assert.match(f.denied(a,'LATER333',409,'REDEEM_CODE_NOT_STARTED').error,/11月3日 20:00/);
 f.set('2026-11-03T20:00:00+08:00');f.ok(a,'LATER333');
 f.set('2026-11-05T23:59:59+08:00');f.ok(person(),'LATER333');
 f.set('2026-11-06T00:00:00+08:00');f.denied(person(),'LATER333',409,'REDEEM_CODE_EXPIRED');
 f.denied(a,'NOSUCH99',404,'REDEEM_CODE_NOT_FOUND');
 f.denied(a,'!!',404,'REDEEM_CODE_NOT_FOUND');
 f.denied(a,'   ',400,'REDEEM_CODE_REQUIRED');
 const missingId=f.service.handle({identity:a,url:'/api/mobile/redeem',method:'POST',body:{code:'OFF44444'}});
 assert.equal(missingId.data.code,'REQUEST_ID_REQUIRED');
});

test('disabled codes stay disabled across restarts; seeds never overwrite existing rows',t=>{
 const dir=tempDir(t),databasePath=join(dir,'mobile.sqlite'),codes=[{code:'OFF44444',rewards:{coins:5}},{code:'KEEP5555',rewards:{coins:5},maxUses:3}];
 const first=createMobileService({databasePath,redeemSeeds:seeds(codes)});
 const a=person(),call=(service,owner,code)=>service.handle({identity:owner,url:'/api/mobile/redeem',method:'POST',body:{code,requestId:rid()}});
 assert.equal(call(first,a,'KEEP5555').status,200);first.close();
 const db=new DatabaseSync(databasePath);db.prepare("UPDATE mobile_redeem_codes SET disabled=1 WHERE code='OFF44444'").run();db.close();
 const second=createMobileService({databasePath,redeemSeeds:seeds(codes.map(code=>({...code,rewards:{coins:999}})))});t.after(()=>second.close());
 const denied=call(second,person(),'OFF44444');assert.equal(denied.status,409);assert.equal(denied.data.code,'REDEEM_CODE_DISABLED');
 const again=call(second,person(),'KEEP5555');assert.equal(again.status,200);assert.equal(again.data.redeemed.coins,5);
 const check=new DatabaseSync(databasePath,{readOnly:true});t.after(()=>check.close());
 assert.equal(check.prepare("SELECT uses FROM mobile_redeem_codes WHERE code='KEEP5555'").get().uses,2);
});

test('ten failed attempts an hour lock an account out of redeeming, then it recovers',t=>{
 const f=fixture(t,[{code:'GOOD8888',rewards:{coins:1}},{code:'TAKEN999',kind:'single',rewards:{coins:1}}]),a=person(),b=person();
 f.ok(b,'TAKEN999');
 for(let i=0;i<4;i++)f.denied(a,'WRONG'+i+'AAA',404,'REDEEM_CODE_NOT_FOUND');
 f.denied(a,'',400,'REDEEM_CODE_REQUIRED');
 f.advance(10*60000);
 for(let i=0;i<5;i++)f.denied(a,'TAKEN999',409,'REDEEM_CODE_USED_UP');
 f.denied(a,'WRONG9AAA',404,'REDEEM_CODE_NOT_FOUND');
 assert.match(f.denied(a,'GOOD8888',429,'REDEEM_RATE_LIMIT').error,/50 分钟后/);
 assert.equal(f.ok(b,'GOOD8888').redeemed.coins,1,'other accounts are not affected');
 f.advance(50*60000);
 assert.equal(f.ok(a,'GOOD8888').redeemed.coins,1,'the first failures left the window');
});

test('every reward type: coins and 碎片 through the ledger, energy above the cap, packs up to 3, decorations with owned fallbacks',t=>{
 const dir=tempDir(t),databasePath=join(dir,'mobile.sqlite');
 const f=fixture(t,[
  {code:'ALLREWARD',rewards:{coins:50,fragments:7,energy:200,energyPacks:2,decorations:['cat-paw',{id:'cream-bow',ifOwned:{coins:30}},'berry-spark','gone-thing']}},
  {code:'MOREPACKS',rewards:{energyPacks:3,decorations:['cream-bow',{id:'cat-paw',ifOwned:{coins:5,fragments:20}},{id:'honey-star',ifOwned:{fragments:4}}]}},
 ],{databasePath}),a=person();
 const before=f.profile(a);
 const {redeemed,profile}=f.ok(a,'ALLREWARD');
 assert.deepEqual({coins:redeemed.coins,fragments:redeemed.fragments,energy:redeemed.energy,energyPacks:redeemed.energyPacks,energyPacksSkipped:redeemed.energyPacksSkipped},{coins:50,fragments:7,energy:200,energyPacks:2,energyPacksSkipped:0});
 assert.deepEqual(redeemed.decorations.map(item=>[item.id,item.status,item.fallback]),[['cat-paw','granted',undefined],['cream-bow','granted',undefined],['berry-spark','unavailable',undefined],['gone-thing','unavailable',undefined]]);
 assert.equal(redeemed.decorations[0].title,'猫爪');
 assert.equal(profile.collection.coins,50);assert.equal(profile.collection.fragments,7);
 assert.equal(profile.energy,before.energy+200);assert.ok(profile.energy>profile.energyCap);
 assert.equal(profile.supply.energy,2);
 const decorations=f.collection(a).decorations;
 assert.equal(decorations.find(item=>item.id==='cat-paw')?.owned,true);assert.equal(decorations.find(item=>item.id==='cream-bow')?.owned,true);
 const more=f.ok(a,'MOREPACKS').redeemed;
 assert.deepEqual([more.energyPacks,more.energyPacksSkipped],[1,2]);
 // Owned -> fallback; a retired decoration also falls back; a plain id already owned just reports it.
 assert.deepEqual(more.decorations.map(item=>[item.id,item.status,item.fallback]),[['cream-bow','owned',undefined],['cat-paw','owned',{coins:5,fragments:20}],['honey-star','unavailable',{coins:0,fragments:4}]]);
 assert.deepEqual([more.coins,more.fragments],[5,24]);
 const after=f.profile(a);
 assert.equal(after.supply.energy,3);assert.equal(after.collection.coins,55);assert.equal(after.collection.fragments,31);
 // Each code pays coins and 碎片 as one ledger entry, like every other wallet source.
 const db=new DatabaseSync(databasePath,{readOnly:true});t.after(()=>db.close());
 assert.deepEqual(db.prepare("SELECT source,coins,fragments FROM mobile_collection_ledger WHERE owner=? AND source LIKE 'redeem:%' ORDER BY source").all(a).map(row=>({...row})),[{source:'redeem:ALLREWARD',coins:50,fragments:7},{source:'redeem:MOREPACKS',coins:5,fragments:24}]);
 assert.equal(JSON.parse(db.prepare("SELECT rewards FROM mobile_redeem_claims WHERE code='MOREPACKS'").get().rewards).fragments,24);
 const equipped=f.service.handle({identity:a,url:'/api/mobile/collection/equip',method:'POST',body:{decorationId:'cat-paw',requestId:rid()}});
 assert.equal(equipped.status,200);assert.equal(equipped.data.equipped.id,'cat-paw');
});

test('the endpoint is mobile-only and has a kill switch; it works through the H5 gateway session',async t=>{
 const off=fixture(t,[{code:'GOOD8888',rewards:{coins:1}}],{redeem:false});
 off.denied(person(),'GOOD8888',503,'REDEEM_DISABLED');
 const web=fixture(t,[{code:'GOOD8888',rewards:{coins:1}}],{runtimeProfile:'web'});
 assert.equal(web.redeem(person(),'GOOD8888').status,404);
 const f=fixture(t,[{code:'GATE2026',rewards:{coins:30}}]);
 const gateway=createH5Gateway({mobileService:{...f.service,close(){}},databasePath:':memory:',upstream:'http://127.0.0.1:1',allowedOrigins:['https://ma-h5-al.tapimg.com']}),base=await listen(gateway);
 try{
  const origin={Origin:'https://ma-h5-al.tapimg.com'};
  const {token}=await (await fetch(base+'/h5/session',{method:'POST',headers:{...origin,'Content-Type':'application/json'},body:'{}'})).json();
  const post=body=>fetch(base+'/h5/api/mobile/redeem',{method:'POST',headers:{...origin,'X-Jigsaw-H5-Session':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post({code:'gate 2026',requestId:rid()}),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.redeemed.coins,30);assert.equal(data.profile.collection.coins,30);
  const again=await post({code:'GATE2026',requestId:rid()});assert.equal(again.status,409);assert.equal((await again.json()).error,'你已经兑换过这个兑换码啦');
 }finally{await new Promise(resolve=>gateway.close(resolve));}
});

// Two service processes' worth of connections on one database file, released at the same instant.
const raceWorker=`
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const {createMobileService}=await import(workerData.serviceUrl);
 const service=createMobileService({databasePath:workerData.databasePath,now:()=>workerData.now,redeemSeeds:workerData.seeds,deferDailyStart:true});
 const gate=new Int32Array(workerData.gate);Atomics.add(gate,0,1);Atomics.notify(gate,0);
 while(Atomics.load(gate,1)===0)Atomics.wait(gate,1,0,20);
 const results=workerData.calls.map(call=>service.handle({identity:call.owner,url:'/api/mobile/redeem',method:'POST',body:{code:call.code,requestId:call.requestId}}));
 service.close();
 parentPort.postMessage(results.map(r=>({status:r.status,code:r.data.code??null,coins:r.data.redeemed?.coins??null})));
})().catch(error=>parentPort.postMessage({error:String(error&&error.stack||error)}));`;

test('simultaneous submits from two connections never double-credit or overspend a code',async t=>{
 const dir=tempDir(t),databasePath=join(dir,'mobile.sqlite'),now=Date.parse('2026-11-02T08:00:00Z');
 const codeSeeds=seeds([{code:'RACE1111',kind:'single',rewards:{coins:500}},{code:'RACESHARE',rewards:{coins:40}}]);
 createMobileService({databasePath,now:()=>now,redeemSeeds:codeSeeds,deferDailyStart:true}).close();
 const same=person(),gate=new SharedArrayBuffer(8),flags=new Int32Array(gate);
 const workers=[0,1].map(()=>new Worker(raceWorker,{eval:true,workerData:{serviceUrl:pathToFileURL(resolve(root,'server/mobile-service.mjs')).href,databasePath,now,seeds:codeSeeds,gate,
  calls:[{owner:person(),code:'RACE1111',requestId:rid()},{owner:same,code:'RACESHARE',requestId:rid()},{owner:same,code:'RACESHARE',requestId:rid()}]}}));
 t.after(()=>Promise.all(workers.map(worker=>worker.terminate())));
 const replies=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));
 while(Atomics.load(flags,0)<2)await new Promise(resolve=>setTimeout(resolve,10));
 Atomics.store(flags,1,1);Atomics.notify(flags,1);
 const results=await Promise.all(replies);
 for(const result of results)assert.ok(Array.isArray(result),JSON.stringify(result));
 const single=results.map(result=>result[0]),shared=results.flatMap(result=>result.slice(1));
 assert.equal(single.filter(r=>r.status===200).length,1,JSON.stringify(single));
 assert.deepEqual(single.filter(r=>r.status!==200).map(r=>r.code),['REDEEM_CODE_USED_UP']);
 assert.equal(shared.filter(r=>r.status===200).length,1,JSON.stringify(shared));
 assert.deepEqual(shared.filter(r=>r.status!==200).map(r=>r.code),Array(3).fill('REDEEM_ALREADY_CLAIMED'));
 const db=new DatabaseSync(databasePath,{readOnly:true});t.after(()=>db.close());
 assert.deepEqual(db.prepare('SELECT code,uses FROM mobile_redeem_codes ORDER BY code').all().map(row=>({...row})),[{code:'RACE1111',uses:1},{code:'RACESHARE',uses:1}]);
 assert.equal(db.prepare('SELECT coins FROM mobile_collection_wallets WHERE owner=?').get(same).coins,40);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_collection_ledger WHERE source LIKE 'redeem:%'").get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_redeem_claims').get().n,2);
});

test('operator script: create, batch with CSV, list, stats and disable on a database the service is using',t=>{
 const dir=tempDir(t),databasePath=join(dir,'mobile.sqlite');
 let now=Date.now();
 const service=createMobileService({databasePath,now:()=>now,redeemSeeds:seeds([]),deferDailyStart:true});t.after(()=>service.close());
 const redeem=(owner,code)=>service.handle({identity:owner,url:'/api/mobile/redeem',method:'POST',body:{code,requestId:rid()}});
 const run=(...args)=>spawnSync(process.execPath,['scripts/redeem-codes.mjs','--db',databasePath,...args],{cwd:root,encoding:'utf8',env:{...process.env,MOBILE_GAME_SETTINGS_CONFIG:''}});
 const created=run('create','--coins','300','--packs','1','--decorations','cat-paw','--if-owned-fragments','20','--max-uses','2','--expires','2099-12-31 23:59','--note','玩家群');
 assert.equal(created.status,0,created.stderr);
 const code=JSON.parse(created.stdout);
 assert.match(code.code,/^[2-9A-HJKMNP-Z]{8}$/);assert.equal(code.kind,'shared');assert.equal(code.maxUses,2);assert.equal(code.expiresAt,'2099-12-31 23:59 北京');
 assert.deepEqual(code.rewards,{coins:300,energyPacks:1,decorations:[{id:'cat-paw',ifOwned:{fragments:20}}]});assert.equal(code.rewardText,'300 金币 + 1 体力包 + 装饰 cat-paw（已拥有则 20 碎片）');
 assert.equal(run('create','--if-owned-fragments','5','--coins','1').status,1,'a fallback needs decorations');
 const a=person();assert.equal(redeem(a,code.code).status,200);
 const custom=run('create','--code','xiao-wo-2026','--coins','66');assert.equal(custom.status,0,custom.stderr);assert.equal(JSON.parse(custom.stdout).code,'XIAOWO2026');
 assert.equal(run('create','--code','XIAOWO2026','--coins','1').status,1,'duplicate code');
 const bad=run('create','--decorations','no-such-thing');assert.equal(bad.status,1);assert.match(bad.stderr,/unknown decoration no-such-thing/);
 assert.equal(run('create').status,1,'a code needs a reward');
 const csv=join(dir,'batch.csv'),batch=run('batch','--count','5','--coins','500','--energy','30','--batch-id','test-batch','--csv',csv,'--starts','2026-01-01');
 assert.equal(batch.status,0,batch.stderr);
 const lines=batch.stdout.trim().split('\n'),codes=lines.slice(-5);
 assert.equal(JSON.parse(lines.slice(0,-5).join('\n')).count,5);
 for(const single of codes)assert.match(single,/^[2-9A-HJKMNP-Z]{10}$/);
 assert.equal(new Set(codes).size,5);
 const rows=readFileSync(csv,'utf8').replace(/^﻿/,'').trim().split('\r\n');
 assert.equal(rows[0],'code,batch,rewards,startsAt,expiresAt,note');assert.deepEqual(rows.slice(1).map(row=>row.split(',')[0]),codes);
 assert.match(rows[1],/500 金币 \+ 30 体力/);
 assert.equal(run('batch','--count','1','--coins','1','--batch-id','test-batch','--csv',join(dir,'other.csv')).status,1,'batch ids are unique');
 const b=person();assert.equal(redeem(b,codes[0]).data.redeemed.coins,500);assert.equal(redeem(a,codes[0]).data.code,'REDEEM_CODE_USED_UP');
 const list=run('list');assert.equal(list.status,0,list.stderr);
 assert.match(list.stdout,new RegExp(code.code+'.*shared.*active.*1/2'));assert.match(list.stdout,/test-batch\s+5\s+1/);
 const batchList=run('list','--batch','test-batch');for(const single of codes)assert.match(batchList.stdout,new RegExp(single));
 const stats=JSON.parse(run('stats',code.code.toLowerCase()).stdout);
 assert.equal(stats.claims.count,1);assert.deepEqual(stats.claims.granted,{coins:300,fragments:0,energy:0,energyPacks:1,energyPacksSkipped:0,decorations:1,decorationFallbacks:0});
 assert.equal(stats.recentClaims.length,1);assert.equal(typeof stats.recentClaims[0].name,'string');
 const disabled=run('disable',code.code);assert.equal(disabled.status,0,disabled.stderr);assert.equal(JSON.parse(disabled.stdout).status,'disabled');
 assert.equal(redeem(person(),code.code).data.code,'REDEEM_CODE_DISABLED');
 assert.equal(run('enable',code.code).status,0);assert.equal(redeem(person(),code.code).status,200);
 assert.equal(redeem(person(),code.code).data.code,'REDEEM_CODE_USED_UP');
 assert.equal(run('disable','NOPE2345').status,1);
 assert.ok(existsSync(databasePath+'-wal'),'the service database stays in WAL mode');
});
