import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
import {energyCap,inviteCapBonus,INVITE_CAP_BONUS,xpForLevel} from '../server/mobile-economy.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';

const rid=()=>randomBytes(16).toString('hex'),identity=()=>randomBytes(32).toString('hex');
function fixture(runtimeProfile){
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-invite-cap-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=Date.parse('2026-10-24T04:00:00Z');
 const options={databasePath,runtimeProfile,now:()=>now,randomInt:min=>min,guestNames:false};
 const service=createMobileService(options),db=new DatabaseSync(databasePath);
 const call=(owner,url,body,token,instance=service)=>instance.handle({identity:owner,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(...args)=>{const r=call(...args);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.data;};
 const profile=owner=>ok(owner,'/api/mobile/profile'),tasks=owner=>ok(owner,'/api/mobile/tasks');
 const patch=(owner,changes)=>{const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);Object.assign(p,changes);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),owner);};
 const player=()=>{const owner=identity();profile(owner);return owner;};
 const historical=(owner,count,{qualifiedAt=now-365*86400000,status='awarded',contributions=3}={})=>{
  for(let i=0;i<count;i++)db.prepare('INSERT INTO mobile_invitation_bindings(invitee,inviter,bound_at,contributions,qualified_at,reward_status) VALUES(?,?,?,?,?,?)').run(identity(),owner,now-366*86400000,contributions,qualifiedAt,status);
 };
 const room=owner=>ok(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
 const drop=(owner,ticket)=>{
  const path='/api/rooms/'+ticket.room.id,current=ok(owner,path,undefined,ticket.token),group=current.puzzle.groups.find(g=>!g.locked);
  ok(owner,path,{type:'claim',groupId:group.id},ticket.token);
  return ok(owner,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},ticket.token);
 };
 const gift=owner=>db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),owner,'invite-refill',0,0,'fixture:'+rid(),now);
 return {options,db,call,ok,profile,tasks,patch,player,historical,room,drop,gift,get now(){return now;},advance:ms=>{now+=ms;},close(){db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('qualified invitations add 0/1/5 capacity; pending bindings do not count',()=>{
 const f=fixture();try{
  assert.deepEqual(INVITE_CAP_BONUS,{perFriend:1,maximum:5,countBefore:null});
  for(const [qualified,expected] of [[0,0],[1,1],[7,5]]){
   const a=f.player();f.historical(a,qualified);f.historical(a,2,{qualifiedAt:null,contributions:2});
   const p=f.profile(a),v=f.tasks(a);assert.equal(p.energyCap,energyCap(0)+expected);assert.deepEqual(p.inviteCapBonus,{count:expected,maximum:5});
   assert.equal(v.invitation.capBonus,expected);assert.equal(v.invitation.capBonusMaximum,5);assert.equal(v.invitation.qualifiedCount,qualified);
  }
 }finally{f.close();}
});

test('historical qualifications apply at read time without rewriting history or granting rewards',()=>{
 const f=fixture();try{
  const a=f.player();f.tasks(a);f.historical(a,2);const before=f.db.prepare('SELECT * FROM mobile_invitation_bindings ORDER BY invitee').all();
  f.db.exec("CREATE TRIGGER no_invite_update BEFORE UPDATE ON mobile_invitation_bindings BEGIN SELECT RAISE(ABORT,'history is read-only'); END");
  const changes=f.db.prepare('SELECT total_changes() n').get().n;assert.deepEqual(inviteCapBonus(f.db,a),{count:2,maximum:5});assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
  const p=f.profile(a);assert.equal(p.energyCap,energyCap(0)+2);assert.equal(p.giftCount,0);assert.equal(f.tasks(a).invitation.capBonus,2);
  assert.deepEqual(f.db.prepare('SELECT * FROM mobile_invitation_bindings ORDER BY invitee').all(),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_gifts').get().n,0);
 }finally{f.close();}
});

test('four actual qualifications count +4 while the same day grants only three refill packs',()=>{
 const f=fixture();try{
  const a=f.player(),code=f.tasks(a).invitation.code;
  for(let i=0;i<4;i++){
   const b=f.player(),ticket=f.room(b);f.ok(b,'/api/mobile/invitations/accept',{code,requestId:rid()});
   f.drop(b,ticket);f.drop(b,ticket);assert.equal(f.profile(a).inviteCapBonus.count,i);
   f.drop(b,ticket);assert.equal(f.profile(a).inviteCapBonus.count,i+1);
  }
  const v=f.tasks(a);assert.equal(v.invitation.qualifiedCount,4);assert.equal(v.invitation.capBonus,4);assert.equal(v.invitation.todayRewarded,3);assert.equal(v.inventory.find(g=>g.kind==='invite-refill').count,3);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mobile_invitation_bindings WHERE inviter=? AND reward_status='daily-limit'").get(a).n,1);
 }finally{f.close();}
});

test('invitation bonus stacks above the level maximum and refreshes across service instances',()=>{
 const f=fixture();let other;try{
  const a=f.player();f.patch(a,{level:1000});f.historical(a,7);other=createMobileService(f.options);
  assert.equal(f.profile(a).energyCap,DEFAULT_GAME_SETTINGS.energy.maximumCap+5);
  assert.equal(f.ok(a,'/api/mobile/profile',undefined,undefined,other).energyCap,DEFAULT_GAME_SETTINGS.energy.maximumCap+5);
  const b=f.player();assert.equal(f.ok(b,'/api/mobile/profile',undefined,undefined,other).inviteCapBonus.count,0);f.historical(b,1);assert.equal(f.ok(b,'/api/mobile/profile',undefined,undefined,other).inviteCapBonus.count,1);
 }finally{other?.close();f.close();}
});

test('natural recovery reaches the effective ceiling, reports its timer and preserves overflow',()=>{
 const f=fixture();try{
  const a=f.player();f.historical(a,2);const cap=energyCap(0)+2,interval=DEFAULT_GAME_SETTINGS.energy.naturalRecoveryMinutes*60000;
  f.patch(a,{energy:cap-2,energyAt:f.now});assert.equal(f.profile(a).naturalRecoveryAt,f.now+interval);
  f.advance(interval);assert.equal(f.profile(a).energy,cap-1);f.advance(interval*10);const p=f.profile(a);assert.equal(p.energy,cap);assert.equal(p.naturalRecoveryAt,null);
  f.patch(a,{energy:cap+10});f.advance(interval*10);assert.equal(f.profile(a).energy,cap+10);
 }finally{f.close();}
});

test('full-refill gifts and supply use the effective cap for fills and ENERGY_FULL',()=>{
 const f=fixture();try{
  const a=f.player();f.historical(a,2);const cap=energyCap(0)+2;f.gift(a);f.gift(a);f.patch(a,{energy:energyCap(0),supply:{energy:2,create:1}});
  const input={kind:'invite-refill',quantity:1,requestId:rid()},opened=f.ok(a,'/api/mobile/gifts/open',input);assert.equal(opened.opened.energy,2);assert.equal(opened.profile.energy,cap);
  assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,requestId:rid()}).data.code,'ENERGY_FULL');assert.equal(f.profile(a).giftCount,1);
  assert.equal(f.call(a,'/api/mobile/supply/use',{kind:'energy',requestId:rid()}).data.code,'ENERGY_FULL');
  f.patch(a,{energy:energyCap(0)});const filled=f.ok(a,'/api/mobile/supply/use',{kind:'energy',requestId:rid()});assert.equal(filled.energy,cap);assert.equal(filled.supply.energy,1);
  f.patch(a,{energy:cap+10});assert.equal(f.call(a,'/api/mobile/gifts/open',{...input,requestId:rid()}).data.code,'ENERGY_FULL');assert.equal(f.profile(a).energy,cap+10);
 }finally{f.close();}
});

test('auto supply and contribution level-up refills include the invitation bonus',()=>{
 const f=fixture();try{
  const a=f.player();f.historical(a,3);f.patch(a,{firstRoomCompleted:true,level:10,xp:0,energy:0,autoSupply:true,supply:{energy:1,create:1}});const ticket=f.room(a),r=f.drop(a,ticket);
  assert.equal(r.profile.energy,energyCap(10)+3-DEFAULT_GAME_SETTINGS.energy.contributionCost);assert.equal(r.profile.supply.energy,0);assert.equal(r.profile.lastReward.autoUsed,true);
  f.patch(a,{level:0,xp:xpForLevel(1)-1,energy:1,autoSupply:false});const levelled=f.drop(a,ticket).profile;assert.equal(levelled.level,1);assert.equal(levelled.energy,energyCap(1)+3);
 }finally{f.close();}
});

test('gift and sharing experience refills use the effective cap after levelling',()=>{
 const f=fixture();try{
  const a=f.player();f.historical(a,2);f.patch(a,{energy:0,xp:xpForLevel(1)-1});
  f.db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(rid(),a,'invite-friend',10,2,'legacy:'+rid(),f.now);
  const opened=f.ok(a,'/api/mobile/gifts/open',{kind:'invite-friend',quantity:1,requestId:rid()});assert.equal(opened.profile.energy,opened.profile.energyCap+10);assert.equal(opened.profile.energyCap,energyCap(opened.profile.level)+2);
  f.patch(a,{level:0,xp:0,energy:0});const shared=f.ok(a,'/api/mobile/invitations/share',{requestId:rid(),shared:true});assert.ok(shared.profile.level>0);assert.equal(shared.profile.energy,energyCap(shared.profile.level)+2+shared.shared.energy);
 }finally{f.close();}
});

test('web ignores qualified invitations and retains its disabled-energy DTO meaning and gifts',()=>{
 const f=fixture('web');try{
  const a=f.player(),before=f.profile(a);f.historical(a,7);f.advance(86400000);const p=f.profile(a),v=f.tasks(a);
  assert.equal(p.capabilities.energy,false);assert.equal(p.energy,0);assert.equal(p.energyCap,before.energyCap);assert.equal('inviteCapBonus' in p,false);assert.equal('capBonus' in v.invitation,false);assert.equal('capBonusMaximum' in v.invitation,false);
  f.gift(a);assert.equal(f.ok(a,'/api/mobile/gifts/open',{kind:'invite-refill',quantity:1,requestId:rid()}).opened.energy,0);assert.equal(f.profile(a).energy,0);
 }finally{f.close();}
});
