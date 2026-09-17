import { makeFixtureRoom as makeRoom } from './legacy-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, applyAction, authenticate, snapshot, LEASE_MS, ROOM_LIFETIME, DRAG_LEASE_GROUPS } from '../lib/room-engine.ts';
import { placedCount } from '../lib/puzzle-engine.ts';
function setup(){const r=makeRoom('test','seaside-native-v2',12,100000),a=addMember(r,'a','甲','digest-a',100000),b=addMember(r,'b','乙','digest-b',100000);r.puzzle.groups.forEach((g,i)=>{g.dx=2000+i*300;g.dy=3000+i*200;});return {r,a,b};}
test('two participants receive identical puzzle state without authentication secrets',()=>{const {r}=setup(),s=snapshot(r,100300);assert.equal(s.members.length,2);assert.equal(s.puzzle.groups.length,12);assert.ok(!JSON.stringify(s).includes('digest'));});
test('an unclaimed piece and another player’s lease cannot be moved',()=>{const {r,a,b}=setup();assert.throws(()=>applyAction(r,a,{type:'move',groupId:0,dx:2,dy:2,seq:1},100100));applyAction(r,a,{type:'claim',groupId:0},100100);assert.throws(()=>applyAction(r,b,{type:'claim',groupId:0},100101));assert.throws(()=>applyAction(r,b,{type:'move',groupId:0,dx:0,dy:0,seq:1},100102));});
test('stale moves cannot overwrite newer positions',()=>{const {r,a}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'move',groupId:0,dx:210,dy:210,seq:2},100200);applyAction(r,a,{type:'move',groupId:0,dx:110,dy:110,seq:1},100300);assert.equal(r.puzzle.groups[0].dx,210);});
test('a drop cannot consume an adjacent group another player is holding',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,b,{type:'claim',groupId:1},100100);applyAction(r,b,{type:'move',groupId:1,dx:305,dy:305,seq:1},100200);applyAction(r,a,{type:'drop',groupId:0,dx:300,dy:300,seq:1},100250);assert.equal(r.puzzle.groups.length,12);assert.equal(r.leases[1].playerId,'b');applyAction(r,b,{type:'drop',groupId:1,dx:305,dy:305,seq:2},100300);assert.equal(r.puzzle.groups.length,11);assert.deepEqual(r.puzzle.groups.find(g=>g.pieces.includes(0)).pieces,[1,0]);});
test('expired leases release and stale owner operations are rejected',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,b,{type:'claim',groupId:0},100100+LEASE_MS+1);assert.equal(r.leases[0].playerId,'b');assert.throws(()=>applyAction(r,a,{type:'drop',groupId:0,dx:0,dy:0,seq:1},110200));});
test('presence heartbeat does not indefinitely hold a lost drag',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'heartbeat'},105000);applyAction(r,b,{type:'claim',groupId:0},110101);assert.equal(r.leases[0].playerId,'b');});
test('heartbeat renews a deliberately held piece and leaving releases it',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'heartbeat',groupId:0},109000);assert.throws(()=>applyAction(r,b,{type:'claim',groupId:0},111000));applyAction(r,a,{type:'leave'},111001);applyAction(r,b,{type:'claim',groupId:0},111002);assert.equal(r.leases[0].playerId,'b');});
test('invalid names, unsupported difficulty, invalid movement and unknown membership are rejected',()=>{const {r,a}=setup();assert.throws(()=>makeRoom('x','unknown',12,0));assert.throws(()=>makeRoom('x','seaside-native-v2',17,0));assert.throws(()=>addMember(r,'x','  ','x',100200));assert.throws(()=>authenticate(r,'bad',100200));applyAction(r,a,{type:'claim',groupId:0},100100);assert.throws(()=>applyAction(r,a,{type:'move',groupId:0,dx:NaN,dy:1,seq:1},100200));});
test('rooms enforce eight active players and expire at the extended retention deadline',()=>{const {r}=setup();for(let i=0;i<6;i++)addMember(r,`m${i}`,`玩家${i}`,`d${i}`,100100);assert.throws(()=>addMember(r,'ninth','第九位','d9',100200));assert.throws(()=>authenticate(r,'digest-a',r.expiresAt));});
test('shared completion count and timer remain stable after the last drop',()=>{const {r,a,b}=setup();for(let i=0;i<12;i++){const g=r.puzzle.groups.find(g=>g.pieces.includes(i));if(g.locked)continue;const player=i%2?a:b;applyAction(r,player,{type:'claim',groupId:g.id},101000+i*100);applyAction(r,player,{type:'drop',groupId:g.id,dx:0,dy:0,seq:1},101050+i*100);}assert.equal(placedCount(r.puzzle),12);const ended=r.completedAt;assert.ok(ended);assert.equal(snapshot(r,999999).puzzle.elapsed,Math.floor((ended-r.createdAt)/1000));});
test('a batch claim leases every group in one action, and is all-or-nothing',()=>{const {r,a,b}=setup();
 // One action, several groups: the whole selection becomes ours.
 applyAction(r,a,{type:'claimMany',groupIds:[0,1,2]},100100);
 for(const id of [0,1,2])assert.equal(r.leases[id].playerId,'a');
 applyAction(r,a,{type:'release',groupId:0},100110);applyAction(r,a,{type:'release',groupId:1},100111);applyAction(r,a,{type:'release',groupId:2},100112);
 // A batch containing any group another player holds is refused outright, so no
 // partial selection is ever left leased by the requester.
 applyAction(r,b,{type:'claim',groupId:2},100200);
 assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:[0,1,2]},100300));
 assert.equal(r.leases[0],undefined,'a refused batch must not lease the free groups either');
 assert.equal(r.leases[1],undefined);assert.equal(r.leases[2].playerId,'b');
});
test('a batch claim is bounded, refuses duplicates and locked or invalid ids, and keeps one gesture at a time',()=>{const {r,a,b}=setup();
 assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:[]},100100));
 assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:Array.from({length:DRAG_LEASE_GROUPS+1},(_,i)=>i)},100101));
 assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:[0,0.5]},100102));
 // Duplicates collapse, so a repeated id cannot inflate the count.
 applyAction(r,a,{type:'claimMany',groupIds:[0,0,1]},100103);
 assert.deepEqual(Object.keys(r.leases).map(Number).sort((x,y)=>x-y),[0,1]);
 // Claiming a new batch while holding one from an earlier gesture must not silently drop it.
 assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:[5,6]},100104));
 assert.equal(r.leases[5],undefined);
 // A locked group cannot be part of a batch.
 const locked=r.puzzle.groups.find(g=>g.locked);
 if(locked)assert.throws(()=>applyAction(r,a,{type:'claimMany',groupIds:[locked.id,4]},100105));
 // Another player still cannot claim a group inside our batch.
 assert.throws(()=>applyAction(r,b,{type:'claim',groupId:1},100106));
});
test('a batched gesture moves and drops each group, and another player may take a dropped one',()=>{const {r,a,b}=setup();
 // `dx`/`dy` are offsets clamped to the world, and small offsets near the board snap a
 // group into place. Start far from the board so the batch is genuinely mid-flight.
 for(const id of [0,1,2]){const g=r.puzzle.groups.find(x=>x.id===id);g.dx=-600;g.dy=-600;}
 const before=new Map([0,1,2].map(id=>[id,{...r.puzzle.groups.find(g=>g.id===id)}]));
 applyAction(r,a,{type:'claimMany',groupIds:[0,1,2]},100100);
 for(const id of [0,1,2])applyAction(r,a,{type:'move',groupId:id,dx:before.get(id).dx+40,dy:before.get(id).dy+40,seq:1},100110+id);
 for(const id of [0,1,2]){const g=r.puzzle.groups.find(g=>g.id===id);
  assert.ok(g.dx>before.get(id).dx&&g.dy>before.get(id).dy,`group ${id} moved with the batch`);}
 applyAction(r,a,{type:'drop',groupId:0,dx:-600,dy:-600,seq:2},100200);
 assert.equal(r.leases[0],undefined,'a dropped group leaves the batch');
 assert.equal(r.leases[1].playerId,'a');
 applyAction(r,b,{type:'claim',groupId:0},100210);
 assert.equal(r.leases[0].playerId,'b','the freed group is available to the other player');
});
