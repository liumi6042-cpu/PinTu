import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/room-client.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';
import { makeRoom, addMember, applyAction, snapshot } from '../lib/room-engine.ts';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fakeTable(client){return {state:client.state,network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protect){const ids=protect instanceof Set?protect:new Set(protect===null?[]:[protect]);const previous=new Map(this.state.groups.map(g=>[g.id,g]));this.state.groups=structuredClone(next.groups);for(const g of this.state.groups){const held=previous.get(g.id);if(ids.has(g.id)&&held&&!g.locked){g.dx=held.dx;g.dy=held.dy;}}this.state.elapsed=next.elapsed;}};}

test('a piece follows pointer motion before the claim response arrives',async()=>{
 let resolveClaim;const claimed=new Promise(r=>{resolveClaim=r;});const room=makeRoom('local','seaside',12,Date.now());
 const savedGlobals={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const context={drawImage(){}};const canvas={getContext:()=>context,addEventListener(){},focus(){},setPointerCapture(){},style:{}};
 globalThis.document={createElement:()=>({getContext:()=>context}),addEventListener(){}};globalThis.Path2D=class{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.cancelAnimationFrame=()=>{};
 const table=new PuzzleTable(canvas,room.puzzle,{naturalWidth:800,naturalHeight:600},()=>{},()=>{});const group=room.puzzle.groups[0],original={dx:group.dx,dy:group.dy};
 Object.assign(table,{state:room.puzzle,paused:false,networkReady:true,remoteOwners:{},claimSerial:0,selected:null,drag:null,pan:null,space:false,pointers:new Map(),canvas:{focus(){},setPointerCapture(){},style:{}},network:{acquire:()=>claimed,move(){},release(){},drop:async()=>{}},point:e=>({x:e.clientX,y:e.clientY}),world:p=>p,groupAt:()=>group,draw(){}});
 table.down({button:0,pointerId:1,clientX:20,clientY:20,preventDefault(){}});
 table.move({pointerId:1,clientX:80,clientY:50});
 try{assert.equal(group.dx,original.dx+60);assert.equal(group.dy,original.dy+30);}finally{resolveClaim(true);await claimed;await Promise.resolve();table.destroy();Object.assign(globalThis,savedGlobals);}
});

test('500 ms round trips do not build a queue of obsolete moves ahead of drop',async()=>{
 const originalFetch=globalThis.fetch,room=makeRoom('slow-room','seaside',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),sent=[];
 globalThis.fetch=async(url,options={})=>{const action=options.body?JSON.parse(options.body):null;const start=performance.now();if(action&&action.type!=='heartbeat'&&action.type!=='leave'){sent.push({type:action.type,dx:action.dx,start});await wait(500);}if(action){applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));};
 const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,Date.now())}),table=fakeTable(client),cleanup=client.attach(table);
 try{assert.equal(await table.network.acquire(0),true);for(let i=1;i<=20;i++){table.state.groups.find(g=>g.id===0).dx=100+i;table.network.move(0,100+i,100);await wait(45);}
   const releasedAt=performance.now();await table.network.drop(0,0,0);
   const obsolete=sent.filter(a=>a.type==='move'&&a.start>releasedAt);assert.equal(obsolete.length,0,`${obsolete.length} obsolete moves delayed the drop`);
   assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));assert.ok(performance.now()-releasedAt<1300,'drop waited for a growing backlog');
 }finally{client.leave();cleanup();globalThis.fetch=originalFetch;}
});

async function withServer(run,beforeAction=async()=>{}) {
 const originalFetch=globalThis.fetch,room=makeRoom('interaction-room','seaside',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),sent=[];
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
 const state=makeRoom('canvas-room','seaside',12,Date.now()).puzzle,table=Object.create(PuzzleTable.prototype);let draws=0,updates=0;
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

