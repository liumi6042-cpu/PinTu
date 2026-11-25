import test from 'node:test';
import assert from 'node:assert/strict';
import {platformSocketUrl} from '../mobile/ports.ts';
import {createWebPlatform} from '../mobile/platform-web.ts';
import {createWechatPlatform} from '../mobile/platform-wechat.ts';

function globals(t,values){for(const [key,value]of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);}}
const config={gameName:'拼图',apiBase:'https://game.test/api/shared',assetBase:'https://game.test/assets'};
test('socket endpoints require WSS and the exact API host and effective port',()=>{
 for(const url of ['wss://game.test/rooms','wss://GAME.test:443/rooms?ticket=abc'])assert.equal(platformSocketUrl(url,config),url);
 for(const url of ['ws://game.test/rooms','wss://other.test/rooms','wss://game.test:444/rooms','wss://game.test@other.test/rooms','wss://game.test/rooms#fragment','wss://game.test/rooms\n'])assert.throws(()=>platformSocketUrl(url,config));
 assert.equal(platformSocketUrl('ws://127.0.0.1:3221/stream',{apiBase:'http://127.0.0.1:3221',development:true}),'ws://127.0.0.1:3221/stream');
 assert.throws(()=>platformSocketUrl('ws://127.0.0.1:3221/stream',{apiBase:'http://127.0.0.1:3221'}));
 assert.throws(()=>platformSocketUrl('ws://192.168.1.1:3221/stream',{apiBase:'http://192.168.1.1:3221',development:true}));
 assert.throws(()=>platformSocketUrl('wss://game.test:0/stream',config));
});

test('browser adapter uses native WebSocket and closes without late callbacks',t=>{
 const sockets=[],events=[];class Socket{static OPEN=1;readyState=0;bufferedAmount=0;constructor(url){this.url=url;this.sent=[];sockets.push(this);}send(data){this.sent.push(data);}close(){this.closed=true;}}
 globals(t,{WebSocket:Socket,document:{baseURI:'https://game.test/'},location:{href:'https://game.test/',origin:'https://game.test'}});
 const p=createWebPlatform({id:'web',...config},{style:{}}),handlers={open:()=>events.push('open'),message:data=>events.push(data),error:()=>events.push('error'),close:()=>events.push('close')};
 assert.throws(()=>p.openSocket('wss://other.test/stream',handlers));assert.equal(sockets.length,0);
 const port=p.openSocket('wss://game.test/stream',handlers),socket=sockets[0];assert.throws(()=>port.send('early'));socket.readyState=1;socket.onopen();socket.onmessage({data:'snapshot'});socket.onmessage({data:new Uint8Array([1])});port.send('cursor');assert.deepEqual(socket.sent,['cursor']);
 socket.bufferedAmount=16*1024;port.send('at-limit');socket.bufferedAmount++;assert.throws(()=>port.send('stale-cursor'),/发送拥堵/);assert.deepEqual(socket.sent,['cursor','at-limit'],'congested socket does not enqueue another obsolete cursor');
 socket.bufferedAmount=0;socket.readyState=2;assert.throws(()=>port.send('closing'),/尚未就绪/);socket.onerror();assert.deepEqual(events,['open','snapshot','error']);port.close();port.close();assert.equal(socket.closed,true);assert.equal(socket.onmessage,null);assert.throws(()=>port.send('late'));
});

test('wechat adapter uses one SocketTask without DOM and detaches its own listeners',t=>{
 const handlers={},events=[],sent=[],removed=[];let endpoint,closed=0;
 const task={send:({data})=>sent.push(data),close:()=>closed++};for(const type of ['Open','Message','Close','Error']){task['on'+type]=fn=>handlers[type]=fn;task['off'+type]=fn=>removed.push([type,fn===handlers[type]]);}
 globals(t,{URL:undefined,wx:{createCanvas:()=>({}),request(){},connectSocket:({url})=>(endpoint=url,task)}});
 const p=createWechatPlatform({id:'wechat',...config}),socket=p.openSocket('wss://game.test/stream',{open:()=>events.push('open'),message:data=>events.push(data),error:()=>events.push('error'),close:()=>events.push('close')});
 assert.equal(endpoint,'wss://game.test/stream');assert.throws(()=>socket.send('early'));handlers.Open();handlers.Message({data:'snapshot'});handlers.Message({data:new ArrayBuffer(1)});socket.send('cursor');assert.deepEqual(sent,['cursor']);
 socket.close();socket.close();handlers.Message({data:'late'});handlers.Close();assert.equal(closed,1);assert.equal(removed.length,4);assert.ok(removed.every(([,same])=>same));assert.deepEqual(events,['open','snapshot']);
});
