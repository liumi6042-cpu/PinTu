import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
import {RoomClient} from '../lib/room-client.ts';
const owner='a'.repeat(64),peer='b'.repeat(64),rid=()=>randomBytes(16).toString('hex');
async function fixture(t){
 const service=createMobileService({databasePath:':memory:',diagnosticAccountIds:[owner],now:()=>1800000000000,tapTap:{exchangeCode:async code=>({openid:code})}});t.after(()=>service.close());
 await service.bindTapTap({identity:owner,code:'owner',nickname:'老头'});
 await service.bindTapTap({identity:peer,code:'peer',nickname:'老头'});
 const call=(identity,url,body,token)=>service.handle({identity,url,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 return {service,call,create:()=>call(owner,'/api/mobile/diagnostics/room',{requestId:rid()})};
}

test('nine-grid role requires the exact server allowlisted bound identity, not the nickname or client fields',async t=>{
 const f=await fixture(t);
 assert.equal(f.call(owner,'/api/mobile/profile').data.taptap.diagnostics,true);
 assert.equal(f.call(peer,'/api/mobile/profile').data.taptap.diagnostics,false);
 assert.equal(f.call(peer,'/api/mobile/diagnostics/room',{requestId:rid(),diagnostic:true,name:'老头'}).status,403);
 assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:9,visibility:'public',requestId:rid()}).status,400,'normal room policy still excludes nine pieces');
 const made=f.create();assert.equal(made.status,200,JSON.stringify(made.data));const ticket=made.data;
 assert.equal(ticket.room.puzzle.cols,3);assert.equal(ticket.room.puzzle.rows,3);assert.equal(ticket.room.puzzle.groups.length,9);assert.equal(ticket.room.diagnostic,true);
 for(const url of ['/api/rooms/'+ticket.room.id,'/api/rooms/'+ticket.room.id+'/join'])assert.equal(f.call(peer,url,url.endsWith('/join')?{}:undefined,ticket.token).status,403);
 assert.equal(f.call(owner,'/api/lobby').data.rooms.length,0);assert.equal(f.call(owner,'/api/mobile/profile').data.ownedRooms.length,0);
 const stream=f.service.realtime.subscribe({identity:owner,roomId:ticket.room.id,authorization:'Bearer '+ticket.token,artworkSnapshot:true});assert.equal(stream.room.diagnostic,true);
});

test('all nine real server drops preserve wallet, stamina, tasks, first-room experience, and normal-room capacity',async t=>{
 const f=await fixture(t),before=f.call(owner,'/api/mobile/profile').data;
 const made=f.create();assert.equal(made.status,200,JSON.stringify(made.data));const ticket=made.data;
 const path='/api/rooms/'+ticket.room.id;let seq=0,last;
 for(let id=0;id<9;id++){
  assert.equal(f.call(owner,path,{type:'claim',groupId:id,requestId:rid()},ticket.token).status,200);
  last=f.call(owner,path,{type:'drop',groupId:id,dx:0,dy:0,seq:++seq,requestId:rid()},ticket.token);
  assert.equal(last.status,200,JSON.stringify(last.data));assert.equal(last.data.mobileContribution,undefined);assert.ok(last.data.diagnosticTiming.serverMs>=0);
 }
 assert.ok(last.data.completedAt);assert.equal(last.data.mobileResult,undefined);
 const after=f.call(owner,'/api/mobile/profile').data;
 for(const key of ['energy','level','xp','totalXp','giftProgress','giftCount','supply','collection','newcomer','firstRoomId','firstSelectionAvailable','lastReward'])assert.deepEqual(after[key],before[key],key+' changed during diagnostics');
 for(let i=0;i<3;i++)assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()}).status,201);
 assert.equal(f.call(owner,'/api/mobile/profile').data.ownedRooms.length,3);
 const reset=f.create();assert.equal(reset.status,200);assert.notEqual(reset.data.room.id,ticket.room.id);assert.equal(reset.data.room.puzzle.groups.length,9);
 assert.equal(f.call(owner,'/api/mobile/profile').data.ownedRooms.length,3);
 assert.equal(f.call(owner,'/api/lobby').data.rooms.length,3);
 assert.equal(f.call(owner,path,undefined,ticket.token).status,404,'only the disposable old test room closes on reset');
});

test('diagnostic RoomClient reports actual request, drop queue, server, and total times without client rewards',async t=>{
 const f=await fixture(t),ticket=f.create().data,events=[];
 const client=new RoomClient(ticket,{randomId:rid,hidden:()=>false,emit:(name,data)=>events.push({name,data}),fetch:async(url,init)=>{
  const body=init.body?JSON.parse(init.body):undefined;
  if(body?.type==='drop')await new Promise(resolve=>setTimeout(resolve,20));
  const result=f.call(owner,url,body,ticket.token);
  return {ok:result.status<300,status:result.status,headers:{get:()=>null},json:async()=>result.data};
 }});
 const table={cancelNetworkDrag(){},syncRemote(next){client.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
 const cleanup=client.attach(table);t.after(cleanup);
 assert.equal(await table.network.acquire(0),true);await table.network.drop(0,0,0);
 const timings=events.filter(e=>e.name==='room:request-timing').map(e=>e.data);
 for(const type of ['claim','drop-start','drop-queue','drop','drop-total'])assert.ok(timings.some(value=>value.action===type),type+' missing');
 const drop=timings.find(value=>value.action==='drop');assert.ok(drop.ms>=15);assert.ok(drop.serverMs>=0);assert.ok(timings.find(value=>value.action==='drop-total').ms>=drop.ms);
 assert.equal(events.find(e=>e.name==='puzzle:successful-drop').data.creditedXp,undefined);
});
