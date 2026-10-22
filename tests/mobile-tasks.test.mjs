import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {mobileTaskDay} from '../server/mobile-tasks.mjs';
const rid=()=>randomBytes(16).toString('hex'),identity=()=>randomBytes(32).toString('hex');
function fixture(){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-tasks-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=Date.parse('2026-10-10T04:00:00Z');const options={databasePath,now:()=>now,randomInt:(_min,max)=>max-1,adEnabled:true};let service=createMobileService(options);const db=new DatabaseSync(databasePath);
 const call=(actor,url,body,token,instance=service)=>instance.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(actor,url,body,token,instance)=>{const response=call(actor,url,body,token,instance);assert.ok(response.status===200||response.status===201,JSON.stringify(response));return response.data;};
 const profile=a=>ok(a,'/api/mobile/profile'),tasks=a=>ok(a,'/api/mobile/tasks');
 const patch=(actor,changes)=>{profile(actor);const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);Object.assign(p,changes);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),actor);};
 const player=()=>{const a=identity();patch(a,{level:50,xp:20,totalXp:12000,energy:1000,firstRoomCompleted:true,createdAt:now-70000});return a;};
 const room=(owner,pieces=500)=>ok(owner,'/api/rooms',{mode:'random',pieces,visibility:'public',requestId:rid()});
 const join=(actor,roomId)=>ok(actor,'/api/rooms/'+roomId+'/join',{});
 const drop=(actor,ticket,{input,instance}={})=>{
  const path='/api/rooms/'+ticket.room.id,current=ok(actor,path,undefined,ticket.token,instance),group=current.puzzle.groups.find(g=>!g.locked);assert.ok(group,'test room still has loose pieces');
  ok(actor,path,{type:'claim',groupId:group.id},ticket.token,instance);const body=input??{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()};
  const result=ok(actor,path,body,ticket.token,instance);assert.equal(result.mobileContribution.creditedXp,1);assert.equal(result.mobileContribution.requestId,body.requestId);return {result,input:body,path};
 };
 const accept=(actor,code,requestId=rid())=>ok(actor,'/api/mobile/invitations/accept',{code,requestId});
 return {db,options,call,ok,profile,tasks,patch,player,room,join,drop,accept,get now(){return now;},set now(n){now=n;},get service(){return service;},restart(){service.close();service=createMobileService(options);},close(){db.close();service.close();assert.ok(dir.startsWith(resolve('work')+'\\'));rmSync(dir,{recursive:true,force:true});}};
}
const task=(view,id)=>view.tasks.find(t=>t.id===id);

void test('beginner solo milestones count real contributions, credit 10/50/100 once and disappear across days/restarts',()=>{
 const f=fixture();try{
  const owner=f.player(),peer=f.player(),ticket=f.room(owner),starting=f.profile(owner).collection.coins;
  assert.deepEqual(f.tasks(owner).tasks.filter(t=>t.group==='beginner').map(t=>[t.target,t.coins,t.progress]),[[10,10,0],[50,50,0],[100,100,0]]);
  for(let n=1;n<=100;n++){
   const dropped=f.drop(owner,ticket);if([10,50,100].includes(n)){const snapshot=f.profile(owner);f.ok(owner,dropped.path,dropped.input,ticket.token);assert.equal(f.profile(owner).collection.coins,snapshot.collection.coins,'replayed drop cannot repeat a milestone award');}
   if([9,10,49,50,99,100].includes(n)){
    const view=f.tasks(owner),remaining=view.tasks.filter(t=>t.group==='beginner');assert.deepEqual(remaining.map(t=>t.target),[10,50,100].filter(target=>target>n));
    assert.ok(remaining.every(t=>t.progress===n));const earned=n>=100?160:n>=50?60:n>=10?10:0;
    assert.equal(f.db.prepare("SELECT COALESCE(SUM(coins),0) n FROM mobile_collection_ledger WHERE owner=? AND source LIKE 'task:beginner-%'").get(owner).n,earned);
   }
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_beginner_rewards WHERE owner=?').get(owner).n,3);
  assert.equal(f.profile(owner).collection.coins>=starting+160,true);assert.equal(f.tasks(peer).tasks.filter(t=>t.group==='beginner').length,3);
  f.now+=86400000;f.restart();assert.equal(f.tasks(owner).tasks.some(t=>t.group==='beginner'),false);assert.equal(f.tasks(owner).tasks.some(t=>t.group==='beginner'),false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_collection_ledger WHERE owner=? AND source LIKE 'task:beginner-%'").get(owner).n,3);
 }finally{f.close();}
});

void test('historical valid events qualify immediately, concurrent service views stay idempotent and do not grant gifts',()=>{
 const f=fixture();let second;try{
  const owner=f.player(),other=f.player(),room='historical-room';for(let n=0;n<105;n++)f.db.prepare('INSERT INTO mobile_task_events VALUES(?,?,?,?)').run(owner,room,'historical-'+n,f.now-86400000);
  const before=f.profile(owner);second=createMobileService(f.options);
  assert.equal(f.tasks(owner).tasks.some(t=>t.group==='beginner'),false);
  assert.equal(f.ok(owner,'/api/mobile/tasks',undefined,undefined,second).tasks.some(t=>t.group==='beginner'),false);
  const after=f.profile(owner);assert.equal(after.collection.coins,before.collection.coins+160);assert.equal(after.giftCount,before.giftCount);assert.equal(after.totalXp,before.totalXp);
  assert.deepEqual(f.tasks(other).tasks.filter(t=>t.group==='beginner').map(t=>t.progress),[0,0,0]);
 }finally{second?.close();f.close();}
});

void test('a beginner wallet failure rolls back its completion receipt and can be retried exactly once',()=>{
 const f=fixture();try{
  const owner=f.player(),before=f.profile(owner).collection.coins;
  for(let n=0;n<10;n++)f.db.prepare('INSERT INTO mobile_task_events VALUES(?,?,?,?)').run(owner,'history','valid-'+n,f.now);
  f.db.exec("CREATE TRIGGER fail_beginner_wallet BEFORE INSERT ON mobile_collection_ledger WHEN NEW.source='task:beginner-10' BEGIN SELECT RAISE(ABORT,'synthetic wallet failure'); END");
  assert.equal(f.call(owner,'/api/mobile/tasks').status,500);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_beginner_rewards WHERE owner=?').get(owner).n,0);assert.equal(f.profile(owner).collection.coins,before);
  f.db.exec('DROP TRIGGER fail_beginner_wallet');assert.equal(f.tasks(owner).tasks.some(t=>t.id==='beginner-10'),false);assert.equal(f.profile(owner).collection.coins,before+10);
  f.tasks(owner);assert.equal(f.profile(owner).collection.coins,before+10);
 }finally{f.close();}
});

void test('ten gifts are stored at issue-time, survive old progress migration, and never spend ad inventory',()=>{
 const f=fixture();try{
  const a=f.player();f.patch(a,{energy:10,energyAt:f.now-240000,giftProgress:9,supply:{energy:3,create:3}});const ticket=f.room(a,48),before=f.profile(a);
  const {result,input,path}=f.drop(a,ticket);const after=f.profile(a),view=f.tasks(a);
  assert.equal(after.energy,before.energy-1);assert.equal(after.giftProgress,0);assert.equal(after.giftCount,1);assert.equal(result.profile.lastReward.gift,0);assert.equal(result.profile.lastReward.giftsAdded,1);
  assert.deepEqual(view.inventory,[{kind:'ten-7',title:'十格小礼',energyMin:1,energyMax:7,xp:0,coins:0,count:1}]);assert.deepEqual(after.supply,{energy:3,create:3});
  assert.equal(f.ok(a,path,input,ticket.token).revision,result.revision);assert.equal(f.profile(a).giftCount,1);
  f.patch(a,{level:80});f.restart();assert.equal(f.tasks(a).inventory[0].energyMax,7);
  const opened=f.ok(a,'/api/mobile/gifts/open',{kind:'ten-7',quantity:1,requestId:rid()});assert.equal(opened.opened.energy,7);assert.equal(opened.profile.energy,16);assert.equal(opened.profile.naturalRecoveryAt,f.now+60000);assert.equal(opened.profile.totalXp,before.totalXp+1);assert.equal(opened.profile.giftProgress,0);
 }finally{f.close();}
});

void test('real co-op contributions award exactly 10/30/60 and linked-friend 10/30 milestones once',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);f.accept(b,f.tasks(a).invitation.code);
  for(let n=1;n<=60;n++){
   f.drop(b,bt);const dropped=f.drop(a,ticket);f.ok(a,dropped.path,dropped.input,ticket.token);
   if([9,10,29,30,59,60].includes(n)){const v=f.tasks(a);assert.equal(task(v,'cooperation-60').progress,n);assert.equal(task(v,'cooperation-10').earned,n>=10);assert.equal(task(v,'cooperation-30').earned,n>=30);assert.equal(task(v,'cooperation-60').earned,n>=60);assert.equal(task(v,'friend-10').earned,n>=10);assert.equal(task(v,'friend-30').earned,n>=30);}
   f.now+=50;
  }
  const v=f.tasks(a),counts=Object.fromEntries(v.inventory.map(g=>[g.kind,g.count]));assert.deepEqual(counts,{'ten-7':6,'cooperation-10':1,'cooperation-30':1,'cooperation-60':1,'friend-10':1,'friend-30':1,'invite-refill':1});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events WHERE owner=?').get(a).n,60);assert.equal(f.profile(a).totalXp,12060);
  const before=f.profile(a),body={kind:'cooperation-60',quantity:1,requestId:rid()},opened=f.ok(a,'/api/mobile/gifts/open',body);assert.equal(opened.opened.energy,20);assert.equal(opened.opened.xp,8);assert.equal(opened.profile.totalXp,before.totalXp+8);assert.equal(opened.profile.giftProgress,before.giftProgress);assert.equal(task(opened,'cooperation-60').progress,60);
 }finally{f.close();}
});

void test('accepted social friends count only real active cooperation, preserve replay, and stop after removal or blocking',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ac=f.profile(a).code,bc=f.profile(b).code;
  const befriend=()=>{f.ok(a,'/api/mobile/social/requests',{code:bc,requestId:rid()});f.ok(b,'/api/mobile/social/requests/respond',{code:ac,accept:true,requestId:rid()});};
  const beforeA=f.profile(a),beforeB=f.profile(b);befriend();
  for(const [owner,before] of [[a,beforeA],[b,beforeB]]){const p=f.profile(owner);assert.equal(p.totalXp,before.totalXp);assert.equal(p.energy,before.energy);assert.equal(p.giftCount,0);assert.equal(task(f.tasks(owner),'friend-30').progress,0);assert.equal(f.tasks(owner).invitation.bound,false);}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_invitation_bindings').get().n,0);
  const ticket=f.room(a),bt=f.join(b,ticket.room.id);f.drop(a,ticket);assert.equal(task(f.tasks(a),'friend-30').progress,0);
  for(let n=1;n<=10;n++){
   f.drop(b,bt);const dropped=f.drop(a,ticket);f.ok(a,dropped.path,dropped.input,ticket.token);
   assert.equal(task(f.tasks(a),'friend-30').progress,n);assert.equal(task(f.tasks(a),'friend-10').earned,n>=10);
  }
  assert.equal(f.tasks(a).inventory.find(g=>g.kind==='friend-10').count,1);
  assert.equal(f.tasks(a).inventory.some(g=>g.kind==='invite-refill'),false);
  f.ok(a,'/api/mobile/social/friends/remove',{code:bc,requestId:rid()});f.drop(a,ticket);assert.equal(task(f.tasks(a),'friend-30').progress,10);assert.equal(task(f.tasks(a),'cooperation-30').progress,11);
  f.now+=3000;befriend();f.drop(a,ticket);assert.equal(task(f.tasks(a),'friend-30').progress,11);
  f.ok(b,'/api/mobile/social/block',{code:ac,requestId:rid()});f.drop(b,bt);f.drop(a,ticket);assert.equal(task(f.tasks(a),'friend-30').progress,11);assert.equal(task(f.tasks(b),'friend-30').progress,10);
  // Old invitation bindings keep their historical collaboration eligibility even after social removal.
  f.accept(b,f.tasks(a).invitation.code);f.drop(a,ticket);assert.equal(task(f.tasks(a),'friend-30').progress,12);
  assert.equal(f.tasks(a).inventory.find(g=>g.kind==='friend-10').count,1);
  assert.equal(f.tasks(a).invitation.qualifiedCount,0);
 }finally{f.close();}
});

void test('same identity tabs, invalid actions, stale successes and departed partners do not qualify',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),tab=f.join(a,ticket.room.id);f.drop(a,ticket);f.drop(a,tab);assert.equal(task(f.tasks(a),'cooperation-10').progress,0);
  const bt=f.join(b,ticket.room.id);f.drop(b,bt);f.drop(a,ticket);assert.equal(task(f.tasks(a),'cooperation-10').progress,1);
  const path='/api/rooms/'+ticket.room.id,unchanged=f.profile(a).totalXp;f.ok(a,path,{type:'heartbeat'},ticket.token);assert.equal(f.call(a,path,{type:'drop',groupId:-1,seq:1,dx:0,dy:0,requestId:rid()},ticket.token).status,409);assert.equal(f.profile(a).totalXp,unchanged);
  f.now+=120001;f.ok(b,path,{type:'heartbeat'},bt.token);f.drop(a,ticket);assert.equal(task(f.tasks(a),'cooperation-10').progress,1);
  f.drop(b,bt);f.ok(b,path,{type:'leave'},bt.token);f.drop(a,ticket);assert.equal(task(f.tasks(a),'cooperation-10').progress,1);
  assert.equal(f.tasks(a).giftProgress,5);
 }finally{f.close();}
});

void test('daily reset is Beijing midnight, keeps inventory and ten remainder, and never backfills solo events',()=>{
 const f=fixture();try{
  f.now=Date.parse('2026-10-10T15:59:59.000Z');const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);
  for(let i=0;i<3;i++)f.drop(a,ticket);assert.equal(task(f.tasks(a),'cooperation-10').progress,0);
  f.drop(b,bt);for(let i=0;i<10;i++)f.drop(a,ticket);
  const prior=f.tasks(a);assert.equal(prior.day,'2026-10-10');assert.equal(prior.giftProgress,3);assert.equal(prior.giftCount,2);
  f.now=Date.parse('2026-10-10T16:00:00.000Z');const reset=f.tasks(a);assert.equal(reset.day,'2026-10-11');assert.equal(task(reset,'cooperation-10').progress,0);assert.equal(task(reset,'cooperation-10').earned,false);assert.equal(reset.giftProgress,3);assert.equal(reset.giftCount,2);
  for(let i=0;i<10;i++)f.drop(a,ticket);const next=f.tasks(a);assert.equal(next.giftCount,4);assert.equal(next.inventory.find(g=>g.kind==='cooperation-10').count,2);assert.equal(next.giftProgress,3);assert.equal(mobileTaskDay(f.now),'2026-10-11');
 }finally{f.close();}
});

void test('gift XP levels first, fixed energy then overflows; XP does not create progress and overflow is preserved',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);f.drop(b,bt);for(let i=0;i<10;i++)f.drop(a,ticket);
  f.patch(a,{level:0,xp:0,totalXp:0,energy:5,giftProgress:4});const before=f.tasks(a);
  const opened=f.ok(a,'/api/mobile/gifts/open',{kind:'cooperation-10',quantity:1,requestId:rid()});assert.equal(opened.opened.levels,1);assert.equal(opened.profile.energyCap,51);assert.equal(opened.profile.energy,61);assert.equal(opened.profile.totalXp,2);assert.equal(opened.profile.giftProgress,4);assert.equal(task(opened,'cooperation-10').progress,task(before,'cooperation-10').progress);assert.equal(opened.profile.lastReward.type,'gift-open');
  f.now+=86400000;f.drop(b,bt);for(let i=0;i<10;i++)f.drop(a,ticket);f.patch(a,{level:0,xp:0,totalXp:0,energy:120});const overflow=f.ok(a,'/api/mobile/gifts/open',{kind:'cooperation-10',quantity:1,requestId:rid()});assert.equal(overflow.profile.energy,130);
 }finally{f.close();}
});

void test('persistent gift-open receipts are atomic across instances, reject changed requests and excess quantity',()=>{
 const f=fixture();let second;try{
  const a=f.player();f.patch(a,{giftProgress:9});const ticket=f.room(a,48);f.drop(a,ticket);second=createMobileService(f.options);
  const input={kind:'ten-7',quantity:1,requestId:rid()},one=f.ok(a,'/api/mobile/gifts/open',input),two=f.ok(a,'/api/mobile/gifts/open',input,undefined,second);assert.deepEqual(two,one);
  assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,quantity:2},undefined,second).data.code,'REQUEST_CONFLICT');assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,requestId:rid()},undefined,second).data.code,'GIFT_EMPTY');
  for(const quantity of [0,-1,1.5,21,'1',null])assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,quantity,requestId:rid()}).data.code,'INVALID_GIFT_QUANTITY');
  assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,kind:'fake',requestId:rid()}).data.code,'INVALID_GIFT_KIND');
  f.restart();assert.deepEqual(f.ok(a,'/api/mobile/gifts/open',input),one);assert.equal(f.profile(a).giftCount,0);
 }finally{second?.close();f.close();}
});

void test('invitation binding is durable and idempotent, qualifies only three post-bind real actions',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),c=f.player(),code=f.tasks(a).invitation.code,other=f.tasks(c).invitation.code;
  assert.equal(f.call(a,'/api/mobile/invitations/accept',{code,requestId:rid()}).data.code,'SELF_INVITATION');assert.equal(f.call(b,'/api/mobile/invitations/accept',{code:'invalid',requestId:rid()}).data.code,'INVALID_INVITATION');assert.equal(f.call(b,'/api/mobile/invitations/accept',{code:'000000000000',requestId:rid()}).data.code,'INVITATION_NOT_FOUND');
  const ticket=f.room(b);for(let i=0;i<3;i++)f.drop(b,ticket);const requestId=rid(),accepted=f.accept(b,code.toUpperCase(),requestId);assert.equal(accepted.accepted.alreadyBound,false);assert.equal(f.accept(b,code.toUpperCase(),requestId).accepted.alreadyBound,false);assert.equal(f.accept(b,code).accepted.alreadyBound,true);assert.equal(f.call(b,'/api/mobile/invitations/accept',{code:other,requestId:rid()}).data.code,'INVITATION_ALREADY_BOUND');
  f.drop(b,ticket);f.drop(b,ticket);assert.equal(f.tasks(a).invitation.qualifiedCount,0);const third=f.drop(b,ticket);f.ok(b,third.path,third.input,ticket.token);const v=f.tasks(a);assert.equal(v.invitation.qualifiedCount,1);assert.equal(v.invitation.joinedCount,1);assert.equal(v.invitation.todayRewarded,1);assert.equal(v.inventory.find(g=>g.kind==='invite-refill').count,1);assert.equal(f.profile(a).totalXp,12000);assert.equal(f.profile(a).lastReward.type,'invitation-gift');
  f.restart();assert.equal(f.tasks(a).invitation.code,code);assert.equal(f.tasks(b).invitation.bound,true);f.drop(b,ticket);assert.equal(f.tasks(a).giftCount,1);
 }finally{f.close();}
});

void test('inviter earns at most three qualifying friends daily; overflow still links but never re-awards',()=>{
 const f=fixture();try{
  const a=f.player(),code=f.tasks(a).invitation.code,invited=[];
  for(let n=0;n<4;n++){const b=f.player(),ticket=f.room(b,48);f.accept(b,code);for(let i=0;i<3;i++)f.drop(b,ticket);invited.push({b,ticket});}
  let v=f.tasks(a);assert.equal(v.invitation.joinedCount,4);assert.equal(v.invitation.qualifiedCount,4);assert.equal(v.invitation.todayRewarded,3);assert.equal(v.giftCount,3);
  f.now+=86400000;f.drop(invited[3].b,invited[3].ticket);v=f.tasks(a);assert.equal(v.invitation.todayRewarded,0);assert.equal(v.giftCount,3);
  const b=f.player(),ticket=f.room(b,48);f.accept(b,code);for(let i=0;i<3;i++)f.drop(b,ticket);assert.equal(f.tasks(a).giftCount,4);assert.equal(f.tasks(a).invitation.todayRewarded,1);
 }finally{f.close();}
});

void test('ordinary active partner is sufficient for regular tasks but not invited-friend tasks',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);f.drop(b,bt);for(let i=0;i<10;i++)f.drop(a,ticket);let v=f.tasks(a);assert.equal(task(v,'cooperation-10').earned,true);assert.equal(task(v,'friend-10').progress,0);
  f.accept(a,f.tasks(b).invitation.code);f.drop(a,ticket);v=f.tasks(a);assert.equal(task(v,'friend-10').progress,1);f.drop(b,bt);assert.equal(task(f.tasks(b),'friend-10').progress,1);
 }finally{f.close();}
});

void test('one moved group counts once and rejected energy cannot create an event, task or gift',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);f.drop(b,bt);
  const stored=JSON.parse(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data),loose=stored.puzzle.groups.filter(g=>!g.locked).slice(0,3),lead=loose[0];lead.pieces=loose.flatMap(g=>g.pieces);const removed=new Set(loose.slice(1).map(g=>g.id));stored.puzzle.groups=stored.puzzle.groups.filter(g=>!removed.has(g.id));f.db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(stored),stored.id);
  f.patch(a,{giftProgress:9,energy:1,level:50,xp:50});const result=f.drop(a,ticket).result;assert.equal(result.profile.totalXp,12001);assert.equal(result.profile.energy,0);assert.equal(result.profile.giftCount,1);assert.equal(task(f.tasks(a),'cooperation-10').progress,1);assert.equal(result.profile.giftProgress,0);
  const path='/api/rooms/'+ticket.room.id,next=result.puzzle.groups.find(g=>!g.locked);f.ok(a,path,{type:'claim',groupId:next.id},ticket.token);const events=f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events').get().n;
  const denied=f.call(a,path,{type:'drop',groupId:next.id,dx:0,dy:0,seq:1,requestId:rid()},ticket.token);assert.equal(denied.data.code,'ENERGY_EMPTY');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events').get().n,events);assert.equal(task(f.tasks(a),'cooperation-10').progress,1);assert.equal(f.profile(a).giftCount,1);
 }finally{f.close();}
});

void test('batch open sums XP before energy once, preserves gift counts, and has no progress side effects',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(a),bt=f.join(b,ticket.room.id);
  for(let day=0;day<2;day++){f.drop(b,bt);for(let i=0;i<30;i++)f.drop(a,ticket);if(day===0)f.now+=86400000;}
  f.patch(a,{level:0,xp:0,totalXp:0,energy:5});const before=f.tasks(a),opened=f.ok(a,'/api/mobile/gifts/open',{kind:'cooperation-30',quantity:2,requestId:rid()});
  assert.deepEqual(opened.opened,{kind:'cooperation-30',quantity:2,energy:30,xp:10,coins:0,levels:2});assert.equal(opened.profile.energy,82);assert.equal(opened.profile.energyCap,52);assert.equal(opened.profile.xp,4);assert.equal(opened.profile.giftCount,before.giftCount-2);assert.equal(opened.profile.giftProgress,before.giftProgress);assert.deepEqual(opened.tasks,before.tasks);
  const tenBefore=opened.inventory.find(g=>g.kind==='ten-7').count,ten=f.ok(a,'/api/mobile/gifts/open',{kind:'ten-7',quantity:tenBefore,requestId:rid()});assert.equal(ten.opened.energy,tenBefore*7);assert.equal(ten.opened.xp,0);assert.equal(ten.profile.totalXp,10);assert.equal(ten.inventory.some(g=>g.kind==='ten-7'),false);
 }finally{f.close();}
});

function qualifyInvitation(f,inviter){const b=f.player(),ticket=f.room(b,48);f.accept(b,f.tasks(inviter).invitation.code);for(let n=0;n<3;n++)f.drop(b,ticket);return {b,ticket};}

void test('new invitation reward is an unconsumed refill gift separate from full ad inventory',()=>{
 const f=fixture();try{
  const a=f.player();f.patch(a,{level:10,energy:12,supply:{energy:3,create:3}});qualifyInvitation(f,a);const view=f.tasks(a);
  assert.equal(view.profile.energy,12);assert.equal(view.profile.totalXp,12000);assert.deepEqual(view.inventory,[{kind:'invite-refill',title:'补满体力包',effect:'full-energy',energyMin:0,energyMax:0,xp:0,coins:0,count:1}]);
  assert.deepEqual({kind:task(view,'invite-friend').kind,effect:task(view,'invite-friend').effect,energy:task(view,'invite-friend').energy,xp:task(view,'invite-friend').xp},{kind:'invite-refill',effect:'full-energy',energy:0,xp:0});
  const opened=f.ok(a,'/api/mobile/gifts/open',{kind:'invite-refill',quantity:1,requestId:rid()});assert.deepEqual(opened.opened,{kind:'invite-refill',effect:'full-energy',quantity:1,energy:48,xp:0,coins:0,levels:0});assert.equal(opened.profile.energy,60);assert.equal(opened.profile.giftCount,0);assert.deepEqual(opened.profile.supply,{energy:3,create:3});assert.equal(opened.profile.lastReward.effect,'full-energy');assert.equal(opened.profile.totalXp,12000);
 }finally{f.close();}
});

void test('refill rejects multiple quantity or already-full energy, preserves excess and keeps its gift',()=>{
 const f=fixture();try{
  const a=f.player();qualifyInvitation(f,a);qualifyInvitation(f,a);const input={kind:'invite-refill',quantity:1,requestId:rid()};
  assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,quantity:2}).data.code,'INVALID_GIFT_QUANTITY');
  for(const energy of [100,117]){f.patch(a,{energy});const result=f.call(a,'/api/mobile/gifts/open',input);assert.equal(result.status,409);assert.equal(result.data.code,'ENERGY_FULL');assert.equal(f.profile(a).energy,energy);assert.equal(f.profile(a).giftCount,2);}
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_requests WHERE owner=? AND scope='gift-open'").get(a).n,0);
  f.patch(a,{energy:7});const retried=f.ok(a,'/api/mobile/gifts/open',input);assert.equal(retried.opened.energy,93);assert.equal(retried.profile.energy,100);assert.equal(retried.profile.giftCount,1);
 }finally{f.close();}
});

void test('stored refill uses opening-time capacity after a real level-up and gives no XP',()=>{
 const f=fixture();try{
  const a=f.player();f.patch(a,{level:0,xp:0,totalXp:0,energy:5});qualifyInvitation(f,a);assert.equal(f.profile(a).energyCap,50);
  const ticket=f.room(a,48);f.drop(a,ticket);f.drop(a,ticket);const before=f.profile(a);assert.equal(before.level,1);assert.equal(before.energy,50);assert.equal(before.energyCap,51);
  const opened=f.ok(a,'/api/mobile/gifts/open',{kind:'invite-refill',quantity:1,requestId:rid()});assert.equal(opened.profile.energy,51);assert.equal(opened.opened.energy,1);assert.equal(opened.opened.levels,0);assert.equal(opened.profile.totalXp,before.totalXp);assert.equal(opened.profile.giftProgress,before.giftProgress);
 }finally{f.close();}
});

void test('refill receipts and atomic consumption survive another service instance and restart',()=>{
 const f=fixture();let other;try{
  const a=f.player();qualifyInvitation(f,a);qualifyInvitation(f,a);f.patch(a,{energy:20});other=createMobileService(f.options);
  const input={kind:'invite-refill',quantity:1,requestId:rid()},first=f.ok(a,'/api/mobile/gifts/open',input),replayed=f.ok(a,'/api/mobile/gifts/open',input,undefined,other);assert.deepEqual(replayed,first);assert.equal(f.profile(a).giftCount,1);
  const second={...input,requestId:rid()};assert.equal(f.call(a,'/api/mobile/gifts/open',second,undefined,other).data.code,'ENERGY_FULL');assert.equal(f.profile(a).giftCount,1);
  f.patch(a,{energy:95});const next=f.ok(a,'/api/mobile/gifts/open',second,undefined,other);assert.equal(next.opened.energy,5);assert.equal(f.profile(a).giftCount,0);
  f.restart();assert.deepEqual(f.ok(a,'/api/mobile/gifts/open',input),first);assert.equal(f.profile(a).giftCount,0);assert.equal(f.profile(a).energy,100);
 }finally{other?.close();f.close();}
});

void test('historical fixed invitation gifts remain unchanged and historical rewarded bindings do not regrant',()=>{
 const f=fixture();try{
  const a=f.player(),b=f.player(),ticket=f.room(b,48);f.accept(b,f.tasks(a).invitation.code);
  f.db.prepare("UPDATE mobile_invitation_bindings SET contributions=3,qualified_at=?,reward_day=?,reward_status='awarded' WHERE invitee=?").run(f.now,mobileTaskDay(f.now),b);
  f.db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),a,'invite-friend',10,2,'invite:'+b,f.now);
  f.restart();f.drop(b,ticket);let view=f.tasks(a);assert.equal(view.giftCount,1);assert.equal(view.inventory[0].kind,'invite-friend');assert.equal(view.inventory[0].energyMin,10);assert.equal(view.inventory[0].xp,2);
  f.patch(a,{energy:115});const originalXp=f.profile(a).totalXp,opened=f.ok(a,'/api/mobile/gifts/open',{kind:'invite-friend',quantity:1,requestId:rid()});assert.deepEqual(opened.opened,{kind:'invite-friend',quantity:1,energy:10,xp:2,coins:0,levels:0});assert.equal(opened.profile.energy,125);assert.equal(opened.profile.totalXp,originalXp+2);
  qualifyInvitation(f,a);view=f.tasks(a);assert.equal(view.inventory.length,1);assert.equal(view.inventory[0].kind,'invite-refill');assert.equal(view.inventory[0].count,1);assert.equal(view.invitation.todayRewarded,2);
 }finally{f.close();}
});

void test('sharing grants direct fixed rewards three times daily, replays once and cannot advance puzzle counters',()=>{
 const f=fixture();try{
  const a=f.player();f.patch(a,{level:0,xp:0,totalXp:0,energy:5,giftProgress:4});const input={requestId:rid(),shared:true},first=f.ok(a,'/api/mobile/invitations/share',input);
  assert.deepEqual(first.shared,{energy:20,xp:10,coins:0,levels:2,alreadyRewarded:false});assert.equal(first.profile.energy,72);assert.equal(first.profile.level,2);assert.equal(first.profile.lastReward.type,'invitation-share');assert.equal(first.profile.giftCount,0);assert.equal(first.profile.giftProgress,4);assert.equal(first.invitation.todayShared,1);assert.equal(first.invitation.shareDailyLimit,3);assert.equal(task(first,'share-invitation').progress,1);assert.equal(task(first,'share-invitation').earned,false);assert.equal(task(first,'share-invitation').energy,20);assert.equal(task(first,'share-invitation').xp,10);
  assert.deepEqual(f.ok(a,'/api/mobile/invitations/share',input),first);assert.equal(f.profile(a).energy,72);assert.equal(f.tasks(a).invitation.todayShared,1);
  f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true});const third=f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.equal(third.profile.energy,112);assert.equal(third.profile.totalXp,30);assert.equal(third.profile.level,3);assert.equal(third.profile.giftProgress,4);assert.equal(third.profile.giftCount,0);assert.equal(third.invitation.todayShared,3);assert.equal(task(third,'share-invitation').earned,true);
  const capped=f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.deepEqual(capped.shared,{energy:0,xp:0,coins:0,levels:0,alreadyRewarded:true});assert.equal(capped.profile.energy,112);assert.equal(capped.profile.totalXp,30);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events WHERE owner=?').get(a).n,0);assert.equal(task(capped,'cooperation-10').progress,0);assert.equal(task(capped,'friend-10').progress,0);assert.equal(capped.invitation.todayRewarded,0);
 }finally{f.close();}
});

void test('sharing cap is atomic across instances and Beijing days without losing old refill inventories',()=>{
 const f=fixture();let other;try{
  f.now=Date.parse('2026-10-10T15:59:59.000Z');const a=f.player();qualifyInvitation(f,a);f.patch(a,{energy:10});other=createMobileService(f.options);
  const firstInput={requestId:rid(),shared:true},first=f.ok(a,'/api/mobile/invitations/share',firstInput);f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true},undefined,other);f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.equal(f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true},undefined,other).shared.alreadyRewarded,true);assert.equal(f.profile(a).giftCount,1);
  f.now=Date.parse('2026-10-10T16:00:00.000Z');assert.equal(f.tasks(a).invitation.todayShared,0);assert.equal(f.tasks(a).giftCount,1);assert.deepEqual(f.ok(a,'/api/mobile/invitations/share',firstInput,undefined,other),first);assert.equal(f.tasks(a).invitation.todayShared,0);
  const newDay=f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true},undefined,other);assert.equal(newDay.shared.energy,20);assert.equal(newDay.invitation.todayShared,1);assert.equal(newDay.invitation.todayRewarded,0);assert.equal(newDay.profile.giftCount,1);
  f.restart();assert.equal(f.tasks(a).invitation.todayShared,1);assert.equal(f.tasks(a).invitation.shareDailyLimit,3);assert.equal(f.tasks(a).giftCount,1);
 }finally{other?.close();f.close();}
});
