import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../lib/room-client.ts';
import {makeFixtureRoom} from './legacy-fixtures.mjs';
import {addMember,applyAction,snapshot} from '../lib/room-engine.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<80;i++){if(check())return;await tick();}throw Error('Drag queue did not settle');}
function fixture(){
 const room=makeFixtureRoom('queue-room','seaside-native-v2',12,Date.now()),member=addMember(room,'a','甲','a',Date.now()),sent=[],gates=[];
 // Keep unrelated pieces well away: this fixture checks request admission,
 // while real dropGroup must remain free to merge pieces in gameplay tests.
 for(const group of room.puzzle.groups){group.dx=group.id===0?100:1000+group.id*200;group.dy=group.dx;}
 const client=new RoomClient({token:'a',playerId:'a',room:snapshot(room,Date.now())},{
  fetch:async(_url,init={})=>{
   const action=init.body?JSON.parse(init.body):null;
   if(action&&['claim','move','drop','release'].includes(action.type)){
    const gate={action};sent.push(action);gates.push(gate);
    const rejection=await new Promise(resolve=>{gate.finish=resolve;});
    if(rejection)return Response.json({error:rejection.message},{status:rejection.status});
   }
   if(action){try{applyAction(room,member,action,Date.now());room.revision++;}catch(error){return Response.json({error:error.message},{status:error.status||500});}}
   return Response.json(snapshot(room,Date.now()));
  }
 });
 const table={network:null,networkReady:true,cancelNetworkDrag(){},playConnectionSound(){},syncRemote(next,_owners,protectedIds){const old=new Map(client.state.groups.map(g=>[g.id,g]));client.state.groups=structuredClone(next.groups);for(const group of client.state.groups){const prior=old.get(group.id);if(prior&&protectedIds.has(group.id)&&!group.locked){group.dx=prior.dx;group.dy=prior.dy;}}}};
 const detach=client.attach(table);
 const answer=async(type,groupId,rejection)=>{await until(()=>gates.some(g=>g.action.type===type&&g.action.groupId===groupId&&!g.answered));const gate=gates.find(g=>g.action.type===type&&g.action.groupId===groupId&&!g.answered);gate.answered=true;gate.finish(rejection);await tick();};
 async function close(){detach();for(const gate of gates)if(!gate.answered){gate.answered=true;gate.finish();}await tick();}
 return{client,table,room,sent,answer,close};
}

for(const sameGroup of [true,false])test(`rapid ${sameGroup?'same-piece':'different-piece'} gestures have a bounded queue and keep accepted final positions`,async()=>{
 const f=fixture(),net=f.table.network,secondId=sameGroup?0:1;
 try{
  const first=net.acquire(0);net.move(0,150,150);const firstDrop=net.drop(0,150,150);
  assert.equal(net.canAcquire(secondId),true,'one following gesture stays immediately usable');
  const second=net.acquire(secondId);net.move(secondId,240,240);const secondDrop=net.drop(secondId,240,240);
  for(let i=0;i<12;i++){
   assert.equal(net.canAcquire(sameGroup?0:2),false,'replaced map entries must not hide queued gestures');
   assert.equal(await net.acquire(sameGroup?0:2),false,'direct admission also enforces backpressure');
  }
  await f.answer('claim',0);assert.equal(await first,true);await f.answer('drop',0);await firstDrop;
  await f.answer('claim',secondId);assert.equal(await second,true);await f.answer('drop',secondId);await secondDrop;
  assert.equal(f.room.puzzle.groups.find(g=>g.id===secondId).dx,240,'rejected third gestures cannot alter the accepted final drop');
  assert.deepEqual(f.sent.map(a=>[a.type,a.groupId]),[['claim',0],['drop',0],['claim',secondId],['drop',secondId]]);
  assert.equal(net.canAcquire(2),true,'completed tasks release admission capacity');
 }finally{await f.close();}
});

test('one completed gesture frees capacity while the next is still awaiting confirmation',async()=>{
 const f=fixture(),net=f.table.network;
 try{
  const first=net.acquire(0),drop1=net.drop(0,150,150);const second=net.acquire(1),drop2=net.drop(1,240,240);
  await f.answer('claim',0);await first;await f.answer('drop',0);await drop1;
  assert.equal(net.canAcquire(2),true);const third=net.acquire(2),drop3=net.drop(2,330,330);
  assert.equal(net.canAcquire(3),false);
  await f.answer('claim',1);await second;await f.answer('drop',1);await drop2;
  await f.answer('claim',2);await third;await f.answer('drop',2);await drop3;
  assert.equal(f.room.puzzle.groups.find(g=>g.id===2).dx,330);assert.equal(net.canAcquire(3),true);
 }finally{await f.close();}
});

test('claim refusal drains the real queue and admits a later gesture',async()=>{
 const f=fixture(),net=f.table.network;
 try{
  const first=net.acquire(0),drop1=net.drop(0,150,150);const second=net.acquire(1),drop2=net.drop(1,240,240);
  await f.answer('claim',0,{status:409,message:'拼块已被占用'});assert.equal(await first,false);await drop1;
  await f.answer('claim',1);assert.equal(await second,true);await f.answer('drop',1);await drop2;
  assert.equal(net.canAcquire(2),true);assert.equal(f.sent.some(a=>a.type==='drop'&&a.groupId===0),false);
 }finally{await f.close();}
});

test('leaving settles superseded pending gestures without sending their queued drops',async()=>{
 const f=fixture(),net=f.table.network;
 try{
  const first=net.acquire(0),drop1=net.drop(0,150,150);const second=net.acquire(0),drop2=net.drop(0,240,240);
  await until(()=>f.sent.some(a=>a.type==='claim'));f.client.leave();await f.answer('claim',0);
  assert.equal(await first,false);assert.equal(await second,false);await Promise.all([drop1,drop2]);
  assert.equal(f.sent.filter(a=>a.type==='claim').length,1);assert.equal(f.sent.filter(a=>a.type==='drop').length,0);
 }finally{await f.close();}
});
