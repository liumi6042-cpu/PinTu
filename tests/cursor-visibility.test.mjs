import test from 'node:test';
import assert from 'node:assert/strict';
import {CursorClient} from '../lib/cursor-client.ts';

const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function environment(t,initiallyHidden=false){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document'),listeners=new Set(),calls=[],received=[];
 const document={hidden:initiallyHidden,addEventListener(type,listener){if(type==='visibilitychange')listeners.add(listener);},removeEventListener(type,listener){if(type==='visibilitychange')listeners.delete(listener);}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1000000});
 t.mock.method(performance,'now',()=>Date.now()-1000000);
 let handler=async()=>Response.json({cursors:[],serverTime:Date.now()}),inFlight=0,maximumInFlight=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,method:options.method,body:options.body?JSON.parse(options.body):null,time:Date.now()});
  inFlight++;maximumInFlight=Math.max(maximumInFlight,inFlight);
  try{return await handler(url,options);}finally{inFlight--;}
 });
 const client=new CursorClient('room','token','self',cursors=>received.push(cursors),()=>true,()=>document.hidden);
 t.after(()=>{client.stop();if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;});
 return {client,calls,received,listeners,get maximumInFlight(){return maximumInFlight;},
  fetchWith(next){handler=next;},
  visibility(hidden){document.hidden=hidden;for(const listener of listeners)listener();},
  async advance(ms){t.mock.timers.tick(ms);await settle();},
 };
}

test('background cursor reads sleep, foreground wakes once, and stop removes the listener',async t=>{
 const env=environment(t,true);env.client.start();env.client.start();
 assert.equal(env.listeners.size,1,'repeated start does not add listeners');
 await env.advance(30000);assert.equal(env.calls.length,0);
 env.client.point({x:100,y:200});await env.advance(1000);assert.equal(env.calls.length,0,'hidden pointer events cannot publish a visible cursor');
 env.visibility(false);env.visibility(false);await env.advance(0);
 assert.equal(env.calls.length,1);assert.equal(env.calls[0].method,'GET');
 await env.advance(1199);assert.equal(env.calls.length,1);
 await env.advance(1);assert.equal(env.calls.length,2,'ordinary idle foreground polling continues');
 env.visibility(true);await env.advance(30000);assert.equal(env.calls.length,2,'no periodic hidden GET remains');
 env.visibility(false);await env.advance(0);assert.equal(env.calls.length,3);
 env.client.stop();assert.equal(env.listeners.size,0);
 env.visibility(false);await env.advance(30000);assert.equal(env.calls.length,3);
});

test('hide waits for an in-flight position, sends one newer tombstone, and never overlaps requests',async t=>{
 const env=environment(t);let finishPosition;
 env.fetchWith(()=>new Promise(resolve=>{finishPosition=resolve;}));
 env.client.start();env.client.point({x:40,y:50});await env.advance(0);
 assert.equal(env.calls.length,1);assert.deepEqual(env.calls[0].body.point,{x:40,y:50});
 env.visibility(true);env.client.point(null);await env.advance(250);
 assert.equal(env.calls.length,1,'hide is queued behind the active position');
 env.fetchWith(async()=>Response.json({cursors:[],serverTime:Date.now()}));
 finishPosition(Response.json({cursors:[{playerId:'friend',x:2,y:3,updatedAt:Date.now()}],serverTime:Date.now()}));
 await settle();await env.advance(0);
 assert.equal(env.calls.length,2);assert.equal(env.calls[1].method,'POST');assert.equal(env.calls[1].body.point,null);
 assert.ok(env.calls[1].body.seq>env.calls[0].body.seq);
 assert.ok(env.received.every(cursors=>cursors.length===0),'late replies do not redisplay cursors in the background');
 await env.advance(30000);assert.equal(env.calls.length,2);
 env.visibility(false);env.visibility(false);await env.advance(0);
 assert.equal(env.calls.length,3);assert.equal(env.calls[2].method,'GET');
 assert.equal(env.maximumInFlight,1);
});

test('foreground movement still coalesces at 200 ms and an acknowledged hide is not resent on stop',async t=>{
 const env=environment(t);env.client.start();env.client.point({x:1,y:1});await env.advance(0);
 for(let i=2;i<=20;i++)env.client.point({x:i,y:i});
 await env.advance(199);assert.equal(env.calls.length,1);
 await env.advance(1);assert.equal(env.calls.length,2);assert.deepEqual(env.calls[1].body.point,{x:20,y:20});
 assert.equal(env.calls[1].time-env.calls[0].time,200);
 env.visibility(true);await env.advance(200);assert.equal(env.calls.at(-1).body.point,null);
 const total=env.calls.length;env.client.stop();assert.equal(env.calls.length,total,'an acknowledged hide is not resent on stop');
 assert.equal(env.maximumInFlight,1);
});
