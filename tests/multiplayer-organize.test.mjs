import test from 'node:test';
import assert from 'node:assert/strict';
import {addMember,applyAction,snapshot,LEASE_MS} from '../lib/room-engine.ts';
import {makeFixtureRoom as makeRoom} from './legacy-fixtures.mjs';
import {RoomClient} from '../lib/room-client.ts';

function fixture(count=300,visibility='public'){
 const room=makeRoom('organize','seaside-native-v2',count,100000);room.visibility='public';room.ownerId='guest:a';room.startedAt=null;room.participants={};
 const players=['a','b','c'].map(id=>addMember(room,id,id,'digest-'+id,100000,undefined,'guest:'+id));
 room.visibility=visibility;
 room.puzzle.groups.forEach((g,i)=>{g.dx=3000+i;g.dy=4000+i;});
 Object.assign(room.puzzle.groups[0],{locked:true,dx:0,dy:0});
 room.puzzle.groups[1].pieces.push(2);room.puzzle.groups.splice(2,1);
 return {room,players};
}

test('all multiplayer seats reject organize without changing puzzle, leases or progress',()=>{
 for(const visibility of ['public','private',undefined])for(const count of [300,2000]){
  const {room,players}=fixture(count);room.visibility=visibility;
  applyAction(room,players[0],{type:'claim',groupId:3},100010);
  const before=structuredClone(room);
  for(const player of players)assert.throws(()=>applyAction(room,player,{type:'shuffle'},100100),error=>error.status===403&&error.message==='多人房不能整理拼块');
  for(const key of ['puzzle','leases','startedAt','completedAt','participants','achievements','lastOrganizedAt'])assert.deepEqual(room[key],before[key]);
 }
});

test('solo owner can organize without moving held, joined or placed groups; other identities are rejected',()=>{
 const {room,players:[a,b]}=fixture();room.visibility='solo';
 assert.throws(()=>applyAction(room,b,{type:'shuffle'},100001),error=>error.status===403);
 const initialStart=room.startedAt;applyAction(room,a,{type:'shuffle'},100010);
 assert.equal(room.startedAt,initialStart);assert.deepEqual(room.participants,{});
 applyAction(room,a,{type:'claim',groupId:3},100100);
 const before=structuredClone(room.puzzle.groups);
 applyAction(room,a,{type:'shuffle'},100101);
 for(const id of [0,1,3])assert.deepEqual(room.puzzle.groups.find(g=>g.id===id),before.find(g=>g.id===id));
 const held=structuredClone(room.puzzle.groups.find(g=>g.id===3));
 applyAction(room,a,{type:'shuffle'},100100+LEASE_MS+1);
 assert.equal(room.leases[3],undefined);assert.notDeepEqual(room.puzzle.groups.find(g=>g.id===3),held);
});

test('client waits for a pending drop, prevents overlap, and fits the solo camera',async()=>{
 const {room,players:[a]}=fixture(300,'solo');const client=new RoomClient({token:'test',playerId:a.id,room:snapshot(room,100000)});
 let finishDrop,finishArrange,requests=0,fits=0;
 const dropped=new Promise(resolve=>finishDrop=resolve),response=new Promise(resolve=>finishArrange=resolve);
 const dropping={ending:{type:'drop'},canceled:false,finished:dropped};client.drags.set(8,dropping);client.pendingDrags.add(dropping);
 client.table={networkReady:true,syncRemote(){},fit(){fits++;}};
 client.request=async()=>{requests++;return response;};
 const action=client.organize();await Promise.resolve();assert.equal(requests,0);
 assert.equal(await client.acquire(9),false);
 await assert.rejects(client.organize(),/正在整理/);
 client.drags.delete(8);client.pendingDrags.delete(dropping);finishDrop();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);
 finishArrange(snapshot(room,100100));await action;assert.equal(fits,1);
 await client.organize();assert.equal(fits,2);
 client.request=async()=>{throw new Error('Temporary network failure');};
 await assert.rejects(client.organize(),/Temporary network failure/);assert.equal(client.organizing,false);
 client.request=async()=>snapshot(room,100200);await client.organize();
 const active={ending:null,canceled:false};client.drags.set(10,active);client.pendingDrags.add(active);await assert.rejects(client.organize(),/放下/);
});

test('an acknowledged-later drop does not block picking up the same group again',()=>{
 const {room,players:[a]}=fixture(300,'solo');const client=new RoomClient({token:'test',playerId:a.id,room:snapshot(room,100000)});
 const pending={ending:{type:'drop',dx:0,dy:0},canceled:false,finished:Promise.resolve()};
 client.drags.set(8,pending);
 assert.equal(client.moving(8),false,'a group waiting for drop acknowledgement can be acquired again');
});
