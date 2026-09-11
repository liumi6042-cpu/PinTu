import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, addMember, applyAction, snapshot } from '../lib/room-engine.ts';
import { recordRoomChange, roomUpdate, applyRoomUpdate, roomPollDelay } from '../lib/room-sync.ts';
import { RoomClient } from '../lib/room-client.ts';

function setup(){
  let now=100000;const room=makeRoom('delta','seaside',2000,now),member=addMember(room,'a','甲','secret-token-digest',now);
  return {room,action(input){const previous=structuredClone(room.puzzle.groups);applyAction(room,member,input,++now);room.revision++;recordRoomChange(room,previous);return now;}};
}
test('2000-piece moves send only changed groups, and merge removals converge to the full snapshot',()=>{
  const {room,action}=setup();let client=snapshot(room,100000);
  let now=action({type:'claim',groupId:0});client=applyRoomUpdate(client,roomUpdate(room,now,client.revision));
  now=action({type:'move',groupId:0,dx:100,dy:100,seq:1});
  const delta=roomUpdate(room,now,client.revision);
  assert.equal(delta.kind,'delta');assert.equal(delta.groups.length,1);
  assert.ok(JSON.stringify(delta).length<JSON.stringify(snapshot(room,now)).length*.05);
  assert.ok(!JSON.stringify(delta).includes('secret-token-digest'));
  client=applyRoomUpdate(client,delta);
  now=action({type:'drop',groupId:0,dx:0,dy:0,seq:2});client=applyRoomUpdate(client,roomUpdate(room,now,client.revision));
  now=action({type:'claim',groupId:1});client=applyRoomUpdate(client,roomUpdate(room,now,client.revision));
  now=action({type:'drop',groupId:1,dx:0,dy:0,seq:1});const merged=roomUpdate(room,now,client.revision);
  assert.ok(merged.removed.length>0);client=applyRoomUpdate(client,merged);
  assert.deepEqual(client,snapshot(room,now));
  const unchanged=roomUpdate(room,now,client.revision);assert.equal(unchanged.groups.length,0);
  assert.equal(applyRoomUpdate(client,unchanged).puzzle.groups,client.puzzle.groups);
});
test('missed history falls back to full state, out-of-order deltas never rewind, and gaps require resync',()=>{
  const {room,action}=setup(),initial=snapshot(room,100000);
  let now=action({type:'claim',groupId:0});const claim=roomUpdate(room,now,0);
  now=action({type:'move',groupId:0,dx:120,dy:120,seq:1});const move=roomUpdate(room,now,0);
  let client=applyRoomUpdate(initial,move);assert.equal(applyRoomUpdate(client,claim),client);
  assert.equal(applyRoomUpdate(initial,{...move,baseRevision:1}),null);
  for(let seq=2;seq<110;seq++)now=action({type:'move',groupId:0,dx:120+seq,dy:120,seq});
  assert.ok(room.syncHistory.length<=96);assert.ok(!('kind' in roomUpdate(room,now,0)));
  client=applyRoomUpdate(client,roomUpdate(room,now,0));assert.deepEqual(client,snapshot(room,now));
  assert.equal(roomPollDelay(false,10),2000);assert.equal(roomPollDelay(true,10),300);assert.equal(roomPollDelay(true,10,true),4000);
});

test('the displayed clock advances between polls and stays frozen before play and after completion',()=>{
  const {room}=setup(),time=Date.now();room.startedAt=99000;
  const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,100000)});
  assert.ok(client.elapsedNow(time+2200)>=3);
  client.snapshot.startedAt=null;client.snapshot.puzzle.elapsed=0;assert.equal(client.elapsedNow(time+5000),0);
  client.snapshot.completedAt=100000;client.snapshot.puzzle.elapsed=8;assert.equal(client.elapsedNow(time+10000),8);
});
