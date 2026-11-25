import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatClient} from '../lib/chat-client.ts';
const message=(id,text='hello')=>({id,playerId:'p',name:'Guest',color:'#99caf4',text,sentAt:1000});
const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
test('lost send replies retry the same ID and merge concurrent older poll replies without losing messages',async t=>{
 let resolvePoll,posts=0;const bodies=[],updates=[];
 t.mock.method(globalThis,'fetch',async(path,init)=>{
  if(init.method==='GET')return await new Promise(resolve=>{resolvePoll=resolve;});
  const body=JSON.parse(init.body);bodies.push(body);posts++;
  if(posts===1)throw new TypeError('network error');
  return Response.json({messages:[message(1,'other'),message(2,body.text)],cursor:2,message:message(2,body.text)});
 });
 const client=new ChatClient('room','token',state=>updates.push(state),()=>true);t.after(()=>client.stop());client.start();await wait();
 await assert.rejects(client.send('hello'));
 await client.send('hello');assert.equal(bodies[0].requestId,bodies[1].requestId);
 resolvePoll(Response.json({messages:[message(1,'other')],cursor:1}));await wait();
 assert.deepEqual(client.state.messages.map(m=>m.id),[1,2]);assert.equal(client.state.sending,false);
});
test('hidden pages do not poll, resume wakes the feed, stop prevents late updates',async t=>{
 let hidden=true,calls=0,finish;const updates=[];
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const client=new ChatClient('room','token',state=>updates.push(state),()=>true,()=>hidden);t.after(()=>client.stop());client.start();await wait();assert.equal(calls,0);
 hidden=false;client.refresh();await wait();assert.equal(calls,1);client.stop();finish(Response.json({messages:[message(1)],cursor:1}));await wait();assert.equal(updates.length,0);
});
test('rate responses retain the draft request ID and block premature retries',async t=>{
 const bodies=[];let hidden=true;
 t.mock.method(globalThis,'fetch',async(path,init)=>{bodies.push(JSON.parse(init.body));return Response.json({error:'wait'},{status:429,headers:{'Retry-After':'10'}});});
 const client=new ChatClient('room','token',()=>{},()=>true,()=>hidden);client.start();t.after(()=>client.stop());
 await assert.rejects(client.send('hello'),/wait/);await assert.rejects(client.send('hello'),/发送太快/);assert.equal(bodies.length,1);
});
