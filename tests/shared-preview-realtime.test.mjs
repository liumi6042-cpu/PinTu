import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket} from 'ws';
import {createRoomRealtimeHub} from '../server/room-realtime.mjs';
import {createSharedMobilePreview} from '../scripts/serve-mobile-shared.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
test('shared preview tunnels real WS only at /h5/realtime to its fixed local backend',async()=>{
 const roomId='a'.repeat(32),token='b'.repeat(32),backend=http.createServer((_req,res)=>res.end('backend'));
 const backendPort=await listen(backend),received=[];
 const hub=createRoomRealtimeHub({server:backend,path:'/h5/realtime',allowOrigin:origin=>origin==='http://127.0.0.1:'+backendPort,
  subscribe(_request,input){assert.equal(input.token,token);assert.equal(input.session,'opaque-first-frame');received.push(input);return {roomId};},
  readRoom:()=>({id:roomId,revision:1}),readCursors:()=>({cursors:[],serverTime:Date.now()}),writeCursor(){},validate(){},
 });
 const preview=createSharedMobilePreview({backendPort}),previewPort=await listen(preview),origin='http://127.0.0.1:'+previewPort;let ws;
 try{
  ws=new WebSocket('ws://127.0.0.1:'+previewPort+'/h5/realtime',{headers:{Origin:origin}});
  const frames=[];await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview WS subscribe timeout')),3000);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'subscribe',roomId,token,session:'opaque-first-frame'})));ws.on('message',bytes=>{const frame=JSON.parse(bytes);frames.push(frame);if(frame.type==='room'){assert.equal(frame.data.id,roomId);ws.send(JSON.stringify({type:'ping'}));}if(frame.type==='pong'){clearTimeout(timer);resolve();}});});
  assert.equal(received.length,1);assert.ok(frames.some(frame=>frame.type==='ready'));
  const denied=path=>new Promise((resolve,reject)=>{const socket=new WebSocket('ws://127.0.0.1:'+previewPort+path,{headers:{Origin:origin}});socket.on('error',()=>{});socket.on('open',()=>{socket.terminate();reject(Error('Unexpected generic WS proxy'));});socket.on('unexpected-response',(_request,response)=>{assert.equal(response.statusCode,403);socket.terminate();resolve();});});
  await denied('/api/realtime');await denied('/h5/realtime?token=forbidden');
 }finally{ws?.terminate();preview.closeRealtimeTunnels();hub.close();await Promise.all([new Promise(resolve=>preview.close(resolve)),new Promise(resolve=>backend.close(resolve))]);}
});
