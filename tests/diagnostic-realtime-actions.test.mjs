import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket} from 'ws';
import {RoomRealtime} from '../lib/room-realtime.ts';
import {createRoomRealtimeHub} from '../server/room-realtime.mjs';

const roomId='a'.repeat(32),token='b'.repeat(32),clientId='c'.repeat(32),gestureId='d'.repeat(32);
const id=n=>n.toString(16).padStart(32,'0');
const action=(n,overrides={})=>({id:id(n),clientId,gestureId,ordinal:n,action:{type:'claim',groupId:0},since:0,...overrides});
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const until=async predicate=>{const end=Date.now()+2500;while(!predicate()){assert.ok(Date.now()<end,'timed out');await new Promise(resolve=>setTimeout(resolve,5));}};
async function fakeClient(t,{advertise=true}={}){
 const sockets=[];
 const realtime=new RoomRealtime({url:'wss://game.test/h5/realtime',random:()=>.5,credentials:async()=>({roomId,token}),openSocket(_url,handlers){const socket={handlers,sent:[],closed:false,bufferedAmount:0,send(raw){this.sent.push(JSON.parse(raw));},close(){this.closed=true;}};sockets.push(socket);return socket;}});
 t.after(()=>realtime.close());realtime.start();await settle();const socket=sockets[0];socket.handlers.open();socket.handlers.message(JSON.stringify({type:'ready',...(advertise?{actions:{version:1,diagnosticOnly:true}}:{})}));
 return {realtime,socket,sockets};
}

test('diagnostic client sends actions immediately and matches independent out-of-order replies',async t=>{
 const f=await fakeClient(t);assert.equal(f.realtime.actionsReady,true);
 const first=f.realtime.sendAction(action(1)),second=f.realtime.sendAction(action(2));
 assert.equal(f.socket.sent.filter(frame=>frame.type==='action').length,2,'no acknowledgement may gate the next send');assert.equal(f.realtime.pendingActionCount,2);
 f.socket.handlers.message(JSON.stringify({type:'action-result',id:id(2),status:409,data:{code:'LEASE_CONFLICT'}}));
 assert.deepEqual(await second,{status:409,data:{code:'LEASE_CONFLICT'}});assert.equal(f.realtime.connected,true);assert.equal(f.realtime.pendingActionCount,1);
 f.socket.handlers.message(JSON.stringify({type:'action-result',id:id(1),status:200,data:{revision:1}}));assert.equal((await first).data.revision,1);assert.equal(f.realtime.pendingActionCount,0);
});

test('old ready frames cannot enable actions and invalid input never reaches the socket',async t=>{
 const f=await fakeClient(t,{advertise:false});
 await assert.rejects(f.realtime.sendAction(action(1)),error=>error.code==='ACTION_TRANSPORT_UNAVAILABLE'&&error.sent===false);
 f.socket.handlers.message('{"type":"ready","actions":{"version":1,"diagnosticOnly":false}}');assert.equal(f.realtime.actionsReady,true);assert.equal(f.realtime.actionsDiagnosticOnly,false);
 f.socket.handlers.message('{"type":"ready","actions":{"version":1,"diagnosticOnly":true}}');
 for(const input of [action(1,{ordinal:2147483648}),action(1,{clientId:'forged'}),action(1,{action:{type:'move',groupId:0,seq:1,dx:20001,dy:0}}),action(1,{action:{type:'shuffle',groupId:0}})])await assert.rejects(f.realtime.sendAction(input),error=>error.code==='INVALID_ACTION_INPUT'&&error.sent===false);
 assert.equal(f.socket.sent.filter(frame=>frame.type==='action').length,0);
});

test('pending and native buffer limits reject new actions without an invisible queue',async t=>{
 const f=await fakeClient(t),promises=Array.from({length:64},(_,n)=>f.realtime.sendAction(action(n+1)));const results=Promise.allSettled(promises);
 assert.equal(f.realtime.pendingActionCount,64);
 await assert.rejects(f.realtime.sendAction(action(65)),error=>error.code==='ACTION_BACKPRESSURE'&&error.sent===false);
 await assert.rejects(f.realtime.sendAction(action(1)),error=>error.code==='ACTION_ID_PENDING'&&error.sent===false);
 assert.equal(f.socket.sent.filter(frame=>frame.type==='action').length,64);
 f.realtime.resetActions();assert.equal(f.realtime.actionsReady,false);assert.equal(f.realtime.pendingActionCount,0);
 assert.ok((await results).every(result=>result.status==='rejected'&&result.reason.sent===true&&result.reason.code==='ACTION_TRANSPORT_RESET'));
});

test('socket buffering rejects an unsent action and disconnect rejects all uncertain sent actions',async t=>{
 const f=await fakeClient(t);f.socket.bufferedAmount=65537;
 await assert.rejects(f.realtime.sendAction(action(1)),error=>error.code==='ACTION_BACKPRESSURE'&&error.sent===false);f.socket.bufferedAmount=0;
 const pending=Promise.allSettled([f.realtime.sendAction(action(2)),f.realtime.sendAction(action(3))]);f.socket.handlers.close();
 assert.ok((await pending).every(result=>result.status==='rejected'&&result.reason.sent===true));assert.equal(f.realtime.pendingActionCount,0);
});

test('an eight-second acknowledgement timeout rejects every pending action and reconnect never replays',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10000});const f=await fakeClient(t);
 const pending=Promise.allSettled([f.realtime.sendAction(action(1)),f.realtime.sendAction(action(2))]);t.mock.timers.tick(8000);await settle();
 assert.ok((await pending).every(result=>result.status==='rejected'&&result.reason.sent===true&&result.reason.code==='ACTION_TIMEOUT'));assert.equal(f.socket.closed,true);
 t.mock.timers.tick(501);await settle();assert.equal(f.sockets.length,2);const next=f.sockets[1];next.handlers.open();next.handlers.message('{"type":"ready","actions":{"version":1,"diagnosticOnly":true}}');
 assert.equal(next.sent.filter(frame=>frame.type==='action').length,0);assert.equal(f.realtime.actionsReady,true);
});

async function hubFixture(t,options={}){
 const server=http.createServer((_req,res)=>res.end('ok')),writes=[];let allowed=options.allowed??true,authenticated=true;
 const hub=createRoomRealtimeHub({server,path:'/realtime',allowOrigin:origin=>origin==='https://game.test',subscribe:()=>({roomId}),readRoom:()=>({id:roomId,revision:0}),readCursors:()=>({cursors:[]}),writeCursor(){},validate(){if(!authenticated)throw Object.assign(Error('session expired'),{status:401,code:'IDENTITY_REQUIRED'});},
  actionCapabilities:()=>allowed?{version:1,diagnosticOnly:true}:undefined,writeAction:async(context,input)=>{writes.push(input);return await options.writeAction?.(context,input)??{status:200,data:{ordinal:input.ordinal}};},...options.hub});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/realtime',{headers:{Origin:'https://game.test'}}),frames=[];ws.on('message',bytes=>frames.push(JSON.parse(bytes)));ws.on('error',()=>{});
 t.after(async()=>{ws.terminate();hub.close();await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>ws.once('open',resolve));ws.send(JSON.stringify({type:'subscribe',roomId,token}));await until(()=>frames.some(frame=>frame.type==='cursors'));
 return {ws,frames,writes,hub,send:input=>ws.send(JSON.stringify({type:'action',...input})),ack:n=>frames.find(frame=>frame.type==='action-result'&&frame.id===id(n)),revoke:()=>{allowed=false;},expire:()=>{authenticated=false;}};
}

test('real hub advertises only opted-in diagnostic actions and preserves strictly ordered writes',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await hubFixture(t,{writeAction:async(_context,input)=>{if(input.ordinal===1)await gate;return {status:input.ordinal===2?409:200,data:{ordinal:input.ordinal}};}});
 assert.deepEqual(f.frames.find(frame=>frame.type==='ready').actions,{version:1,diagnosticOnly:true});
 f.send(action(1));f.send(action(2));f.send(action(3));await until(()=>f.writes.length===1);assert.equal(f.ack(1),undefined);release();await until(()=>f.ack(3));
 assert.deepEqual(f.writes.map(input=>input.ordinal),[1,2,3]);assert.equal(f.ack(2).status,409);assert.equal(f.ws.readyState,WebSocket.OPEN);
 f.send(action(4,{ordinal:2147483648}));await until(()=>f.ack(4));assert.equal(f.ack(4).status,400);assert.equal(f.writes.length,3);
});

test('normal peers gain no action capability; revocation rejects a write and identity expiry closes the channel',async t=>{
 const normal=await hubFixture(t,{allowed:false});assert.equal(normal.frames.find(frame=>frame.type==='ready').actions,undefined);normal.send(action(1));await until(()=>normal.ack(1));assert.equal(normal.ack(1).status,403);assert.equal(normal.writes.length,0);assert.equal(normal.ws.readyState,WebSocket.OPEN);
 const f=await hubFixture(t);f.revoke();f.send(action(1));await until(()=>f.ack(1));assert.equal(f.ack(1).status,403);assert.equal(f.writes.length,0);
 f.expire();f.send(action(2));await until(()=>f.frames.some(frame=>frame.type==='error'));assert.equal(f.frames.at(-1).status,401);await until(()=>f.ws.readyState===WebSocket.CLOSED);
});

test('business exceptions are acknowledged and do not break subsequent ordered writes',async t=>{
 const f=await hubFixture(t,{writeAction:(_context,input)=>{if(input.ordinal===1)throw Object.assign(Error('piece busy'),{status:409,code:'PIECE_BUSY'});return {status:200,data:{ok:true}};}});
 f.send(action(1));f.send(action(2));await until(()=>f.ack(2));assert.equal(f.ack(1).status,409);assert.equal(f.ack(1).data.code,'PIECE_BUSY');assert.equal(f.ack(2).status,200);assert.equal(f.ws.readyState,WebSocket.OPEN);
});

test('diagnostic action bursts are bounded at 64 without enabling a larger normal-peer rate',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await hubFixture(t,{writeAction:async()=>{await gate;return {status:200,data:{ok:true}};}});
 for(let n=1;n<=65;n++)f.send(action(n));await until(()=>f.ack(65));assert.equal(f.ack(65).status,429);assert.equal(f.ws.readyState,WebSocket.OPEN);assert.equal(f.writes.length,1);
 release();await until(()=>f.ack(64));assert.equal(f.writes.length,64);assert.equal(f.hub.stats().actionWrites,64);
 const normal=await hubFixture(t,{allowed:false});for(let n=0;n<41;n++)normal.ws.send('{"type":"ping"}');await until(()=>normal.frames.some(frame=>frame.type==='error'));assert.equal(normal.frames.find(frame=>frame.type==='error').code,'REALTIME_RATE_LIMIT');
});
