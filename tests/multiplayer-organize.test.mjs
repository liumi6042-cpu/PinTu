import test from 'node:test';
import assert from 'node:assert/strict';
import {addMember,applyAction,snapshot,ORGANIZE_COOLDOWN_MS,LEASE_MS} from '../lib/room-engine.ts';
import {makeFixtureRoom as makeRoom} from './legacy-fixtures.mjs';
import {recordRoomChange,roomUpdate,applyRoomUpdate} from '../lib/room-sync.ts';
import {RoomClient} from '../lib/room-client.ts';

function fixture(count=300,visibility='public'){
 const room=makeRoom('organize','seaside-native-v2',count,100000);room.visibility=visibility;room.ownerId='guest:a';room.startedAt=null;room.participants={};
 const players=['a','b','c'].map(id=>addMember(room,id,id,'digest-'+id,100000,undefined,'guest:'+id));
 room.puzzle.groups.forEach((g,i)=>{g.dx=3000+i;g.dy=4000+i;});
 Object.assign(room.puzzle.groups[0],{locked:true,dx:0,dy:0});
 room.puzzle.groups[1].pieces.push(2);room.puzzle.groups.splice(2,1);
 return {room,players};
}

test('any seated multiplayer player can arrange, preserving groups, placements, leases, timer and contributions',()=>{
 for(const visibility of ['public','private',undefined])for(const count of [300,2000]){
  const {room,players:[a,b,c]}=fixture(count,visibility);
  room.visibility=visibility;
  applyAction(room,a,{type:'claim',groupId:3},100010);
  applyAction(room,b,{type:'claim',groupId:4},100011);
  const before=structuredClone(room),old=snapshot(room,100012);
  applyAction(room,c,{type:'shuffle'},100100);room.revision++;
  recordRoomChange(room,before.puzzle.groups);
  for(const id of [0,1,3,4])assert.deepEqual(room.puzzle.groups.find(g=>g.id===id),before.puzzle.groups.find(g=>g.id===id));
  assert.deepEqual(room.leases,before.leases);
  assert.equal(room.startedAt,before.startedAt);assert.equal(room.completedAt,before.completedAt);
  assert.deepEqual(room.participants,before.participants);assert.deepEqual(room.achievements,before.achievements);
  const changed=room.puzzle.groups.filter(g=>g.dx!==before.puzzle.groups.find(old=>old.id===g.id).dx||g.dy!==before.puzzle.groups.find(old=>old.id===g.id).dy);
  assert.equal(changed.length,count-5);
  assert.equal(new Set(room.puzzle.groups.flatMap(g=>g.pieces)).size,count);
  const update=roomUpdate(room,100100,old.revision);
  assert.equal(update.kind,count===300?'delta':undefined);
  assert.deepEqual(applyRoomUpdate(old,update),snapshot(room,100100));
  const arranged=structuredClone(room.puzzle);
  assert.throws(()=>applyAction(room,b,{type:'shuffle'},100101),error=>error.status===409&&error.message.includes('2 秒'));
  assert.deepEqual(room.puzzle,arranged);
  applyAction(room,b,{type:'move',groupId:4,dx:240,dy:320,seq:1},100102);
  assert.equal(room.puzzle.groups.find(g=>g.id===4).dx,240,'the teammate keeps control after arranging');
  applyAction(room,c,{type:'shuffle'},100100+ORGANIZE_COOLDOWN_MS);
  assert.equal(room.puzzle.groups.find(g=>g.id===4).dx,240);
 }
});

test('expired holds can be arranged, and organizing never starts a puzzle timer',()=>{
 const {room,players:[a,b]}=fixture();
 const initialStart=room.startedAt;applyAction(room,b,{type:'shuffle'},100010);
 assert.equal(room.startedAt,initialStart);assert.deepEqual(room.participants,{});
 applyAction(room,a,{type:'claim',groupId:3},100100);
 const held=structuredClone(room.puzzle.groups.find(g=>g.id===3));
 applyAction(room,b,{type:'shuffle'},100100+LEASE_MS+1);
 assert.equal(room.leases[3],undefined);
 assert.notDeepEqual(room.puzzle.groups.find(g=>g.id===3),held);
 const solo=fixture(300);solo.room.visibility='solo';
 assert.throws(()=>applyAction(solo.room,solo.players[1],{type:'shuffle'},100100),error=>error.status===403);
 applyAction(solo.room,solo.players[0],{type:'shuffle'},100100);
});

test('client waits for a pending drop, prevents overlap, and preserves the multiplayer camera',async()=>{
 const {room,players:[a]}=fixture();const client=new RoomClient({token:'test',playerId:a.id,room:snapshot(room,100000)});
 let finishDrop,finishArrange,requests=0,fits=0;
 const dropped=new Promise(resolve=>finishDrop=resolve),response=new Promise(resolve=>finishArrange=resolve);
 client.drags.set(8,{ending:{type:'drop'},canceled:false,finished:dropped});
 client.table={networkReady:true,syncRemote(){},fit(){fits++;}};
 client.request=async()=>{requests++;return response;};
 const action=client.organize();await Promise.resolve();assert.equal(requests,0);
 assert.equal(await client.acquire(9),false);
 await assert.rejects(client.organize(),/正在整理/);
 client.drags.delete(8);finishDrop();await Promise.resolve();await Promise.resolve();
 assert.equal(requests,1);
 finishArrange(snapshot(room,100100));await action;assert.equal(fits,0);
 client.snapshot.visibility='solo';await client.organize();assert.equal(fits,1);
 client.request=async()=>{throw new Error('Temporary network failure');};
 await assert.rejects(client.organize(),/Temporary network failure/);assert.equal(client.organizing,false);
 client.request=async()=>snapshot(room,100200);await client.organize();
 client.drags.set(10,{ending:null,canceled:false});await assert.rejects(client.organize(),/放下/);
});
