import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {RoomClient} from '../lib/room-client.ts';
import {makeRoom,addMember,applyAction,snapshot,PHOTO_IDS} from '../lib/room-engine.ts';
import {supportsPieceCount} from '../lib/piece-policy.ts';
import {createFittedPuzzle,placedCount} from '../lib/puzzle-engine.ts';
import {legacyApiProblems} from '../scripts/legacy-api-check.mjs';

// 2026-11-02 (player on a Huawei P50 Pro): WebViews before Chrome 92 have no Array.prototype.at. The solo-local
// drop called soloOps.at(-1), threw, and the board swallowed it: all 12 pieces of ch1-1 stayed drawn on their
// spots, unlocked, at 0 / 12, and nothing ever reached the server.
const roomId='a'.repeat(32),playerId='b'.repeat(32),token='c'.repeat(32);
const catalogImage=PHOTO_IDS.find(id=>supportsPieceCount(id,108));
let serial=100;
const randomId=()=>(++serial).toString(16).padStart(32,'0');
const until=async(condition,message='room client did not settle')=>{for(let i=0;i<400;i++){if(condition())return;await turn();}assert.fail(message);};
const without=async(owner,name,run)=>{const saved=Object.getOwnPropertyDescriptor(owner,name);delete owner[name];try{return await run();}finally{if(saved)Object.defineProperty(owner,name,saved);}};

function level(t,{energy=()=>({enabled:true,energy:1000,cap:1000,cost:1,xp:2,autoSupply:false,supplyEnergy:0,free:false})}={}){
 const room=makeRoom(roomId,catalogImage,108,Date.now());room.puzzle=createFittedPuzzle(catalogImage,4,3,123);
 const member=addMember(room,playerId,'玩家','digest',Date.now());
 const ticket={token,playerId,room:snapshot(room,Date.now())},events=[],requests=[];let drawn=null,client;
 const reply=data=>Response.json(data);
 client=new RoomClient(ticket,{fetch:async(url,init)=>{
  const action=init?.body?JSON.parse(init.body):null;requests.push(action);
  if(action?.type==='batch'){const applied=[];for(const op of action.ops){applyAction(room,member,{type:'claim',groupId:op.groupId},Date.now());applyAction(room,member,{type:'drop',groupId:op.groupId,dx:op.dx,dy:op.dy,seq:1},Date.now());room.revision++;applied.push(op.requestId);}
   return reply({...snapshot(room,Date.now()),soloBatch:{applied,skipped:[],stopped:null}});}
  if(action&&action.type!=='leave'){applyAction(room,member,action,Date.now());room.revision++;}
  return reply(snapshot(room,Date.now()));
 },randomId,emit:(name,detail)=>events.push({name,detail}),hidden:()=>false,now:()=>Date.now(),performanceNow:()=>Date.now(),solo:{enabled:()=>true,energy}});
 const table={network:null,networkReady:true,fit(){},cancelNetworkDrag(){},playConnectionSound(){},syncRemote:next=>{drawn=structuredClone(next);}};
 t.after(client.attach(table));
 return {client,table,room,events,requests,drawn:()=>drawn};
}
// What the board does on a finger lift: acquire, move the piece onto its spot, drop it there.
async function place(f,id){assert.equal(await f.table.network.acquire(id),true);await f.table.network.drop(id,0,0).catch(()=>{});}

test('a story level plays to completion on a WebView without Array.prototype.at',async t=>{
 await without(Array.prototype,'at',async()=>{
  const f=level(t);assert.equal(f.client.localPlay,true);
  for(let i=0;i<12;i++){const loose=(f.drawn()??f.client.state).groups.find(g=>!g.locked);if(!loose)break;await place(f,loose.id);await turn();}
  await until(()=>f.room.completedAt!==null,'the room never completed');
  assert.equal(placedCount(f.room.puzzle),12);
  await until(()=>f.client.snapshot.completedAt!=null);
  assert.ok(f.requests.some(action=>action?.type==='batch'),'drops were saved through the solo batch');
  assert.equal(f.events.some(e=>e.name==='room:local-play-error'),false);
 });
});

test('a failing local drop is not swallowed: the room returns to server drags and redraws its own state',async t=>{
 let broken=true;
 const f=level(t,{energy:()=>{if(broken)throw TypeError('missing built-in');return null;}});
 const id=f.client.state.groups[3].id;
 await place(f,id);
 await until(()=>f.events.some(e=>e.name==='room:local-play-error'),'the failure was swallowed');
 await until(()=>!f.client.localPlay,'local play did not end');
 // The table shows the room's position again, not a piece left on its spot unplaced.
 const shown=f.drawn().groups.find(g=>g.id===id),server=f.room.puzzle.groups.find(g=>g.id===id);
 assert.deepEqual([shown.dx,shown.dy,shown.locked],[server.dx,server.dy,server.locked]);
 broken=false;
 // Server drags now place pieces: claim, then drop.
 await place(f,id);await until(()=>f.room.puzzle.groups.some(g=>g.pieces.includes(f.client.state.groups.find(x=>x.id===id)?.pieces[0]??-1)&&g.locked),'the server drag did not place the piece');
 assert.ok(f.requests.some(action=>action?.type==='claim')&&f.requests.some(action=>action?.type==='drop'));
});

test('legacy-runtime installs the missing built-ins and leaves present ones alone',async()=>{
 const names=[[Array.prototype,'at'],[String.prototype,'at'],[Object,'hasOwn'],[Array.prototype,'findLast'],[Array.prototype,'findLastIndex']];
 const saved=names.map(([owner,name])=>[owner,name,Object.getOwnPropertyDescriptor(owner,name)]);
 try{
  for(const [owner,name] of names)delete owner[name];
  await import('../mobile/legacy-runtime.ts?fresh');
  assert.equal([1,2,3].at(-1),3);assert.equal([1,2,3].at(5),undefined);assert.equal('abc'.at(-1),'c');
  assert.equal(Object.hasOwn({a:1},'a'),true);assert.equal(Object.hasOwn(Object.create({a:1}),'a'),false);
  assert.equal([1,2,3,4].findLast(n=>n%2===1),3);assert.equal([1,2,3,4].findLastIndex(n=>n>9),-1);
  assert.equal(Object.keys(Array.prototype).includes('at'),false);
 }finally{for(const [owner,name,descriptor] of saved)if(descriptor)Object.defineProperty(owner,name,descriptor);}
});

test('the build check rejects newer built-ins that the legacy runtime does not cover',()=>{
 assert.deepEqual(legacyApiProblems('a.at(-1);Object.hasOwn(b,"c")').length,2);
 assert.deepEqual(legacyApiProblems('a.at(-1);Object.hasOwn(b,"c");d("hasOwn");d("findLastIndex")'),[]);
 assert.equal(legacyApiProblems('x=crypto.randomUUID()').length,1);
 assert.equal(legacyApiProblems('y=structuredClone(z)').length,1);
 assert.deepEqual(legacyApiProblems('y=typeof structuredClone=="function"?structuredClone(z):0'),[]);
});
