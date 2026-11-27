import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';

const owner='a'.repeat(64),observer='b'.repeat(64),start=1800000000000;
function fixture(options={}){
 mkdirSync(resolve('work'),{recursive:true});
 const dir=mkdtempSync(resolve('work/mobile-write-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=start;
 const configuration={...options,databasePath,now:()=>now};
 const service=createMobileService(configuration),peer=createMobileService(configuration),db=new DatabaseSync(databasePath);
 db.exec(`CREATE TABLE write_audit(target TEXT NOT NULL,operation TEXT NOT NULL);
 CREATE TRIGGER profile_insert AFTER INSERT ON mobile_profiles BEGIN INSERT INTO write_audit VALUES('profile','insert'); END;
 CREATE TRIGGER profile_update AFTER UPDATE ON mobile_profiles BEGIN INSERT INTO write_audit VALUES('profile','update'); END;
 CREATE TRIGGER presence_insert AFTER INSERT ON mobile_social_players BEGIN INSERT INTO write_audit VALUES('presence','insert'); END;
 CREATE TRIGGER presence_update AFTER UPDATE ON mobile_social_players BEGIN INSERT INTO write_audit VALUES('presence','update'); END;`);
 const call=(url='/api/mobile/profile',{body,method=body===undefined?'GET':'POST',identity=owner,instance=service}={})=>instance.handle({identity,url,method,body});
 const stored=(identity=owner)=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);
 const patch=updates=>db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...stored(),...updates}),owner);
 const writes=(target,operation)=>Number(db.prepare('SELECT COUNT(*) n FROM write_audit WHERE target=? AND operation=?').get(target,operation).n);
 return {db,service,peer,call,stored,patch,writes,reset:()=>db.exec('DELETE FROM write_audit'),get now(){return now;},set now(value){now=value;},close(){db.close();service.close();peer.close();assert.ok(dir.startsWith(resolve('work')+'\\'));rmSync(dir,{recursive:true,force:true});}};
}

test('profile initialization and stable reads save once; full-energy timestamps retain their original semantics',()=>{
 const f=fixture();try{
  const initial=f.call();assert.equal(initial.status,200);assert.match(initial.data.code,/^[1-9]\d{8}$/);
  assert.equal(f.writes('profile','insert'),1);assert.equal(f.writes('profile','update'),0);assert.equal(f.writes('presence','insert'),1);
  f.reset();assert.equal(f.call().status,200);assert.equal(f.writes('profile','update'),0);
  f.now++;assert.equal(f.call().status,200);assert.equal(f.writes('profile','update'),1,'a changed full-energy clock is still persisted');assert.equal(f.stored().energyAt,f.now);
  f.patch({energy:20,energyAt:f.now});f.reset();
  for(let i=0;i<9;i++){f.now+=1000;assert.equal(f.call().status,200);}
  assert.equal(f.writes('profile','update'),0);assert.equal(f.writes('presence','update'),0);
  f.now=start+10000;assert.equal(f.call().status,200);assert.equal(f.writes('presence','update'),1);
 }finally{f.close();}
});

test('supply mutations save once, replay does not save again, and failed recovery or new identities roll back',()=>{
 const f=fixture({publicTestPolicy:{customNames:true}});try{
  f.call();f.patch({energy:10,energyAt:f.now,supply:{energy:1,create:0}});f.reset();
  const body={kind:'energy',requestId:'1'.repeat(32)},first=f.call('/api/mobile/supply/use',{body});
  assert.equal(first.status,200);assert.equal(first.data.supply.energy,0);assert.equal(f.writes('profile','update'),1);
  assert.deepEqual(f.call('/api/mobile/supply/use',{body}),first);assert.equal(f.writes('profile','update'),1);
  f.patch({energy:10,energyAt:f.now});f.now+=300000;f.reset();
  const before=f.stored();assert.equal(f.call('/api/mobile/profile',{method:'PATCH',body:{name:''}}).status,400);
  assert.deepEqual(f.stored(),before);assert.equal(f.writes('profile','update'),0);assert.equal(f.writes('presence','update'),0);
  const recovered=f.call();assert.equal(recovered.data.energy,11);assert.equal(f.writes('profile','update'),1);assert.equal(f.writes('presence','update'),1);
  f.reset();assert.equal(f.call('/api/does-not-exist',{identity:observer}).status,404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_profiles WHERE id=?').get(observer).n,0);
  assert.equal(f.writes('profile','insert'),0);assert.equal(f.writes('presence','insert'),0);
  assert.equal(f.call(undefined,{identity:observer}).status,200);assert.equal(f.writes('profile','insert'),1);
 }finally{f.close();}
});

test('instances share presence throttling and always read newly committed profiles',()=>{
 const f=fixture({runtimeProfile:'web'});try{
  const initial=f.call().data;f.reset();
  f.now=start+9999;assert.equal(f.call(undefined,{instance:f.peer}).data.code,initial.code);assert.equal(f.writes('presence','update'),0);
  f.now++;assert.equal(f.call(undefined,{instance:f.peer}).status,200);assert.equal(f.call().status,200);assert.equal(f.writes('presence','update'),1);
  const updated=f.call('/api/mobile/profile',{method:'PATCH',body:{name:'跨实例玩家',autoSupply:false},instance:f.peer});assert.equal(updated.status,200);
  assert.equal(f.call().data.name,'跨实例玩家');assert.equal(f.call().data.autoSupply,false);assert.equal(f.writes('profile','update'),1);
  f.reset();for(let i=0;i<8;i++){f.now+=1000;assert.equal(f.call(undefined,{instance:i%2?f.peer:f.service}).status,200);}
  assert.equal(f.writes('profile','update'),0);assert.equal(f.writes('presence','update'),0);
 }finally{f.close();}
});

test('presence keeps the 90-second online cutoff, refreshes after idle, and tolerates a backward clock',()=>{
 const f=fixture({runtimeProfile:'web'});try{
  const code=f.call().data.code;
  const observed=()=>f.call('/api/mobile/social/search?code='+code,{identity:observer,instance:f.peer}).data.player;
  f.now=start+89999;assert.equal(observed().online,true);assert.equal(observed().lastSeenAt,start);
  f.now++;assert.equal(observed().online,false);
  assert.equal(f.call().status,200);assert.equal(observed().online,true);assert.equal(observed().lastSeenAt,f.now);
  f.now=start+1;assert.equal(f.call().status,200);assert.equal(observed().lastSeenAt,f.now);
 }finally{f.close();}
});
