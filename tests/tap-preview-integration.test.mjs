import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {WebSocket} from 'ws';
import {createMobileService} from '../server/mobile-service.mjs';
import {GameClient} from '../mobile/client.ts';
import {RoomClient} from '../lib/room-client.ts';

const rid=()=>randomBytes(16).toString('hex');
const until=async condition=>{const end=Date.now()+7000;while(!condition()){assert.ok(Date.now()<end,'integration did not converge');await new Promise(resolve=>setTimeout(resolve,10));}};

test('production public rooms use real HTTP/WS authority plus simulated Tap relay and resume canonical moves on failure',async t=>{
 mkdirSync('work',{recursive:true});const dir=mkdtempSync(resolve('work/tap-preview-http-')),bundle=resolve(dir,'gateway.mjs');
 await build({entryPoints:['server/h5-gateway.mjs'],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'current-source-hub',setup(builder){
  builder.onResolve({filter:/^\.\.\/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve('server/room-realtime.mjs')}));
  builder.onResolve({filter:/^\.\/mobile-service\.mjs$/},args=>args.importer.endsWith('h5-gateway.mjs')?{path:pathToFileURL(resolve('server/mobile-service.mjs')).href,external:true}:undefined);
 }}]});
 const {createH5Gateway}=await import(pathToFileURL(bundle).href),writes=[],cursorWrites=[],sockets=[],streams=[],detach=[];
 const service=createMobileService({databasePath:':memory:',tapMultiplayerEnabled:true,tapTap:{exchangeCode:async code=>({openid:code})}});
 const originalWrite=service.realtime.writeAction;service.realtime.writeAction=(context,input)=>{writes.push(structuredClone(input));return originalWrite(context,input);};
 const originalCursor=service.realtime.writeCursor;service.realtime.writeCursor=(...args)=>{cursorWrites.push(args[1]);return originalCursor(...args);};
 const gateway=createH5Gateway({databasePath:':memory:',mobileService:service,upstream:'http://127.0.0.1:1',allowedOrigins:['https://tap-test.invalid'],assetDir:resolve('public'),assetPaths:[]});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+gateway.address().port+'/h5';
 t.after(async()=>{for(const stop of detach)stop();for(const stream of streams)stream.close();await new Promise(resolve=>setTimeout(resolve,30));for(const socket of sockets)socket.terminate();gateway.realtime?.close();await new Promise(resolve=>gateway.close(resolve));assert.ok(dir.startsWith(resolve('work')+sep));rmSync(dir,{recursive:true,force:true});});
 const sdkPeers=new Map(),messages=[];let channel=0;
 function actor(index){
  let listener;const storage=new Map(),manager={
   registerListener(value){listener=value;sdkPeers.set(index,value);},unregisterListener(value){assert.equal(value,listener);sdkPeers.delete(index);},
   connect(o){o.success({playerId:'tap-'+index});},createRoom(o){o.success({roomInfo:{id:'channel-'+(++channel)}});},joinRoom(o){o.success({roomInfo:{id:o.data.roomId}});},
   sendCustomMessage(o){messages.push(o.data.msg);for(const [id,peer]of sdkPeers)if(id!==index)peer.onCustomMessageReceived({playerId:'tap-'+index,message:o.data.msg});o.success({});},leaveRoom(o){o.success({});},disconnect(o){o.success({});},
  };
  const platform={config:{id:'taptap',gameName:'isolated test',apiBase:base,assetBase:base+'/assets',development:true},storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},randomId:rid,tapTapIdentity:async()=>({code:'synthetic-'+index,nickname:'隔离玩家'+index}),onlineBattleManager:()=>manager,
   async request(input){const res=await fetch(input.url,{method:input.method??'GET',headers:{Origin:'https://tap-test.invalid',...input.headers},body:input.body===undefined?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body),signal:AbortSignal.timeout(6500)});return {status:res.status,data:await res.json(),headers:Object.fromEntries(res.headers)};},
   openSocket(url,handlers){const socket=new WebSocket(url,{headers:{Origin:'https://tap-test.invalid'}});sockets.push(socket);socket.on('open',()=>handlers.open());socket.on('message',raw=>handlers.message(raw.toString()));socket.on('error',()=>handlers.error());socket.on('close',()=>handlers.close());return {send:raw=>socket.send(raw),close:()=>socket.close()};},
  };
  const client=new GameClient(platform);return {client,failPlatform:()=>listener.onDisconnected({})};
 }
 const a=actor(0),b=actor(1);await Promise.all([a.client.start(),b.client.start()]);
 let ta=await a.client.createRoom({mode:'random',pieces:48,visibility:'public'});assert.equal(ta.room.tapPreview.testOnly,false);assert.equal(a.client.config.capabilities.tapMultiplayer,true);const inviteCode=ta.inviteCode??ta.room.inviteCode;ta=await a.client.joinRoom(ta.room.id);
 const tb=await b.client.joinRoom(ta.room.id,inviteCode);
 function attach(client,ticket){
  const stream=client.roomRealtime(ticket,()=>room.snapshot.revision);streams.push(stream);
  const room=new RoomClient(ticket,{realtime:stream,fetch:client.fetchLike,randomId:rid,now:Date.now,performanceNow:Date.now,hidden:()=>false,emit(){}});
  const table={network:null,networkReady:true,cancelNetworkDrag(){},playConnectionSound(){},syncRemote(next,_owners,protect){const own=new Map(room.state.groups.map(g=>[g.id,g]));room.state.groups=next.groups.map(g=>structuredClone(protect.has(g.id)&&own.has(g.id)?own.get(g.id):g));}};
  detach.push(room.attach(table));stream.start();return {stream,room,table};
 }
 const ac=attach(a.client,ta),bc=attach(b.client,tb);await until(()=>ac.stream.preview.connected&&bc.stream.preview.connected&&ac.stream.actionsReady);
 const group=ac.room.snapshot.puzzle.groups.find(g=>!g.locked),original={dx:group.dx,dy:group.dy};assert.equal(await ac.table.network.acquire(group.id),true);
 for(let n=0;n<20;n++){ac.table.network.move(group.id,original.dx+100+n,original.dy+100+n);ac.stream.sendCursor({clientId:rid(),seq:n+1,point:{x:100+n,y:100+n}});await new Promise(resolve=>setTimeout(resolve,30));}
 await until(()=>bc.room.state.groups.find(g=>g.id===group.id)?.dx!==original.dx);
 const canonical=await a.client.json('/api/rooms/'+ta.room.id,'GET',undefined,{Authorization:'Bearer '+ta.token});
 assert.equal(canonical.puzzle.groups.find(g=>g.id===group.id).dx,original.dx);assert.deepEqual(writes.map(w=>w.action.type),['claim']);assert.equal(cursorWrites.length,0);assert.ok(messages.length>0);
 a.failPlatform();await until(()=>!ac.stream.preview.connected&&!bc.stream.preview.connected);
 ac.table.network.move(group.id,original.dx+200,original.dy+200);await until(()=>writes.some(w=>w.action.type==='move'));
 await ac.table.network.drop(group.id,0,0);await until(()=>!bc.room.snapshot.leases[group.id]);
 assert.deepEqual(writes.map(w=>w.action.type),['claim','move','drop']);assert.deepEqual(writes.map(w=>w.ordinal),[1,2,3]);
 assert.equal(ac.room.snapshot.leases[group.id],undefined);assert.equal(ac.room.connected,true);assert.equal(bc.room.connected,true);
});
