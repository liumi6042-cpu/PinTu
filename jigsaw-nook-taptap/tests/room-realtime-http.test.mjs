import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),origin='https://ma-h5-al.tapimg.com';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
async function fixture(options={}){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/room-realtime-'));
 const databasePath=resolve(dir,'mobile.sqlite'),sessionsPath=resolve(dir,'sessions.sqlite');
 const service=createMobileService({databasePath,cursorFlushMs:10000});
 const gateway=createH5Gateway({upstream:'http://127.0.0.1',allowedOrigins:[origin],databasePath:sessionsPath,mobileService:service,realtimeOptions:{authorizeIntervalMs:200,...options}});
 const base=await listen(gateway),sockets=[];
 const call=async(actor,path,body,token)=>{const response=await fetch(base+'/h5'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(actor?{'X-Jigsaw-H5-Session':actor.session}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const session=async()=>{const response=await call(null,'/session',{});assert.equal(response.status,201);return {session:response.data.token,identity:createHash('sha256').update(response.data.token).digest('hex')};};
 const connect=(actor,ticket,extra={},socketOptions={})=>new Promise((resolve,reject)=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/h5/realtime'+(socketOptions.query??''),{headers:{Origin:socketOptions.origin??origin}});sockets.push(ws);
  const messages=[],waiters=[];let closeInfo;
  const peer={ws,messages,waitFor(predicate){const found=messages.find(predicate);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime message timeout: '+JSON.stringify(messages))),3000);waiters.push({predicate,resolve:value=>{clearTimeout(timer);resolve(value);}});});},closed:()=>closeInfo?Promise.resolve(closeInfo):new Promise(resolve=>ws.once('close',(code,reason)=>resolve({code,reason:String(reason)})))};
  ws.on('message',bytes=>{const value=JSON.parse(bytes.toString());messages.push(value);for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(value))waiters.splice(i,1)[0].resolve(value);});
  ws.on('close',(code,reason)=>{closeInfo={code,reason:String(reason)};});
  ws.once('error',reject);ws.once('unexpected-response',(_request,response)=>{ws.terminate();reject(Object.assign(Error('Upgrade rejected'),{status:response.statusCode}));});
  ws.once('open',()=>{ws.send(JSON.stringify({type:'subscribe',roomId:ticket.room.id,token:ticket.token,session:actor.session,...extra}));resolve(peer);});
 });
 return {base,gateway,service,call,session,connect,databasePath,sessionsPath,async close(){for(const socket of sockets)socket.terminate();gateway.realtime.close();await new Promise(resolve=>gateway.close(resolve));rmSync(dir,{recursive:true,force:true});}};
}

test('real two-player WS: personalized updates, memory cursors, HTTP compatibility and genuine leave',async()=>{
 const f=await fixture();try{
  const a=await f.session(),b=await f.session();assert.deepEqual((await f.call(a,'/config')).data.realtime,{version:1});
  const ticket=(await f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'private',requestId:rid()})).data;
  const path='/api/rooms/'+ticket.room.id,bt=(await f.call(b,path+'/join',{inviteCode:ticket.inviteCode})).data;
  const pa=await f.connect(a,ticket),pb=await f.connect(b,bt);await Promise.all([pa.waitFor(v=>v.type==='ready'),pb.waitFor(v=>v.type==='ready')]);
  const ar=(await pa.waitFor(v=>v.type==='room')).data,br=(await pb.waitFor(v=>v.type==='room')).data;
  assert.equal(ar.inviteCode,ticket.inviteCode);assert.equal(br.inviteCode,undefined,'actor-private invitation never broadcasts');
  await Promise.all([pa.waitFor(v=>v.type==='cursors'),pb.waitFor(v=>v.type==='cursors')]);
  const before=f.gateway.realtime.stats(),reads=f.service.realtime.stats();await wait(450);
  assert.equal(f.gateway.realtime.stats().roomReads,before.roomReads,'idle has no periodic room snapshot queries');
  assert.equal(f.service.realtime.stats().roomReads,reads.roomReads);assert.ok(f.gateway.realtime.stats().validations>before.validations,'only authorization heartbeat remains');
  pa.ws.send(JSON.stringify({type:'ping'}));assert.equal((await pa.waitFor(v=>v.type==='pong')).type,'pong');
  const clientId=rid();for(let seq=1;seq<=8;seq++)pa.ws.send(JSON.stringify({type:'cursor',data:{clientId,seq,point:{x:100+seq,y:120},name:'forged',color:'forged',level:9999}}));
  const visible=(await pb.waitFor(v=>v.type==='cursors'&&v.data.cursors.some(c=>c.x===108))).data.cursors.find(c=>c.playerId===ticket.playerId);
  assert.notEqual(visible.name,'forged');assert.notEqual(visible.level,9999);assert.equal(visible.color,ar.members.find(m=>m.id===ticket.playerId).color);
  const legacy=(await f.call(b,path+'/cursors',undefined,bt.token)).data;assert.equal(legacy.cursors.find(c=>c.playerId===ticket.playerId).x,108,'HTTP sees the latest unflushed WS position');
  const db=new DatabaseSync(f.databasePath);assert.equal(db.prepare('SELECT count(*) n FROM mobile_cursors').get().n,0,'eight high-frequency positions did not write SQLite');
  f.service.realtime.flush();assert.equal(f.service.realtime.stats().cursorFlushes,1);assert.equal(JSON.parse(db.prepare('SELECT data FROM mobile_cursors').get().data).x,108);db.close();
  const group=ticket.room.puzzle.groups.find(g=>!g.locked),claim=await f.call(a,path,{type:'claim',groupId:group.id,requestId:rid()},ticket.token);assert.equal(claim.status,200);
  const pushed=(await pb.waitFor(v=>v.type==='room'&&v.data.revision===claim.data.revision)).data;assert.equal(pushed.inviteCode,undefined);assert.equal(pushed.profile,undefined);assert.equal(pushed.mobileContribution,undefined);
  pa.ws.close();await pa.closed();assert.equal((await f.call(b,path+'/cursors',undefined,bt.token)).data.cursors[0].x,108,'disconnect does not leave the room');
  const again=await f.connect(a,ticket,{since:claim.data.revision});await again.waitFor(v=>v.type==='ready');
  again.ws.send(JSON.stringify({type:'cursor',data:{clientId,seq:4,point:{x:300,y:300}}}));await wait(30);
  assert.equal((await f.call(b,path+'/cursors',undefined,bt.token)).data.cursors[0].x,108,'a stale reconnect sequence cannot restore an old position');
  assert.equal((await f.call(a,path,{type:'leave'},ticket.token)).status,200);
  await pb.waitFor(v=>v.type==='cursors'&&v.data.cursors.length===0&&v.data.serverTime>=visible.positionUpdatedAt);
  assert.equal((await again.waitFor(v=>v.type==='error')).status,409);await again.closed();assert.equal((await f.call(b,path+'/cursors',undefined,bt.token)).data.cursors.length,0);
 }finally{await f.close();}
});

test('WS rejects malicious origin/query, wrong room identity, expired sessions, floods and large packets',async()=>{
 const f=await fixture();try{
  const a=await f.session(),b=await f.session(),ticket=(await f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()})).data;
  await assert.rejects(f.connect(a,ticket,{}, {origin:'https://evil.example'}),error=>error.status===403);
  await assert.rejects(f.connect(a,ticket,{}, {query:'?token='+ticket.token}),error=>error.status===403);
  const wrong=await f.connect(b,ticket);assert.equal((await wrong.waitFor(v=>v.type==='error')).status,403);await wrong.closed();
  const badTicket=await f.connect(a,{...ticket,token:rid()});assert.equal((await badTicket.waitFor(v=>v.type==='error')).status,401);await badTicket.closed();
  const live=await f.connect(a,ticket);await live.waitFor(v=>v.type==='room');
  const sessions=new DatabaseSync(f.sessionsPath);sessions.prepare('UPDATE h5_sessions SET expires_at=0 WHERE token_hash=?').run(a.identity);sessions.close();
  assert.equal((await live.waitFor(v=>v.type==='error')).code,'IDENTITY_REQUIRED');await live.closed();
  const expired=await f.connect(a,ticket);assert.equal((await expired.waitFor(v=>v.type==='error')).status,401);await expired.closed();
  const bt=(await f.call(b,'/api/rooms/'+ticket.room.id+'/join',{})).data,flood=await f.connect(b,bt);await flood.waitFor(v=>v.type==='room');
  const clientId=rid();for(let seq=1;seq<=27;seq++)flood.ws.send(JSON.stringify({type:'cursor',data:{clientId,seq,point:{x:100,y:100}}}));
  assert.equal((await flood.waitFor(v=>v.type==='error')).status,429);await flood.closed();
  const large=await f.connect(b,bt);await large.waitFor(v=>v.type==='ready');large.ws.send('x'.repeat(5000));assert.equal((await large.closed()).code,1009);
  await wait(10);assert.equal(f.gateway.realtime.stats().peers,0,'closed subscribers and pending connections are removed');
 }finally{await f.close();}
});

test('WS enforces socket-IP connection cap and backpressure closes slow recipients',async()=>{
 const f=await fixture({maxConnectionsPerAddress:1,maxBufferedAmount:512*1024});try{
  const a=await f.session(),ticket=(await f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()})).data;
  const peer=await f.connect(a,ticket);await peer.waitFor(v=>v.type==='ready');await assert.rejects(f.connect(a,ticket),error=>error.status===403);
 }finally{await f.close();}
 const slow=await fixture({maxBufferedAmount:-1});try{const a=await slow.session(),ticket=(await slow.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()})).data;const peer=await slow.connect(a,ticket);assert.equal((await peer.closed()).code,1013);}finally{await slow.close();}
});
