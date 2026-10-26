import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {build} from 'esbuild';
import {WebSocket} from 'ws';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {attachWebRoomRealtime} from '../server/room-realtime.node.mjs';

const origin='http://localhost',root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__webRealtimeEnv={PUZZLE_LOCAL_ORIGIN:origin,PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {sharedClientApi} from "./lib/shared-client-api";export {sharedConfig} from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {applyRoomUpdate} from "./lib/room-sync";export {GET as cheersGET,POST as cheersPOST} from "./app/api/rooms/[id]/cheers/route";export {GET as cursorsGET} from "./app/api/rooms/[id]/cursors/route";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__webRealtimeEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='a'.repeat(32),other='b'.repeat(32),token='c'.repeat(64),otherToken='d'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){for(let n=0;n<150;n++){const value=predicate();if(value)return value;await delay(20);}throw Error(message||'Timed out waiting for realtime state');}

async function fixture(options={}){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();
 globalThis.__webRealtimeEnv.PUZZLE_DB=db;
 for(const [id,secret,name] of [[owner,token,'甲'],[other,otherToken,'乙']]){db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(id,id,name,'kept-password','kept-salt',now);db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(secret),id,now+86400000);}
 const photos=api.RESTORABLE_PHOTOS.slice(0,3).map(p=>({...p,width:1200,height:900}));
 const snapshot={releaseId:'realtime-isolated',gameSettings:structuredClone(DEFAULT_GAME_SETTINGS),taskRewards:structuredClone(DEFAULT_TASK_REWARD_SETTINGS),albums:{albums:[{id:'free',title:'免费',description:'',showOnPc:true,showOnMobile:true,purchasable:false,price:0,imageIds:photos.map(p=>p.id),milestones:[]}]},photos,dailyRuntime:{select:()=>photos[0],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__webRealtimeEnv.PUZZLE_CONTENT_SNAPSHOT=()=>snapshot;
 const server=createServer(async(req,res)=>{try{
  const parts=[];for await(const data of req)parts.push(data);
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{})});
  const pathname=new URL(request.url).pathname,direct=/^\/api\/rooms\/([^/]+)\/(cheers|cursors)$/.exec(pathname),path=pathname.slice('/api/shared'.length);
  const response=direct?await api[direct[2]==='cursors'?'cursorsGET':req.method==='POST'?'cheersPOST':'cheersGET'](request,{params:Promise.resolve({id:direct[1]})}):path==='/config'?new Response(JSON.stringify(api.sharedConfig(origin)),{headers:{'Content-Type':'application/json'}}):await api.sharedClientApi(request,path);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const hub=attachWebRoomRealtime({server,port,origin,...options}),sockets=[];
 const request=async(path,{method='GET',body,cookie=token,roomToken,headers={},direct=false}={})=>{
  const response=await fetch('http://127.0.0.1:'+port+(direct?'':'/api/shared')+path,{method,headers:{Host:'localhost',Origin:origin,Cookie:'puzzle_session='+cookie,...(roomToken?{Authorization:'Bearer '+roomToken}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json(),headers:response.headers};
 };
 const socket=async(ticket,cookie=token,headers={},query='')=>{
  const ws=new WebSocket('ws://127.0.0.1:'+port+'/api/shared/realtime'+query,{headers:{Host:'localhost',Origin:origin,Cookie:'puzzle_session='+cookie,...headers}}),messages=[];
  sockets.push(ws);ws.on('message',value=>messages.push(JSON.parse(value)));ws.on('error',()=>{});await once(ws,'open');
  ws.send(JSON.stringify({type:'subscribe',roomId:ticket.room?.id??ticket.roomId,token:ticket.token,session:'ignored-for-web'}));
  return {ws,messages,send:input=>ws.send(JSON.stringify(input)),next:predicate=>until(()=>messages.find(predicate))};
 };
 const create=async(visibility='public',imageIndex=0)=>{const made=await request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:photos[imageIndex].id,pieces:108,visibility}});assert.equal(made.status,201,JSON.stringify(made.data));return made.data;};
 const join=async ticket=>{const joined=await request('/api/rooms/'+ticket.room.id+'/join',{method:'POST',body:{},cookie:otherToken});assert.equal(joined.status,200,JSON.stringify(joined.data));return joined.data;};
 return {db,server,hub,request,socket,create,join,async close(){for(const ws of sockets)ws.terminate();hub.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();delete globalThis.__webRealtimeEnv.PUZZLE_DB;}};
}

test('only the upgraded runtime advertises the versioned capability',()=>{
 delete globalThis.__webRealtimeEnv.PUZZLE_REALTIME_ENABLED;assert.equal(api.sharedConfig(origin).realtime,undefined);
 globalThis.__webRealtimeEnv.PUZZLE_REALTIME_ENABLED='1';assert.deepEqual(api.sharedConfig(origin).realtime,{version:1});delete globalThis.__webRealtimeEnv.PUZZLE_REALTIME_ENABLED;
});

test('real WebSockets receive original HTTP room transactions and preserve per-peer authority',async()=>{
 const f=await fixture();try{
  const first=await f.create(),second=await f.join(first),a=await f.socket(first),b=await f.socket(second,otherToken);
  const firstFrame=await b.next(m=>m.type==='room');assert.equal(firstFrame.data.members.length,2);
  const path='/api/rooms/'+first.room.id,send=body=>f.request(path,{method:'POST',roomToken:first.token,body});
  assert.equal((await send({type:'claim',groupId:0})).status,200);
  const claimed=await f.request(path,{roomToken:first.token});
  await b.next(m=>m.type==='room'&&m.data.revision===claimed.data.revision);
  const group=claimed.data.puzzle.groups.find(g=>g.id===0);
  const moved=await send({type:'move',groupId:0,dx:group.dx+25,dy:group.dy+20,seq:1});assert.equal(moved.status,200);
  await b.next(m=>m.type==='room'&&m.data.revision===moved.data.revision);
  const dropped=await send({type:'drop',groupId:0,dx:0,dy:0,seq:2,requestId:'e'.repeat(32)});assert.equal(dropped.status,200);
  await b.next(m=>m.type==='room'&&m.data.revision===dropped.data.revision);
  let merged=firstFrame.data;for(const message of b.messages.filter(m=>m.type==='room').slice(1))merged=api.applyRoomUpdate(merged,message.data);
  const authoritative=await f.request(path,{cookie:otherToken,roomToken:second.token});assert.deepEqual(merged.puzzle.groups,authoritative.data.puzzle.groups);
  assert.ok(!a.messages.some(m=>m.type==='room'&&'token' in m.data),'no subscription token is broadcast');
  const mismatch=await f.socket(first,otherToken);assert.equal((await mismatch.next(m=>m.type==='error')).status,401);
 }finally{await f.close();}
});

test('15Hz cursor delivery is coalesced in SQLite and survives socket disconnect until explicit leave',async()=>{
 const f=await fixture();try{
  const first=await f.create(),second=await f.join(first),a=await f.socket(first),b=await f.socket(second,otherToken);await b.next(m=>m.type==='room');
  const path='/api/rooms/'+first.room.id,revision=f.db.sql.prepare('SELECT revision FROM puzzle_rooms WHERE id=?').get(first.room.id).revision;
  f.db.sql.exec('CREATE TABLE cursor_write_count(n INTEGER); INSERT INTO cursor_write_count VALUES(0); CREATE TRIGGER cursor_write_insert AFTER INSERT ON puzzle_room_cursors BEGIN UPDATE cursor_write_count SET n=n+1; END; CREATE TRIGGER cursor_write_update AFTER UPDATE ON puzzle_room_cursors BEGIN UPDATE cursor_write_count SET n=n+1; END;');
  const clientId='e'.repeat(32);for(let seq=1;seq<=15;seq++){a.send({type:'cursor',data:{clientId,seq,point:{x:100+seq,y:120}}});await delay(67);}
  await b.next(m=>m.type==='cursors'&&m.data.cursors.some(c=>c.playerId===first.playerId&&c.x===115));
  await until(()=>f.db.sql.prepare('SELECT seq FROM puzzle_room_cursors WHERE room_id=? AND player_id=?').get(first.room.id,first.playerId)?.seq===15);
  const writes=f.db.sql.prepare('SELECT n FROM cursor_write_count').get().n;assert.ok(writes<=7,'bounded durable writes, got '+writes);assert.ok(writes>=3);
  assert.equal(f.db.sql.prepare('SELECT revision FROM puzzle_rooms WHERE id=?').get(first.room.id).revision,revision,'cursor updates never mutate board revision');
  a.send({type:'cursor',data:{clientId,seq:16,point:null}});await delay(300);a.ws.close();await once(a.ws,'close');
  const retained=await f.request(path+'/cursors',{cookie:otherToken,roomToken:second.token});assert.equal(retained.data.cursors.find(c=>c.playerId===first.playerId).x,115);
  const reconnect=await f.socket(first);await reconnect.next(m=>m.type==='ready');
  const legacy=await f.request(path+'/cursors',{method:'POST',roomToken:first.token,body:{clientId:'f'.repeat(32),seq:1,point:{x:201,y:220}}});assert.equal(legacy.status,200);
  await b.next(m=>m.type==='cursors'&&m.data.cursors.some(c=>c.playerId===first.playerId&&c.x===201));
  const beforeLeave=Date.now(),left=await f.request(path,{method:'POST',roomToken:first.token,body:{type:'leave'}});assert.equal(left.status,200);
  await reconnect.next(m=>m.type==='error'&&m.status===409);
  await b.next(m=>m.type==='cursors'&&!m.data.cursors.some(c=>c.playerId===first.playerId)&&m.data.serverTime>=beforeLeave);
  const after=await f.request(path+'/cursors',{cookie:otherToken,roomToken:second.token});assert.ok(!after.data.cursors.some(c=>c.playerId===first.playerId));
  console.log('realtime cursor evidence',JSON.stringify({inputs:16,durableWrites:writes,stats:f.hub.stats()}));
 }finally{await f.close();}
});

test('a cold realtime context seeds the persisted cursor sequence before accepting messages',async()=>{
 const f=await fixture();try{
  const first=await f.create(),second=await f.join(first),path='/api/rooms/'+first.room.id,clientId='e'.repeat(32);
  assert.equal((await f.request(path+'/cursors',{method:'POST',roomToken:first.token,body:{clientId,seq:90,point:{x:301,y:320}}})).status,200);
  const a=await f.socket(first),b=await f.socket(second,otherToken);await b.next(m=>m.type==='room');
  a.send({type:'cursor',data:{clientId,seq:1,point:{x:10,y:20}}});await delay(100);
  const seen=b.messages.filter(m=>m.type==='cursors').at(-1).data.cursors.find(c=>c.playerId===first.playerId);assert.equal(seen.x,301,'old messages cannot overlay a newer durable point after a restart');
  a.send({type:'cursor',data:{clientId:'f'.repeat(32),seq:99,point:null}});await delay(100);
  assert.equal(f.db.sql.prepare('SELECT client_id FROM puzzle_room_cursors WHERE room_id=? AND player_id=?').get(first.room.id,first.playerId).client_id,clientId,'another tab null never takes ownership');
  a.send({type:'cursor',data:{clientId,seq:91,point:{x:302,y:321}}});await b.next(m=>m.type==='cursors'&&m.data.cursors.some(c=>c.playerId===first.playerId&&c.x===302));
 }finally{await f.close();}
});

test('private membership, suspended identity, invalid coordinates and handshake credentials fail closed',async()=>{
 const f=await fixture({authorizeIntervalMs:100});try{
  f.db.sql.prepare("INSERT INTO puzzle_memberships VALUES(?,'puzzle','active',?,?,0)").run(owner,Date.now()-1000,Date.now()+86400000);
  const first=await f.create('private'),valid=await f.socket(first);await valid.next(m=>m.type==='room');
  const outsider=await f.socket(first,otherToken);assert.equal((await outsider.next(m=>m.type==='error')).status,401);
  const invalid=await f.socket(first);await invalid.next(m=>m.type==='ready');invalid.send({type:'cursor',data:{clientId:'f'.repeat(32),seq:1,point:{x:1e8,y:0}}});assert.equal((await invalid.next(m=>m.type==='error')).status,400);
  await assert.rejects(()=>f.socket(first,token,{Origin:'https://untrusted.example'}));
  await assert.rejects(()=>f.socket(first,token,{},'?token='+first.token));
  f.db.sql.prepare("INSERT INTO puzzle_account_security(user_id,status) VALUES(?,'suspended') ON CONFLICT(user_id) DO UPDATE SET status='suspended'").run(owner);
  assert.equal((await valid.next(m=>m.type==='error')).status,401,'the original account route rejects suspended sessions');
 }finally{await f.close();}
});

function editRoom(f,id,edit){
 const saved=f.db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(id),room=JSON.parse(saved.data);
 edit(room);room.revision=saved.revision+1;
 f.db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(room),room.revision,id);
}
const cheerId=n=>n.toString(16).padStart(32,'0');

test('cheers native and shared HTTP routes preserve cursor authority and completion/input rules',async()=>{
 const f=await fixture();try{
  const first=await f.create(),path='/api/rooms/'+first.room.id,opts={roomToken:first.token};
  for(const direct of [true,false]){
   const call=(suffix,options={})=>f.request(path+suffix,{...opts,direct,...options});
   assert.deepEqual((await call('/cheers')).data.cheers,[],'GET works before completion');
   for(const credentials of [{roomToken:undefined},{roomToken:'f'.repeat(32)},{cookie:otherToken},{cookie:''}]){
    const cheers=await call('/cheers',credentials),cursors=await call('/cursors',credentials);
    assert.equal(cheers.status,cursors.status);assert.equal(cheers.data.error,cursors.data.error);assert.equal(cheers.status,401);
    const post=await call('/cheers',{...credentials,method:'POST',body:{id:cheerId(1),emote:'clap'}});assert.equal(post.status,cheers.status);assert.equal(post.data.error,cheers.data.error);
   }
   const early=await call('/cheers',{method:'POST',body:{}});assert.equal(early.status,409);assert.equal(early.data.code,'ROOM_NOT_COMPLETED');
  }
  assert.equal((await f.request('/api/rooms/not-an-id/cheers',{...opts,direct:true})).status,404);
  editRoom(f,first.room.id,room=>{room.completedAt=Date.now();});
  const saved=f.db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(first.room.id);
  for(const direct of [true,false])for(const body of [[],{},'invalid',{id:'A'.repeat(32),emote:'clap'},{id:cheerId(1),emote:'invalid'},{id:4,emote:'tea'}]){
   const invalid=await f.request(path+'/cheers',{...opts,direct,method:'POST',body});assert.equal(invalid.status,400);assert.equal(invalid.data.code,'INVALID_CHEER');
  }
  const posted=await f.request(path+'/cheers',{...opts,direct:true,method:'POST',body:{id:cheerId(1),emote:'tea',playerId:'spoof',name:'spoof',at:0}});
  assert.equal(posted.status,200);assert.equal(posted.headers.get('cache-control'),'no-store');assert.equal(posted.data.cheers.length,1);
  assert.equal(posted.data.cheers[0].playerId,first.playerId);assert.equal(posted.data.cheers[0].name,'甲');assert.ok(posted.data.cheers[0].at>0);
  const retried=await f.request(path+'/cheers',{...opts,method:'POST',body:{id:cheerId(1),emote:'tea'}});assert.deepEqual(retried.data.cheers,posted.data.cheers);assert.equal(retried.data.cursor,posted.data.cursor);
  const filtered=await f.request(path+'/cheers?after='+posted.data.cursor,opts);assert.deepEqual(filtered.data.cheers,[]);assert.equal(filtered.data.cursor,posted.data.cursor);
  assert.equal((await f.request(path+'/cheers?after=invalid',opts)).data.cheers.length,1);
  for(let n=2;n<=4;n++)assert.equal((await f.request(path+'/cheers',{...opts,method:'POST',body:{id:cheerId(n),emote:'clap',after:posted.data.cursor}})).status,200);
  const limited=await f.request(path+'/cheers',{...opts,method:'POST',body:{id:cheerId(5),emote:'clap'}});assert.equal(limited.status,429);assert.equal(limited.data.code,'CHEER_RATE_LIMIT');assert.equal(limited.headers.get('retry-after'),'2');
  assert.equal((await f.request(path+'/cheers',{...opts,method:'POST',body:{id:cheerId(1),emote:'tea'}})).status,200,'dedupe before rate limit');
  assert.deepEqual(f.db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(first.room.id),saved,'cheers never enter room snapshot or revision');
  assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM puzzle_room_cursors WHERE room_id=?').get(first.room.id).n,0);
  for(const lastSeen of [Date.now()-60000,0]){
   editRoom(f,first.room.id,room=>{room.members.find(m=>m.id===first.playerId).lastSeen=lastSeen;});
   for(const direct of [true,false])for(const method of ['GET','POST']){
    const result=await f.request(path+'/cheers',{...opts,direct,method,...(method==='POST'?{body:{id:cheerId(6),emote:'cat'}}:{})});
    const cursor=await f.request(path+'/cursors',{...opts,direct});assert.equal(result.status,409);assert.equal(result.data.error,cursor.data.error);
    if(lastSeen===0)assert.equal(result.data.code,'ROOM_ADMISSION_REQUIRED');
   }
  }
 }finally{await f.close();}
});

test('cheers use one HTTP/WS store, skip subscribe replay, isolate rooms and reject without disconnect',async()=>{
 const f=await fixture();try{
  const first=await f.create(),second=await f.join(first),otherRoom=await f.create('public',1),path='/api/rooms/'+first.room.id;
  assert.notEqual(otherRoom.room.id,first.room.id);
  const a=await f.socket(first);await a.next(m=>m.type==='room');
  a.send({type:'cheer',data:{id:cheerId(10),emote:'clap'}});
  assert.equal((await a.next(m=>m.type==='cheer-error'&&m.id===cheerId(10))).code,'ROOM_NOT_COMPLETED');
  a.send({type:'ping'});await a.next(m=>m.type==='pong');assert.equal(a.ws.readyState,WebSocket.OPEN);
  editRoom(f,first.room.id,room=>{room.completedAt=Date.now();});
  const before=await f.request(path+'/cheers',{roomToken:first.token,direct:true,method:'POST',body:{id:cheerId(11),emote:'heart'}});assert.equal(before.status,200);
  await a.next(m=>m.type==='cheers'&&m.data.cheers.some(c=>c.id===cheerId(11)));
  const b=await f.socket(second,otherToken),c=await f.socket(otherRoom);await b.next(m=>m.type==='room');await c.next(m=>m.type==='room');
  const normalFrames=b.messages.filter(m=>['room','cursors'].includes(m.type)).length;
  a.send({type:'cheer',data:{id:cheerId(12),emote:'cat'}});
  const echoed=await a.next(m=>m.type==='cheers'&&m.data.cheers.some(c=>c.id===cheerId(12))),received=await b.next(m=>m.type==='cheers');
  assert.deepEqual(received.data.cheers.map(c=>c.id),[cheerId(12)]);assert.equal(received.data.cheers[0].playerId,first.playerId);
  assert.equal(echoed.data.cursor,received.data.cursor);assert.ok(received.data.cursor>before.data.cursor);
  assert.ok(!c.messages.some(m=>m.type==='cheers'),'another room never receives cheers');
  const http=await f.request(path+'/cheers?after='+before.data.cursor,{roomToken:second.token,cookie:otherToken});assert.deepEqual(http.data.cheers,received.data.cheers);
  a.send({type:'cheer',data:{id:cheerId(12),emote:'cat'}});a.send({type:'cheer',data:{id:cheerId(13),emote:'bad'}});
  assert.equal((await a.next(m=>m.type==='cheer-error'&&m.id===cheerId(13))).code,'INVALID_CHEER');
  assert.equal(b.messages.filter(m=>m.type==='cheers').length,1,'duplicate emits no empty/repeated push');
  for(const n of [14,15])a.send({type:'cheer',data:{id:cheerId(n),emote:'star'}});
  await b.next(m=>m.type==='cheers'&&m.data.cheers.some(c=>c.id===cheerId(15)));
  a.send({type:'cheer',data:{id:cheerId(16),emote:'star'}});
  const limited=await a.next(m=>m.type==='cheer-error'&&m.id===cheerId(16));assert.equal(limited.status,429);assert.equal(limited.code,'CHEER_RATE_LIMIT');
  assert.equal(a.ws.readyState,WebSocket.OPEN);assert.ok(!a.messages.some(m=>m.type==='error'));
  assert.equal(b.messages.filter(m=>['room','cursors'].includes(m.type)).length,normalFrames,'cheers do not broadcast room or cursor snapshots');
  editRoom(f,otherRoom.room.id,room=>{room.completedAt=Date.now();});
  const isolated=await f.request('/api/rooms/'+otherRoom.room.id+'/cheers',{roomToken:otherRoom.token,method:'POST',body:{id:cheerId(17),emote:'popper'}});
  assert.equal(isolated.status,200);assert.equal(isolated.data.cheers.length,1);assert.ok(isolated.data.cursor>received.data.cursor);
 }finally{await f.close();}
});

test('diagnostic rooms retain their existing realtime admission and use ephemeral cheers',async()=>{
 globalThis.__webRealtimeEnv.PUZZLE_DIAGNOSTIC_ACCOUNT_IDS=owner;
 const f=await fixture();try{
  const created=await f.request('/api/mobile/diagnostics/room',{method:'POST',body:{requestId:cheerId(100)}});assert.equal(created.status,201);
  const ticket=created.data,a=await f.socket(ticket);await a.next(m=>m.type==='room');
  a.send({type:'cheer',data:{id:cheerId(101),emote:'clap'}});assert.equal((await a.next(m=>m.type==='cheer-error')).code,'ROOM_NOT_COMPLETED');
  const row=f.db.sql.prepare('SELECT data,revision FROM puzzle_diagnostic_rooms WHERE id=?').get(ticket.room.id),room=JSON.parse(row.data);room.completedAt=Date.now();
  const data=JSON.stringify(room);f.db.sql.prepare('UPDATE puzzle_diagnostic_rooms SET data=? WHERE id=?').run(data,ticket.room.id);
  a.send({type:'cheer',data:{id:cheerId(102),emote:'popper'}});await a.next(m=>m.type==='cheers'&&m.data.cheers.some(c=>c.id===cheerId(102)));
  const unchanged=f.db.sql.prepare('SELECT data,revision FROM puzzle_diagnostic_rooms WHERE id=?').get(ticket.room.id);assert.equal(unchanged.data,data);assert.equal(unchanged.revision,row.revision);
  assert.ok(!a.messages.some(m=>m.type==='error'));
 }finally{await f.close();delete globalThis.__webRealtimeEnv.PUZZLE_DIAGNOSTIC_ACCOUNT_IDS;}
});
