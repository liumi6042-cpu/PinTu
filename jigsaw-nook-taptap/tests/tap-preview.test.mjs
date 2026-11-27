import test from 'node:test';
import assert from 'node:assert/strict';
import {createTapPreview} from '../server/tap-preview.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {TapPreviewRealtime} from '../mobile/tap-preview.ts';
import {GameClient} from '../mobile/client.ts';
import {validTapPlatformId,normalizeTapPlatformId} from '../lib/tap-platform-id.mjs';

const key=n=>n.toString(16).padStart(32,'0'),identity=n=>n.toString(16).padStart(64,'0');
const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
function roomFixture(){return {id:key(1),visibility:'private',revision:0,serverTime:100000,createdAt:100000,expiresAt:200000,startedAt:null,completedAt:null,puzzle:{version:1,imageId:'test',cols:2,rows:1,seed:1,elapsed:0,groups:[{id:0,pieces:[0],dx:100,dy:100,locked:false},{id:1,pieces:[1],dx:200,dy:100,locked:false}]},members:[{id:key(2),name:'甲',color:'#123456',lastSeen:100000},{id:key(3),name:'乙',color:'#654321',lastSeen:100000}],leases:{0:{playerId:key(2),seq:0,expires:110000,previewId:key(99)}}};}

test('test-room coordinator gates private IDs, elects one creator, binds identities, and renews an empty channel generation',()=>{
 let time=100000;const room=roomFixture(),allowed=new Set(),coordinator=createTapPreview({roomIds:allowed,now:()=>time});
 assert.equal(coordinator.descriptor(room),undefined);assert.throws(()=>coordinator.request(room,room.members[0],{}),e=>e.code==='TAP_PREVIEW_DISABLED');
 allowed.add(room.id);const a={op:'reserve',clientId:key(10),tapPlayerId:'tap-a'},b={op:'reserve',clientId:key(11),tapPlayerId:'tap-b'};
 const first=coordinator.request(room,room.members[0],a),second=coordinator.request(room,room.members[1],b);
 assert.equal(first.canCreate,true);assert.equal(second.canCreate,false);assert.equal(second.epoch,first.epoch);
 assert.throws(()=>coordinator.request(room,room.members[1],{...b,op:'publish',epoch:first.epoch,channelId:'channel'}),e=>e.code==='TAP_PREVIEW_CREATOR_CHANGED');
 const published=coordinator.request(room,room.members[0],{...a,op:'publish',epoch:first.epoch,channelId:'channel'});
 assert.equal(published.channelId,'channel');assert.ok(published.serial>second.serial);
 assert.throws(()=>coordinator.request(room,room.members[1],{...a}),e=>e.code==='TAP_PREVIEW_BINDING_CONFLICT');
 assert.throws(()=>coordinator.request(room,room.members[1],{...b,clientId:key(12),tapPlayerId:'tap-a'}),e=>e.code==='TAP_PREVIEW_ALREADY_CONNECTED');
 for(const [member,binding]of [[room.members[0],a],[room.members[1],b]])coordinator.request(room,member,{...binding,op:'ready',epoch:first.epoch,channelId:'channel'});
 assert.ok(coordinator.descriptor(room).peers.every(p=>p.ready));
 const stored=JSON.stringify(room);time+=21000;room.members.forEach(m=>m.lastSeen=time);
 const fresh=coordinator.request(room,room.members[0],a);assert.notEqual(fresh.epoch,first.epoch);assert.equal(fresh.canCreate,true);
 assert.throws(()=>coordinator.request(room,room.members[0],{...a,op:'publish',epoch:first.epoch,channelId:'late'}),e=>e.code==='TAP_PREVIEW_STALE');
 room.members.forEach(m=>m.lastSeen=100000);assert.equal(JSON.stringify(room),stored,'coordination does not write puzzle/leases/progress');
 assert.equal(coordinator.descriptor({...room,visibility:'public'}),undefined);
});

test('production gate admits public/private rooms, excludes diagnostics/completion and expires abandoned generations',()=>{
 let time=100000;const coordinator=createTapPreview({enabled:true,now:()=>time}),room=roomFixture();
 for(const visibility of ['public','private'])assert.equal(coordinator.descriptor({...room,visibility}).testOnly,false);
 for(const changes of [{diagnostic:true},{completedAt:time},{closedAt:time},{visibility:'invalid'}])assert.equal(coordinator.descriptor({...room,...changes}),undefined);
 const first=coordinator.descriptor(room);time+=61000;coordinator.descriptor({...room,id:key(100)});assert.notEqual(coordinator.descriptor(room).epoch,first.epoch);
 const off=createTapPreview({enabled:false});assert.equal(off.descriptor(room),undefined);
});

test('production mobile service still rejects guest and wrong-token coordination and retains history',async t=>{
 const service=createMobileService({databasePath:':memory:',tapMultiplayerEnabled:true,now:()=>100000,tapTap:{exchangeCode:async code=>({openid:code})}});t.after(()=>service.close());
 const owner=identity(21),guest=identity(22),call=(who,url,body,token)=>service.handle({identity:who,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 await service.bindTapTap({identity:owner,code:'synthetic-production-owner',nickname:'正式流程测试'});
 const ticket=call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:key(221)}).data,path='/api/rooms/'+ticket.room.id;
 assert.equal(ticket.room.tapPreview.testOnly,false);const joined=call(guest,path+'/join',{}).data,request={op:'reserve',clientId:key(222),tapPlayerId:'test-platform-id'};
 assert.equal(call(guest,path+'/tap-preview',request,joined.token).data.code,'TAP_PREVIEW_IDENTITY');assert.equal(call(guest,path+'/tap-preview',request,ticket.token).status,403);
 assert.equal(call(owner,path+'/tap-preview',request,ticket.token).status,200);assert.ok(call(owner,'/api/room-history').data.rooms.some(r=>r.id===ticket.room.id));
});

test('actual mobile service requires admission and Tap binding, persists only final authoritative drops, and preserves reward replay',async t=>{
 const allowed=new Set(),service=createMobileService({databasePath:':memory:',tapPreviewRoomIds:allowed,now:()=>100000,tapTap:{exchangeCode:async code=>({openid:code})}});t.after(()=>service.close());
 const a=identity(1),b=identity(2),guest=identity(3);let requestId=100;
 for(const actor of [a,b])assert.equal((await service.bindTapTap({identity:actor,code:'synthetic-'+actor,nickname:'测试玩家'})).status,200);
 const call=(actor,url,body,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const created=call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'private',requestId:key(requestId++)});assert.equal(created.status,201);
 const ticket=created.data,path='/api/rooms/'+ticket.room.id,joined=call(b,path+'/join',{inviteCode:ticket.inviteCode}).data;
 assert.equal(ticket.room.tapPreview,undefined);allowed.add(ticket.room.id);
 const before=call(a,path,undefined,ticket.token).data,profileBefore=call(a,'/api/mobile/profile').data;
 assert.equal(before.tapPreview.testOnly,true);
 assert.equal(call(b,path+'/tap-preview',{op:'reserve',clientId:key(10),tapPlayerId:'a'},ticket.token).status,403);
 const guestTicket=call(guest,path+'/join',{inviteCode:ticket.inviteCode}).data;
 const beforeCoordination=call(a,path,undefined,ticket.token).data;
 assert.equal(call(guest,path+'/tap-preview',{op:'reserve',clientId:key(12),tapPlayerId:'guest'},guestTicket.token).data.code,'TAP_PREVIEW_IDENTITY');
 const aBind={op:'reserve',clientId:key(10),tapPlayerId:'tap-a'},bBind={op:'reserve',clientId:key(11),tapPlayerId:'tap-b'};
 const reserved=call(a,path+'/tap-preview',aBind,ticket.token);assert.equal(reserved.status,200);
 assert.equal(call(b,path+'/tap-preview',bBind,joined.token).status,200);
 assert.equal(call(a,path+'/tap-preview',{...aBind,op:'publish',epoch:reserved.data.epoch,channelId:'synthetic-channel'},ticket.token).status,200);
 const after=call(a,path,undefined,ticket.token).data;assert.equal(after.revision,beforeCoordination.revision);assert.deepEqual(after.puzzle,beforeCoordination.puzzle);
 const unchanged=call(a,'/api/mobile/profile').data;assert.equal(unchanged.collection.coins,profileBefore.collection.coins);assert.equal(unchanged.energy,profileBefore.energy);
 const group=after.puzzle.groups.find(g=>!g.locked),claim=call(a,path,{type:'claim',groupId:group.id,requestId:key(requestId++)},ticket.token);
 assert.equal(claim.status,200);assert.match(claim.data.leases[group.id].previewId,/^[a-f0-9]{32}$/);
 assert.equal(call(b,path,{type:'claim',groupId:group.id,requestId:key(requestId++)},joined.token).status,409);
 assert.deepEqual(call(a,path,undefined,ticket.token).data.puzzle,after.puzzle,'no preview request moves canonical pieces');
 const drop={type:'drop',groupId:group.id,dx:0,dy:0,seq:500,requestId:key(requestId++)},result=call(a,path,drop,ticket.token);assert.equal(result.status,200);
 const p1=call(a,'/api/mobile/profile').data,retry=call(a,path,drop,ticket.token),p2=call(a,'/api/mobile/profile').data;
 assert.equal(retry.status,200);assert.equal(p2.totalXp,p1.totalXp);assert.equal(p2.collection.coins,p1.collection.coins);assert.equal(p2.energy,p1.energy);
 assert.equal(call(a,path,undefined,ticket.token).data.leases[group.id],undefined);
 assert.ok(call(a,'/api/room-history').data.rooms.some(r=>r.id===ticket.room.id));
});

function transportFixture(t,{missing=false,stallSend=false,dropMessages=false,players=2,sendLimit=0,roomLimit=false,eventForm='object',messageForm='string',bodyKey='message',production=false}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:100000});const room=roomFixture(),records=[],listeners=[],authorities=[],adapters=[],sent=[],held=[];let channel=0,requestCount=0;
 for(let n=2;n<players;n++)room.members.push({id:key(2+n),name:'拼友'+(n+1),color:'#123456',lastSeen:100000});
 const coordinatorOptions={enabled:production,roomIds:new Set([room.id]),notify:()=>queueMicrotask(()=>{for(const authority of authorities)authority.emit();})};let coordinator=createTapPreview(coordinatorOptions);
 const view=()=>({...structuredClone(room),tapPreview:coordinator.descriptor(room)});
 function actor(index,{sharedManager,nativeId='tap-'+index,requestGate,onDisconnect}={}){
  const roomListeners=new Set(),cursorListeners=new Set(),states=new Set(),fallback=[],actions=[];
  const authority={connected:true,actionsReady:true,actionsDiagnosticOnly:false,pendingActionCount:0,start(){},close(){this.connected=false;for(const fn of states)fn(false);},setHidden(v){this.connected=!v;for(const fn of states)fn(!v);},diagnostics:()=>({}),subscribeRoom:fn=>(roomListeners.add(fn),()=>roomListeners.delete(fn)),subscribeState:fn=>(states.add(fn),()=>states.delete(fn)),subscribeCursors:fn=>(cursorListeners.add(fn),()=>cursorListeners.delete(fn)),sendCursor:data=>(fallback.push(data),true),sendAction:async input=>(actions.push(input),{status:200,data:view()}),resetActions(){},emit(){for(const fn of roomListeners)fn(view());}};
  authorities.push(authority);let listener=null;
  const manager=sharedManager??{registerListener(fn){listener=fn;listeners[index]=fn;},unregisterListener(fn){assert.equal(fn,listener);listeners[index]=null;},connect(o){records.push(['connect',index]);o.success({playerId:nativeId});},createRoom(o){records.push(['create',index]);o.success({roomInfo:{id:'channel-'+(++channel)}});},joinRoom(o){records.push(['join',index]);o.success({roomInfo:{id:o.data.roomId}});},sendCustomMessage(o){sent.push({index,at:Date.now(),...o.data});if(sendLimit&&sent.filter(s=>Date.now()-s.at<1000&&(roomLimit||s.index===index)).length>sendLimit){o.fail({errno:1234,errMsg:'synthetic frequency limit token=do-not-retain'});return;}if(!dropMessages)for(let n=0;n<listeners.length;n++)if(n!==index){const body=messageForm==='object'?JSON.parse(o.data.msg):o.data.msg;let e={playerId:nativeId,...(bodyKey.startsWith('data.')?{data:{[bodyKey.slice(5)]:body}}:{[bodyKey]:body})};if(eventForm==='data')e={data:e};if(eventForm==='json')e=JSON.stringify(e);listeners[n]?.onCustomMessageReceived(e);listeners[n]?.onCustomMessage(e);}if(stallSend&&JSON.parse(o.data.msg).d)held.push(()=>o.success({}));else o.success({});},leaveRoom(o){records.push(['leave',index]);o.success({});},disconnect(o){records.push(['disconnect',index]);o.success({});}};
  const adapter=new TapPreviewRealtime({authority,onDisconnect,manager:()=>missing?undefined:manager,room:view(),playerId:room.members[index].id,randomId:()=>key(10+index),request:body=>{requestCount++;const response=coordinator.request(room,room.members.find(m=>m.id===key(index+2)),body);return requestGate?requestGate(body,response):Promise.resolve(response);}});adapters.push(adapter);
  return {adapter,authority,manager,fallback,actions,emitCursors:data=>{for(const fn of cursorListeners)fn(data);}};
 }
 t.after(async()=>{for(const adapter of adapters)adapter.close();await settle();});
 return {get coordinator(){return coordinator;},restartCoordinator(){coordinator=createTapPreview(coordinatorOptions);for(const authority of authorities)authority.emit();},room,actor,records,sent,held,listeners,view,dropMessages:value=>{dropMessages=value;},async advance(ms){t.mock.timers.tick(ms);await settle();},async ready(){for(let n=0;n<30&&!adapters.every(a=>a.fullPreviewReady);n++){await settle();t.mock.timers.tick(100);}await settle();assert.ok(adapters.every(a=>a.fullPreviewReady));},get requestCount(){return requestCount;}};
}

test('two platform peers combine latest cursor/drag, bound message rate, ignore duplicate callbacks and never ACK or mutate a puzzle',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1),moves=[];b.adapter.preview.subscribeMoves(v=>moves.push(v));a.adapter.start();b.adapter.start();await f.ready();
 const before=JSON.stringify(f.room.puzzle),sentBefore=f.sent.length,receivedBefore=b.adapter.diagnostics().platformReceived;const start=Date.now();
 for(let n=1;n<=100;n++){a.adapter.sendCursor({clientId:key(100),seq:n,point:{x:n,y:n}});assert.equal(a.adapter.preview.sendMove(0,n,n+1),true);await f.advance(10);}
 const emitted=f.sent.slice(sentBefore).filter(s=>s.index===0);assert.ok(emitted.length>=2&&emitted.length<=4);assert.ok(f.sent.every(s=>s.msg.length<=2048));assert.equal(a.fallback.length,0);
 assert.equal(b.adapter.diagnostics().platformReceived-receivedBefore,emitted.length,'the two documented callback aliases cannot double-apply');
 assert.ok(moves.flat().some(m=>m.dx>0));assert.equal(JSON.stringify(f.room.puzzle),before);assert.equal(a.actions.length,0,'platform previews cannot synthesize action replies');
 assert.ok(emitted.every((s,n)=>n===0||s.at-emitted[n-1].at>=250));assert.ok(Date.now()-start>=1000);
 const frame=JSON.parse(emitted.at(-1).msg),listener=f.listeners[1],accepted=b.adapter.diagnostics().platformReceived;
 for(const event of [{playerId:'wrong',message:JSON.stringify({...frame,s:500})},{playerId:'tap-0',message:JSON.stringify({...frame,e:key(999),s:500})},{playerId:'tap-0',message:JSON.stringify({...frame,s:500,completed:true})},{playerId:'tap-0',message:'x'.repeat(2049)}])listener.onCustomMessageReceived(event);
 assert.equal(b.adapter.diagnostics().platformReceived,accepted);
 f.room.leases[0].previewId=key(101);for(const item of [a,b])item.authority.emit();await settle();assert.equal(moves.at(-1).length,0,'a new claim generation clears stale visual state');
 listener.onCustomMessageReceived({playerId:'tap-0',message:JSON.stringify({...frame,s:1000})});assert.equal(moves.at(-1).length,0);
});

test('a peer disconnect immediately restores authoritative cursor/move fallback and cleanup does not leave a queue running',async t=>{
 const notices=[],f=transportFixture(t),a=f.actor(0,{onDisconnect:()=>notices.push('a')}),b=f.actor(1,{onDisconnect:()=>notices.push('b')}),moves=[];a.adapter.preview.subscribeMoves(v=>moves.push(v));a.adapter.start();b.adapter.start();await f.ready();
 f.listeners[1].onDisconnected({});await settle();assert.equal(b.adapter.preview.connected,false);assert.equal(a.adapter.preview.connected,false);
 assert.equal(a.adapter.preview.sendMove(0,40,50),false);assert.equal(a.adapter.sendCursor({clientId:key(100),seq:1,point:{x:1,y:2}}),true);assert.equal(a.fallback.length,1);
 assert.deepEqual(notices,['b'],'only the device with a confirmed TapTap disconnect gets the notice');
 const count=f.sent.length;a.adapter.close();b.adapter.close();await settle();await f.advance(10000);assert.equal(f.sent.length,count);assert.ok(f.listeners.every(fn=>fn===null));
});

test('missing host support leaves the existing transport usable without platform API or registration calls',async t=>{
 const f=transportFixture(t,{missing:true}),a=f.actor(0);a.adapter.start();await settle();assert.equal(a.adapter.connected,true);assert.equal(a.adapter.preview.connected,false);assert.equal(f.requestCount,0);
 a.adapter.sendCursor({clientId:key(50),seq:1,point:{x:1,y:1}});assert.equal(a.fallback.length,1);assert.equal(f.records.length,0);
 assert.equal(a.adapter.diagnostics().previewError,'get-manager-missing-api');assert.match(a.adapter.diagnostics().previewDetail,/宿主未提供多人接口/);
});

test('native connection failure retains its phase and numeric errno without retaining raw credentials',async t=>{
 const f=transportFixture(t),a=f.actor(0);a.manager.connect=o=>o.fail({errno:'1007',errMsg:'未开通 token=do-not-retain https://private.example/?code=hidden'});
 a.adapter.start();await settle();const diagnostics=a.adapter.diagnostics();
 assert.equal(diagnostics.previewError,'connect-service-disabled');assert.equal(diagnostics.previewStage,'connect');assert.equal(diagnostics.previewErrno,'1007');assert.match(diagnostics.previewDetail,/连接平台.*服务未开通.*1007/);
 assert.doesNotMatch(JSON.stringify(diagnostics),/do-not-retain|private\.example|hidden/);assert.equal(f.requestCount,0);assert.equal(a.adapter.connected,true);
});

test('room creation failure is distinct from connection failure and cleanup cannot overwrite it',async t=>{
 const f=transportFixture(t),a=f.actor(0);a.manager.createRoom=o=>o.fail({errno:1205,errMsg:'request failed'});a.manager.disconnect=o=>o.fail({errno:999,errMsg:'cleanup'});
 a.adapter.start();await settle();assert.equal(a.adapter.diagnostics().previewStage,'createRoom');assert.equal(a.adapter.diagnostics().previewErrno,'1205');assert.match(a.adapter.diagnostics().previewDetail,/创建平台房间/);assert.equal(a.adapter.connected,true);
});

test('Promise-style native failures retain the join phase and errors without valid short codes are omitted',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();await settle();
 b.manager.joinRoom=()=>Promise.reject({errno:'https://secret.example/token',errMsg:'network failed'});b.adapter.start();await settle();
 assert.equal(b.adapter.diagnostics().previewError,'joinRoom-network');assert.equal(b.adapter.diagnostics().previewErrno,'');assert.equal(b.adapter.connected,true);assert.doesNotMatch(JSON.stringify(b.adapter.diagnostics()),/secret\.example/);
});

test('authoritative cursor reception stays available until the platform is verified and resumes after failure',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1),received=[];
 a.adapter.subscribeCursors(value=>received.push(value));
 const sample={cursors:[{playerId:f.room.members[1].id,name:'乙',color:'#654321',x:12,y:34,updatedAt:Date.now()}]};
 a.adapter.start();a.emitCursors(sample);assert.equal(received.at(-1),sample);
 b.adapter.start();await f.ready();const before=received.length;
 a.emitCursors(sample);assert.equal(received.length,before,'verified platform previews suppress duplicate authority cursors');
 f.listeners[1].onDisconnected({});await settle();assert.equal(a.adapter.preview.connected,false);
 a.emitCursors(sample);assert.equal(received.at(-1),sample,'original cursor reception resumes alongside outgoing fallback');
});

test('a slow native send has one in-flight message and retains only the most recent position',async t=>{
 const f=transportFixture(t,{stallSend:true}),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 const moves=()=>f.sent.filter(s=>s.index===0&&JSON.parse(s.msg).d);
 a.adapter.preview.sendMove(0,1,2);await f.advance(300);assert.equal(moves().length,1);
 for(let n=0;n<10;n++){a.adapter.preview.sendMove(0,n+10,n+20);await f.advance(100);}assert.equal(moves().length,1);
 f.held.shift()();await settle();await f.advance(100);assert.equal(moves().length,2);assert.equal(JSON.parse(moves()[1].msg).d[1],19);
});

test('an admitted non-Tap or backgrounded player switches Tap peers to per-peer hybrid mode instead of tearing down Tap',async t=>{
 const f=transportFixture(t,{production:true}),a=f.actor(0),b=f.actor(1);
 const seenA=[],seenB=[],movesB=[];
 a.adapter.subscribeCursors(v=>seenA.push(v.cursors));
 b.adapter.subscribeCursors(v=>seenB.push(v.cursors));
 b.adapter.preview.subscribeMoves(v=>movesB.push(v));
 a.adapter.start();b.adapter.start();await f.ready();

 // A 3rd player (Web / old SDK / backgrounded) is present without Tap binding.
 const legacyId=key(200);
 f.room.members.push({id:legacyId,name:'普通客户端',color:'#123456',lastSeen:Date.now()});f.room.revision++;
 for(const actor of [a,b])actor.authority.emit();await settle();

 // Tap peers stay connected in hybrid mode: Tap stays active between a and b, while WS fallback still feeds the 3rd peer.
 assert.equal(a.adapter.preview.connected,true);assert.equal(b.adapter.preview.connected,true);
 assert.equal(a.adapter.diagnostics().previewHybrid,true);assert.equal(a.adapter.diagnostics().previewFullRoster,false);
 assert.match(a.adapter.diagnostics().previewDetail,/混合通道：已接通 1 位拼友，其余 1 位走原通道/);
 assert.equal(a.adapter.preview.sendMove(0,30,40),false,'hybrid sendMove also allows authoritative WS move for non-Tap peers');
 a.adapter.sendCursor({clientId:key(100),seq:1,point:{x:3,y:4}});assert.equal(a.fallback.length,1,'hybrid sendCursor also forwards to WS for non-Tap peers');
 await f.advance(300);
 assert.ok(movesB.flat().some(m=>m.dx===30&&m.dy===40),'Tap peer still receives 10Hz Tap drag previews in hybrid mode');
 assert.ok(seenB.at(-1)?.some(c=>c.playerId===f.room.members[0].id&&c.x===3&&c.y===4),'Tap peer still receives Tap cursor in hybrid mode');

 // WS cursors from the non-Tap peer merge alongside Tap peer cursors without duplicating confirmed Tap peers.
 b.adapter.sendCursor({clientId:key(101),seq:1,point:{x:70,y:80}});
 await f.advance(300);
 a.emitCursors({cursors:[
  {playerId:f.room.members[1].id,name:'乙',color:'#654321',x:999,y:999,updatedAt:Date.now()},
  {playerId:legacyId,name:'普通客户端',color:'#123456',x:15,y:25,updatedAt:Date.now()},
 ],serverTime:Date.now()});
 const merged=seenA.at(-1);
 assert.equal(merged?.filter(c=>c.playerId===f.room.members[1].id).length,1,'confirmed Tap peer is not duplicated by WS');
 assert.equal(merged?.find(c=>c.playerId===f.room.members[1].id)?.x,70,'confirmed Tap peer uses fresh Tap cursor');
 assert.equal(merged?.find(c=>c.playerId===legacyId)?.x,15,'non-Tap peer cursor merges cleanly from WS');

 // Once the backgrounded/legacy peer ages out (>22s without heartbeat), Tap peers upgrade back to full Tap offload.
 const later=Date.now()+23000;
 f.room.members[0].lastSeen=later;f.room.members[1].lastSeen=later;f.room.serverTime=later;f.room.leases[0].expires=later+10000;f.room.revision++;
 for(const actor of [a,b])actor.authority.emit();await f.advance(100);
 assert.equal(a.adapter.diagnostics().previewFullRoster,true);assert.equal(a.adapter.diagnostics().previewHybrid,false);
 const fallbackBefore=a.fallback.length;
 assert.equal(a.adapter.preview.sendMove(0,55,66),true,'full Tap roster suppresses redundant WS moves again');
 a.adapter.sendCursor({clientId:key(100),seq:2,point:{x:8,y:9}});assert.equal(a.fallback.length,fallbackBefore);
});

test('an uncompleted native call times out to the original stream and cannot overlap a second singleton connection',async t=>{
 const f=transportFixture(t),a=f.actor(0);let connects=0;a.manager.connect=()=>{connects++;};a.adapter.start();await settle();await f.advance(5001);assert.equal(a.adapter.connected,true);assert.equal(a.adapter.preview.connected,false);assert.equal(f.requestCount,0);
 a.adapter.close();await settle();const b=f.actor(1,{sharedManager:a.manager});b.adapter.start();await settle();await f.advance(4001);assert.equal(connects,1);assert.equal(b.adapter.connected,true);assert.equal(b.adapter.preview.connected,false);
});

test('leaving while a native call is pending waits for completion before reusing the singleton',async t=>{
 const f=transportFixture(t),a=f.actor(0),pending=[];a.manager.connect=o=>pending.push(o);a.adapter.start();await settle();assert.equal(pending.length,1);
 a.adapter.close();const b=f.actor(1,{sharedManager:a.manager});b.adapter.start();await settle();assert.equal(pending.length,1,'a second native login cannot overlap the first');
 pending[0].success({playerId:'tap-0'});await settle();assert.equal(pending.length,2);pending[1].fail({});await settle();assert.equal(f.requestCount,0);
});

test('Web, WeChat and ordinary rooms never initialize Tap multiplayer, and even the test adapter is lazy',()=>{
 let calls=0;const base=roomFixture();
 for(const platformId of ['web','wechat','taptap'])for(const enabled of [false,true]){
  const client=new GameClient({config:{id:platformId,apiBase:'https://game.test/h5',assetBase:'https://game.test'},openSocket(){throw Error('not started');},randomId:()=>key(100),onlineBattleManager(){calls++;return undefined;}});
  client.config.realtime={version:1};const room={...base,...(enabled?{tapPreview:{version:1,testOnly:true,epoch:key(100),serial:1,channelId:null,peers:[]}}:{})};
  const stream=client.roomRealtime({room,token:key(10),playerId:base.members[0].id},()=>0);assert.equal(!!stream.preview,platformId==='taptap'&&enabled);stream.close();
 }
 assert.equal(calls,0,'no platform room SDK calls before explicit room start');
});

test('removing server opt-in disables an existing platform session and completed puzzles cannot continue previewing',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 a.adapter.observe({...f.view(),revision:1,tapPreview:undefined});assert.equal(a.adapter.preview.connected,false);assert.equal(a.adapter.preview.sendMove(0,1,2),false);
 b.adapter.observe({...f.view(),revision:1,completedAt:Date.now()});assert.equal(b.adapter.preview.connected,false);assert.equal(b.adapter.preview.sendMove(0,1,2),false);await settle();
});

test('successful room joins with missing message callbacks never suppress the original movement channel',async t=>{
 const f=transportFixture(t,{dropMessages:true}),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await settle();
 for(let n=0;n<30;n++)await f.advance(100);
 assert.equal(a.adapter.diagnostics().previewRosterReady,true);assert.equal(a.adapter.preview.connected,false);assert.equal(a.adapter.preview.sendMove(0,3,4),false);
 a.adapter.sendCursor({clientId:key(50),seq:1,point:{x:1,y:2}});assert.equal(a.fallback.length,1);
 for(let n=0;n<50;n++)await f.advance(100);
 assert.equal(a.adapter.diagnostics().previewError,'message-handshake-timeout');assert.equal(a.adapter.connected,true);
});

test('silent platform message loss expires a confirmed preview route and retains normal game authority',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();assert.equal(a.adapter.preview.sendMove(0,123,456),true);await f.advance(300);f.dropMessages(true);
 for(let n=0;n<40;n++)await f.advance(100);
 assert.equal(a.adapter.preview.connected,false);assert.equal(b.adapter.preview.connected,false);assert.equal(a.adapter.preview.sendMove(0,3,4),false);assert.equal(a.adapter.connected,true);assert.equal(b.adapter.connected,true);
 const before=f.sent.length;f.dropMessages(false);await f.ready();await f.advance(500);assert.ok(f.sent.slice(before).every(s=>JSON.parse(s.msg).d===null),'recovery cannot replay old dragging positions');
});

test('platform IDs remain opaque and the coordinator accepts punctuation without changing identity checks',()=>{
 const room=roomFixture(),coordinator=createTapPreview({roomIds:[room.id]});room.members.forEach(m=>m.lastSeen=Date.now());
 for(const value of ['user:region.123@example','room/part+suffix=','8'.repeat(200)])assert.equal(validTapPlatformId(value),true);
 for(const value of ['',{},12.5,Number.MAX_SAFE_INTEGER+1,' a','a\nb','a'.repeat(257)])assert.equal(normalizeTapPlatformId(value),null);
 assert.equal(normalizeTapPlatformId(123456789),'123456789');
 const binding={clientId:key(10),tapPlayerId:'app:user.region/123'},reserved=coordinator.request(room,room.members[0],{op:'reserve',...binding});
 const published=coordinator.request(room,room.members[0],{op:'publish',...binding,epoch:reserved.epoch,channelId:'room:region.456'});assert.equal(published.channelId,'room:region.456');
 assert.throws(()=>coordinator.request(room,room.members[1],{op:'reserve',clientId:key(11),tapPlayerId:binding.tapPlayerId}),e=>e.code==='TAP_PREVIEW_ALREADY_CONNECTED');
});

test('a Promise acknowledgement cannot outrun a later valid native connect callback',async t=>{
 const f=transportFixture(t),a=f.actor(0);let pending;
 a.manager.connect=o=>{pending=o;return Promise.resolve({errMsg:'connect:ok'});};
 a.adapter.start();await settle();assert.equal(f.requestCount,0);assert.equal(a.adapter.diagnostics().previewError,'');
 pending.success({playerId:'app:player.region/123'});await settle();assert.ok(f.requestCount>=3);assert.equal(a.adapter.diagnostics().previewError,'');assert.equal(f.records.filter(r=>r[0]==='create').length,1);
});

test('callback acknowledgements and one-layer bridge envelopes retain exact IDs without inventing identities',async t=>{
 const f=transportFixture(t),a=f.actor(0);a.manager.connect=o=>{o.success({errMsg:'connect:ok'});return Promise.resolve({data:{playerId:123456789}});};
 a.manager.createRoom=o=>{o.success({});return Promise.resolve({data:{roomInfo:{id:'platform:room.42'}}});};
 a.adapter.start();await settle();const meta=f.view().tapPreview;assert.equal(meta.peers[0].tapPlayerId,'123456789');assert.equal(meta.channelId,'platform:room.42');assert.equal(meta.peers[0].ready,true);assert.equal(a.adapter.diagnostics().previewError,'');
});

test('invalid native responses expose only expected field types and do not use openid as a substitute',async t=>{
 const f=transportFixture(t),a=f.actor(0);a.manager.connect=o=>o.success({openid:'private-openid',playerId:{value:'private-id'},data:{playerId:'must-not-override-root'},token:'never-retain'});
 a.adapter.start();await settle();assert.equal(f.requestCount,0);await f.advance(5001);const d=a.adapter.diagnostics();
 assert.equal(d.previewError,'connect-invalid-player-id');assert.match(d.previewResponse,/playerId=object/);assert.doesNotMatch(JSON.stringify(d),/private-openid|private-id|never-retain|must-not-override-root/);assert.equal(a.adapter.connected,true);
});


test('two peers confirm actual message identity with punctuation IDs and safe numeric bridge IDs',async t=>{
 const f=transportFixture(t),a=f.actor(0,{nativeId:'app:region.player/1'}),b=f.actor(1,{nativeId:123456789}),moves=[];
 b.adapter.preview.subscribeMoves(value=>moves.push(value));a.adapter.start();b.adapter.start();await f.ready();
 assert.equal(a.adapter.preview.sendMove(0,123,234),true);await f.advance(300);assert.ok(moves.flat().some(m=>m.dx===123));
 assert.deepEqual(f.view().tapPreview.peers.map(p=>p.tapPlayerId).sort(),['123456789','app:region.player/1']);
});

for(const hz of [10,15])test(`three peers can select ${hz}/s independently, report real sends and retain the per-player cap`,async t=>{
 const f=transportFixture(t,{players:3,sendLimit:15}),actors=[f.actor(0),f.actor(1),f.actor(2)];
 for(const a of actors)a.adapter.start();await f.ready();
 const before=JSON.stringify(f.room.puzzle),start=f.sent.length;
 for(const a of actors){a.adapter.setPreviewSendHz(hz);a.adapter.resetPreviewStats();}
 for(let n=1;n<=3000;n++){
  if(n%5===0)for(const a of actors)a.adapter.sendCursor({clientId:key(100),seq:n,point:{x:n,y:n}});
  await f.advance(1);
 }
 for(let i=0;i<actors.length;i++){
  const d=actors[i].adapter.diagnostics(),sent=f.sent.slice(start).filter(s=>s.index===i);
  assert.ok(sent.length>=hz*3-2&&sent.length<=hz*3+1,`${hz} target: ${sent.length} sends over 3s`);
  assert.ok(sent.every((s,n)=>sent.filter(other=>other.at<=s.at&&s.at-other.at<1000).length<=hz));
  assert.equal(d.previewConnected,true);assert.equal(d.previewTargetHz,hz);assert.equal(d.previewPeersConfirmed,2);
  assert.equal(d.platformSent,sent.length);assert.equal(d.platformSucceeded,d.platformSent);assert.equal(d.platformFailed,0);
  assert.ok(d.platformSendPeak<=hz);assert.equal(d.platformPeerReceives.length,2);assert.ok(d.platformPeerReceives.every(p=>p.total>0&&p.hz<=hz));
  assert.equal(actors[i].fallback.length,0);
 }
 assert.equal(JSON.stringify(f.room.puzzle),before);
 actors[0].adapter.setPreviewSendHz(99);assert.equal(actors[0].adapter.diagnostics().previewTargetHz,hz);
 actors[0].adapter.resetPreviewStats();const reset=actors[0].adapter.diagnostics();assert.equal(reset.platformSent,0);assert.equal(reset.platformSucceeded,0);assert.equal(reset.platformPeerReceives.length,0);
 assert.equal(reset.previewConnected,true,'clearing counters cannot reset the handshake or sequence');
});

test('a simulated shared room quota is observable as send failure and preserves authoritative fallback',async t=>{
 const f=transportFixture(t,{players:3,sendLimit:15,roomLimit:true}),actors=[f.actor(0),f.actor(1),f.actor(2)];
 for(const a of actors)a.adapter.start();await f.ready();for(const a of actors){a.adapter.setPreviewSendHz(10);a.adapter.resetPreviewStats();}
 for(let n=1;n<=200;n++){for(const a of actors)a.adapter.sendCursor({clientId:key(100),seq:n,point:{x:n,y:n}});await f.advance(5);}
 const diagnostics=actors.map(a=>a.adapter.diagnostics()),failed=diagnostics.find(d=>d.platformFailed>0);
 assert.ok(failed,'30 aggregate attempts/s must expose a shared 15/s quota');assert.equal(failed.previewConnected,false);
 assert.equal(failed.previewStage,'sendCustomMessage');assert.equal(failed.previewErrno,'1234');assert.match(failed.platformLastSendError,/1234/);
 assert.doesNotMatch(JSON.stringify(diagnostics),/do-not-retain/);assert.ok(actors.every(a=>a.adapter.connected));
 assert.ok(actors.some(a=>a.fallback.length>0),'a failed platform cannot masquerade as successful fast syncing');
});

test('clearing metrics during a slow SDK call does not count its callback as a new success',async t=>{
 const f=transportFixture(t,{stallSend:true}),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 a.adapter.preview.sendMove(0,1,2);await f.advance(300);assert.equal(f.held.length,1);
 a.adapter.resetPreviewStats();f.held.shift()();await settle();assert.equal(a.adapter.diagnostics().platformSucceeded,0);
 assert.equal(a.adapter.diagnostics().platformSent,0);
});

for(const bodyKey of ['message','msg','data','data.message','data.msg'])for(const eventForm of ['object','data','json'])for(const messageForm of ['string','object'])test(`three platform peers verify ${eventForm} events with ${bodyKey} ${messageForm} messages without relaxing sender binding`,async t=>{
 const f=transportFixture(t,{players:3,eventForm,messageForm,bodyKey}),actors=[f.actor(0),f.actor(1),f.actor(2)];
 for(const a of actors)a.adapter.start();await f.ready();
 for(const a of actors){assert.equal(a.adapter.preview.connected,true);assert.match(a.adapter.diagnostics().previewDetail,/双向验证/);}
 const before=actors[1].adapter.diagnostics().platformReceived;
 for(let n=1;n<=30;n++){actors[0].adapter.sendCursor({clientId:key(100),seq:n,point:{x:n,y:n}});await f.advance(50);}
 const d=actors[1].adapter.diagnostics();assert.ok(d.platformReceived>before);assert.ok(d.platformCallbacks>d.platformReceived);assert.ok(d.previewIgnored.duplicate>0);assert.ok(d.previewEventShape);assert.ok(d.previewEventShape.includes('body='+bodyKey+','));
 assert.doesNotMatch(JSON.stringify(d),/tap-0/,'only event field types, not platform identity values, are exposed');
 const sent=JSON.parse(f.sent.filter(s=>s.index===0).at(-1).msg),received=d.platformReceived;
 f.listeners[1].onCustomMessageReceived({message:{...sent,s:10000}});assert.equal(actors[1].adapter.diagnostics().platformReceived,received,'a parsed frame without native sender identity remains untrusted');
});

test('alternate bridge bodies retain sender, format, binding and sequence validation without exposing values',async t=>{
 const f=transportFixture(t,{bodyKey:'msg'}),a=f.actor(0,{nativeId:'a'.repeat(24)}),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 const frame=JSON.parse(f.sent.find(s=>s.index===0).msg),listener=f.listeners[1];
 const count=()=>b.adapter.diagnostics().platformReceived,before=count();
 for(const event of [
  {msg:JSON.stringify({...frame,s:100})},
  {playerId:'unregistered',msg:JSON.stringify({...frame,s:100})},
  {playerId:'a'.repeat(24),msg:JSON.stringify({...frame,c:key(999),s:100})},
  {playerId:'a'.repeat(24),msg:'x'.repeat(2049)},
  {playerId:'a'.repeat(24),data:JSON.stringify({...frame,s:100,p:['invalid',1]})},
  {playerId:'a'.repeat(24),message:'invalid canonical body',msg:JSON.stringify({...frame,s:100})},
  {playerId:'a'.repeat(24),payload:JSON.stringify({...frame,s:100})}
 ]){listener.onCustomMessageReceived(event);assert.equal(count(),before);}
 listener.onCustomMessageReceived({playerId:'a'.repeat(24),msg:JSON.stringify({...frame,s:100})});assert.equal(count(),before+1);
 const d=b.adapter.diagnostics();assert.match(d.previewEventShape,/sender=string\(24\),body=msg,message=undefined,msg=string/);
 assert.doesNotMatch(JSON.stringify(d),new RegExp('a'.repeat(24)));assert.ok(d.previewIgnored.sender>0);assert.ok(d.previewIgnored.binding>0);assert.ok(d.previewIgnored.payload>0);assert.ok(d.previewIgnored.frame>0);
 listener.onCustomMessageReceived({playerId:'a'.repeat(24),data:JSON.stringify({...frame,s:100})});assert.equal(count(),before+1,'aliases cannot replay the same sequence');
});

test('missing handshake falls back before automatic recovery; statistics clearing cannot claim success',async t=>{
 const f=transportFixture(t,{dropMessages:true}),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();
 for(let n=0;n<100&&!a.adapter.diagnostics().previewError;n++)await f.advance(100);
 const d=a.adapter.diagnostics();assert.ok(d.platformSucceeded>=5);assert.equal(d.platformFailed,0);assert.equal(d.platformReceived,0);assert.equal(d.platformCallbacks,0);
 assert.equal(d.previewConnected,false);assert.equal(d.previewError,'message-handshake-timeout');assert.match(d.previewDetail,/超时.*回退/);
 a.adapter.resetPreviewStats();a.adapter.setPreviewSendHz(15);for(let n=0;n<3;n++){a.adapter.sendCursor({clientId:key(100),seq:n+1,point:{x:n,y:n}});await f.advance(100);}
 const reset=a.adapter.diagnostics();assert.equal(reset.platformSent,0);assert.match(reset.previewDetail,/超时.*回退/);assert.ok(a.fallback.length>0);f.dropMessages(false);await f.ready();assert.equal(a.adapter.preview.connected,true);
});

test('a non-creator leaving keeps the remaining platform peers connected',async t=>{
 const f=transportFixture(t,{players:3,bodyKey:'msg'}),actors=[f.actor(0),f.actor(1),f.actor(2)];for(const a of actors)a.adapter.start();await f.ready();
 const before=f.view().tapPreview,connects=f.records.filter(r=>r[0]==='connect').length;
 actors[1].adapter.close();f.room.members=f.room.members.filter(m=>m.id!==key(3));f.room.revision++;
 for(const i of [0,2]){actors[i].authority.emit();f.listeners[i].onPlayerLeft({playerId:'tap-1'});}await settle();
 assert.equal(f.view().tapPreview.epoch,before.epoch);assert.equal(f.view().tapPreview.channelId,before.channelId);
 for(const i of [0,2])assert.equal(actors[i].adapter.preview.connected,true);
 assert.equal(f.records.filter(r=>r[0]==='connect').length,connects);
});

test('creator departure elects one replacement automatically without changing game progress',async t=>{
 const f=transportFixture(t,{players:3}),actors=[f.actor(0),f.actor(1),f.actor(2)];for(const a of actors)a.adapter.start();await f.ready();
 const original=f.view().tapPreview,puzzle=JSON.stringify(f.room.puzzle);actors[0].adapter.close();f.room.members=f.room.members.filter(m=>m.id!==key(2));f.room.revision++;
 for(const a of actors.slice(1))a.authority.emit();await settle();
 for(let n=0;n<100&&!actors.slice(1).every(a=>a.adapter.preview.connected);n++)await f.advance(100);
 for(const a of actors.slice(1))assert.equal(a.adapter.preview.connected,true);
 const next=f.view().tapPreview;assert.notEqual(next.epoch,original.epoch);assert.notEqual(next.channelId,original.channelId);
 assert.equal(f.records.filter(r=>r[0]==='create').length,2,'one initial room plus one new elected room');
 assert.equal(JSON.stringify(f.room.puzzle),puzzle);assert.equal(actors[1].actions.length+actors[2].actions.length,0);
 assert.throws(()=>f.coordinator.request(f.room,f.room.members[0],{op:'leave',clientId:key(11),tapPlayerId:'tap-1',epoch:original.epoch}),e=>e.code==='TAP_PREVIEW_STALE');
 assert.equal(f.view().tapPreview.epoch,next.epoch,'late old-generation cleanup cannot invalidate the new room');
});

test('backgrounding suspends retries and returning restores the same game session automatically',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();a.adapter.setPreviewSendHz(15);
 a.adapter.setHidden(true);await settle();const connects=f.records.filter(r=>r[0]==='connect'&&r[1]===0).length;
 for(let n=0;n<30;n++)await f.advance(100);assert.equal(f.records.filter(r=>r[0]==='connect'&&r[1]===0).length,connects);
 a.adapter.setHidden(false);await f.ready();assert.equal(a.adapter.diagnostics().previewTargetHz,15);assert.ok(a.adapter.diagnostics().previewRecoveryCount>0);
});

test('a stale same-account binding expires before automatic retry registers a new client',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);
 f.coordinator.request(f.room,f.room.members[0],{op:'reserve',clientId:key(90),tapPlayerId:'tap-0'});
 a.adapter.start();b.adapter.start();await settle();assert.equal(a.adapter.diagnostics().previewErrno,'TAP_PREVIEW_ALREADY_CONNECTED');assert.match(a.adapter.diagnostics().previewDetail,/等待自动重试/);
 for(let n=0;n<190;n++){f.room.members.forEach(m=>m.lastSeen=Date.now());await f.advance(100);}
 assert.equal(a.adapter.preview.connected,false);assert.ok(f.view().tapPreview.peers.some(p=>p.clientId===key(90)),'never evict an unexpired other client');
 for(let n=0;n<250&&!(a.adapter.preview.connected&&b.adapter.preview.connected);n++){f.room.members.forEach(m=>m.lastSeen=Date.now());a.authority.emit();b.authority.emit();await f.advance(100);}
 assert.equal(a.adapter.preview.connected,true);assert.equal(b.adapter.preview.connected,true);assert.ok(a.adapter.diagnostics().previewRecoveryCount>=1);
});

test('closing during reserve waits for its late registration then removes it before singleton reuse',async t=>{
 const f=transportFixture(t);let release;
 const a=f.actor(0,{requestGate:(body,response)=>body.op==='reserve'?new Promise(resolve=>{release=()=>resolve(response);}):Promise.resolve(response)});
 a.adapter.start();await settle();assert.equal(typeof release,'function');a.adapter.close();await settle();
 assert.equal(f.view().tapPreview.peers.length,1,'pending successful reserve has not been forgotten');
 release();await settle();assert.equal(f.view().tapPreview.peers.length,0,'late reserve is explicitly unregistered');
 const next=f.actor(0,{sharedManager:a.manager});next.adapter.start();await settle();assert.equal(next.adapter.diagnostics().previewError,'');assert.equal(next.adapter.diagnostics().previewSessionJoined,true);
});

test('an expired creator lease invalidates only the old preview generation',()=>{
 let time=100000;const room=roomFixture(),c=createTapPreview({roomIds:[room.id],now:()=>time}),a={clientId:key(10),tapPlayerId:'tap-a'},b={clientId:key(11),tapPlayerId:'tap-b'};
 const first=c.request(room,room.members[0],{op:'reserve',...a});c.request(room,room.members[0],{op:'publish',...a,epoch:first.epoch,channelId:'old'});c.request(room,room.members[1],{op:'reserve',...b});
 const puzzle=JSON.stringify(room.puzzle);time+=15000;room.members.forEach(m=>m.lastSeen=time);c.request(room,room.members[1],{op:'renew',...b,epoch:first.epoch});time+=6000;room.members.forEach(m=>m.lastSeen=time);
 const next=c.descriptor(room);assert.notEqual(next.epoch,first.epoch);assert.equal(next.channelId,null);assert.equal(next.peers.length,0);assert.equal(JSON.stringify(room.puzzle),puzzle);
 assert.throws(()=>c.request(room,room.members[0],{op:'renew',...a,epoch:first.epoch}),e=>e.code==='TAP_PREVIEW_STALE');
 assert.equal(c.request(room,room.members[1],{op:'reserve',...b}).canCreate,true);
});

test('coordinator restart with lower serial numbers recovers through a fresh reserve response',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 const old=f.view().tapPreview;for(let n=0;n<10;n++)f.coordinator.request(f.room,f.room.members[0],{op:'renew',clientId:key(10),tapPlayerId:'tap-0',epoch:old.epoch});a.authority.emit();b.authority.emit();
 f.restartCoordinator();await settle();
 for(let n=0;n<180;n++){f.room.members.forEach(m=>m.lastSeen=Date.now());await f.advance(100);if(a.adapter.diagnostics().previewRecoveryCount&&b.adapter.diagnostics().previewRecoveryCount&&a.adapter.preview.connected&&b.adapter.preview.connected)break;}
 assert.equal(a.adapter.preview.connected,true);assert.equal(b.adapter.preview.connected,true);assert.notEqual(f.view().tapPreview.epoch,old.epoch);
 assert.ok(a.adapter.diagnostics().previewRecoveryCount>0);assert.ok(b.adapter.diagnostics().previewRecoveryCount>0);
});

test('a timed-out native call remains blocked from automatic singleton reuse',async t=>{
 const f=transportFixture(t),a=f.actor(0);let calls=0;a.manager.connect=()=>{calls++;};a.adapter.start();await settle();
 for(let n=0;n<100;n++)await f.advance(100);assert.equal(calls,1);assert.equal(a.adapter.diagnostics().previewRecoveryBlocked,true);assert.match(a.adapter.diagnostics().previewDetail,/退出自测包/);
});

test('waiting for a late player binding is distinct from message timeout and upgrades cleanly when bound',async t=>{
 const f=transportFixture(t),a=f.actor(0),b=f.actor(1);a.adapter.start();b.adapter.start();await f.ready();
 f.dropMessages(true);for(let n=0;n<50;n++)await f.advance(100);assert.equal(a.adapter.preview.connected,false);
 // When no other active peer has a ready Tap binding yet (b becomes inactive, late player joins unbound), handshake timer resets instead of timing out.
 b.adapter.close();f.room.members[1].lastSeen=0;f.room.members.push({id:key(4),name:'迟到拼友',color:'#123456',lastSeen:Date.now()});f.room.revision++;a.authority.emit();await settle();
 for(let n=0;n<60;n++)await f.advance(100);
 const waiting=a.adapter.diagnostics();assert.equal(waiting.previewError,'');assert.equal(waiting.previewSessionJoined,true);assert.equal(waiting.previewMembersReady,1);assert.equal(waiting.previewMembersTotal,2);assert.deepEqual(waiting.previewMissingBindings,['迟到拼友']);assert.match(waiting.previewDetail,/等待 1 位玩家.*绑定/);
 f.dropMessages(false);const c=f.actor(2);c.adapter.start();
 for(let n=0;n<30&&!(a.adapter.fullPreviewReady&&c.adapter.fullPreviewReady);n++){await settle();await f.advance(100);}
 assert.equal(a.adapter.preview.connected,true);assert.equal(c.adapter.preview.connected,true);assert.match(a.adapter.diagnostics().previewDetail,/双向验证/);
});

test('platform preview cursors enrich level and decoration from local room members without enlarging wire frames and refresh on level-up',async t=>{
 const f=transportFixture(t);
 const paw={id:'cat-paw',title:'猫爪',artKey:'cat-paw',color:'#d9829c',kind:'cursor'};
 f.room.members[0].level=28;f.room.members[0].decoration=paw;
 f.room.members[1].level=17;f.room.members[1].decoration=null;
 const a=f.actor(0),b=f.actor(1);
 const seenA=[],seenB=[];
 a.adapter.subscribeCursors(data=>seenA.push(data.cursors));
 b.adapter.subscribeCursors(data=>seenB.push(data.cursors));
 a.adapter.start();b.adapter.start();await f.ready();

 // Move cursor over Tap platform: wire payload stays coordinate-only while local cursors carry level + decoration.
 a.adapter.sendCursor({clientId:key(200),seq:1,point:{x:120,y:240}});
 b.adapter.sendCursor({clientId:key(201),seq:1,point:{x:300,y:180}});
 for(let n=0;n<4;n++)await f.advance(100);
 const lastWire=f.sent.at(-1)?.msg;
 assert.ok(lastWire&&!lastWire.includes('cat-paw')&&!lastWire.includes('"level"'),'platform wire frame omits static member metadata');
 const cursorForA=seenB.at(-1)?.find(c=>c.playerId===key(2));
 assert.equal(cursorForA?.level,28);
 assert.deepEqual(cursorForA?.decoration,paw);
 const cursorForB=seenA.at(-1)?.find(c=>c.playerId===key(3));
 assert.equal(cursorForB?.level,17);
 assert.equal(cursorForB?.decoration,null);

 // Mid-room level-up and decoration swap in room.members refreshes cached Tap cursors immediately on next room update.
 const star={id:'star',title:'星芒',artKey:'star',color:'#e8c47a',kind:'cursor'};
 f.room.members[0].level=29;f.room.members[0].decoration=star;
 f.room.revision++;f.room.serverTime=Date.now();
 b.authority.emit();await settle();
 const updatedA=seenB.at(-1)?.find(c=>c.playerId===key(2));
 assert.equal(updatedA?.level,29);
 assert.deepEqual(updatedA?.decoration,star);
});
