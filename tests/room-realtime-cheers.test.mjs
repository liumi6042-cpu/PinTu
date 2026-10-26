import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),origin='https://ma-h5-al.tapimg.com';
async function fixture(t,{completed=true,realtimeOptions={},legacy=false}={}){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/realtime-cheers-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now}),sockets=[];
 if(legacy){delete service.realtime.readCheers;delete service.realtime.writeCheer;}
 const gateway=createH5Gateway({upstream:'http://127.0.0.1',allowedOrigins:[origin],databasePath:resolve(dir,'sessions.sqlite'),mobileService:service,realtimeOptions:{authorizeIntervalMs:60000,...realtimeOptions}});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+gateway.address().port;
 t.after(async()=>{for(const ws of sockets)ws.terminate();gateway.realtime.close();await new Promise(resolve=>gateway.close(resolve));rmSync(dir,{recursive:true,force:true});});
 const call=async(actor,path,body,token)=>{const response=await fetch(base+'/h5'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(actor?{'X-Jigsaw-H5-Session':actor}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const session=async()=>{const response=await call(null,'/session',{});assert.equal(response.status,201);return response.data.token;};
 const a=await session(),b=await session(),created=await call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(created.status,201);const ticket=created.data,path='/api/rooms/'+ticket.room.id;
 if(completed){const db=new DatabaseSync(databasePath),room=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);room.completedAt=now;db.prepare('UPDATE mobile_rooms SET completed_at=?,data=? WHERE id=?').run(now,JSON.stringify(room),room.id);db.close();}
 const joined=await call(b,path+'/join',{});assert.equal(joined.status,200);const bt=joined.data;
 const connect=async(actor,ticket)=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/h5/realtime',{headers:{Origin:origin}});sockets.push(ws);const messages=[],waiters=[];
  const peer={ws,messages,send:value=>ws.send(JSON.stringify(value)),waitFor(predicate){const found=messages.find(predicate);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime message timeout: '+JSON.stringify(messages))),3000);waiters.push({predicate,resolve:value=>{clearTimeout(timer);resolve(value);}});});}};
  ws.on('message',bytes=>{const value=JSON.parse(bytes.toString());messages.push(value);for(let n=waiters.length-1;n>=0;n--)if(waiters[n].predicate(value))waiters.splice(n,1)[0].resolve(value);});
  await new Promise((resolve,reject)=>{ws.once('error',reject);ws.once('open',resolve);});peer.send({type:'subscribe',roomId:ticket.room.id,token:ticket.token,session:actor});await peer.waitFor(value=>value.type==='cursors');return peer;
 };
 return {service,gateway,call,a,b,ticket,bt,path,connect,advance:ms=>now+=ms};
}

test('gateway cheers reach both peers, preserve room revisions, keep rate-limited sockets open and never replay to late subscribers',async t=>{
 const f=await fixture(t),pa=await f.connect(f.a,f.ticket),pb=await f.connect(f.b,f.bt),before=f.gateway.realtime.stats();
 const id=rid();pa.send({type:'cheer',data:{id,emote:'clap',name:'forged'}});
 const received=(await pb.waitFor(value=>value.type==='cheers'&&value.data.cheers.some(item=>item.id===id))).data;
 assert.equal(received.cheers.length,1);assert.equal(received.cheers[0].playerId,f.ticket.playerId);assert.notEqual(received.cheers[0].name,'forged');await pa.waitFor(value=>value.type==='cheers'&&value.data.cheers[0].id===id);
 assert.equal((await f.call(f.b,f.path+'/cheers?after='+received.cursor,undefined,f.bt.token)).data.cheers.length,0);
 const ids=Array.from({length:4},rid);for(const next of ids)pa.send({type:'cheer',data:{id:next,emote:'heart'}});
 const denied=await pa.waitFor(value=>value.type==='cheer-error'&&value.id===ids[3]);assert.equal(denied.status,429);assert.equal(denied.code,'CHEER_RATE_LIMIT');assert.equal(pa.ws.readyState,WebSocket.OPEN);
 pa.send({type:'ping'});await pa.waitFor(value=>value.type==='pong');assert.ok(!pa.messages.some(value=>value.type==='error'));
 await pb.waitFor(value=>value.type==='cheers'&&value.data.cheers.some(item=>item.id===ids[2]));
 assert.equal(f.gateway.realtime.stats().roomReads,before.roomReads,'cheers do not broadcast room snapshots');assert.equal(f.gateway.realtime.stats().cheerWrites-before.cheerWrites,4);assert.ok(f.gateway.realtime.stats().cheerReads>before.cheerReads);
 const late=await f.connect(f.b,f.bt);assert.ok(!late.messages.some(value=>value.type==='cheers'));
 f.advance(2000);const nextId=rid(),posted=await f.call(f.a,f.path+'/cheers',{id:nextId,emote:'star'},f.ticket.token);assert.equal(posted.status,200);
 const next=(await late.waitFor(value=>value.type==='cheers')).data;assert.deepEqual(next.cheers.map(item=>item.id),[nextId]);assert.ok(next.cursor>received.cursor);
});

test('cheer business errors and malformed data return cheer-error without disconnecting',async t=>{
 const f=await fixture(t,{completed:false}),peer=await f.connect(f.a,f.ticket),id=rid();
 peer.send({type:'cheer',data:{id,emote:'cat'}});const notCompleted=await peer.waitFor(value=>value.type==='cheer-error'&&value.id===id);assert.equal(notCompleted.status,409);assert.equal(notCompleted.code,'ROOM_NOT_COMPLETED');
 peer.send({type:'cheer',data:[]});const invalid=await peer.waitFor(value=>value.type==='cheer-error'&&value.id===null);assert.equal(invalid.status,400);assert.equal(invalid.code,'INVALID_CHEER');
 peer.send({type:'ping'});await peer.waitFor(value=>value.type==='pong');assert.equal(peer.ws.readyState,WebSocket.OPEN);assert.ok(!peer.messages.some(value=>value.type==='error'));
});

test('pending room and cursor notifications preserve a cheer notification in the same turn',async t=>{
 const f=await fixture(t,{realtimeOptions:{writeCheer(context,input){f.gateway.realtime.notify(context.roomId,{room:true,cursors:true});f.service.realtime.writeCheer(context,input);f.gateway.realtime.notify(context.roomId,{room:false,cursors:true});}}}),peer=await f.connect(f.a,f.ticket),before=f.gateway.realtime.stats(),id=rid();
 peer.send({type:'cheer',data:{id,emote:'tea'}});await peer.waitFor(value=>value.type==='cheers'&&value.data.cheers.some(item=>item.id===id));
 assert.ok(f.gateway.realtime.stats().roomReads>before.roomReads);assert.ok(f.gateway.realtime.stats().cursorReads>before.cursorReads);
});

test('invalid cheers and service rate errors keep sockets open, fatal identity errors reject them',async t=>{
 for(const [status,code]of [[400,'INVALID_CHEER'],[429,'CHEER_RATE_LIMIT'],[403,'ROOM_IDENTITY_MISMATCH'],[500,'INTERNAL_ERROR']])await t.test(String(status),async t=>{
  const f=await fixture(t,{realtimeOptions:{writeCheer(){throw Object.assign(Error('test rejection'),{status,code});}}}),peer=await f.connect(f.a,f.ticket),id=rid();peer.send({type:'cheer',data:{id,emote:'bad'}});
  const reply=await peer.waitFor(value=>value.type===(status===400||status===429?'cheer-error':'error'));assert.equal(reply.status,status);assert.equal(reply.code,code);
  if(status===400||status===429){assert.equal(reply.id,id);peer.send({type:'ping'});await peer.waitFor(value=>value.type==='pong');assert.equal(peer.ws.readyState,WebSocket.OPEN);}
  else await new Promise(resolve=>{if(peer.ws.readyState===WebSocket.CLOSED)resolve();else peer.ws.once('close',resolve);});
 });
});

test('gateway supports services without cheers and answers CHEERS_UNSUPPORTED without disconnecting',async t=>{
 const f=await fixture(t,{legacy:true}),peer=await f.connect(f.a,f.ticket),id=rid();peer.send({type:'cheer',data:{id,emote:'tea'}});
 const reply=await peer.waitFor(value=>value.type==='cheer-error');assert.equal(reply.id,id);assert.equal(reply.status,404);assert.equal(reply.code,'CHEERS_UNSUPPORTED');
 peer.send({type:'ping'});await peer.waitFor(value=>value.type==='pong');assert.equal(peer.ws.readyState,WebSocket.OPEN);assert.equal(f.gateway.realtime.stats().cheerReads,0);
});
