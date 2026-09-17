// Regression guard for the multi-select drag outage.
//
// The shipped multi-select feature claimed its groups one request at a time. Two things
// went wrong with that:
//   1. the room engine refuses a second claim while one lease is already held, so a
//      multi-piece gesture could never complete in a room;
//   2. the refused claim leaked a slot in the client's stale-batch bookkeeping, after
//      which `canAcquire` answered false for every group — so *nothing* could be
//      dragged any more, not even a single piece.
//
// Both are fixed by claiming a whole selection in one `claimMany` request, which leases
// either all of the groups or none of them. These tests pin that down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, applyAction, DRAG_LEASE_GROUPS } from '../lib/room-engine.ts';
import { makeFixtureRoom } from './legacy-fixtures.mjs';
import { RoomClient } from '../lib/room-client.ts';
import { PuzzleTable, MULTI_SELECT_LIMIT } from '../lib/puzzle-table.ts';
import { boardFor, piecesFor } from '../lib/puzzle-engine.ts';

/** A room whose groups are all out on the table, plus two members. */
function roomFixture(){
  const room=makeFixtureRoom('drag','seaside-native-v2',108,100000);
  room.visibility='private';room.startedAt=100000;
  const me=addMember(room,'me','我','digest-me',100000,undefined,'guest:me');
  const them=addMember(room,'them','朋友','digest-them',100000,undefined,'guest:them');
  room.puzzle.groups.forEach((g,i)=>{g.dx=5000+i*400;g.dy=5000+i*300;});
  return {room,me,them};
}

/**
 * A table + RoomClient pair whose `fetch` goes straight into the engine, so a drag can
 * be exercised without an HTTP server. The clock advances on every response because
 * `receive()` ignores a snapshot whose serverTime does not move.
 */
function clientFixture(room,me){
  let clock=100000;
  globalThis.fetch=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;clock+=25;
    try{
      if(!body)return new Response(JSON.stringify(room),{status:200,headers:{'Content-Type':'application/json'}});
      applyAction(room,me,body,clock);room.revision++;
      return new Response(JSON.stringify(room),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(error){return new Response(JSON.stringify({error:error.message}),{status:error.status??400});}
  };
  const client=new RoomClient({token:'t',playerId:me.id,room:structuredClone(room)});
  const context={setTransform(){},clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(){}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  const table=Object.create(PuzzleTable.prototype);
  Object.assign(table,{
    canvas:{width:2560,height:1600,style:{},focus(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>false},
    width:1280,height:800,ctx:context,state:client.state,board:boardFor(12,9),pieces:piecesFor(12,9,91),
    camera:{x:0,y:0,z:.7},background:{width:0,height:0,getContext:()=>context},backgroundDirty:true,backgroundDrag:null,previousDragRect:null,
    drag:null,dragIds:[],dragOffsets:new Map(),selected:null,selectedExtra:new Set(),selectAnchor:null,didMultiSelect:false,
    remoteOwners:{},theme:'beige',paused:false,space:false,networkReady:true,claimSerial:0,
    pointers:new Map(),pan:null,pinch:null,feedback:null,raf:0,
    update(){},notice(){},playConnectionSound(){},draw(){},render(){},
  });
  client.attach(table);
  client.receive(structuredClone(room),true);
  const leasesOf=()=>Object.entries(room.leases).filter(([,l])=>l.playerId===me.id).map(([id])=>Number(id)).sort((a,b)=>a-b);
  return {client,table,leasesOf};
}

const settle=(ms=40)=>new Promise(r=>setTimeout(r,ms));

test('a multi-piece drag claims the whole selection in one request and holds it',async()=>{
  const {room,me}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  const [a,b]=client.state.groups;
  a.dx=0;a.dy=0;b.dx=-1+.003;b.dy=-.997; // touching, so the selection widens to both
  table.beginDrag(a,{x:0,y:0});
  const carried=[...table.dragIds];
  await settle();
  assert.ok(carried.length>1,`the gesture should carry both touching groups, got [${carried}]`);
  assert.ok(table.drag,'the gesture is held');
  assert.deepEqual(leasesOf(),carried.slice().sort((x,y)=>x-y),'every carried group is leased in one go');
  assert.ok(carried.length<=MULTI_SELECT_LIMIT);
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();
});

test('a gesture the server refuses leases nothing and leaves no task behind',async()=>{
  const {room,me,them}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  // Another player holds a group and its touching neighbour, so a gesture over them is refused.
  const held=client.state.groups[4],neighbour=client.state.groups.find(g=>g!==held&&!room.leases[g.id]);
  neighbour.dx=held.dx-1+.003;neighbour.dy=held.dy-.997;
  for(const g of [held,neighbour])room.leases[g.id]={playerId:them.id,expires:200000,seq:0};
  room.revision++;client.receive(structuredClone(room),true);
  await settle();
  const before=leasesOf().length;
  table.beginDrag(held,{x:0,y:0});
  await settle();
  assert.equal(leasesOf().length,before,'a refused gesture must lease none of its groups');
  assert.equal(client.drags.size,0,'no dangling drag task');
  assert.equal(client.active.size,0,'no dangling batch slot');
  client.stop();
});

test('drags still work after a refused gesture, and in solo play, and the ceiling is the engine cap',async()=>{
  const {room,me,them}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  const held=client.state.groups[4];
  room.leases[held.id]={playerId:them.id,expires:200000,seq:0};
  room.revision++;client.receive(structuredClone(room),true);
  await settle();
  table.beginDrag(held,{x:0,y:0});
  await settle();
  assert.equal(table.drag,null,'the refused gesture is not held locally');

  // This is the bug the user hit: after one refusal, nothing could be dragged at all.
  const free=client.state.groups.find(g=>!room.leases[g.id]&&!g.locked);
  table.beginDrag(free,{x:0,y:0});
  await settle();
  assert.ok(table.drag,'a drag after a refusal still works');
  assert.ok(leasesOf().includes(free.id),'and it really did lease its group');
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();

  // Solo play has no network at all, so it must be untouched by any of this.
  const solo=Object.create(PuzzleTable.prototype);
  const state=structuredClone(client.state);
  Object.assign(solo,{
    canvas:{style:{},focus(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>false},
    width:1280,height:800,ctx:{},state,board:boardFor(12,9),pieces:piecesFor(12,9,91),
    camera:{x:0,y:0,z:.7},backgroundDirty:false,backgroundDrag:null,previousDragRect:null,
    drag:null,dragIds:[],dragOffsets:new Map(),selected:null,selectedExtra:new Set(),didMultiSelect:false,
    remoteOwners:{},theme:'beige',paused:false,space:false,network:null,networkReady:true,claimSerial:0,
    pointers:new Map(),pan:null,pinch:null,feedback:null,raf:0,update(){},notice(){},draw(){},
  });
  const soloGroup=solo.state.groups.find(g=>!g.locked);
  soloGroup.dx=0;soloGroup.dy=0;
  solo.beginDrag(soloGroup,{x:0,y:0});
  assert.ok(solo.drag,'solo drag is unaffected');
  assert.ok(solo.dragIds.includes(soloGroup.id),`solo carries group ${soloGroup.id}, got [${solo.dragIds}]`);

  // The client's ceiling must admit a full selection, or a legal gesture would be refused.
  assert.ok(MULTI_SELECT_LIMIT<=DRAG_LEASE_GROUPS,
    `the selection cap (${MULTI_SELECT_LIMIT}) must not exceed the lease ceiling (${DRAG_LEASE_GROUPS})`);
});
