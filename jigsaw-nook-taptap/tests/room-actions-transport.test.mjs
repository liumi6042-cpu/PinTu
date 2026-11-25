import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket} from 'ws';
import {RoomRealtime} from '../lib/room-realtime.ts';
import {createRoomRealtimeHub} from '../server/room-realtime.mjs';

const roomId='a'.repeat(32),token='b'.repeat(32),clientId='c'.repeat(32),gestureId='d'.repeat(32);
const id=n=>n.toString(16).padStart(32,'0');
const action=n=>({id:id(n),clientId,gestureId,ordinal:n,action:{type:'claim',groupId:0},since:0});
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const until=async predicate=>{const end=Date.now()+2500;while(!predicate()){assert.ok(Date.now()<end,'timed out');await new Promise(resolve=>setTimeout(resolve,5));}};

async function fakeClient(t){
 const sockets=[];
 const realtime=new RoomRealtime({url:'wss://game.test/h5/realtime',random:()=>.5,credentials:async()=>({roomId,token}),openSocket(_url,handlers){const socket={handlers,sent:[],bufferedAmount:0,closed:false,send(raw){this.sent.push(JSON.parse(raw));},close(){this.closed=true;}};sockets.push(socket);return socket;}});
 t.after(()=>realtime.close());assert.equal(realtime.actionsDiagnosticOnly,true);realtime.start();await settle();const socket=sockets[0];socket.handlers.open();
 return {realtime,socket,sockets,ready:actions=>socket.handlers.message(JSON.stringify({type:'ready',...(actions===undefined?{}:{actions})}))};
}

test('room action readiness requires the explicit boolean scope and keeps legacy diagnostic-only capability distinguishable',async t=>{
 const f=await fakeClient(t);
 for(const capability of [undefined,{version:1},{version:1,diagnosticOnly:'false'},{version:2,diagnosticOnly:false}]){
  f.ready(capability);assert.equal(f.realtime.connected,true);assert.equal(f.realtime.actionsReady,false);assert.equal(f.realtime.actionsDiagnosticOnly,true);
  await assert.rejects(f.realtime.sendAction(action(1)),error=>error.sent===false&&error.code==='ACTION_TRANSPORT_UNAVAILABLE');
 }
 f.ready({version:1,diagnosticOnly:true});assert.equal(f.realtime.actionsReady,true);assert.equal(f.realtime.actionsDiagnosticOnly,true);
 f.ready({version:1,diagnosticOnly:false});assert.equal(f.realtime.actionsReady,true);assert.equal(f.realtime.actionsDiagnosticOnly,false);
 f.realtime.setHidden(true);assert.equal(f.realtime.actionsReady,false);assert.equal(f.realtime.actionsDiagnosticOnly,true);
 assert.equal(f.socket.sent.filter(frame=>frame.type==='action').length,0);
});

test('ordinary-room actions send without waiting and retain per-ack errors and bounded unsent backpressure',async t=>{
 const f=await fakeClient(t);f.ready({version:1,diagnosticOnly:false});
 const first=f.realtime.sendAction(action(1)),second=f.realtime.sendAction(action(2));assert.equal(f.socket.sent.filter(frame=>frame.type==='action').length,2);
 f.socket.handlers.message(JSON.stringify({type:'action-result',id:id(2),status:409,data:{code:'PIECE_BUSY'}}));assert.equal((await second).status,409);assert.equal(f.realtime.pendingActionCount,1);assert.equal(f.realtime.connected,true);
 f.socket.handlers.message(JSON.stringify({type:'action-result',id:id(1),status:200,data:{revision:1}}));assert.equal((await first).data.revision,1);
 f.socket.bufferedAmount=65537;await assert.rejects(f.realtime.sendAction(action(3)),error=>error.sent===false&&error.code==='ACTION_BACKPRESSURE');f.socket.bufferedAmount=0;
 const all=Promise.allSettled(Array.from({length:64},(_,n)=>f.realtime.sendAction(action(n+10))));assert.equal(f.realtime.pendingActionCount,64);
 await assert.rejects(f.realtime.sendAction(action(100)),error=>error.sent===false&&error.code==='ACTION_BACKPRESSURE');
 f.realtime.resetActions();assert.ok((await all).every(result=>result.status==='rejected'&&result.reason.sent===true));assert.equal(f.realtime.actionsDiagnosticOnly,true);
});

test('ordinary-room action timeout rejects all uncertain writes and a fresh connection replays none',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10000});const f=await fakeClient(t);f.ready({version:1,diagnosticOnly:false});
 const pending=Promise.allSettled([f.realtime.sendAction(action(1)),f.realtime.sendAction(action(2))]);t.mock.timers.tick(8000);await settle();
 assert.ok((await pending).every(result=>result.status==='rejected'&&result.reason.sent===true&&result.reason.code==='ACTION_TIMEOUT'));assert.equal(f.realtime.actionsDiagnosticOnly,true);
 t.mock.timers.tick(501);await settle();assert.equal(f.sockets.length,2);const next=f.sockets[1];next.handlers.open();next.handlers.message('{"type":"ready","actions":{"version":1,"diagnosticOnly":false}}');
 assert.equal(f.realtime.actionsDiagnosticOnly,false);assert.equal(next.sent.filter(frame=>frame.type==='action').length,0);
});

async function hubFixture(t,{capability={version:1,diagnosticOnly:false},writeAction}={}){
 const server=http.createServer((_req,res)=>res.end('ok')),writes=[],frames=[];let current=capability,authenticated=true;
 const hub=createRoomRealtimeHub({server,path:'/realtime',allowOrigin:origin=>origin==='https://game.test',subscribe:()=>({roomId}),readRoom:()=>({id:roomId,revision:0}),readCursors:()=>({cursors:[]}),writeCursor(){},
  validate(){if(!authenticated)throw Object.assign(Error('session expired'),{status:401,code:'IDENTITY_REQUIRED'});},actionCapabilities:()=>current,
  writeAction:async(context,input)=>{writes.push(input);return await writeAction?.(context,input)??{status:200,data:{ordinal:input.ordinal}};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/realtime',{headers:{Origin:'https://game.test'}});ws.on('message',bytes=>frames.push(JSON.parse(bytes)));ws.on('error',()=>{});
 t.after(async()=>{ws.terminate();hub.close();await new Promise(resolve=>server.close(resolve));});await new Promise(resolve=>ws.once('open',resolve));ws.send(JSON.stringify({type:'subscribe',roomId,token}));await until(()=>frames.some(frame=>frame.type==='cursors'));
 return {ws,frames,writes,hub,ready:frames.find(frame=>frame.type==='ready'),send:input=>ws.send(JSON.stringify({type:'action',...input})),ack:n=>frames.find(frame=>frame.type==='action-result'&&frame.id===id(n)),revoke:()=>{current=undefined;},expire:()=>{authenticated=false;}};
}

test('hub accepts both explicit action scopes, preserves ordered writes, and rechecks capability and identity',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await hubFixture(t,{writeAction:async(_context,input)=>{if(input.ordinal===1)await gate;return {status:input.ordinal===2?409:200,data:{ordinal:input.ordinal}};}});
 assert.deepEqual(f.ready.actions,{version:1,diagnosticOnly:false});f.send(action(1));f.send(action(2));f.send(action(3));await until(()=>f.writes.length===1);assert.equal(f.ack(1),undefined);
 release();await until(()=>f.ack(3));assert.deepEqual(f.writes.map(input=>input.ordinal),[1,2,3]);assert.equal(f.ack(2).status,409);assert.equal(f.ws.readyState,WebSocket.OPEN);
 f.revoke();f.send(action(4));await until(()=>f.ack(4));assert.equal(f.ack(4).status,403);assert.equal(f.writes.length,3);
 f.expire();f.send(action(5));await until(()=>f.frames.some(frame=>frame.type==='error'));assert.equal(f.frames.at(-1).status,401);await until(()=>f.ws.readyState===WebSocket.CLOSED);
 const diagnostic=await hubFixture(t,{capability:{version:1,diagnosticOnly:true}});assert.deepEqual(diagnostic.ready.actions,{version:1,diagnosticOnly:true});diagnostic.send(action(1));await until(()=>diagnostic.ack(1));assert.equal(diagnostic.ack(1).status,200);
 const old=await hubFixture(t,{capability:{version:1,diagnosticOnly:'false'}});assert.equal(old.ready.actions,undefined);old.send(action(1));await until(()=>old.ack(1));assert.equal(old.ack(1).status,403);assert.equal(old.writes.length,0);
});

test('ordinary-room action capability retains the 64-action bound without granting actions to unadvertised peers',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await hubFixture(t,{writeAction:async()=>{await gate;return {status:200,data:{ok:true}};}});
 for(let n=1;n<=65;n++)f.send(action(n));await until(()=>f.ack(65));assert.equal(f.ack(65).status,429);assert.equal(f.ws.readyState,WebSocket.OPEN);assert.equal(f.writes.length,1);
 release();await until(()=>f.ack(64));assert.equal(f.writes.length,64);
 const old=await hubFixture(t,{capability:null});for(let n=0;n<41;n++)old.ws.send('{"type":"ping"}');await until(()=>old.frames.some(frame=>frame.type==='error'));assert.equal(old.frames.find(frame=>frame.type==='error').code,'REALTIME_RATE_LIMIT');assert.equal(old.writes.length,0);
});
