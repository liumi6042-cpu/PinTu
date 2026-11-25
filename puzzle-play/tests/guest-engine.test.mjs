import { makeFixtureRoom as makeRoom } from './legacy-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, applyAction, authenticate, snapshot, ONLINE_MS } from '../lib/room-engine.ts';
function room(visibility='public',ownerId){return Object.assign(makeRoom('guest-test','seaside-native-v2',12,1000),{visibility,ownerId,startedAt:null,participants:{}});}
test('guest identity survives reconnect/pruning and guest/account participants are counted once',()=>{
 const r=room(),a=addMember(r,'a','游客 A123','secret-a',2000,undefined,'guest:one');
 const again=addMember(r,'again','游客 A123','secret-again',2500,undefined,'guest:one');assert.equal(a.id,again.id);assert.equal(r.members.length,1);
 assert.equal(authenticate(r,'secret-a',2501).id,a.id);assert.equal(authenticate(r,'secret-again',2501).id,a.id);
 assert.ok(!JSON.stringify(snapshot(r,2501)).includes('previousDigests'));
 applyAction(r,again,{type:'claim',groupId:0},2600);applyAction(r,again,{type:'release',groupId:0},2700);
 const b=addMember(r,'b','乙','secret-b',400000,'account-b');assert.equal(r.members.some(m=>m.id==='a'),false);
 const rejoined=addMember(r,'return','游客 A123','secret-return',400001,undefined,'guest:one');
 applyAction(r,rejoined,{type:'claim',groupId:0},400002);applyAction(r,rejoined,{type:'release',groupId:0},400003);
 applyAction(r,b,{type:'claim',groupId:1},400004);addMember(r,'spectator','旁观','secret-c',400005,undefined,'guest:watch');
 assert.deepEqual(Object.keys(r.participants).sort(),['account-b','guest:one']);
 const view=snapshot(r,400006);assert.equal(view.participantCount,2);
 for(const secret of ['guest:one','account-b','secret-return','guestId','accountId','digest'])assert.ok(!JSON.stringify(view).includes(secret));
});
test('eight-player capacity covers both new guests and inactive returning guests',()=>{
 const r=room(),old=addMember(r,'old','旧玩家','old-token',1000,undefined,'guest:old');
 const now=ONLINE_MS+2000;
 for(let i=0;i<8;i++)addMember(r,'m'+i,'游客 '+i,'token-'+i,now,undefined,'guest:'+i);
 assert.throws(()=>addMember(r,'ninth','满员','ninth-token',now,undefined,'guest:ninth'),e=>e.status===409);
 assert.throws(()=>addMember(r,'old2','旧玩家','new-token',now,undefined,'guest:old'),e=>e.status===409);
 assert.throws(()=>applyAction(r,old,{type:'heartbeat'},now),e=>e.status===409);
 assert.equal(snapshot(r,now).members.length,8);
});
test('guest solo ownership cannot be bypassed by missing identity or another guest',()=>{
 const r=room('solo','guest:owner');
 assert.throws(()=>addMember(r,'none','无身份','t0',2000),e=>e.status===403);
 assert.throws(()=>addMember(r,'other','另一个','t1',2000,undefined,'guest:other'),e=>e.status===403);
 const owner=addMember(r,'owner','房主','t2',2000,undefined,'guest:owner');
 assert.doesNotThrow(()=>applyAction(r,owner,{type:'shuffle'},2100));
 assert.throws(()=>addMember(room('solo'),'none','无身份','t3',2000),e=>e.status===403);
});
