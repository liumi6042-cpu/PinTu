import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');

function completeRoom(call,room,token,identity){
 const auth='Bearer '+token,roomPath='/api/rooms/'+room.id;
 let state=room;
 while(state.completedAt===null){
  const group=state.puzzle.groups.find(g=>!g.locked);
  const claim=call(roomPath,{type:'claim',groupId:group.id,requestId:rid()},identity,auth);
  assert.equal(claim.status,200,JSON.stringify(claim.data));
  const drop=call(roomPath,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},identity,auth);
  assert.equal(drop.status,200,JSON.stringify(drop.data));
  state=drop.data;
 }
 return state;
}

function fixture(options={}){
 const now=Date.parse('2030-06-01T12:00:00+08:00');
 const root=resolve('work');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'completion-double-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>now,adEnabled:true,...options}),db=new DatabaseSync(databasePath),identity='a'.repeat(64);
 const call=(url,body,who=identity,authorization)=>service.handle({identity:who,url,method:body===undefined?'GET':'POST',body,authorization});
 call('/api/mobile/profile');
 const created=call('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
 assert.equal(created.status,201,JSON.stringify(created.data));
 return {call,db,identity,room:created.data.room,token:created.data.token,close(){db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('completing a room allows doubling base coins & fragments once via rewarded ad; replay is idempotent',()=>{
 const f=fixture();try{
  // Unfinished room cannot double yet.
  const early=f.call('/api/mobile/completion/double/challenge',{roomId:f.room.id,requestId:rid()});
  assert.equal(early.status,409);assert.equal(early.data.code,'COMPLETION_NOT_FOUND');

  const done=completeRoom(f.call,f.room,f.token,f.identity);
  const baseCoins=done.mobileResult.coins,baseFragments=done.mobileResult.fragments;
  assert.ok(baseCoins>0&&baseFragments>0,'expected positive completion rewards');
  assert.equal(done.mobileResult.doubleClaimed,false);

  const beforeWallet=f.call('/api/mobile/profile').data.collection;
  const reqId=rid();
  const ch=f.call('/api/mobile/completion/double/challenge',{roomId:f.room.id,requestId:reqId});
  assert.equal(ch.status,200,JSON.stringify(ch.data));

  // Uncompleted watch is rejected.
  const incomplete=f.call('/api/mobile/completion/double/redeem',{roomId:f.room.id,requestId:reqId,rewardToken:ch.data.rewardToken,completed:false});
  assert.equal(incomplete.status,403);assert.equal(incomplete.data.code,'AD_EXPIRED');

  // Completed watch doubles base coins & fragments once.
  const redeemed=f.call('/api/mobile/completion/double/redeem',{roomId:f.room.id,requestId:reqId,rewardToken:ch.data.rewardToken,completed:true});
  assert.equal(redeemed.status,200,JSON.stringify(redeemed.data));
  assert.deepEqual(redeemed.data.doubled,{roomId:f.room.id,alreadyClaimed:false,coins:baseCoins,fragments:baseFragments});
  assert.equal(redeemed.data.completion.doubleClaimed,true);
  assert.deepEqual(redeemed.data.completion.doubleBonus,{coins:baseCoins,fragments:baseFragments});
  assert.equal(redeemed.data.collection.coins,beforeWallet.coins+baseCoins);
  assert.equal(redeemed.data.collection.fragments,beforeWallet.fragments+baseFragments);

  // Replaying same requestId returns stored reply without paying again.
  const replay=f.call('/api/mobile/completion/double/redeem',{roomId:f.room.id,requestId:reqId,rewardToken:ch.data.rewardToken,completed:true});
  assert.equal(replay.status,200);
  assert.equal(f.call('/api/mobile/profile').data.collection.coins,beforeWallet.coins+baseCoins);

  // Room snapshot reflects doubled status; a fresh requestId is rejected.
  const snap=f.call('/api/rooms/'+f.room.id,undefined,f.identity,'Bearer '+f.token).data;
  assert.equal(snap.mobileResult.doubleClaimed,true);
  assert.deepEqual(snap.mobileResult.doubleBonus,{coins:baseCoins,fragments:baseFragments});
  const again=f.call('/api/mobile/completion/double/challenge',{roomId:f.room.id,requestId:rid()});
  assert.equal(again.status,409);assert.equal(again.data.code,'COMPLETION_ALREADY_DOUBLED');
 }finally{f.close();}
});

test('completion double rejects strangers, cancelled tokens, wrong room tokens, and ad-disabled/web runtimes',()=>{
 const f=fixture();try{
  completeRoom(f.call,f.room,f.token,f.identity);
  const stranger='b'.repeat(64);
  f.call('/api/mobile/profile',undefined,stranger);
  const noReward=f.call('/api/mobile/completion/double/challenge',{roomId:f.room.id,requestId:rid()},stranger);
  assert.equal(noReward.status,404);assert.equal(noReward.data.code,'COMPLETION_NOT_FOUND');

  const reqId=rid(),ch=f.call('/api/mobile/completion/double/challenge',{roomId:f.room.id,requestId:reqId});
  assert.equal(ch.status,200);
  assert.equal(f.call('/api/mobile/completion/double/cancel',{roomId:f.room.id,requestId:reqId,rewardToken:ch.data.rewardToken}).status,200);
  assert.equal(f.call('/api/mobile/completion/double/redeem',{roomId:f.room.id,requestId:reqId,rewardToken:ch.data.rewardToken,completed:true}).data.code,'AD_EXPIRED');
 }finally{f.close();}

 const web=fixture({runtimeProfile:'web',adEnabled:false});try{
  completeRoom(web.call,web.room,web.token,web.identity);
  const off=web.call('/api/mobile/completion/double/challenge',{roomId:web.room.id,requestId:rid()});
  assert.equal(off.status,503);assert.equal(off.data.code,'ADS_UNAVAILABLE');
 }finally{web.close();}
});
