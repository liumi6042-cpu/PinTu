import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const owner='a'.repeat(64),peer='b'.repeat(64),rid=()=>randomBytes(16).toString('hex');
async function fixture(t){
 let time=1800000000000;
 const service=createMobileService({databasePath:':memory:',diagnosticAccountIds:[owner],now:()=>time,tapTap:{exchangeCode:async code=>({openid:code})}});t.after(()=>service.close());
 await service.bindTapTap({identity:owner,code:'owner',nickname:'老头'});await service.bindTapTap({identity:peer,code:'peer',nickname:'老头'});
 const call=(identity,url,body,token)=>service.handle({identity,url,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const ticket=call(owner,'/api/mobile/diagnostics/room',{requestId:rid()}).data;
 const context=()=>service.realtime.subscribe({identity:owner,roomId:ticket.room.id,authorization:'Bearer '+ticket.token,artworkSnapshot:true});
 const ctx=context(),clientId=rid();let ordinal=0;
 const envelope=(gestureId,action,extra={})=>({id:rid(),clientId,gestureId,ordinal:++ordinal,action,...extra});
 const write=(gestureId,action)=>service.realtime.writeAction(ctx,envelope(gestureId,action));
 return {service,call,ticket,ctx,context,envelope,write,advance:ms=>{time+=ms;}};
}

test('general rooms accept authenticated actions while diagnostics remain owner-bound',async t=>{
 const f=await fixture(t);assert.deepEqual(f.service.realtime.actionCapabilities(f.ctx),{version:1,diagnosticOnly:true});
 const normal=f.call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()}).data;
 const normalCtx=f.service.realtime.subscribe({identity:owner,roomId:normal.room.id,authorization:'Bearer '+normal.token,artworkSnapshot:true});
 assert.deepEqual(f.service.realtime.actionCapabilities(normalCtx),{version:1,diagnosticOnly:false});
 assert.equal(f.service.realtime.writeAction(normalCtx,f.envelope(rid(),{type:'claim',groupId:0})).status,200);
 assert.equal(f.service.realtime.writeAction({...f.ctx,identity:peer},f.envelope(rid(),{type:'claim',groupId:0})).status,403);
 assert.equal(f.service.realtime.writeAction({...f.ctx,authorization:'Bearer '+rid()},f.envelope(rid(),{type:'claim',groupId:0})).status,401);
});

test('all actions commit strong receipts with strict stream order and unchanged player resources',async t=>{
 const f=await fixture(t),before=f.call(owner,'/api/mobile/profile').data,path='/api/rooms/'+f.ticket.room.id;
 for(let groupId=0;groupId<9;groupId++){
  const gesture=rid();
  for(const action of [{type:'claim',groupId},{type:'move',groupId,seq:1,dx:20,dy:20},{type:'drop',groupId,seq:2,dx:0,dy:0}]){
   const input=f.envelope(gesture,action),first=f.service.realtime.writeAction(f.ctx,input);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.diagnostic,true);assert.ok(first.data.diagnosticTiming.serverMs>=0);
   const revision=f.call(owner,path,undefined,f.ticket.token).data.revision;
   const retry=f.service.realtime.writeAction(f.ctx,{...input,since:0});assert.equal(retry.status,200);assert.equal(retry.data.revision,revision);
   assert.equal(f.call(owner,path,undefined,f.ticket.token).data.revision,revision,'replay must not re-run the engine');
   assert.equal(f.service.realtime.writeAction(f.ctx,{...input,action:{...action,groupId:99}}).status,409,'same id cannot change meaning');
  }
 }
 const last=f.call(owner,path,undefined,f.ticket.token).data;assert.ok(last.completedAt);assert.equal(last.mobileResult,undefined);
 const after=f.call(owner,'/api/mobile/profile').data;
 for(const key of ['energy','level','xp','totalXp','giftProgress','giftCount','supply','collection','newcomer','firstRoomId','firstSelectionAvailable','lastReward'])assert.deepEqual(after[key],before[key],key);
 assert.equal(f.call(owner,'/api/lobby').data.rooms.length,0);
});

test('gesture rejection does not stop another gesture and late old-gesture operations cannot release a new lease',async t=>{
 const f=await fixture(t),first=rid(),rejected=rid(),next=rid();
 assert.equal(f.write(first,{type:'claim',groupId:0}).status,200);
 const busy=f.envelope(rejected,{type:'claim',groupId:1});assert.equal(f.service.realtime.writeAction(f.ctx,busy).status,409);
 assert.equal(f.service.realtime.writeAction(f.ctx,busy).status,409,'business rejection is idempotent');
 assert.equal(f.write(rejected,{type:'drop',groupId:1,seq:1,dx:0,dy:0}).data.code,'DIAGNOSTIC_GESTURE_REJECTED');
 assert.equal(f.write(first,{type:'release',groupId:0}).status,200);
 assert.equal(f.write(next,{type:'claim',groupId:0}).status,200);
 assert.equal(f.write(first,{type:'release',groupId:0}).status,409);
 assert.ok(f.call(owner,'/api/rooms/'+f.ticket.room.id,undefined,f.ticket.token).data.leases[0]);
 assert.equal(f.write(next,{type:'drop',groupId:0,seq:1,dx:0,dy:0}).status,200);
});

test('same-player tabs cannot steal gesture leases; disconnect closes its queue and preserves a replacement lease',async t=>{
 const f=await fixture(t),other=f.context(),otherClient=rid(),a=rid(),b=rid();let ordinal=0;
 const send=(gesture,action)=>f.service.realtime.writeAction(other,{id:rid(),clientId:otherClient,gestureId:gesture,ordinal:++ordinal,action});
 f.service.realtime.actionCapabilities(other);
 assert.equal(f.write(a,{type:'claim',groupId:0}).status,200);
 assert.equal(send(b,{type:'claim',groupId:0}).data.code,'DIAGNOSTIC_LEASE_BUSY');
 f.service.realtime.disconnectActions(f.ctx);
 assert.equal(f.write(a,{type:'drop',groupId:0,seq:1,dx:0,dy:0}).data.code,'DIAGNOSTIC_CONNECTION_CLOSED');
 assert.equal(send(rid(),{type:'claim',groupId:0}).status,200);
 f.service.realtime.disconnectActions(f.ctx);
 assert.ok(f.call(owner,'/api/rooms/'+f.ticket.room.id,undefined,f.ticket.token).data.leases[0]);
 f.service.realtime.disconnectActions(other);
 assert.equal(f.call(owner,'/api/rooms/'+f.ticket.room.id,undefined,f.ticket.token).data.leases[0],undefined);
});

test('HTTP compatibility cannot let an old socket release or move a newer lease generation',async t=>{
 const f=await fixture(t),gesture=rid(),path='/api/rooms/'+f.ticket.room.id;
 assert.equal(f.write(gesture,{type:'claim',groupId:0}).status,200);
 assert.equal(f.call(owner,path,{type:'claim',groupId:0},f.ticket.token).status,200,'legacy claim preserves original behavior');
 assert.equal(f.write(gesture,{type:'move',groupId:0,seq:1,dx:0,dy:0}).data.code,'DIAGNOSTIC_LEASE_CHANGED');
 f.service.realtime.disconnectActions(f.ctx);
 assert.ok(f.call(owner,path,undefined,f.ticket.token).data.leases[0],'old socket cannot release new HTTP lease');
});

test('out-of-order actions do not consume stream ordinals and sequence rejection releases only its own gesture',async t=>{
 const f=await fixture(t),gesture=rid();const first=f.envelope(gesture,{type:'claim',groupId:0});
 assert.equal(f.service.realtime.writeAction(f.ctx,{...first,ordinal:2}).data.code,'DIAGNOSTIC_ACTION_ORDER');
 assert.equal(f.service.realtime.writeAction(f.ctx,first).status,200);
 assert.equal(f.write(gesture,{type:'move',groupId:0,seq:2,dx:80,dy:80}).status,200);
 assert.equal(f.write(gesture,{type:'drop',groupId:0,seq:1,dx:0,dy:0}).data.code,'DIAGNOSTIC_ACTION_SEQUENCE');
 assert.equal(f.write(rid(),{type:'claim',groupId:1}).status,200);
});

test('bounded receipt eviction refuses stale writes instead of executing an old action again',async t=>{
 const f=await fixture(t),first=f.envelope(rid(),{type:'claim',groupId:0});
 assert.equal(f.service.realtime.writeAction(f.ctx,first).status,200);
 assert.equal(f.write(first.gestureId,{type:'release',groupId:0}).status,200);
 for(let n=0;n<135;n++){const gesture=rid();assert.equal(f.write(gesture,{type:'claim',groupId:0}).status,200);assert.equal(f.write(gesture,{type:'release',groupId:0}).status,200);}
 const path='/api/rooms/'+f.ticket.room.id,before=f.call(owner,path,undefined,f.ticket.token).data;
 assert.equal(f.service.realtime.writeAction(f.ctx,first).data.code,'DIAGNOSTIC_ACTION_ORDER');
 const after=f.call(owner,path,undefined,f.ticket.token).data;assert.deepEqual(after.leases,before.leases);assert.equal(after.revision,before.revision);
 assert.equal(f.write(rid(),{type:'claim',groupId:1}).status,200,'the current stream remains usable after old receipts expire');
});
