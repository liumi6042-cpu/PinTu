import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMobileService} from '../server/mobile-service.mjs';

const script=resolve('scripts/grant-decoration.mjs');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[script,...args],{encoding:'utf8'}));

test('grant script finds players, dry-runs, backs up, and grants cat-paw, energy and packs once',()=>{
 const workRoot=resolve('work');mkdirSync(workRoot,{recursive:true});
 const dir=mkdtempSync(resolve(workRoot,'grant-decoration-test-')),databasePath=resolve(dir,'mobile.sqlite'),owner='e'.repeat(64);
 const service=createMobileService({databasePath,now:()=>Date.now(),randomInt:min=>min});
 try{
  assert.equal(service.handle({identity:owner,url:'/api/mobile/profile',method:'GET'}).status,200);
  const fixture=new DatabaseSync(databasePath);
  const profile=JSON.parse(fixture.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);
  fixture.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...profile,name:'Echo',energy:3,energyAt:Date.now(),supply:{energy:1,create:2}}),owner);
  fixture.close();
  const found=run('--db',databasePath,'--list-nickname','ech');
  assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].canonicalIdentity,owner);assert.match(found.candidates[0].playerCode,/^\d{9}$/);
  assert.equal(run('--db',databasePath,'--player-code',found.candidates[0].playerCode).candidates[0].canonicalIdentity,owner);
  const args=['--db',databasePath,'--owner',owner,'--grant','cat-paw','--energy','100','--fill-refills','--source','gift:20261030-echo'];
  const dry=run(...args);
  assert.equal(dry.result,'dry-run');assert.deepEqual(dry.plan,{decoration:'cat-paw',energy:100,fillRefills:true,source:'gift:20261030-echo'});
  assert.equal(dry.player.energy,3);
  const granted=run(...args,'--yes');
  assert.equal(granted.result,'granted');assert.ok(existsSync(granted.backup));
  assert.equal(granted.details.decoration,'granted');
  assert.equal(granted.details.supplies.to.energy,103,'energy may exceed the cap');assert.equal(granted.details.supplies.to.energyPacks,3);
  assert.deepEqual(granted.player.ownedDecorations,['cat-paw']);
  assert.equal(run(...args,'--yes').result,'already-granted','the same source is applied once');
  const view=service.handle({identity:owner,url:'/api/mobile/profile',method:'GET'});
  assert.equal(view.data.energy,103);assert.equal(view.data.supply.energy,3);assert.equal(view.data.supply.create,2);
  assert.throws(()=>execFileSync(process.execPath,[script,'--db',databasePath,'--owner',owner,'--energy','5'],{stdio:'pipe'}),/--source/);
 }finally{service.close();assert.ok(dir.startsWith(workRoot+sep));rmSync(dir,{recursive:true,force:true});}
});
