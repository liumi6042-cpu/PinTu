import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {WebSocket} from 'ws';
import {GameClient} from '../mobile/client.ts';
import {RoomClient} from '../lib/room-client.ts';
import {createMobileService} from '../server/mobile-service.mjs';

const origin='https://ma-h5-al.tapimg.com',rid=()=>randomBytes(16).toString('hex');
const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<end,'timed out waiting for real local transport');await new Promise(resolve=>setTimeout(resolve,5));}};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>server.close(resolve));

test('the real HTTP gateway, authenticated WS hub, GameClient and RoomClient pipeline diagnostic actions end to end',async t=>{
 const dir=mkdtempSync(resolve('work/diagnostic-http-ws-')),bundle=resolve(dir,'gateway.mjs'),sessionDb=resolve(dir,'sessions.sqlite');
 const built=await build({entryPoints:[resolve('server/h5-gateway.mjs')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'current-diagnostic-hub',setup(builder){
  builder.onResolve({filter:/^\.\.\/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve('server/room-realtime.mjs')}));
  // The CLI-only dynamic import must remain dormant; this test injects its service.
  builder.onResolve({filter:/^\.\/mobile-service\.mjs$/},args=>args.importer.endsWith('h5-gateway.mjs')?{path:pathToFileURL(resolve('server/mobile-service.mjs')).href,external:true}:undefined);
 }}],metafile:true});
 assert.ok(Object.keys(built.metafile.inputs).some(path=>path.replaceAll('\\','/').endsWith('server/room-realtime.mjs')),'bundle must use the new source hub, not the old generated output');
 const {createH5Gateway}=await import(pathToFileURL(bundle).href);
 let gateway,bootstrap,service,detach;const sockets=[],streams=[];
 t.after(async()=>{
  detach?.();for(const stream of streams)stream.close();for(const socket of sockets)socket.terminate();
  if(gateway){gateway.realtime.close();await close(gateway);}else service?.close();
  if(bootstrap?.listening)await close(bootstrap);
  assert.ok(dir.startsWith(resolve('work')+sep));rmSync(dir,{recursive:true,force:true});
 });
 // Mint the actual opaque credential over HTTP before configuring its account allowlist.
 bootstrap=createH5Gateway({upstream:'http://127.0.0.1',databasePath:sessionDb,allowedOrigins:[origin]});await listen(bootstrap);
 const issued=await fetch('http://127.0.0.1:'+bootstrap.address().port+'/h5/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
 assert.equal(issued.status,201);const session=(await issued.json()).token;assert.match(session,/^[a-f0-9]{64}$/);await close(bootstrap);
 const owner=createHash('sha256').update(session).digest('hex');
 service=createMobileService({databasePath:':memory:',diagnosticAccountIds:[owner],tapTap:{exchangeCode:async()=>({openid:'real-http-ws-test-owner'})}});
 gateway=createH5Gateway({upstream:'http://127.0.0.1',databasePath:sessionDb,allowedOrigins:[origin],mobileService:service});await listen(gateway);
 const base='http://127.0.0.1:'+gateway.address().port+'/h5',storage=new Map([['jigsaw:h5-session:'+base,session]]),requests=[],outgoing=[],incoming=[],heldAcks=[];let holdAcks=true;
 const platform={config:{id:'taptap',apiBase:base,assetBase:base+'/assets',gameName:'local diagnostic integration'},randomId:rid,
  storage:{get:key=>storage.get(key)||null,set:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key)},tapTapIdentity:async()=>({code:'http-binding-code',nickname:'Test owner'}),
  request:async input=>{requests.push(input);const response=await fetch(input.url,{method:input.method||'GET',headers:{Origin:origin,...input.headers},body:input.body===undefined?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body)});return {status:response.status,data:await response.json(),headers:Object.fromEntries(response.headers)};},
  openSocket:(url,handlers)=>{
   const socket=new WebSocket(url,{headers:{Origin:origin}});sockets.push(socket);
   socket.on('open',handlers.open);socket.on('message',bytes=>{const raw=bytes.toString(),frame=JSON.parse(raw);incoming.push(frame);
    if(holdAcks&&frame.type==='action-result')heldAcks.push(()=>handlers.message(raw));else handlers.message(raw);
   });socket.on('error',handlers.error);socket.on('close',handlers.close);
   return {send:raw=>{outgoing.push(JSON.parse(raw));socket.send(raw);},close:()=>socket.close()};
  },
 };
 const game=new GameClient(platform);await game.start();
 assert.equal(game.profile.taptap.bound,true);assert.equal(game.profile.taptap.diagnostics,true);
 assert.ok(requests.some(input=>input.url.endsWith('/api/taptap/bind')&&input.method==='POST'),'bind must travel through the real HTTP gateway');
 const before=structuredClone(await game.refresh()),ticket=await game.createDiagnosticRoom();assert.equal(ticket.room.diagnostic,true);
 let roomClient;const stream=game.roomRealtime(ticket,()=>roomClient?.snapshot.revision??ticket.room.revision);assert.ok(stream);streams.push(stream);
 const events=[];roomClient=new RoomClient(ticket,{fetch:game.fetchLike,realtime:stream,randomId:rid,hidden:()=>false,emit:(name,data)=>events.push({name,data})});
 const table={cancelNetworkDrag(){},playConnectionSound(){},syncRemote(next,owners,protectedIds){const local=new Map(roomClient.state.groups.map(group=>[group.id,group]));roomClient.state.groups=next.groups.map(group=>structuredClone(protectedIds.has(group.id)&&local.has(group.id)?local.get(group.id):group));}};
 detach=roomClient.attach(table);stream.start();await until(()=>stream.actionsReady);assert.equal(stream.diagnostics().lastError,'');
 const ready=incoming.find(frame=>frame.type==='ready');assert.deepEqual(ready.actions,{version:1,diagnosticOnly:true});
 const targets=[{id:0,dx:0,dy:0},{id:1,dx:150,dy:600},{id:2,dx:350,dy:600}],gestures=[];
 for(const target of targets){assert.equal(table.network.canAcquire(target.id),true);const granted=table.network.acquire(target.id);Object.assign(roomClient.state.groups.find(group=>group.id===target.id),{dx:target.dx,dy:target.dy});gestures.push({granted,finished:table.network.drop(target.id,target.dx,target.dy)});}
 const sentActions=outgoing.filter(frame=>frame.type==='action');assert.deepEqual(sentActions.map(frame=>frame.action.type),['claim','drop','claim','drop','claim','drop']);
 assert.equal(stream.pendingActionCount,6,'all six actions are already sent before acknowledgements are delivered');
 assert.deepEqual(sentActions.map(frame=>frame.ordinal),[1,2,3,4,5,6]);assert.equal(new Set(sentActions.map(frame=>frame.clientId)).size,1);
 await until(()=>heldAcks.length===6);assert.ok(incoming.filter(frame=>frame.type==='action-result').every(frame=>frame.status===200));
 assert.equal(gateway.realtime.stats().actionWrites,6,'all six writes reached the actual new hub');
 holdAcks=false;for(const deliver of heldAcks.splice(0))deliver();
 assert.deepEqual(await Promise.all(gestures.map(gesture=>gesture.granted)),[true,true,true]);await Promise.all(gestures.map(gesture=>gesture.finished));
 const authority=await game.json('/api/rooms/'+ticket.room.id,'GET',undefined,{Authorization:'Bearer '+ticket.token});
 assert.equal(authority.puzzle.groups.find(group=>group.id===0).locked,true);assert.equal(roomClient.snapshot.puzzle.groups.find(group=>group.id===0).locked,true);
 for(const target of targets.slice(1)){const actual=authority.puzzle.groups.find(group=>group.id===target.id);assert.equal(actual.dx,target.dx);assert.equal(actual.dy,target.dy);assert.equal(roomClient.state.groups.find(group=>group.id===target.id).dx,target.dx);}
 const dragWrites=requests.filter(input=>input.method==='POST'&&/\/api\/rooms\/[a-f0-9]{32}(?:\?|$)/.test(input.url)).map(input=>typeof input.body==='string'?JSON.parse(input.body):input.body).filter(body=>['claim','move','drop','release'].includes(body?.type));
 assert.equal(dragWrites.length,0,'HTTP heartbeats are allowed, HTTP drag writes are not');
 const queue=events.filter(event=>event.name==='room:request-timing'&&event.data.action==='drop-queue');assert.equal(queue.length,3);assert.ok(queue.every(event=>event.data.ms<50));
 const after=await game.refresh();for(const key of ['energy','level','xp','totalXp','giftProgress','giftCount','supply','collection','newcomer','firstRoomId','firstSelectionAvailable','lastReward'])assert.deepEqual(after[key],before[key],key+' must not change during diagnostic play');
 detach();detach=null;stream.close();
 const normal=await game.createRoom({mode:'random',pieces:48,visibility:'private',requestId:rid()}),readyCount=incoming.filter(frame=>frame.type==='ready').length;
 const normalStream=game.roomRealtime(normal,()=>normal.room.revision);assert.ok(normalStream);streams.push(normalStream);normalStream.start();
 await until(()=>normalStream.connected&&incoming.filter(frame=>frame.type==='ready').length>readyCount);
 assert.deepEqual(incoming.filter(frame=>frame.type==='ready').at(-1).actions,{version:1,diagnosticOnly:false});assert.equal(normalStream.actionsReady,true);
 const normalClientId=rid(),normalGesture=rid();
 assert.equal((await normalStream.sendAction({id:rid(),clientId:normalClientId,gestureId:normalGesture,ordinal:1,action:{type:'claim',groupId:0}})).status,200);
 assert.equal((await normalStream.sendAction({id:rid(),clientId:normalClientId,gestureId:normalGesture,ordinal:2,action:{type:'release',groupId:0}})).status,200);
 assert.equal(gateway.realtime.stats().actionWrites,8,'ordinary rooms now support separately scoped action writes');
});
