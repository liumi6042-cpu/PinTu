// Regression guard for the multi-select drag outage, and for the opt-in selection rule.
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
// either all of the groups or none of them.
//
// On top of that, the first version of the feature silently widened every plain click to
// whatever loose pieces were touching the clicked one. Players did not ask for that: a
// click on one piece also picked up its neighbours, and because the widening then
// depended on every neighbour's lease being free, one busy neighbour made the click look
// like it did nothing at all. Selection is now strictly opt-in.
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
    remoteOwners:{},theme:'beige',edges:false,paused:false,space:false,networkReady:true,claimSerial:0,
    pointers:new Map(),pan:null,pinch:null,feedback:null,raf:0,
    update(){},notice(){},playConnectionSound(){},draw(){},render(){},
  });
  client.attach(table);
  client.receive(structuredClone(room),true);
  const leasesOf=()=>Object.entries(room.leases).filter(([,l])=>l.playerId===me.id).map(([id])=>Number(id)).sort((a,b)=>a-b);
  return {client,table,leasesOf};
}

/** A bare table with no network, the way solo play runs. */
function soloFixture(state){
  const solo=Object.create(PuzzleTable.prototype);
  Object.assign(solo,{
    canvas:{width:2560,height:1600,style:{},focus(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>false},
    width:1280,height:800,ctx:{},state,board:boardFor(12,9),pieces:piecesFor(12,9,91),
    camera:{x:0,y:0,z:.7},backgroundDirty:false,backgroundDrag:null,previousDragRect:null,
    drag:null,dragIds:[],dragOffsets:new Map(),selected:null,selectedExtra:new Set(),didMultiSelect:false,
    remoteOwners:{},theme:'beige',edges:false,paused:false,space:false,network:null,networkReady:true,claimSerial:0,
    pointers:new Map(),pan:null,pinch:null,feedback:null,raf:0,update(){},notice(){},draw(){},
  });
  return solo;
}

const settle=(ms=40)=>new Promise(r=>setTimeout(r,ms));

/** Park two groups so they sit flush against each other, edge to edge. */
function makeTouching(a,b){
  a.dx=0;a.dy=0;
  b.dx=-1+.003;b.dy=-.997;
}

test('an explicit selection drags as one piece and leases every group in a single request',async()=>{
  const {room,me}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  const [a,b]=client.state.groups;
  makeTouching(a,b);
  // Selection is opt-in now, so build it the way a player does: Shift/Ctrl click.
  table.toggleSelection(a.id);
  table.toggleSelection(b.id);
  assert.equal(table.selectedExtra.size,2,'the Shift/Ctrl clicks build a two-group selection');
  table.beginDrag(a,{x:0,y:0});
  const carried=[...table.dragIds];
  await settle();
  assert.deepEqual(carried.slice().sort((x,y)=>x-y),[a.id,b.id].sort((x,y)=>x-y),
    `the gesture carries exactly the selection, got [${carried}]`);
  assert.ok(table.drag,'the gesture is held');
  assert.deepEqual(leasesOf(),carried.slice().sort((x,y)=>x-y),'every carried group is leased in one go');
  assert.ok(carried.length<=MULTI_SELECT_LIMIT);
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();
});

test('a plain click drags exactly one group and never selects its neighbours',async()=>{
  // The user's literal complaint: clicking one piece also grabbed the pieces beside it.
  // Two layers are pinned here — `dragMembers` never widens on its own, and the pointer
  // handler collapses any standing selection down to the clicked group.
  const {room,me}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  const [a,b,c]=client.state.groups;
  makeTouching(a,b);makeTouching(b,c);

  // `dragMembers` is the authority on what a gesture carries. With no explicit
  // selection it must be the clicked group alone, however flush its neighbours sit.
  assert.deepEqual(table.dragMembers(a.id),[a.id],'no selection means one group, neighbours excluded');

  // Now stand a multi-selection and click a group *outside* it. The click collapses the
  // selection to the clicked group — it never inherits the old set, and never widens.
  table.selectedExtra=new Set([b.id,c.id]);table.selected=b.id;
  table.selected=a.id;table.selectedExtra=new Set([a.id]);table.didMultiSelect=false;
  table.beginDrag(a,{x:0,y:0});
  await settle();
  assert.deepEqual([...table.dragIds],[a.id],`a plain click drags one group, got [${table.dragIds}]`);
  assert.equal(table.selectedExtra.size,1,'the old selection is collapsed, not widened');
  assert.equal(table.selected,a.id,'the clicked group becomes the selection');
  assert.deepEqual(leasesOf(),[a.id],'only the clicked group is leased');
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();
});

test('a gesture the server refuses leases nothing and leaves no task behind',async()=>{
  const {room,me,them}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  // Two groups, both held by the other player, and both in our selection.
  const [a,b]=client.state.groups;
  makeTouching(a,b);
  for(const g of [a,b])room.leases[g.id]={playerId:them.id,expires:200000,seq:0};
  room.revision++;client.receive(structuredClone(room),true);
  await settle();
  table.selectedExtra=new Set([a.id,b.id]);table.selected=a.id;
  const before=leasesOf().length;
  table.beginDrag(a,{x:0,y:0});
  await settle();
  assert.equal(leasesOf().length,before,'a refused gesture must lease none of its groups');
  assert.equal(table.drag,null,'the refused gesture is not held locally');
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
  table.selectedExtra=new Set([held.id]);table.selected=held.id;
  table.beginDrag(held,{x:0,y:0});
  await settle();
  assert.equal(table.drag,null,'the refused gesture is not held locally');

  // This is the bug the user hit: after one refusal, nothing could be dragged at all.
  const free=client.state.groups.find(g=>!room.leases[g.id]&&!g.locked);
  table.selectedExtra=new Set([free.id]);table.selected=free.id;
  table.beginDrag(free,{x:0,y:0});
  await settle();
  assert.ok(table.drag,'a drag after a refusal still works');
  assert.ok(leasesOf().includes(free.id),'and it really did lease its group');
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();

  // Solo play has no network at all, so it must be untouched by any of this.
  const solo=soloFixture(structuredClone(client.state));
  const soloGroup=solo.state.groups.find(g=>!g.locked);
  soloGroup.dx=0;soloGroup.dy=0;
  solo.selectedExtra=new Set([soloGroup.id]);solo.selected=soloGroup.id;
  solo.beginDrag(soloGroup,{x:0,y:0});
  assert.ok(solo.drag,'solo drag is unaffected');
  assert.deepEqual([...solo.dragIds],[soloGroup.id],`solo drags the one clicked group, got [${solo.dragIds}]`);

  // The client's ceiling must admit a full selection, or a legal gesture would be refused.
  assert.ok(MULTI_SELECT_LIMIT<=DRAG_LEASE_GROUPS,
    `the selection cap (${MULTI_SELECT_LIMIT}) must not exceed the lease ceiling (${DRAG_LEASE_GROUPS})`);
});

test('a full selection is carried end to end: select, drag, and lease every group',async()=>{
  // The Ctrl+A path itself is covered in puzzle-table-render.test.mjs (that file has a
  // mirror of the arrow-property key handler, which Object.create cannot expose). Here
  // we pin the part that matters for the outage: once a full selection exists, one
  // gesture carries all of it and leases all of it in a single request.
  const {room,me}=roomFixture();
  const {client,table,leasesOf}=clientFixture(room,me);
  const chosen=client.state.groups.filter(g=>!g.locked).slice(0,MULTI_SELECT_LIMIT);
  table.selectedExtra=new Set(chosen.map(g=>g.id));table.selected=chosen[0].id;

  table.beginDrag(chosen[0],{x:0,y:0});
  await settle();
  const expected=chosen.map(g=>g.id).sort((x,y)=>x-y);
  assert.deepEqual([...table.dragIds].sort((x,y)=>x-y),expected,'the gesture carries the whole selection');
  assert.deepEqual(leasesOf(),expected,'and leases every one of them in one go');
  assert.ok(expected.length<=DRAG_LEASE_GROUPS,'never more than the engine allows');
  for(const id of [...table.dragIds])void client.drop(id,0,0);
  await settle();
  client.stop();
});
