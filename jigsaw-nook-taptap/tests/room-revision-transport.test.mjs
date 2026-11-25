import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {GameClient} from '../mobile/client.ts';
import {RoomClient} from '../lib/room-client.ts';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
const rid=()=>randomBytes(16).toString('hex'),origin='https://ma-h5-al.tapimg.com';
const until=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end,'timed out');await new Promise(resolve=>setTimeout(resolve,10));}};

test('real HTTP and WS: the nine-grid ticket subscribes and room actions share a stable preflight URL with authoritative revisions',async t=>{
 const dir=mkdtempSync(resolve('work/room-revision-')),session=randomBytes(32).toString('hex'),owner=createHash('sha256').update(session).digest('hex');
 const service=createMobileService({databasePath:':memory:',diagnosticAccountIds:[owner],tapTap:{exchangeCode:async()=>({openid:'isolated-nine-grid'})}});
 const gateway=createH5Gateway({upstream:'http://127.0.0.1',databasePath:resolve(dir,'sessions.sqlite'),allowedOrigins:[origin],mobileService:service});
 const db=new DatabaseSync(resolve(dir,'sessions.sqlite'));db.prepare('INSERT INTO h5_sessions VALUES(?,?,?)').run(owner,'local-test=1',Date.now()+3600000);db.close();
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+gateway.address().port+'/h5',memory=new Map([['jigsaw:h5-session:'+base,session]]),sent=[],sockets=[];
 const port={config:{id:'taptap',apiBase:base,assetBase:base+'/assets',gameName:'test'},storage:{get:key=>memory.get(key)||null,set:(key,value)=>memory.set(key,value),remove:key=>memory.delete(key)},randomId:rid,tapTapIdentity:async()=>({code:'local-test',nickname:'老头'}),
  request:async input=>{sent.push(input);const response=await fetch(input.url,{method:input.method||'GET',headers:{Origin:origin,...input.headers},body:input.body===undefined?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body)});return {status:response.status,data:await response.json(),headers:Object.fromEntries(response.headers)};},
  openSocket:(url,handlers)=>{const socket=new WebSocket(url,{headers:{Origin:origin}});sockets.push(socket);socket.on('open',handlers.open);socket.on('message',bytes=>handlers.message(bytes.toString()));socket.on('error',handlers.error);socket.on('close',handlers.close);return {send:data=>socket.send(data),close:()=>socket.close()};},
 };
 let stream,detach;
 t.after(async()=>{detach?.();stream?.close();for(const socket of sockets)socket.terminate();gateway.realtime.close();await new Promise(resolve=>gateway.close(resolve));assert.ok(dir.startsWith(resolve('work')+'\\'));rmSync(dir,{recursive:true,force:true});});
 const client=new GameClient(port);await client.start();assert.equal(client.config.capabilities.roomActionRevisionBody,true);
 const ticket=await client.createDiagnosticRoom();assert.equal(client.ticket,ticket);assert.equal(ticket.room.diagnostic,true);
 stream=client.roomRealtime(ticket,()=>roomClient.snapshot.revision);
 assert.ok(stream);const roomClient=new RoomClient(ticket,{fetch:client.fetchLike,realtime:stream,randomId:rid,hidden:()=>false,emit(){}});
 const table={cancelNetworkDrag(){},syncRemote(next){roomClient.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
 detach=roomClient.attach(table);stream.start();await until(()=>stream.connected);assert.equal(stream.diagnostics().lastError,'');
 assert.equal(await table.network.acquire(0),true);
 table.network.move(0,80,80);await until(()=>sent.some(input=>typeof input.body==='string'&&JSON.parse(input.body).type==='move'));
 await table.network.drop(0,0,0);
 assert.ok(roomClient.state.groups.find(group=>group.id===0).locked);
 const actions=sent.filter(input=>new URL(input.url).pathname===new URL(base).pathname+'/api/rooms/'+ticket.room.id&&input.method==='POST');
 assert.ok(actions.length>=3);assert.equal(new Set(actions.map(input=>input.url)).size,1);
 for(const input of actions){const action=JSON.parse(input.body);assert.ok(Number.isSafeInteger(action.since));assert.match(action.requestId,/^[a-f0-9]{32}$/);assert.equal(input.headers.Authorization,'Bearer '+ticket.token);assert.equal(input.headers['X-Jigsaw-H5-Session'],session);}
 const restored=await client.fetchLike('/api/rooms/'+ticket.room.id+'?since='+roomClient.snapshot.revision,{headers:{Authorization:'Bearer '+ticket.token}});
 assert.equal((await restored.json()).kind,'delta','GET compatibility keeps its existing query revision');
 client.config.capabilities.roomActionRevisionBody=false;
 const oldSince=roomClient.snapshot.revision;
 const heartbeat=await client.fetchLike('/api/rooms/'+ticket.room.id+'?since='+oldSince,{method:'POST',headers:{Authorization:'Bearer '+ticket.token},body:JSON.stringify({type:'heartbeat',requestId:rid()})});
 assert.equal(heartbeat.status,200);assert.equal((await heartbeat.json()).baseRevision,oldSince);assert.ok(sent.at(-1).url.endsWith('?since='+oldSince));assert.equal(JSON.parse(sent.at(-1).body).since,undefined);
 assert.ok(stream.diagnostics().roomMessages>0);
});

test('unadvertised old servers and formal Web retain the query protocol, while opt-in preserves action IDs',async()=>{
 const sent=[],memory=new Map(),port={config:{id:'taptap',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets'},storage:{get:key=>memory.get(key)||null,set:(key,value)=>memory.set(key,value)},request:async input=>{sent.push(input);return {status:200,data:input.url.endsWith('/session')?{token:'a'.repeat(64)}:{ok:true},headers:{}};}};
 const client=new GameClient(port),path='/api/rooms/'+'b'.repeat(32)+'?since=17',body=JSON.stringify({type:'drop',groupId:0,dx:0,dy:0,seq:2,requestId:'c'.repeat(32)});
 await client.fetchLike(path,{method:'POST',body});assert.equal(sent.at(-1).url,'https://game.test/h5'+path);assert.equal(sent.at(-1).body,body);
 client.config.capabilities.roomActionRevisionBody=true;await client.fetchLike(path,{method:'POST',body});
 assert.equal(sent.at(-1).url,'https://game.test/h5'+path.split('?')[0]);assert.deepEqual(JSON.parse(sent.at(-1).body),{...JSON.parse(body),since:17});
 port.config.id='web';port.config.identityMode='web-cookie';await client.fetchLike(path,{method:'POST',body});assert.equal(sent.at(-1).url,'https://game.test/h5'+path);
});
