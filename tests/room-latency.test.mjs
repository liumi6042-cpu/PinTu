import { makeFixtureRoom as makeRoom } from './legacy-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/room-client.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';
import { addMember, applyAction, snapshot } from '../lib/room-engine.ts';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fakeTable(client){return {state:client.state,network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protect){const ids=protect instanceof Set?protect:new Set(protect===null?[]:[protect]);const previous=new Map(this.state.groups.map(g=>[g.id,g]));this.state.groups=structuredClone(next.groups);for(const g of this.state.groups){const held=previous.get(g.id);if(ids.has(g.id)&&held&&!g.locked){g.dx=held.dx;g.dy=held.dy;}}this.state.elapsed=next.elapsed;}};}

test('a piece follows pointer motion before the claim response arrives',async()=>{
 let resolveClaim;const claimed=new Promise(r=>{resolveClaim=r;});const room=makeRoom('local','seaside-native-v2',12,Date.now());
 const savedGlobals={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const context={drawImage(){}};const canvas={getContext:()=>context,addEventListener(){},focus(){},setPointerCapture(){},style:{}};
 globalThis.document={createElement:()=>({getContext:()=>context}),addEventListener(){}};globalThis.Path2D=class{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.cancelAnimationFrame=()=>{};
 const table=new PuzzleTable(canvas,room.puzzle,{naturalWidth:800,naturalHeight:600},()=>{},()=>{});const group=room.puzzle.groups[0],original={dx:group.dx,dy:group.dy};
 Object.assign(table,{state:room.puzzle,paused:false,networkReady:true,remoteOwners:{},claimSerial:0,selected:null,drag:null,pan:null,space:false,pointers:new Map(),canvas:{focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),style:{}},network:{acquire:()=>claimed,move(){},release(){},drop:async()=>{}},point:e=>({x:e.clientX,y:e.clientY}),world:p=>p,groupAt:()=>group,draw(){}});
 table.down({button:0,pointerId:1,clientX:20,clientY:20,preventDefault(){}});
 table.move({pointerId:1,clientX:80,clientY:50});
 try{assert.equal(group.dx,original.dx+60);assert.equal(group.dy,original.dy+30);}finally{resolveClaim(true);await claimed;await Promise.resolve();table.destroy();Object.assign(globalThis,savedGlobals);}
});

test('500 ms round trips do not build a queue of obsolete moves ahead of drop',async()=>{
 const originalFetch=globalThis.fetch,room=makeRoom('slow-room','seaside-native-v2',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),sent=[];
 globalThis.fetch=async(url,options={})=>{const action=options.body?JSON.parse(options.body):null;const start=performance.now();if(action&&action.type!=='heartbeat'&&action.type!=='leave'){sent.push({type:action.type,dx:action.dx,start});await wait(500);}if(action){applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));};
 const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,Date.now())}),table=fakeTable(client),cleanup=client.attach(table);
 try{assert.equal(await table.network.acquire(0),true);for(let i=1;i<=20;i++){table.state.groups.find(g=>g.id===0).dx=100+i;table.network.move(0,100+i,100);await wait(45);}
   const releasedAt=performance.now();await table.network.drop(0,0,0);
   const obsolete=sent.filter(a=>a.type==='move'&&a.start>releasedAt);assert.equal(obsolete.length,0,`${obsolete.length} obsolete moves delayed the drop`);
   assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));assert.ok(performance.now()-releasedAt<1300,'drop waited for a growing backlog');
 }finally{client.leave();cleanup();globalThis.fetch=originalFetch;}
});

async function withServer(run,beforeAction=async()=>{}) {
 const originalFetch=globalThis.fetch,room=makeRoom('interaction-room','seaside-native-v2',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),sent=[];
 globalThis.fetch=async(url,options={})=>{
   const action=options.body?JSON.parse(options.body):null;
   try{if(action){sent.push({...action,at:performance.now()});await beforeAction(action,room);applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));}
   catch(error){return Response.json({error:error.message},{status:error.status||500});}
 };
 const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,Date.now())}),table=fakeTable(client),canceled=[];
 table.cancelNetworkDrag=id=>canceled.push(id);const cleanup=client.attach(table);
 try{await run({room,client,table,sent,canceled});}finally{cleanup();globalThis.fetch=originalFetch;}
}

test('unchanged polling snapshots avoid drawing while z-order changes redraw the table',()=>{
 const state=makeRoom('canvas-room','seaside-native-v2',12,Date.now()).puzzle,table=Object.create(PuzzleTable.prototype);let draws=0,updates=0;
 Object.assign(table,{state,remoteOwners:{},draw:()=>draws++,update:()=>updates++,notice(){},playTone(){}});
 table.syncRemote(structuredClone(state),{},new Set());assert.equal(draws,0);assert.equal(updates,0);
 const next=structuredClone(state);next.groups.reverse();table.syncRemote(next,{},new Set());assert.equal(draws,1);
 next.elapsed++;table.syncRemote(next,{},new Set());assert.equal(updates,1);assert.equal(draws,1);
});

test('quick drops survive a pending claim and the next local drag survives previous acknowledgments',async()=>{
 await withServer(async({room,table,sent})=>{
   const firstClaim=table.network.acquire(0);table.network.move(0,75,75);
   const firstDrop=table.network.drop(0,0,0);
   assert.equal(table.network.canAcquire(1),true);
   const secondClaim=table.network.acquire(1),second=table.state.groups.find(g=>g.id===1);second.dx=150;second.dy=150;table.network.move(1,150,150);
   assert.equal(await firstClaim,true);await firstDrop;
   assert.equal(table.state.groups.find(g=>g.id===1).dx,150,'the earlier drop acknowledgment pulled back the next local drag');
   assert.equal(await secondClaim,true);await table.network.drop(1,150,150);
   assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));
   assert.equal(room.puzzle.groups.find(g=>g.id===1).dx,150);
   assert.deepEqual(sent.filter(a=>['claim','drop'].includes(a.type)).map(a=>[a.type,a.groupId]),[['claim',0],['drop',0],['claim',1],['drop',1]]);
   assert.equal(sent.filter(a=>a.type==='move'&&a.groupId===0).length,0);
 },async action=>{if(['claim','move','drop'].includes(action.type))await wait(100);});
});

test('a competing claim rolls back local motion and allows another piece to be dragged',async()=>{
 await withServer(async({room,client,table,canceled})=>{
   const original=room.puzzle.groups.find(g=>g.id===0).dx;
   const denied=table.network.acquire(0);table.state.groups.find(g=>g.id===0).dx=180;table.network.move(0,180,180);
   await table.network.drop(0,180,180);assert.equal(await denied,false);
   assert.equal(table.state.groups.find(g=>g.id===0).dx,original);assert.ok(canceled.includes(0));assert.equal(client.snapshot.leases[0].playerId,'b');
   assert.equal(await table.network.acquire(1),true);await table.network.drop(1,0,0);
   assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(1)));
 },async(action,room)=>{if(action.type==='claim'&&action.groupId===0){const other=addMember(room,'b','乙','b',Date.now());applyAction(room,other,{type:'claim',groupId:0},Date.now());room.revision++;await wait(50);}});
});

test('fast connections coalesce high frequency motion without delaying drop',async()=>{
 await withServer(async({table,sent})=>{
   assert.equal(await table.network.acquire(0),true);
   for(let i=0;i<40;i++){table.network.move(0,100+i,120);await wait(2);}
   const releasedAt=performance.now();await table.network.drop(0,0,0);
   const moves=sent.filter(a=>a.type==='move');assert.ok(moves.length<20,'pointer events were sent as separate requests');
   for(let i=1;i<moves.length;i++)assert.ok(moves[i].at-moves[i-1].at>=50,'the connection was flooded by pointer events');
   assert.equal(moves.filter(a=>a.at>releasedAt).length,0);assert.ok(performance.now()-releasedAt<100);
 });
});


// The browser bits a PuzzleTable needs. The table is the real one; only the canvas is a stub.
function stubCanvas(){const context={drawImage(){}};return {canvas:{getContext:()=>context,addEventListener(){},focus(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),style:{}}};}
function stubDom(){const saved={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const context={drawImage(){}};globalThis.document={createElement:()=>({getContext:()=>context}),addEventListener(){}};globalThis.Path2D=class{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.cancelAnimationFrame=()=>{};
 return {restore(){Object.assign(globalThis,saved);}};}

test('the piece just dropped can be picked up again before the drop is confirmed',async()=>{
 const originalFetch=globalThis.fetch,room=makeRoom('fast-hands','seaside-native-v2',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),moves=[];
 globalThis.fetch=async(url,options={})=>{const action=options.body?JSON.parse(options.body):null;if(action){moves.push({...action});await wait(120);applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));};
 const {canvas}=stubCanvas(),saved=stubDom(),told=[];
 const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,Date.now())});
 const table=new PuzzleTable(canvas,structuredClone(room.puzzle),{naturalWidth:800,naturalHeight:600},()=>{},message=>told.push(message));
 const cancelled=[],dropDrag=table.cancelNetworkDrag.bind(table);table.cancelNetworkDrag=(id,reason)=>{cancelled.push(id);return dropDrag(id,reason);};
 const cleanup=client.attach(table);
 Object.assign(table,{remoteOwners:{},pointers:new Map(),selected:null,drag:null,pan:null,point:e=>({x:e.clientX,y:e.clientY}),world:p=>p,groupAt:()=>table.state.groups.find(g=>g.id===0),draw(){},update(){}});
 const group=()=>table.state.groups.find(g=>g.id===0),start={dx:group().dx,dy:group().dy};
 try{
  table.down({button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){}});
  table.move({pointerId:1,clientX:40,clientY:40});
  table.up({pointerId:1});
  assert.equal(table.network.canAcquire(0),true,'the piece just dropped stayed locked out until the server answered');
  table.down({button:0,pointerId:2,clientX:40,clientY:40,preventDefault(){}});
  assert.ok(table.drag,'the second drag never started');
  table.move({pointerId:2,clientX:130,clientY:110});
  const expected=start.dx+40+90;
  assert.equal(group().dx,expected,'the piece did not follow the pointer');
  table.up({pointerId:2});
  await wait(700);
  const drops=moves.filter(action=>action.type==='drop');
  assert.equal(drops.length,2);
  assert.equal(drops.at(-1).dx,expected,'the second drop did not carry the position the player left the piece at');
  assert.equal(Math.round(room.puzzle.groups.find(g=>g.id===0).dx),Math.round(expected));
  assert.deepEqual(moves.filter(a=>a.type==='claim'||a.type==='drop').map(a=>a.type),['claim','drop','claim','drop'],'the second claim jumped ahead of the drop it replaces');
  assert.deepEqual(cancelled,[],'the first drop confirmation cancelled the drag that replaced it');
  assert.deepEqual(told,[]);
 }finally{cleanup();table.destroy();saved.restore();globalThis.fetch=originalFetch;}
});

test('a refusal belongs to the drag it was sent for and never cancels the next one',async()=>{
 await withServer(async({room,table,canceled})=>{
   const firstClaim=table.network.acquire(0);table.network.move(0,60,60);
   const firstDrop=table.network.drop(0,60,60);
   assert.equal(table.network.canAcquire(0),true,'the group awaiting confirmation was still locked out');
   const secondClaim=table.network.acquire(0);
   table.state.groups.find(g=>g.id===0).dx=200;table.network.move(0,200,200);
   await firstDrop;
   assert.deepEqual(canceled,[],'the refusal cancelled the newer drag');
   assert.equal(await firstClaim,true);
   assert.equal(await secondClaim,false,'a claim on a group the server has taken away has to be denied');
   assert.deepEqual(canceled,[0],'the newer drag was not taken back after the server refused it');
   assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));
 },async(action,room)=>{if(action.type==='drop'){const group=room.puzzle.groups.find(g=>g.id===0);if(group&&!group.locked){group.locked=true;group.dx=0;group.dy=0;}}});
});

test('a refused claim takes the piece back and says why',async()=>{
 const {canvas}=stubCanvas(),saved=stubDom(),told=[],room=makeRoom('refused-room','seaside-native-v2',12,Date.now());
 const table=new PuzzleTable(canvas,room.puzzle,{naturalWidth:800,naturalHeight:600},()=>{},message=>told.push(message));
 Object.assign(table,{paused:false,networkReady:true,remoteOwners:{},claimSerial:0,selected:null,drag:null,pan:null,space:false,pointers:new Map(),network:{canAcquire:()=>true,acquire:async()=>false,move(){},drop(){},release(){}},point:e=>({x:e.clientX,y:e.clientY}),world:p=>p,groupAt:()=>table.state.groups[0],draw(){}});
 try{
  table.down({button:0,pointerId:1,clientX:10,clientY:10,preventDefault(){}});
  assert.ok(table.drag,'the press has to start the drag before the server answers');
  await wait(0);await wait(0);
  assert.equal(table.drag,null,'the piece stayed under the pointer after a refused claim');
  assert.deepEqual(told,['这组拼块没能确认，已经放回原处']);
 }finally{table.destroy();saved.restore();}
});
