import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom,addMember,applyAction,snapshot } from '../lib/room-engine.ts';
import { manageRoom,roomTitle } from '../lib/room-management.ts';
import { canCreateMemberRoom,membershipStatus,MEMBER_ROOM_LIMIT,MEMBERSHIP_LAUNCHED } from '../lib/membership-policy.ts';
import { RoomClient } from '../lib/room-client.ts';
test('membership uses server term boundaries; scheduled cancellation keeps access until the paid period ends',()=>{
  const record={plan:'puzzle',status:'active',startsAt:1000,expiresAt:2000,cancelAtPeriodEnd:true};
  assert.equal(MEMBER_ROOM_LIMIT,3);assert.equal(MEMBERSHIP_LAUNCHED,false);assert.equal(canCreateMemberRoom(),false);
  assert.equal(canCreateMemberRoom(record,999),false);assert.equal(canCreateMemberRoom(record,1000),true);assert.equal(canCreateMemberRoom(record,1999),true);assert.equal(canCreateMemberRoom(record,2000),false);
  assert.equal(membershipStatus(record,2000),'expired');assert.equal(canCreateMemberRoom({...record,status:'ended'},1500),false);
});
test('room ownership gates settings and preserves pieces, elapsed time and retention',()=>{
  const room=makeRoom('r','seaside-native-v2',108,1000);room.ownerId='owner';room.visibility='private';room.startedAt=null;
  const before=JSON.stringify(room.puzzle),expiry=room.expiresAt;
  assert.throws(()=>manageRoom(room,new Set(['outsider']),{title:'No'},1100),/房主/);
  manageRoom(room,new Set(['owner']),{title:'晚风与朋友',visibility:'public',acceptingNew:false},1100);
  assert.equal(room.title,'晚风与朋友');assert.equal(room.visibility,'public');assert.equal(room.acceptingNew,false);assert.equal(room.expiresAt,expiry);assert.equal(room.startedAt,null);assert.equal(JSON.stringify(room.puzzle),before);
  assert.throws(()=>manageRoom(room,new Set(['owner']),{ownerId:'outsider'},1200));assert.throws(()=>manageRoom(room,new Set(['owner']),{visibility:'solo'},1200));
  for(const title of ['', ' '.repeat(3),'x'.repeat(41),'bad\nname'])assert.throws(()=>roomTitle(title));assert.equal(roomTitle('  A room  '),'A room');
});
test('closed admission rejects newcomers but admits owners and returning players even after presence pruning',()=>{
  const room=makeRoom('r','seaside-native-v2',108,1000);room.ownerId='owner';room.visibility='private';
  const friend=addMember(room,'f','Friend','ft',1000,undefined,'guest:friend');
  manageRoom(room,new Set(['owner']),{acceptingNew:false},1100);room.members=[];
  assert.throws(()=>addMember(room,'s','Stranger','st',1200,undefined,'guest:stranger'),/暂停/);
  const returned=addMember(room,'f2','Friend','ft2',1200,undefined,'guest:friend');assert.ok(returned);
  assert.ok(addMember(room,'o','Owner','ot',1200,'owner'));assert.ok(!JSON.stringify(snapshot(room,1200)).includes('guest:friend'));
  applyAction(room,returned,{type:'claim',groupId:0},1300);assert.ok(room.leases[0]);
  manageRoom(room,new Set(['owner']),{acceptingNew:true},1400);assert.ok(addMember(room,'s','Stranger','st',1400,undefined,'guest:stranger'));
});
test('room clients notify metadata and achievement changes without notifying on every position revision',()=>{
  const room=makeRoom('r','seaside-native-v2',108,1000),client=new RoomClient({token:'t',playerId:'p',room:snapshot(room,1000)});let updates=0;
  const stop=client.subscribe(()=>updates++);client.emit();assert.equal(updates,1);
  client.snapshot.revision++;client.emit();assert.equal(updates,1);
  client.snapshot.title='New title';client.emit();client.snapshot.acceptingNew=false;client.emit();client.snapshot.achievementDays={p:'2026-09-09'};client.emit();client.snapshot.completedAt=2000;client.emit();assert.equal(updates,5);stop();
});
