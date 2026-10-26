import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {createSoloBatch,SOLO_BATCH_MAX} from '../server/mobile-solo-batch.mjs';
import {PHOTOS,photoGuidance,gridForDimensions,placedCount} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),identity=()=>randomBytes(32).toString('hex');
const photo=PHOTOS.find(p=>p.galleryVisible!==false&&gridForDimensions(photoGuidance(p.id).width,photoGuidance(p.id).height,48).count===48);
const op=(groupId,dx=0,dy=0)=>({requestId:rid(),groupId,dx,dy});
function fixture(t,options={}){
 mkdirSync(resolve('work'),{recursive:true});
 const dir=mkdtempSync(resolve('work/mobile-solo-batch-')),databasePath=resolve(dir,'mobile.sqlite'),now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:(_min,max)=>max-1,...options}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(resolve('work')+'\\'));rmSync(dir,{recursive:true,force:true});});
 const call=(actor,url,body,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(...args)=>{const reply=call(...args);assert.ok([200,201].includes(reply.status),JSON.stringify(reply));return reply.data;};
 const profile=actor=>ok(actor,'/api/mobile/profile');
 const patch=(actor,changes)=>{profile(actor);const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...p,...changes}),actor);};
 const player=()=>{const actor=identity();patch(actor,{level:50,xp:20,totalXp:12000,energy:1000,energyAt:now,firstRoomCompleted:true,autoSupply:false});return actor;};
 const room=actor=>ok(actor,'/api/rooms',{mode:'selected',imageId:photo.id,pieces:48,visibility:'public',requestId:rid()});
 const path=ticket=>'/api/rooms/'+ticket.room.id;
 const read=(actor,ticket)=>ok(actor,path(ticket),undefined,ticket.token);
 const batch=(actor,ticket,ops)=>ok(actor,path(ticket),{type:'batch',ops,requestId:rid()},ticket.token);
 const drop=(actor,ticket,operation)=>{ok(actor,path(ticket),{type:'claim',groupId:operation.groupId},ticket.token);return ok(actor,path(ticket),{type:'drop',groupId:operation.groupId,dx:operation.dx,dy:operation.dy,seq:1,requestId:operation.requestId},ticket.token);};
 const rawRoom=ticket=>JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
 return {service,db,call,ok,profile,patch,player,room,path,read,batch,drop,rawRoom,now};
}
const balances=p=>({energy:p.energy,xp:p.xp,totalXp:p.totalXp,coins:p.collection.coins,giftProgress:p.giftProgress,giftCount:p.giftCount,lastReward:p.lastReward});
const progress=view=>view.tasks.map(({id,progress,target})=>({id,progress,target}));

test('solo capability defaults on for mobile and each kill switch rejects batches',t=>{
 const previous=process.env.MOBILE_SOLO_LOCAL_PLAY;
 try{
  delete process.env.MOBILE_SOLO_LOCAL_PLAY;
  assert.equal(fixture(t).service.capabilities.soloLocalPlay,true);
  const disabled=[fixture(t,{soloLocalPlay:false}),fixture(t,{runtimeProfile:'web'})];
  process.env.MOBILE_SOLO_LOCAL_PLAY='false';disabled.push(fixture(t));
  assert.equal(fixture(t,{soloLocalPlay:true}).service.capabilities.soloLocalPlay,true,'explicit host option takes precedence');
  assert.equal(fixture(t,{runtimeProfile:'web',soloLocalPlay:true}).service.capabilities.soloLocalPlay,false);
  for(const f of disabled){
   assert.equal(f.service.capabilities.soloLocalPlay,false);
   const owner=f.player(),ticket=f.room(owner);
   const reply=f.call(owner,f.path(ticket),{type:'batch',ops:[op(0)]},ticket.token);
   assert.equal(reply.status,409);assert.equal(reply.data.code,'SOLO_BATCH_DISABLED');
   assert.equal(f.profile(owner).capabilities.soloLocalPlay,false);
  }
 }finally{if(previous===undefined)delete process.env.MOBILE_SOLO_LOCAL_PLAY;else process.env.MOBILE_SOLO_LOCAL_PLAY=previous;}
});

test('three batched snaps match normal drops, including task counters and durable replay',t=>{
 const f=fixture(t),owner=f.player(),twin=f.player(),ticket=f.room(owner),other=f.room(twin);
 const before=f.profile(owner),ops=ticket.room.puzzle.groups.slice(0,3).map(g=>op(g.id));
 const result=f.batch(owner,ticket,ops);
 assert.deepEqual(result.soloBatch,{applied:ops.map(o=>o.requestId),skipped:[],stopped:null});
 assert.equal(placedCount(result.puzzle),3);
 assert.equal(result.profile.energy,before.energy-3*before.economy.contributionCost);
 assert.equal(result.profile.totalXp,before.totalXp+3*before.economy.contributionXp);
 assert.equal(result.mobileContributions.length,3);
 for(const [i,receipt]of result.mobileContributions.entries()){
  assert.equal(receipt.requestId,ops[i].requestId);assert.equal(receipt.groupId,ops[i].groupId);
  assert.equal(receipt.creditedXp,before.economy.contributionXp);
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_requests WHERE owner=? AND scope=?').get(owner,'room-action:'+ticket.room.id).n,3);
 for(const operation of ops)f.drop(twin,other,{...operation,requestId:rid()});
 assert.deepEqual(balances(result.profile),balances(f.profile(twin)));
 assert.deepEqual(progress(f.ok(owner,'/api/mobile/tasks')),progress(f.ok(twin,'/api/mobile/tasks')));
 const saved=f.rawRoom(ticket),retried=f.batch(owner,ticket,ops);
 assert.deepEqual(retried.soloBatch,result.soloBatch);
 assert.deepEqual(retried.mobileContributions,result.mobileContributions);
 assert.deepEqual(balances(retried.profile),balances(result.profile));
 assert.equal(placedCount(retried.puzzle),3);assert.deepEqual(f.rawRoom(ticket),saved);
 const originalDrop={type:'drop',groupId:ops[0].groupId,dx:0,dy:0,seq:1,requestId:ops[0].requestId};
 assert.equal(f.ok(owner,f.path(ticket),originalDrop,ticket.token).mobileContribution.requestId,ops[0].requestId,'normal drop replays the same fingerprint');
 assert.equal(f.profile(owner).totalXp,result.profile.totalXp);
});

test('non-snapping batches preserve the same clamped offsets as normal drops without spending energy',t=>{
 const f=fixture(t),owner=f.player(),twin=f.player(),ticket=f.room(owner),other=f.room(twin);
 // Identical initial layouts remove any chance of different nearby merge candidates.
 const twinRoom=f.rawRoom(other);twinRoom.puzzle=structuredClone(ticket.room.puzzle);
 f.db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(twinRoom),other.room.id);
 const before=f.profile(owner),operation=op(ticket.room.puzzle.groups[0].id,500,300);
 const result=f.batch(owner,ticket,[operation]),normal=f.drop(twin,other,{...operation,requestId:rid()});
 assert.deepEqual(result.soloBatch.applied,[operation.requestId]);assert.deepEqual(result.mobileContributions,[]);
 assert.equal(result.profile.energy,before.energy);assert.equal(result.profile.totalXp,before.totalXp);
 assert.deepEqual(result.puzzle.groups,normal.puzzle.groups);
 assert.deepEqual(f.read(owner,ticket).puzzle,result.puzzle,'offset persists through a fresh read');
});

test('a peer lease is skipped and later snaps succeed; failed ops restore the caller lease',t=>{
 const f=fixture(t),owner=f.player(),peer=f.player(),ticket=f.room(owner);
 const joined=f.ok(peer,f.path(ticket)+'/join',{}),[a,b,c]=ticket.room.puzzle.groups;
 f.ok(owner,f.path(ticket),{type:'claim',groupId:c.id},ticket.token);
 f.ok(peer,f.path(ticket),{type:'claim',groupId:a.id},joined.token);
 const before=f.rawRoom(ticket),blocked=op(a.id);
 const refused=f.batch(owner,ticket,[blocked]);
 assert.deepEqual(refused.soloBatch,{applied:[],skipped:[{requestId:blocked.requestId,code:'CONFLICT'}],stopped:null});
 assert.deepEqual(f.rawRoom(ticket),before,'claim refusal restores leases and all room fields');
 const good=op(b.id),result=f.batch(owner,ticket,[blocked,good]);
 assert.deepEqual(result.soloBatch.applied,[good.requestId]);assert.equal(result.soloBatch.skipped[0].code,'CONFLICT');
 assert.equal(result.leases[a.id].playerId,joined.playerId);assert.equal(result.leases[c.id],undefined,'other caller leases are released on success');
 assert.equal(result.members.find(m=>m.id===ticket.playerId).contribution,1);
 assert.equal(placedCount(result.puzzle),1);
});

test('energy exhaustion commits only earlier snaps and restores the failed and unprocessed groups',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner);f.patch(owner,{energy:1});
 const before=f.rawRoom(ticket),profile=f.profile(owner),ops=before.puzzle.groups.slice(0,3).map(g=>op(g.id));
 const result=f.batch(owner,ticket,ops);
 assert.deepEqual(result.soloBatch.applied,[ops[0].requestId]);assert.deepEqual(result.soloBatch.skipped,[]);
 assert.equal(result.soloBatch.stopped.requestId,ops[1].requestId);assert.equal(result.soloBatch.stopped.code,'ENERGY_EMPTY');
 assert.ok(result.soloBatch.stopped.message);assert.equal(result.profile.energy,0);
 assert.equal(result.profile.totalXp,profile.totalXp+profile.economy.contributionXp);
 for(const operation of ops.slice(1))assert.deepEqual(result.puzzle.groups.find(g=>g.id===operation.groupId),before.puzzle.groups.find(g=>g.id===operation.groupId));
 assert.deepEqual(result.leases,{});assert.equal(placedCount(result.puzzle),1);
 assert.deepEqual(balances(f.profile(owner)),balances(result.profile));assert.deepEqual(f.read(owner,ticket).puzzle,result.puzzle);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events WHERE owner=?').get(owner).n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_requests WHERE owner=? AND scope=?').get(owner,'room-action:'+ticket.room.id).n,1);
 f.patch(owner,{energy:10});const resumed=f.batch(owner,ticket,ops);
 assert.deepEqual(resumed.soloBatch.applied,ops.map(o=>o.requestId));assert.equal(placedCount(resumed.puzzle),3);
 assert.equal(resumed.profile.totalXp,profile.totalXp+3*profile.economy.contributionXp);
});

test('completion returns the settled profile immediately and retries never repeat completion rewards',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner),before=f.profile(owner);let current=ticket.room,lastOps;
 assert.equal(SOLO_BATCH_MAX,40);
 while(current.completedAt===null){
  lastOps=current.puzzle.groups.filter(g=>!g.locked).slice(0,SOLO_BATCH_MAX).map(g=>op(g.id));
  assert.ok(lastOps.length);current=f.batch(owner,ticket,lastOps);assert.equal(current.soloBatch.stopped,null);assert.deepEqual(current.soloBatch.skipped,[]);
 }
 assert.equal(current.completedAt,f.now);assert.ok(current.mobileResult);assert.ok(current.mobileResult.energy>0);
 assert.equal(placedCount(current.puzzle),current.puzzle.cols*current.puzzle.rows);
 const count=current.puzzle.cols*current.puzzle.rows;
 assert.equal(current.profile.energy,before.energy-count*before.economy.contributionCost+current.mobileResult.energy);
 assert.equal(current.profile.lastReward.completion.energy,current.mobileResult.energy);
 assert.deepEqual(balances(current.profile),balances(f.profile(owner)));
 const retry=f.batch(owner,ticket,lastOps);assert.deepEqual(balances(retry.profile),balances(current.profile));
 assert.deepEqual(retry.mobileResult,current.mobileResult);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_settlements WHERE room_id=?').get(ticket.room.id).n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_collection_completions WHERE room_id=?').get(ticket.room.id).n,1);
});

test('invalid batch lengths and diagnostic rooms reject; malformed middle ops do not block later snaps',async t=>{
 const owner=identity(),f=fixture(t,{diagnosticAccountIds:[owner],tapTap:{exchangeCode:async()=>({openid:'solo-batch-diagnostic-owner'})}});
 assert.equal((await f.service.bindTapTap({identity:owner,code:'solo-batch-diagnostic-code'})).status,200);
 f.patch(owner,{level:50,xp:20,totalXp:12000,energy:1000,firstRoomCompleted:true});const ticket=f.room(owner);
 for(const ops of [undefined,null,{},[],Array.from({length:41},()=>op(0))]){
  const reply=f.call(owner,f.path(ticket),{type:'batch',ops},ticket.token);
  assert.equal(reply.status,400);assert.equal(reply.data.code,'INVALID_BATCH');
 }
 const diagnostic=f.ok(owner,'/api/mobile/diagnostics/room',{requestId:rid()});
 const reply=f.call(owner,f.path(diagnostic),{type:'batch',ops:[op(0)]},diagnostic.token);
 assert.equal(reply.status,409);assert.equal(reply.data.code,'SOLO_BATCH_UNAVAILABLE');
 const [a,b]=ticket.room.puzzle.groups;
 const invalid=[null,42,{},op(-1),op(.5),op(Number.MAX_SAFE_INTEGER+1),op(b.id,'0',0),op(b.id,Infinity,0),op(b.id,0,NaN),op(b.id,20001,0),op(b.id,0,-20001),{...op(b.id),requestId:'bad'}];
 const first=op(a.id),last=op(b.id),result=f.batch(owner,ticket,[first,...invalid,last]);
 assert.deepEqual(result.soloBatch.applied,[first.requestId,last.requestId]);assert.equal(result.soloBatch.skipped.length,invalid.length);
 assert.deepEqual(result.soloBatch.skipped,invalid.map(operation=>({requestId:typeof operation?.requestId==='string'?operation.requestId:null,code:'INVALID_OP'})));
 assert.equal(result.soloBatch.stopped,null);assert.equal(placedCount(result.puzzle),2);
 const conflict=f.batch(owner,ticket,[{...first,dx:20},op(a.id),op(999999),op(ticket.room.puzzle.groups[2].id)]);
 assert.deepEqual(conflict.soloBatch.skipped.map(s=>s.code),['REQUEST_CONFLICT','CONFLICT','CONFLICT']);assert.equal(conflict.soloBatch.applied.length,1);
});

test('rollback keeps room, profile and every member identity for the next op and handler closures',()=>{
 const member={id:'a',name:'owner'},peer={id:'b',name:'peer'},room={id:'room',members:[member,peer],leases:{},revision:0},p={id:'owner',energy:2};
 const first=op(0),second=op(1);let calls=0;
 const soloBatch=createSoloBatch({enabled:true,requestKey:value=>/^[a-f0-9]{32}$/.test(value),fail:()=>assert.fail(),snapshotView:()=>({}),profileView:profile=>({...profile}),replay:(profile,_scope,_drop,_now,fn)=>{assert.equal(profile,p);return fn();},engine:{applyAction(live,who){
  assert.equal(live,room);assert.equal(who,member);assert.equal(live.members[0],member);assert.equal(live.members[1],peer);
  if(calls++===0){member.name='changed';member.extra=true;delete peer.name;room.members.reverse();room.extra=true;p.energy=0;p.extra=true;throw Object.assign(new Error('conflict'),{status:409});}
  assert.deepEqual(member,{id:'a',name:'owner'});assert.deepEqual(peer,{id:'b',name:'peer'});assert.equal(room.extra,undefined);assert.deepEqual(p,{id:'owner',energy:2});
 }}});
 const result=soloBatch({room,member,p,input:{ops:[first,second]},now:1,since:null,act:()=>({})});
 assert.deepEqual(result.soloBatch.applied,[second.requestId]);assert.equal(room.members[0],member);assert.equal(room.members[1],peer);
});

test('unexpected failures roll back successful earlier ops and their SQLite receipts',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner),before=f.rawRoom(ticket),profile=f.profile(owner);
 f.db.exec("CREATE TRIGGER fail_second_event BEFORE INSERT ON mobile_task_events WHEN (SELECT COUNT(*) FROM mobile_task_events)=1 BEGIN SELECT RAISE(ABORT,'unexpected storage failure'); END");
 const ops=ticket.room.puzzle.groups.slice(0,2).map(g=>op(g.id));
 const reply=f.call(owner,f.path(ticket),{type:'batch',ops},ticket.token);
 assert.equal(reply.status,500);assert.deepEqual(f.rawRoom(ticket),before);assert.deepEqual(balances(f.profile(owner)),balances(profile));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_requests WHERE scope=?').get('room-action:'+ticket.room.id).n,0);
 f.db.exec('DROP TRIGGER fail_second_event');assert.deepEqual(f.batch(owner,ticket,ops).soloBatch.applied,ops.map(o=>o.requestId));
});
