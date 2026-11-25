import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
const rid=()=>randomBytes(16).toString('hex'),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
function fixture(){
 let now=1800000000000;const service=createMobileService({now:()=>now});
 const call=(identity,url,body,token)=>service.handle({identity,url,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined});
 const first=call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(first.status,201);
 const ticket=first.data,path='/api/rooms/'+ticket.room.id,peer=call(b,path+'/join',{}).data;
 return {service,call,ticket,path,peer,advance:ms=>now+=ms};
}
test('stationary cursor outlives pointer and online timers without counting the absent player online',()=>{
 const f=fixture();try{
  const input={clientId:rid(),seq:1,point:{x:100,y:120}};
  const initial=f.call(a,f.path+'/cursors',input,f.ticket.token);assert.equal(initial.status,200);const positionTime=initial.data.serverTime;
  f.advance(10*60*1000);assert.equal(f.call(b,f.path,{type:'heartbeat'},f.peer.token).status,200);
  const snapshot=f.call(b,f.path,undefined,f.peer.token).data;
  assert.equal(snapshot.members.some(m=>m.id===f.ticket.playerId),false,'online count still uses the existing heartbeat timeout');
  const present=f.call(b,f.path+'/cursors',undefined,f.peer.token);assert.equal(present.status,200);
  const stationary=present.data.cursors.find(p=>p.playerId===f.ticket.playerId);assert.equal(stationary.x,100);assert.equal(stationary.updatedAt,present.data.serverTime,'legacy observers receive a current membership confirmation');assert.equal(stationary.positionUpdatedAt,positionTime,'the last actual movement timestamp stays intact');
  assert.equal(f.call(a,f.path,{type:'leave'},f.ticket.token).status,200);
  assert.equal(f.call(b,f.path+'/cursors',undefined,f.peer.token).data.cursors.length,0);
  assert.equal(f.call(a,f.path+'/cursors',{...input,seq:2},f.ticket.token).status,409,'late updates cannot restore a departed cursor');
 }finally{f.service.close();}
});

test('legacy pointer-exit null advances only the current writer sequence without clearing its position',()=>{
 const f=fixture();try{
  const clientId=rid(),send=(seq,point,writer=clientId)=>f.call(a,f.path+'/cursors',{clientId:writer,seq,point},f.ticket.token),read=()=>f.call(b,f.path+'/cursors',undefined,f.peer.token).data.cursors.find(p=>p.playerId===f.ticket.playerId);
  const initial=send(1,{x:110,y:130});assert.equal(initial.status,200);const positionTime=initial.data.serverTime;
  f.advance(12000);assert.equal(send(5,null).status,200);let cursor=read();assert.deepEqual([cursor.x,cursor.y],[110,130]);assert.equal(cursor.positionUpdatedAt,positionTime);assert.equal(cursor.updatedAt,positionTime+12000);
  send(4,{x:200,y:210});cursor=read();assert.equal(cursor.x,110,'an in-flight older position cannot pass the null sequence');
  send(2,null);send(4,{x:220,y:230});assert.equal(read().x,110,'a delayed null cannot roll the sequence backward');
  send(99,null,rid());send(1,{x:240,y:250});assert.equal(read().x,110,'a different tab null cannot become the writer and admit old positions');
  const movedAt=f.advance(1000);send(6,{x:160,y:170});cursor=read();assert.deepEqual([cursor.x,cursor.y],[160,170]);assert.equal(cursor.positionUpdatedAt,movedAt);
 }finally{f.service.close();}
});

test('legacy null alone creates no cursor and actual leave clears retained data across rejoin',()=>{
 const f=fixture();try{
  const clientId=rid(),send=(seq,point,token=f.ticket.token)=>f.call(a,f.path+'/cursors',{clientId,seq,point},token),read=()=>f.call(b,f.path+'/cursors',undefined,f.peer.token).data.cursors;
  assert.equal(send(10,null).status,200);assert.equal(read().length,0);
  send(1,{x:180,y:190});send(5,null);assert.equal(read().length,1);
  assert.equal(f.call(a,f.path,{type:'leave'},f.ticket.token).status,200);assert.equal(read().length,0);
  assert.equal(send(6,{x:300,y:310}).status,409,'late positive updates cannot revive a departed member');
  const again=f.call(a,f.path+'/join',{});assert.equal(again.status,200);assert.equal(read().length,0,'rejoining alone cannot restore the departed point');
  send(4,{x:320,y:330},again.data.token);assert.equal(read().length,0,'the pre-leave sequence guard survives the same-member rejoin');
  send(6,{x:200,y:210},again.data.token);assert.equal(read()[0].x,200,'a genuinely newer position after rejoin is visible');
 }finally{f.service.close();}
});
test('normal room membership pruning removes old cursor positions and does not restore them on rejoin',()=>{
 const f=fixture();try{
  const input={clientId:rid(),seq:1,point:{x:140,y:150}};
  f.call(a,f.path+'/cursors',input,f.ticket.token);f.advance(6*60*1000);
  f.call(b,f.path,{type:'heartbeat'},f.peer.token);
  assert.equal(f.call(c,f.path+'/join',{}).status,200,'normal addMember rules prune the old member');
  assert.equal(f.call(b,f.path+'/cursors',undefined,f.peer.token).data.cursors.length,0);
  const again=f.call(a,f.path+'/join',{});assert.equal(again.status,200);assert.notEqual(again.data.playerId,f.ticket.playerId);
  assert.equal(f.call(a,f.path+'/cursors',undefined,again.data.token).data.cursors.length,0);
 }finally{f.service.close();}
});
