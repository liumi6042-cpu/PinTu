import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {createMobileRetention,readRetentionConfiguration} from '../server/mobile-retention.mjs';
import {createMobileCollection} from '../server/mobile-collection.mjs';
import defaults from '../config/retention-rewards.json' with {type:'json'};
import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};
import {PHOTOS} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),DAY=86400000;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
function fixture(t,options={}){
 let now=Date.parse('2026-11-01T04:00:00Z');
 const service=createMobileService({now:()=>now,randomInt:min=>min,adEnabled:true,shareRewards:false,...options}),owner=randomBytes(32).toString('hex');
 t.after(()=>service.close());
 const call=(url,body,token)=>service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(...args)=>{const response=call(...args);assert.ok([200,201].includes(response.status),JSON.stringify(response));return response.data;};
 const profile=()=>ok('/api/mobile/profile'),view=()=>ok('/api/mobile/retention');
 const claim=(input={requestId:rid()})=>ok('/api/mobile/retention/weekly-claim',input);
 const daily=()=>{
  const ticket=ok('/api/rooms',{mode:'daily',pieces:48,visibility:'public',requestId:rid()});
  // Retain the playable room while clearing the owner's three-entry lobby limit.
  assert.equal(service.handle({identity:owner,url:'/api/rooms/'+ticket.room.id,method:'DELETE'}).status,200);
  return ticket;
 };
 const merge=(ticket,batch=false)=>{
  const path='/api/rooms/'+ticket.room.id,current=ok(path,undefined,ticket.token),group=current.puzzle.groups.find(item=>!item.locked);
  assert.ok(group);
  if(batch)return ok(path,{type:'batch',requestId:rid(),ops:[{groupId:group.id,dx:0,dy:0,requestId:rid()}]},ticket.token);
  ok(path,{type:'claim',groupId:group.id},ticket.token);
  return ok(path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},ticket.token);
 };
 return {service,owner,call,ok,profile,view,claim,daily,merge,set:value=>{now=typeof value==='string'?Date.parse(value):value;},advance:(days=1)=>{now+=days*DAY;}};
}

test('login days use Beijing midnight, count once per visit day and survive gaps',t=>{
 const f=fixture(t);
 assert.equal(f.profile().retention.weeklyGiftAvailable,true);
 f.set('2026-11-01T15:59:59.999Z');
 assert.equal(f.view().weeklyGift.loginDays,1);assert.equal(f.view().weeklyGift.loginDays,1);
 f.set('2026-11-01T16:00:00Z');assert.equal(f.view().weeklyGift.loginDays,2);
 f.advance(5);assert.equal(f.view().weeklyGift.loginDays,3);
 f.claim();assert.equal(f.view().weeklyGift.loginDays,3);
});

test('weekly claim gives supply once, replays durable response and describes today/tomorrow',t=>{
 const f=fixture(t),before=f.view();
 assert.equal(before.weeklyGift.tomorrowDay,2);
 assert.deepEqual(before.weeklyGift.days.map(item=>item.state),['today',...Array(6).fill('future')]);
 const input={requestId:rid()},first=f.claim(input);
 assert.equal(first.profile.supply.energy,1);
 assert.deepEqual(first.granted,{day:1,kind:'energy-pack',amount:1,coins:0,fallback:false});
 assert.equal(first.weeklyGift.tomorrowDay,2);assert.equal(first.weeklyGift.available,false);
 assert.equal(first.profile.retention.weeklyGiftAvailable,false);
 assert.deepEqual(first.weeklyGift.days.map(item=>item.state),['claimed',...Array(6).fill('future')]);
 const denied=f.call('/api/mobile/retention/weekly-claim',{requestId:rid()});
 assert.equal(denied.status,409);assert.equal(denied.data.code,'WEEKLY_GIFT_UNAVAILABLE');
 assert.deepEqual(f.claim(input),first);
 f.advance();assert.equal(f.view().weeklyGift.tomorrowDay,3);
 assert.equal(f.view().weeklyGift.days[1].state,'today');
 assert.deepEqual(f.claim(input),first,'replay after midnight cannot claim another gift');
 assert.equal(f.claim().granted.day,2);
});

test('full energy and creation supplies fall back to coins in the collection wallet',t=>{
 const f=fixture(t);
 for(let n=0;n<3;n++){
  const input={kind:'energy',requestId:rid()},challenge=f.ok('/api/mobile/supply/challenge',input);
  f.ok('/api/mobile/supply/redeem',{...input,rewardToken:challenge.rewardToken,completed:true});
 }
 const first=f.claim();assert.equal(first.profile.supply.energy,3);
 assert.deepEqual(first.granted,{day:1,kind:'energy-pack',amount:0,coins:50,fallback:true});
 assert.equal(first.profile.collection.coins,50);
 f.advance();f.claim();f.advance();const third=f.claim();
 assert.equal(third.profile.supply.create,3);assert.equal(third.profile.collection.coins,150);
 assert.deepEqual(third.granted,{day:3,kind:'create-ticket',amount:0,coins:50,fallback:true});
});

test('seven separated claims grant the gift-only hairpin and finish permanently',t=>{
 const f=fixture(t);
 const collection=()=>f.ok('/api/mobile/collection');
 assert.equal(collection().decorations.some(item=>item.id==='grandma-hairpin'),false);
 const craft=f.call('/api/mobile/collection/craft',{decorationId:'grandma-hairpin',requestId:rid()});
 assert.equal(craft.status,409);assert.equal(craft.data.code,'GIFT_ONLY');
 assert.equal(f.call('/api/mobile/collection/equip',{decorationId:'grandma-hairpin',requestId:rid()}).data.code,'DECORATION_NOT_OWNED');
 let last;
 for(let day=1;day<=7;day++){
  assert.equal(f.view().weeklyGift.tomorrowDay,day<7?day+1:null);
  const before=f.profile();last=f.claim();
  assert.equal(last.granted.day,day);assert.equal(last.weeklyGift.claimed,day);
  assert.equal(last.weeklyGift.tomorrowDay,day<7?day+1:null);
  if(day===7){assert.equal(last.profile.collection.coins-before.collection.coins,100);assert.equal(last.granted.decorationId,'grandma-hairpin');}
  f.advance(day%2?2:1);
 }
 assert.equal(last.weeklyGift.done,true);assert.equal(last.weeklyGift.available,false);
 assert.ok(last.weeklyGift.days.every(item=>item.state==='claimed'));
 assert.equal(f.view().weeklyGift.loginDays,8);
 assert.equal(f.call('/api/mobile/retention/weekly-claim',{requestId:rid()}).data.code,'WEEKLY_GIFT_DONE');
 assert.equal(collection().decorations.find(item=>item.id==='grandma-hairpin').owned,true);
 const equipped=f.ok('/api/mobile/collection/equip',{decorationId:'grandma-hairpin',requestId:rid()});
 assert.equal(equipped.equipped.id,'grandma-hairpin');
});

test('daily merges use the 20:00 turnover, ignore old and non-daily rooms, count batches once',t=>{
 const f=fixture(t);
 f.set('2026-11-01T11:59:59.999Z');const old=f.daily();
 assert.equal(f.view().dailyStreak.count,0);assert.deepEqual(f.view().dailyStreak.next,{at:3,coins:60,in:3});
 f.merge(old);f.merge(old,true);
 assert.equal(f.view().dailyStreak.count,1);assert.equal(f.view().dailyStreak.todayDone,true);
 f.set('2026-11-01T12:00:00Z');
 assert.equal(f.view().dailyStreak.day,'2026-11-02');assert.equal(f.view().dailyStreak.todayDone,false);
 f.merge(old);assert.equal(f.view().dailyStreak.count,1);assert.equal(f.view().dailyStreak.todayDone,false);
 f.merge(f.daily(),true);assert.equal(f.view().dailyStreak.count,2);
 f.advance(2);assert.equal(f.view().dailyStreak.count,0);
 f.merge(f.daily());assert.equal(f.view().dailyStreak.count,1);
 const normal=f.ok('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
 f.advance();f.merge(normal);assert.equal(f.view().dailyStreak.count,1);assert.equal(f.view().dailyStreak.todayDone,false);
});

test('streak milestone positions repeat at 3, 7, 10 and 14 without duplicate coins',t=>{
 const f=fixture(t);let lastAward=null;
 for(let count=1;count<=14;count++){
  const ticket=f.daily(),before=f.profile(),reply=f.merge(ticket,count%2===0);
  const expected=[3,10].includes(count)?60:[7,14].includes(count)?150:0;
  const credited=reply.mobileContribution?.creditedCoins??reply.mobileContributions.reduce((n,item)=>n+item.creditedCoins,0);
  assert.equal(reply.profile.collection.coins-before.collection.coins-credited,expected,'milestone '+count);
  const view=f.view().dailyStreak;assert.equal(view.count,count);assert.equal(view.todayDone,true);
  if(expected)lastAward={day:view.day,streak:count,coins:expected,at:Date.parse('2026-11-01T04:00:00Z')+(count-1)*DAY};
  assert.deepEqual(view.lastAward,lastAward);assert.deepEqual(f.profile().retention.dailyStreak.lastAward,lastAward);
  const coins=f.profile().collection.coins,second=f.merge(ticket),secondCredit=second.mobileContribution.creditedCoins;
  assert.equal(second.profile.collection.coins-coins,secondCredit);assert.equal(f.view().dailyStreak.count,count);
  if(count===2)assert.deepEqual(view.next,{at:3,coins:60,in:1});
  if(count===3)assert.deepEqual(view.next,{at:7,coins:150,in:4});
  if(count%7===0)assert.equal(view.next,null);
  f.advance();
  if(count%7===0)assert.deepEqual(f.view().dailyStreak.next,{at:3,coins:60,in:3},'a new day starts the next reward cycle');
 }
 f.advance(2);assert.equal(f.view().dailyStreak.count,0);assert.deepEqual(f.view().dailyStreak.lastAward,lastAward);
});

test('kill switches and web omit retention, return unknown routes, and allow daily merges without tables',t=>{
 const previous=process.env.MOBILE_RETENTION;
 try{
  delete process.env.MOBILE_RETENTION;
  const disabled=[fixture(t,{retention:false}),fixture(t,{runtimeProfile:'web'})];
  process.env.MOBILE_RETENTION='false';disabled.push(fixture(t),fixture(t,{retention:true}));
  for(const f of disabled){
   assert.equal(f.service.capabilities.weeklyGift,false);assert.equal(f.service.capabilities.dailyStreak,false);
   assert.equal(f.profile().retention,undefined);
   assert.equal(f.call('/api/mobile/retention').status,404);
   assert.equal(f.call('/api/mobile/retention/weekly-claim',{requestId:rid()}).status,404);
   assert.equal(f.merge(f.daily()).profile.retention,undefined);
  }
 }finally{if(previous===undefined)delete process.env.MOBILE_RETENTION;else process.env.MOBILE_RETENTION=previous;}
});

test('gateway config and profiles advertise both retention capabilities',async t=>{
 for(const options of [{},{retention:false},{runtimeProfile:'web'}]){
  const f=fixture(t,options),gateway=createH5Gateway({mobileService:{...f.service,close(){}},databasePath:':memory:',upstream:'http://127.0.0.1:1',allowedOrigins:['https://ma-h5-al.tapimg.com']}),base=await listen(gateway);
  try{
   const response=await fetch(base+'/h5/config'),config=await response.json(),enabled=!options.runtimeProfile&&options.retention!==false;
   assert.equal(response.status,200);assert.equal(config.capabilities.weeklyGift,enabled);assert.equal(config.capabilities.dailyStreak,enabled);
   assert.equal(f.profile().capabilities.weeklyGift,enabled);assert.ok(Object.isFrozen(f.service.capabilities));
  }finally{await new Promise(resolve=>gateway.close(resolve));}
 }
});

test('config validation rejects invalid rewards, unknown decorations, invalid cycles and milestones',()=>{
 for(const mutate of [
  c=>{c.schema='invalid';},c=>{c.weeklyGift.days.pop();},c=>{c.weeklyGift.days[0].day=2;},
  c=>{c.weeklyGift.days[0].kind='unknown';},c=>{c.weeklyGift.days[0].amount=0;},
  c=>{c.weeklyGift.days[0].fallbackCoins=-1;},c=>{c.weeklyGift.days[1].amount=1.5;},
  c=>{c.weeklyGift.days[6].decorationId=catalog.decorations[0].id;},c=>{delete c.weeklyGift.days[6].coins;},
  c=>{c.dailyStreak.cycle=0;},c=>{c.dailyStreak.milestones[0].at=8;},c=>{c.dailyStreak.milestones[0].coins=0;},
  c=>{c.dailyStreak.milestones[0].at=7;}
 ]){const config=structuredClone(defaults);mutate(config);assert.throws(()=>readRetentionConfiguration(config),/Invalid retention configuration/);}
 const previous=process.env.MOBILE_RETENTION_CONFIG;
 try{
  process.env.MOBILE_RETENTION_CONFIG=fileURLToPath(new URL('../package.json',import.meta.url));
  assert.throws(()=>createMobileService(),/Invalid retention configuration/);
  process.env.MOBILE_RETENTION_CONFIG=fileURLToPath(new URL('../config/retention-rewards.json',import.meta.url));
  const service=createMobileService();service.close();
 }finally{if(previous===undefined)delete process.env.MOBILE_RETENTION_CONFIG;else process.env.MOBILE_RETENTION_CONFIG=previous;}
});

test('a retention award failure only logs, preserves the merge, and can be retried on the next merge',t=>{
 const f=fixture(t);f.merge(f.daily());f.advance();f.merge(f.daily());f.advance();
 const ticket=f.daily(),before=f.profile(),prepare=DatabaseSync.prototype.prepare;
 const broken=t.mock.method(DatabaseSync.prototype,'prepare',function(sql,...args){
  if(sql==='INSERT INTO mobile_daily_streak_awards VALUES(?,?,?,?,?)')throw new Error('injected retention failure');
  return prepare.call(this,sql,...args);
 });
 const warnings=t.mock.method(console,'warn',()=>{});
 const reply=f.merge(ticket);
 broken.mock.restore();
 assert.equal(warnings.mock.callCount(),1);assert.match(warnings.mock.calls[0].arguments.join(' '),/injected retention failure/);
 assert.equal(reply.profile.totalXp,before.totalXp+reply.mobileContribution.creditedXp);
 assert.equal(reply.profile.collection.coins-before.collection.coins,reply.mobileContribution.creditedCoins);
 assert.equal(f.view().dailyStreak.count,2);assert.equal(f.view().dailyStreak.todayDone,false);
 const coins=f.profile().collection.coins,retried=f.merge(ticket,true);
 assert.equal(retried.profile.collection.coins-coins-retried.mobileContributions[0].creditedCoins,60);
 assert.equal(f.view().dailyStreak.count,3);
});

test('failed weekly claims roll back supply and receipts so the same request can succeed once',t=>{
 const f=fixture(t),input={requestId:rid()},prepare=DatabaseSync.prototype.prepare;
 const broken=t.mock.method(DatabaseSync.prototype,'prepare',function(sql,...args){
  if(sql==='INSERT INTO mobile_weekly_gift_claims VALUES(?,?,?,?,?)')throw new Error('injected claim failure');
  return prepare.call(this,sql,...args);
 });
 assert.equal(f.call('/api/mobile/retention/weekly-claim',input).status,500);
 broken.mock.restore();
 assert.equal(f.profile().supply.energy,0);assert.equal(f.view().weeklyGift.claimed,0);
 const first=f.claim(input);assert.equal(first.profile.supply.energy,1);assert.deepEqual(f.claim(input),first);
});

test('collection coin sources are verbatim and idempotent; streak failure rolls back its partial award',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const collection=createMobileCollection({db,photos:PHOTOS}),retention=createMobileRetention({db,config:defaults,awardCoins:collection.awardCoins,grantDecoration:collection.grantDecoration}),owner='owner',now=Date.parse('2026-11-01T04:00:00Z');
  assert.equal(collection.awardCoins(owner,'weekly-gift:2',50,now),50);assert.equal(collection.awardCoins(owner,'weekly-gift:2',50,now),0);
  assert.equal(db.prepare('SELECT source FROM mobile_collection_ledger WHERE owner=?').get(owner).source,'weekly-gift:2');
  retention.dailyMerge(owner,'2026-11-01',now);retention.dailyMerge(owner,'2026-11-02',now+DAY);
  db.exec("CREATE TRIGGER reject_award BEFORE INSERT ON mobile_daily_streak_awards BEGIN SELECT RAISE(ABORT,'retention award unavailable'); END");
  assert.throws(()=>retention.dailyMerge(owner,'2026-11-03',now+2*DAY),/retention award unavailable/);
  assert.equal(collection.summary(owner).coins,50);assert.equal(db.prepare('SELECT count FROM mobile_daily_streak WHERE owner=?').get(owner).count,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_collection_ledger WHERE source LIKE 'daily-streak:%'").get().n,0);
  db.exec('DROP TRIGGER reject_award');retention.dailyMerge(owner,'2026-11-03',now+2*DAY);retention.dailyMerge(owner,'2026-11-03',now+2*DAY);
  assert.equal(collection.summary(owner).coins,110);assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_daily_streak_awards').get().n,1);
  assert.equal(db.prepare("SELECT coins FROM mobile_collection_ledger WHERE source='daily-streak:2026-11-03'").get().coins,60);
  collection.grantDecoration(owner,'grandma-hairpin',now);
  const p={id:owner,supply:{energy:0,create:0}};
  db.prepare('INSERT INTO mobile_weekly_gift VALUES(?,6,?,6,?,?)').run(owner,'2026-10-31','2026-10-31',now);
  assert.equal(retention.claim(p,now).coins,100);assert.equal(collection.summary(owner).coins,210);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE item_id='grandma-hairpin'").get().n,1);
 }finally{db.close();}
});
