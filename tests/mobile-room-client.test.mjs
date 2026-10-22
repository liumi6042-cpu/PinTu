import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/room-client.ts';
import { createPuzzle } from '../lib/puzzle-engine.ts';

const until = async condition => { const end = Date.now() + 1500; while (!condition()) { if (Date.now() > end) throw new Error('Room client did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('energy refusal keeps room transport and camera ready, publishes authoritative profile, then accepts a replenished drag', async () => {
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window, previousDocument = globalThis.document;
  const room = {id:'a'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),expiresAt:Date.now()+60000,visibility:'public',startedAt:null,completedAt:null,members:[{id:'b'.repeat(32),name:'玩家',color:'#5b8b70',lastSeen:Date.now(),level:4}],leases:{}};
  const events = [], actionIds = [], windowEvents = new EventTarget();
  let energy = 0;
  globalThis.window = windowEvents; globalThis.document = {hidden:false};
  windowEvents.addEventListener('mobile:profile', event => events.push(['profile',event.detail.energy]));
  windowEvents.addEventListener('mobile:energy-empty', () => events.push(['empty']));
  globalThis.fetch = async (_url, init) => {
    const action = init?.body ? JSON.parse(init.body) : null;
    if (action && action.type !== 'leave') { assert.match(action.requestId,/^[a-f0-9]{32}$/); actionIds.push(action.requestId); }
    if (['claim','drop'].includes(action?.type) && energy === 0) return Response.json({error:'体力不足',code:'ENERGY_EMPTY',profile:{energy:0,level:4}},{status:402});
    if (action?.type === 'claim') { room.leases[action.groupId] = {playerId:'b'.repeat(32),expires:Date.now()+10000}; room.revision++; }
    if (action?.type === 'release') { delete room.leases[action.groupId]; room.revision++; }
    room.serverTime = Date.now();
    return Response.json({...room,profile:{energy,level:4}});
  };
  const client = new RoomClient({token:'room-token',playerId:'b'.repeat(32),room:structuredClone(room)});
  const table = {network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next){client.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
  const detach = client.attach(table);
  try {
    assert.equal(await table.network.acquire(0),false);
    await until(() => events.some(item => item[0] === 'empty'));
    assert.equal(client.connected,true,'insufficient stamina is not a disconnected room');
    assert.equal(table.networkReady,true,'camera and non-drag canvas tools remain usable');
    assert.ok(events.some(item => item[0] === 'profile' && item[1] === 0));
    energy = 50;
    assert.equal(await table.network.acquire(0),true);
    assert.ok(events.some(item => item[0] === 'profile' && item[1] === 50));
    energy = 0;
    client.state.groups.find(group => group.id === 0).dx = 999;
    await table.network.drop(0,999,999);
    assert.equal(client.connected,true,'a rejected drop is also a gameplay refusal, not a transport failure');
    assert.notEqual(client.state.groups.find(group => group.id === 0).dx,999,'rejected optimistic move reconciles to server position');
    energy = 50;
    assert.equal(await table.network.acquire(0),true);
    table.network.release(0);
    await until(() => !room.leases[0]);
    assert.equal(new Set(actionIds).size,actionIds.length,'different actions receive different idempotency IDs');
  } finally {
    detach(); globalThis.fetch=previousFetch; globalThis.window=previousWindow; globalThis.document=previousDocument;
  }
});


test('drop receipt survives an earlier poll and publishes the actual credited XP once', async () => {
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window,previousDocument=globalThis.document;
  const room={id:'c'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),expiresAt:Date.now()+60000,visibility:'public',startedAt:null,completedAt:null,members:[{id:'d'.repeat(32),name:'玩家',color:'#5b8b70',lastSeen:Date.now()}],leases:{}};
  const events=[],windowEvents=new EventTarget();let client;
  globalThis.window=windowEvents;globalThis.document={hidden:false};
  windowEvents.addEventListener('puzzle:successful-drop',event=>events.push(event.detail));
  globalThis.fetch=async(_url,init)=>{
    const action=init?.body?JSON.parse(init.body):null;
    if(action?.type==='claim'){
      room.leases[action.groupId]={playerId:'d'.repeat(32),expires:Date.now()+10000};room.revision++;
      // Poll already got the settled group before the client begins processing its drop.
      room.puzzle.groups.find(g=>g.id===action.groupId).locked=true;
    }
    room.serverTime=Date.now();
    if(action?.type==='drop'){
      delete room.leases[action.groupId];room.revision++;
      return Response.json({...room,mobileContribution:{requestId:action.requestId,groupId:action.groupId,creditedXp:2}});
    }
    return Response.json(room);
  };
  client=new RoomClient({token:'token',playerId:'d'.repeat(32),room:structuredClone(room)});
  const table={network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next){client.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
  const detach=client.attach(table);
  try{
    assert.equal(await table.network.acquire(0),true);
    await table.network.drop(0,0,0);
    assert.equal(events.length,1);
    assert.equal(events[0].roomId,room.id);assert.equal(events[0].groupId,0);assert.equal(events[0].creditedXp,2);
    assert.match(events[0].requestId,/^[a-f0-9]{32}$/);
    const response=await client.request();
    assert.equal(response.mobileContribution,undefined,'later polls never carry forward a prior receipt');
    assert.equal(events.length,1);
  }finally{detach();globalThis.fetch=previousFetch;globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

test('unrelated contribution receipts cannot be attached to a client action', async () => {
  const previousFetch=globalThis.fetch;
  const room={id:'e'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),members:[],leases:{}};
  const client=new RoomClient({token:'token',playerId:'f'.repeat(32),room});
  try{
    for(const receipt of [
      {requestId:'b'.repeat(32),groupId:0,creditedXp:1},
      {requestId:'a'.repeat(32),groupId:1,creditedXp:1},
      {requestId:'a'.repeat(32),groupId:0,creditedXp:0},
    ]){
      globalThis.fetch=async()=>Response.json({...room,mobileContribution:receipt});
      assert.equal((await client.request({type:'drop',groupId:0,dx:0,dy:0,seq:1,requestId:'a'.repeat(32)})).mobileContribution,undefined);
    }
  }finally{globalThis.fetch=previousFetch;}
});
