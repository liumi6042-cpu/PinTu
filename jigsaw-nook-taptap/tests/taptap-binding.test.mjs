import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileService } from '../server/mobile-service.mjs';

const identity=letter=>letter.repeat(64);
const request=(service,owner,url,body)=>service.handle({identity:owner,method:body===undefined?'GET':'POST',url,body});

test('TapTap binding is idempotent, restores an empty guest, and protects a non-empty guest',async()=>{
 const calls=[];
 const service=createMobileService({databasePath:':memory:',tapTap:{exchangeCode:async code=>{calls.push(code);return {openid:'tap-user-1'};}}});
 const a=identity('a'),b=identity('b'),c=identity('c');
 try{
  request(service,a,'/api/mobile/profile');
  const first=await service.bindTapTap({identity:a,code:'one-time-code',nickname:'小窝玩家'});
  assert.equal(first.status,200);assert.equal(first.data.profile.taptap.bound,true);assert.equal(first.data.profile.name,'小窝玩家');
  const retry=await service.bindTapTap({identity:a,code:'one-time-code'});
  assert.equal(retry.status,200);assert.equal(retry.data.profile.taptap.bound,true);assert.equal(calls.length,1,'a repeated code is served from the durable replay record');
  request(service,c,'/api/mobile/profile');
  const restored=await service.bindTapTap({identity:c,code:'one-time-code'});
  assert.equal(restored.status,200);assert.equal(restored.data.profile.name,'小窝玩家');
  request(service,b,'/api/mobile/profile');
  const room=request(service,b,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:'b'.repeat(32)});
  assert.equal(room.status,201);
  const conflict=await service.bindTapTap({identity:b,code:'one-time-code'});
  assert.equal(conflict.status,409);assert.equal(conflict.data.code,'TAPTAP_ACCOUNT_CONFLICT');
  const untouched=request(service,b,'/api/mobile/profile');assert.equal(untouched.data.taptap.bound,false);
 }finally{service.close();}
});
