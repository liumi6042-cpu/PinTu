import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';
const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),other='b'.repeat(64);

test('completed creation ad refills each partial inventory, and replay cannot refill after spending',()=>{
 for(const initial of [0,1,2]){
  mkdirSync('work',{recursive:true});const folder=mkdtempSync(resolve('work/ticket-refill-')),databasePath=resolve(folder,'synthetic.sqlite');
  const service=createMobileService({shareRewards:false,databasePath,adEnabled:true,now:()=>1800000000000}),db=new DatabaseSync(databasePath);
  const call=(who,url,body)=>service.handle({identity:who,url,method:body?'POST':'GET',body});
  try{
   call(owner,'/api/mobile/profile');const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);
   p.supply={energy:1,create:initial};p.firstRoomCompleted=true;p.starterSelectionAvailable=false;
   db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),owner);
   const input={kind:'create',requestId:rid()},challenge=call(owner,'/api/mobile/supply/challenge',input);
   assert.equal(challenge.status,200);const redeem={...input,rewardToken:challenge.data.rewardToken,completed:true};
   assert.equal(call(other,'/api/mobile/supply/redeem',redeem).status,403);
   const result=call(owner,'/api/mobile/supply/redeem',redeem);assert.equal(result.status,200);assert.deepEqual(result.data.supply,{energy:1,create:3});
   assert.equal(call(owner,'/api/mobile/supply/challenge',{kind:'create',requestId:rid()}).data.code,'SUPPLY_FULL');
   const room=call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'private',requestId:rid()});assert.equal(room.status,201);
   assert.equal(call(owner,'/api/mobile/profile').data.supply.create,2);
   assert.equal(call(owner,'/api/mobile/supply/redeem',redeem).status,200);
   assert.equal(call(owner,'/api/mobile/profile').data.supply.create,2,'old completion receipt must not top up again');
  }finally{db.close();service.close();rmSync(folder,{recursive:true,force:true});}
 }
});

test('closed or incomplete ads never refill tickets; energy pack reward stays at one',()=>{
 const service=createMobileService({shareRewards:false,databasePath:':memory:',adEnabled:true,now:()=>1800000000000});
 const call=(url,body)=>service.handle({identity:owner,url,method:body?'POST':'GET',body});
 try{
  const before=call('/api/mobile/profile').data.supply.create,input={kind:'create',requestId:rid()},c=call('/api/mobile/supply/challenge',input).data;
  const redeem={...input,rewardToken:c.rewardToken};assert.equal(call('/api/mobile/supply/redeem',{...redeem,completed:false}).status,403);
  call('/api/mobile/supply/cancel',redeem);assert.equal(call('/api/mobile/supply/redeem',{...redeem,completed:true}).data.code,'AD_EXPIRED');
  assert.equal(call('/api/mobile/profile').data.supply.create,before);
  const energy={kind:'energy',requestId:rid()},token=call('/api/mobile/supply/challenge',energy).data.rewardToken;
  assert.equal(call('/api/mobile/supply/redeem',{...energy,rewardToken:token,completed:true}).data.supply.energy,1);
 }finally{service.close();}
});
