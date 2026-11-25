import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomRealtime} from '../lib/room-realtime.ts';
import {RoomClient} from '../lib/room-client.ts';
import {createPuzzle} from '../lib/puzzle-engine.ts';

const id='a'.repeat(32),token='b'.repeat(32),playerId='c'.repeat(32),session='d'.repeat(64);
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const room=()=>({id,puzzle:createPuzzle('test',12,9,123),revision:0,serverTime:10000,expiresAt:9999999,visibility:'public',startedAt:null,completedAt:null,members:[{id:playerId,name:'玩家',color:'#abc',lastSeen:10000}],leases:{}});
function sockets(t){
 const attempts=[],events=[];let credentials=0;
 const realtime=new RoomRealtime({url:'wss://game.test/h5/realtime',now:()=>Date.now(),random:()=>.5,credentials:async()=>{credentials++;return{roomId:id,token,session,since:0};},openSocket:(url,handlers)=>{const socket={url,handlers,sent:[],closed:false,send(text){this.sent.push(JSON.parse(text));},close(){this.closed=true;}};attempts.push(socket);return socket;}});
 realtime.subscribeState(state=>events.push(state));t.after(()=>realtime.close());return{realtime,attempts,events,credentials:()=>credentials};
}
function stream(){const rooms=new Set(),states=new Set();return{connected:true,subscribeRoom(fn){rooms.add(fn);return()=>rooms.delete(fn);},subscribeState(fn){states.add(fn);return()=>states.delete(fn);},push(value){for(const fn of rooms)fn(value);},status(connected){this.connected=connected;for(const fn of states)fn(connected);},subscriptions:()=>rooms.size+states.size};}
function client(t,read){const state=room(),push=stream(),calls=[],events=[];
 const client=new RoomClient({room:state,token,playerId},{realtime:push,now:()=>Date.now(),performanceNow:()=>Date.now(),randomId:()=> 'e'.repeat(32),hidden:()=>false,emit:(name,detail)=>events.push({name,detail}),fetch:async(url,init)=>{calls.push({url,init});return Response.json(await read?.(url,init)??state);}});
 const table={network:null,networkReady:true,syncRemote(next){client.state.groups=structuredClone(next.groups);},cancelNetworkDrag(){},playConnectionSound(){}};client.heartbeatAt=Date.now();const detach=client.attach(table);t.after(detach);return{client,push,calls,events,table,detach,state};
}

test('one room channel authenticates after opening, carries no credentials in its URL and dispatches authoritative frames',async t=>{
 const f=sockets(t),received=[],cursors=[];f.realtime.subscribeRoom(value=>received.push(value));f.realtime.subscribeCursors(value=>cursors.push(value));f.realtime.start();f.realtime.start();await settle();assert.equal(f.attempts.length,1);
 const socket=f.attempts[0];assert.equal(socket.url,'wss://game.test/h5/realtime');assert.ok(!socket.url.includes(token)&&!socket.url.includes(session));assert.equal(socket.sent.length,0);socket.handlers.open();assert.deepEqual(socket.sent[0],{type:'subscribe',roomId:id,token,session,since:0});assert.equal(f.realtime.connected,false);
 socket.handlers.message('{"type":"ready"}');socket.handlers.message(JSON.stringify({type:'room',data:room()}));socket.handlers.message(JSON.stringify({type:'cursors',data:{cursors:[],serverTime:10000}}));assert.equal(f.realtime.connected,true);assert.equal(received.length,1);assert.equal(cursors.length,1);assert.deepEqual(f.events,[true]);assert.equal(f.realtime.sendCursor({clientId:playerId,seq:1,point:{x:0,y:0}}),true);assert.equal(socket.sent.at(-1).type,'cursor');
 f.realtime.close();socket.handlers.message(JSON.stringify({type:'room',data:room()}));assert.equal(received.length,1);assert.equal(f.realtime.sendCursor({}),false);assert.equal(socket.closed,true);
});

test('malformed or wrong-room frames fall back, reconnect has one fresh generation, and permission errors stop retrying',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10000});const f=sockets(t);f.realtime.start();await settle();const old=f.attempts[0];old.handlers.open();old.handlers.message('{"type":"ready"}');old.handlers.message(JSON.stringify({type:'room',data:{...room(),id:'f'.repeat(32)}}));assert.equal(f.realtime.connected,false);assert.equal(old.closed,true);
 t.mock.timers.tick(501);await settle();assert.equal(f.attempts.length,2);const current=f.attempts[1];old.handlers.message('{"type":"ready"}');assert.equal(f.realtime.connected,false);current.handlers.open();current.handlers.message('{"type":"ready"}');assert.equal(f.realtime.connected,true);current.handlers.message('{"type":"error","status":403,"code":"ROOM_FORBIDDEN"}');t.mock.timers.tick(60000);await settle();assert.equal(f.attempts.length,2);assert.equal(f.realtime.diagnostics().terminal,true);
});

test('hidden channels stop and resume once; stalled sockets are detected without replaying queued moves',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10000});const f=sockets(t);f.realtime.start();await settle();const first=f.attempts[0];first.handlers.open();first.handlers.message('{"type":"ready"}');f.realtime.setHidden(true);assert.equal(first.closed,true);assert.equal(f.realtime.connected,false);assert.equal(f.realtime.sendCursor({}),false);t.mock.timers.tick(60000);await settle();assert.equal(f.attempts.length,1);
 f.realtime.setHidden(false);f.realtime.setHidden(false);await settle();assert.equal(f.attempts.length,2);const second=f.attempts[1];second.handlers.open();second.handlers.message('{"type":"ready"}');t.mock.timers.tick(15000);assert.ok(second.sent.some(value=>value.type==='ping'));t.mock.timers.tick(20001);assert.equal(second.closed,true);assert.ok(second.sent.every(value=>value.type!=='cursor'));
});

test('healthy room pushes suppress polling while retaining a five-second authorized heartbeat and immediate HTTP fallback',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const f=client(t);await settle();t.mock.timers.tick(4500);await settle();assert.equal(f.calls.length,0,'idle WS room must not poll the database');t.mock.timers.tick(502);await settle();assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].init.body).type,'heartbeat');
 const changed=structuredClone(f.state);changed.revision=1;changed.serverTime=Date.now();changed.puzzle.groups[0].dx=234;f.push.push(changed);assert.equal(f.client.state.groups[0].dx,234);f.push.status(false);t.mock.timers.tick(1);await settle();assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.method,'GET');f.detach();assert.equal(f.push.subscriptions(),0);
});

test('a missed delta requests a fresh authorized snapshot and a late pushed state cannot undo it',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const fresh=room();fresh.revision=4;fresh.serverTime=11000;fresh.puzzle.groups[0].dx=432;const f=client(t,async()=>fresh);await settle();f.push.push({...fresh,kind:'delta',baseRevision:3,groups:[],removed:[],elapsed:0,puzzle:undefined});t.mock.timers.tick(1);await settle();assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.headers.Authorization,'Bearer '+token);assert.equal(f.client.snapshot.revision,4);assert.equal(f.client.state.groups[0].dx,432);f.push.push(room());assert.equal(f.client.snapshot.revision,4);
});

test('a pushed drop preceding its HTTP acknowledgement preserves one actual contribution receipt',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const server=room();let f;
 f=client(t,async(_url,init)=>{const action=init.body?JSON.parse(init.body):null;if(action?.type==='claim'){server.leases[action.groupId]={playerId,expires:99999};server.revision++;}
  if(action?.type==='drop'){delete server.leases[action.groupId];server.puzzle.groups.find(value=>value.id===action.groupId).locked=true;server.revision++;server.serverTime=Date.now();f.push.push(structuredClone(server));return{...server,mobileContribution:{requestId:action.requestId,groupId:action.groupId,creditedXp:2}};}return structuredClone(server);});await settle();assert.equal(await f.table.network.acquire(0),true);await f.table.network.drop(0,0,0);assert.equal(f.events.filter(value=>value.name==='puzzle:successful-drop').length,1);assert.equal(f.events.find(value=>value.name==='puzzle:successful-drop').detail.creditedXp,2);assert.ok(f.calls.every(value=>value.init.method==='POST'),'game actions must stay on the existing HTTP validation path');
});
