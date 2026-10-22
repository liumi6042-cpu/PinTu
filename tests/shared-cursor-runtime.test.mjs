import test from 'node:test';
import assert from 'node:assert/strict';
import {CursorClient} from '../lib/cursor-client.ts';

test('shared room retains the last cursor through hiding and transient errors until explicit leave',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const calls=[],received=[],listeners=new Set();let hidden=false,ready=true,fail=false,memberPresent=true;
 const client=new CursorClient('a'.repeat(32),'room-token','self',value=>received.push(value),()=>ready,()=>hidden,{
  retainUntilLeave:true,randomId:()=> 'd'.repeat(32),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>(listeners.add(fn),()=>listeners.delete(fn)),
  fetch:async(url,init)=>{calls.push({method:init.method,body:init.body?JSON.parse(init.body):undefined});if(fail)throw Error('temporary offline');return{ok:true,status:200,headers:{get:()=>null},json:async()=>({serverTime:Date.now(),cursors:memberPresent?[{playerId:'friend',x:12,y:34,name:'朋友',updatedAt:100000}]:[]})};}
 });
 t.after(()=>client.stop());client.start();client.point({x:20,y:30});t.mock.timers.tick(0);await settle();
 const firstSeq=calls[0].body.seq;assert.equal(received.at(-1)[0].playerId,'friend');
 client.point(null);hidden=true;for(const fn of listeners)fn();const beforeHide=calls.length,receivedBeforeHide=received.length;
 t.mock.timers.tick(60000);await settle();assert.equal(calls.length,beforeHide);assert.equal(received.length,receivedBeforeHide);
 hidden=false;fail=true;client.refresh();t.mock.timers.tick(0);await settle();assert.equal(received.length,receivedBeforeHide,'network failure is not a room departure');
 ready=false;client.refresh();t.mock.timers.tick(1200);await settle();assert.equal(received.length,receivedBeforeHide,'reconnecting does not clear the last snapshot');
 ready=true;fail=false;memberPresent=false;client.refresh();t.mock.timers.tick(0);await settle();assert.deepEqual(received.at(-1),[],'authoritative departure still removes a teammate');
 hidden=true;client.refresh();client.stop();await settle();assert.equal(calls.at(-1).body.point,null);assert.ok(calls.at(-1).body.seq>firstSeq);assert.equal(listeners.size,0);
 assert.equal(calls.filter(call=>call.body?.point===null).length,1,'only explicit room stop publishes a tombstone');
});

test('shared room keeps an unsent last point across a hide before returning',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const calls=[];let hidden=false,fail=true;
 const client=new CursorClient('a'.repeat(32),'room-token','self',()=>{},()=>true,()=>hidden,{retainUntilLeave:true,randomId:()=> 'e'.repeat(32),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:()=>()=>{},fetch:async(url,init)=>{calls.push(init.body?JSON.parse(init.body):undefined);if(fail)throw Error('temporary offline');return{ok:true,status:200,headers:{get:()=>null},json:async()=>({serverTime:Date.now(),cursors:[]})};}});
 t.after(()=>client.stop());client.start();client.point({x:55,y:66});hidden=true;client.refresh();t.mock.timers.tick(30000);await settle();assert.equal(calls.length,0);
 hidden=false;client.refresh();t.mock.timers.tick(0);await settle();assert.deepEqual(calls[0].point,{x:55,y:66});
 client.point({x:77,y:88});fail=false;t.mock.timers.tick(1200);await settle();assert.deepEqual(calls[1].point,{x:77,y:88},'reconnect sends the newest point, not the failed older move');
});

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('wechat cursor channel needs no DOM, native fetch, crypto, Response or AbortController',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AbortController');Object.defineProperty(globalThis,'AbortController',{configurable:true,value:undefined});
 const calls=[],received=[],listeners=new Set();let hidden=false;
 const client=new CursorClient('a'.repeat(32),'room-token','self',value=>received.push(value),()=>true,()=>hidden,{
  randomId:()=> 'c'.repeat(32),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>(listeners.add(fn),()=>listeners.delete(fn)),
  fetch:async(url,init)=>{calls.push({url,...init,body:init.body?JSON.parse(init.body):undefined});return{ok:true,status:200,headers:{get:()=>null},json:async()=>({serverTime:5000,cursors:[{playerId:'friend',x:123,y:456,name:'朋友',level:35,decoration:{id:'bow',artKey:'bow',title:'蝴蝶结',color:'#abc'},updatedAt:4800},{playerId:'self',x:1,y:2,updatedAt:5000}]})};},
 });
 t.after(()=>{client.stop();if(descriptor)Object.defineProperty(globalThis,'AbortController',descriptor);else delete globalThis.AbortController;});
 client.start();client.point({x:20,y:30});t.mock.timers.tick(0);await settle();
 assert.equal(calls.length,1);assert.equal(calls[0].timeout,3500);assert.equal(calls[0].body.clientId,'c'.repeat(32));assert.deepEqual(calls[0].body.point,{x:20,y:30});
 assert.equal(received.at(-1).length,1);assert.equal(received.at(-1)[0].level,35);assert.equal(received.at(-1)[0].decoration.artKey,'bow');assert.equal(received.at(-1)[0].updatedAt,99800);
 hidden=true;for(const fn of listeners)fn();t.mock.timers.tick(200);await settle();assert.equal(calls.at(-1).body.point,null);assert.ok(calls.at(-1).body.seq>calls[0].body.seq);
 const count=calls.length;t.mock.timers.tick(30000);await settle();assert.equal(calls.length,count);
 // Closing a shared Canvas modal does not generate a native visibility event.
 hidden=false;client.refresh();t.mock.timers.tick(0);await settle();assert.equal(calls.length,count+1);assert.equal(calls.at(-1).method,'GET');assert.equal(received.at(-1)[0].playerId,'friend');
 hidden=true;client.refresh();const resumed=calls.length;t.mock.timers.tick(30000);await settle();assert.equal(calls.length,resumed);client.stop();assert.equal(listeners.size,0);
});
