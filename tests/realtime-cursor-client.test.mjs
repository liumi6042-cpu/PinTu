import test from 'node:test';
import assert from 'node:assert/strict';
import {CursorClient,REALTIME_CURSOR_INTERVAL} from '../lib/cursor-client.ts';

const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function fixture(t,connected=true){
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const calls=[],sent=[],received=[],states=new Set(),cursors=new Set();let hidden=false,accept=true;
 const realtime={connected,subscribeCursors:fn=>(cursors.add(fn),()=>cursors.delete(fn)),subscribeState:fn=>(states.add(fn),()=>states.delete(fn)),sendCursor(data){if(!this.connected||!accept)return false;sent.push({at:Date.now(),...data});return true;}};
 let fetch=async(_url,init)=>{calls.push(init);return{ok:true,status:200,headers:{get:()=>null},json:async()=>({cursors:[],serverTime:Date.now()})};};
 const client=new CursorClient('room','token','self',value=>received.push(value),()=>true,()=>hidden,{retainUntilLeave:true,realtime,randomId:()=> 'a'.repeat(32),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:()=>()=>{},fetch:(...args)=>fetch(...args)});
 t.after(()=>client.stop());return{client,calls,sent,received,realtime,states,cursors,advance:async ms=>{t.mock.timers.tick(ms);await settle();},state(value){realtime.connected=value;for(const fn of states)fn(value);},emit(data){for(const fn of cursors)fn(data);},hidden(value){hidden=value;client.refresh();},fetch(fn){fetch=fn;},accept(value){accept=value;}};
}

test('healthy realtime sends only latest positions at 15 Hz and never polls HTTP',async t=>{
 const f=fixture(t);f.client.start();f.client.point({x:0,y:0});await f.advance(0);
 for(let x=1;x<=1000;x++){f.client.point({x,y:1});await f.advance(1);}
 assert.equal(REALTIME_CURSOR_INTERVAL,1000/15);assert.equal(f.sent.length,15,'15 positions in the first one-second window');
 assert.ok(f.sent.every((item,i)=>i===0||item.at-f.sent[i-1].at>=REALTIME_CURSOR_INTERVAL));assert.deepEqual(f.sent.at(-1).point,{x:938,y:1});
 await f.advance(67);assert.deepEqual(f.sent.at(-1).point,{x:1000,y:1});const count=f.sent.length;await f.advance(30000);assert.equal(f.sent.length,count);assert.equal(f.calls.length,0);
 f.client.stop();assert.equal(f.sent.at(-1).point,null);assert.ok(f.sent.at(-1).seq>f.sent.at(-2).seq);assert.equal(f.calls.length,0);assert.equal(f.states.size,0);assert.equal(f.cursors.size,0);
});

test('realtime snapshots retain self filtering and server-time age conversion',async t=>{
 const f=fixture(t);f.client.start();f.emit({serverTime:5000,cursors:[{playerId:'self',x:1,y:1,updatedAt:5000},{playerId:'friend',x:7,y:8,name:'朋友',level:12,updatedAt:4800}]});
 assert.equal(f.received.at(-1).length,1);assert.equal(f.received.at(-1)[0].playerId,'friend');assert.equal(f.received.at(-1)[0].updatedAt,99800);
 f.hidden(true);const before=f.received.length;f.state(false);await f.advance(30000);assert.equal(f.received.length,before,'disconnect and hiding do not fabricate room leave');
 f.state(true);f.emit({cursors:[],serverTime:Date.now()});assert.deepEqual(f.received.at(-1),[],'authoritative leave still removes a retained cursor');
});

test('switching a pending HTTP exchange to realtime drops the stale reply and sends only the newest point',async t=>{
 const f=fixture(t,false);let reply;f.fetch((_url,init)=>{f.calls.push(init);return new Promise(resolve=>reply=resolve);});f.client.start();f.client.point({x:1,y:1});await f.advance(0);assert.equal(f.calls.length,1);
 f.client.point({x:20,y:30});f.state(true);await settle();await f.advance(0);assert.deepEqual(f.sent.at(-1).point,{x:20,y:30});
 reply({ok:true,status:200,headers:{get:()=>null},json:async()=>({cursors:[{playerId:'stale',x:1,y:1,updatedAt:Date.now()}]})});await settle();assert.equal(f.received.length,0);
 await f.advance(10000);assert.equal(f.calls.length,1,'no HTTP loop survives socket handover');
});

test('failed sends keep one latest point and HTTP fallback retains its 200 ms movement interval',async t=>{
 const f=fixture(t);f.accept(false);f.client.start();f.client.point({x:1,y:1});await f.advance(0);f.client.point({x:2,y:2});f.client.point({x:9,y:9});f.state(false);await f.advance(0);
 assert.deepEqual(JSON.parse(f.calls[0].body).point,{x:9,y:9});assert.equal(f.sent.length,0);
 f.client.point({x:10,y:10});await f.advance(199);assert.equal(f.calls.length,1);await f.advance(1);assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[1].body).point,{x:10,y:10});
 f.accept(true);f.client.point({x:11,y:11});f.state(true);await f.advance(0);assert.deepEqual(f.sent.at(-1).point,{x:11,y:11});assert.equal(f.calls.length,2);
});

test('an HTTP body from before a socket connect-disconnect cannot overwrite the newer stream snapshot',async t=>{
 const f=fixture(t,false);let body;f.fetch(async(_url,init)=>{f.calls.push(init);return{ok:true,status:200,headers:{get:()=>null},json:()=>new Promise(resolve=>body=resolve)};});f.client.start();await f.advance(0);
 f.state(true);f.emit({cursors:[{playerId:'newer',x:4,y:5,updatedAt:100000}]});f.state(false);body({cursors:[{playerId:'stale',x:1,y:1,updatedAt:100000}]});await settle();assert.equal(f.received.at(-1)[0].playerId,'newer');
});

test('hidden realtime pauses pending movement without discarding it or replaying intermediate positions',async t=>{
 const f=fixture(t);f.client.start();f.client.point({x:1,y:1});await f.advance(0);f.client.point({x:2,y:2});f.client.point({x:3,y:3});f.hidden(true);await f.advance(60000);assert.equal(f.sent.length,1);assert.equal(f.calls.length,0);
 f.hidden(false);await f.advance(0);assert.equal(f.sent.length,2);assert.deepEqual(f.sent.at(-1).point,{x:3,y:3});await f.advance(10000);assert.equal(f.sent.length,2);
});
