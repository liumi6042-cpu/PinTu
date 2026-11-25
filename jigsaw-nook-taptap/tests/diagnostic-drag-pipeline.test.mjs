import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../lib/room-client.ts';
import {addMember,applyAction,snapshot} from '../lib/room-engine.ts';
import {PHOTOS} from '../lib/puzzle-catalog.ts';

const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,{diagnostic=true,httpGate=false,ordinaryActions=false,preview=false}={}){
 let sequence=0,time=1000,measurement=0;
 const rid=()=> (++sequence).toString(16).padStart(32,'0');
 // Diagnostic creation deliberately bypasses the normal >=12-piece policy.
 const puzzle={version:1,layout:'square',imageId:PHOTOS[0].id,cols:3,rows:3,seed:17,elapsed:0,groups:[]};
 const room={id:rid(),puzzle,revision:0,createdAt:time,expiresAt:time+86400000,completedAt:null,startedAt:null,members:[],leases:{},visibility:'private'};
 room.puzzle.groups=Array.from({length:9},(_,id)=>({id,pieces:[id],dx:80+(id%3)*180,dy:80+Math.floor(id/3)*180,locked:false}));
 const member=addMember(room,'me','Test','ticket',time,'test-owner');
 const view=()=>({...snapshot(room,time),...(diagnostic?{diagnostic:true,diagnosticTiming:{serverMs:2}}:{})});
 const calls=[],frames=[],events=[],canceled=[],states=new Set(),previews=[],previewListeners=new Set(),roomListeners=new Set();let profileRefreshes=0;
 const apply=action=>{try{applyAction(room,member,action,++time);room.revision++;return {status:200,data:view()};}catch(error){return {status:error.status??500,data:{error:error.message,code:'ENGINE_REJECTED'}};}};
 const httpPending=[];
 const stream={connected:true,actionsReady:true,actionsDiagnosticOnly:ordinaryActions?false:undefined,
  ...(preview?{preview:{connected:true,observe(){},sendMove(groupId,dx,dy){if(!this.connected||room.leases[groupId]?.playerId!==member.id)return false;previews.push({groupId,dx,dy});return true;},clearMove(){},subscribeMoves(fn){previewListeners.add(fn);return()=>previewListeners.delete(fn);}}}:{}),
  get pendingActionCount(){return frames.filter(frame=>!frame.settled).length;},
  sendAction(input){
   if(!this.actionsReady)return Promise.reject(Object.assign(Error('unavailable'),{code:'ACTION_TRANSPORT_UNAVAILABLE',sent:false}));
   const gate=deferred();frames.push({input:structuredClone(input),...gate,settled:false,applied:false});return gate.promise;
  },
  subscribeState(fn){states.add(fn);return()=>states.delete(fn);},subscribeRoom(fn){roomListeners.add(fn);return()=>roomListeners.delete(fn);},subscribeCursors(){return()=>{};},sendCursor(){return false;},
  resetActions(){this.disconnect();},
  disconnect(){this.connected=false;this.actionsReady=false;for(const frame of frames)if(!frame.settled){frame.settled=true;frame.reject(Object.assign(Error('lost'),{code:'ACTION_CONNECTION_LOST',sent:true}));}for(const fn of states)fn(false);},
  reconnect(){this.connected=true;this.actionsReady=true;for(const fn of states)fn(true);},
 };
 const reply=result=>({ok:result.status<300,status:result.status,headers:{get:()=>null},json:async()=>result.data});
 const client=new RoomClient({token:'ticket',playerId:member.id,room:view()},{realtime:stream,randomId:rid,now:()=>1000,performanceNow:()=>measurement,hidden:()=>false,refreshProfile:async()=>{profileRefreshes++;},emit:(name,data)=>events.push({name,data}),fetch:async(url,init={})=>{
  const action=init.body?JSON.parse(init.body):null;calls.push({url,method:init.method??'GET',action});
  if(action&&httpGate&&['claim','move','drop','release'].includes(action.type)){const gate=deferred();httpPending.push({action,...gate});return gate.promise;}
  return reply(action?apply(action):{status:200,data:view()});
 }});
 const table={networkReady:true,cancelNetworkDrag(id){canceled.push(id);},playConnectionSound(){},syncRemote(next,owners,protectedIds){
  const local=new Map(client.state.groups.map(group=>[group.id,group]));
  client.state.groups=next.groups.map(group=>structuredClone(protectedIds.has(group.id)&&local.has(group.id)?local.get(group.id):group));
 }};
 const cleanup=client.attach(table);t.after(cleanup);
 const commit=(frame,{ack=true}={})=>{assert.equal(frame.applied,false,'an envelope reaches the engine once');frame.result=apply(frame.input.action);frame.applied=true;if(ack){frame.settled=true;frame.resolve(frame.result);}return frame.result;};
 const gesture=(id,dx,dy)=>{
  assert.equal(table.network.canAcquire(id),true,'another ended gesture must not gate this pointer');
  const granted=table.network.acquire(id),group=client.state.groups.find(group=>group.id===id);group.dx=dx;group.dy=dy;
  return {granted,finished:table.network.drop(id,dx,dy)};
 };
 return {client,table,stream,room,view,calls,frames,events,canceled,gesture,commit,previews,previewListeners,roomListeners,advance:ms=>{measurement+=ms;},httpPending,reply,apply,get profileRefreshes(){return profileRefreshes;}};
}

test('platform preview avoids authoritative movement writes, preserves contiguous ordinals and still commits the final drop',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{diagnostic:false,ordinaryActions:true,preview:true});
 const granted=f.table.network.acquire(0);f.table.network.move(0,300,400);assert.equal(f.previews.length,0,'unconfirmed claim cannot grant a preview');
 f.commit(f.frames[0]);await granted;await settle();
 for(let n=0;n<20;n++){f.advance(80);t.mock.timers.tick(80);f.table.network.move(0,300+n,400+n);await settle();}
 assert.ok(f.previews.length>=19);assert.deepEqual(f.frames.map(f=>f.input.action.type),['claim']);
 const before=structuredClone(f.room.puzzle.groups),done=f.table.network.drop(0,500,600);assert.equal(f.frames.length,2);
 assert.deepEqual(f.frames.map(f=>f.input.ordinal),[1,2]);assert.ok(f.frames[1].input.action.seq>f.previews.length);
 assert.deepEqual(f.room.puzzle.groups,before,'only a server-confirmed drop can persist final coordinates');
 f.commit(f.frames[1]);await done;assert.equal(f.room.leases[0],undefined);
 assert.equal(f.calls.filter(c=>['claim','move','drop'].includes(c.action?.type)).length,0);
});

test('platform failure resumes real movement without consuming fake action ordinals or replaying queued previews',async t=>{
 const f=fixture(t,{diagnostic:false,ordinaryActions:true,preview:true}),granted=f.table.network.acquire(0);f.commit(f.frames[0]);await granted;await settle();
 f.table.network.move(0,300,400);assert.equal(f.previews.length,1);assert.equal(f.frames.length,1);
 f.stream.preview.connected=false;f.advance(81);f.table.network.move(0,350,450);await settle();
 assert.equal(f.frames.length,2);assert.equal(f.frames[1].input.action.type,'move');assert.equal(f.frames[1].input.ordinal,2);assert.ok(f.frames[1].input.action.seq>1);
 f.commit(f.frames[1]);await settle();const done=f.table.network.drop(0,500,600);assert.equal(f.frames[2].input.ordinal,3);f.commit(f.frames[2]);await done;
});

test('HTTP authority also skips preview-only moves and resumes HTTP when the platform is unavailable',async t=>{
 const f=fixture(t,{diagnostic:false,preview:true});assert.equal(await f.table.network.acquire(0),true);
 f.table.network.move(0,300,400);await settle();assert.equal(f.previews.length,1);assert.equal(f.calls.filter(c=>c.action?.type==='move').length,0);
 f.stream.preview.connected=false;f.advance(61);f.table.network.move(0,350,450);await settle();assert.equal(f.calls.filter(c=>c.action?.type==='move').length,1);
 await f.table.network.drop(0,500,600);assert.equal(f.room.leases[0],undefined);assert.equal(f.frames.length,0);
});

test('remote previews alter rendered offsets while canonical snapshots and local protected pieces remain authoritative',async t=>{
 const f=fixture(t,{diagnostic:false,ordinaryActions:true,preview:true});const peer=addMember(f.room,'peer','Peer','other-ticket',1000,'other');
 applyAction(f.room,peer,{type:'claim',groupId:1},1001);f.room.leases[1].previewId='a'.repeat(32);f.room.revision++;
 for(const fn of f.roomListeners)fn(f.view());const before=f.client.snapshot.puzzle.groups.find(g=>g.id===1).dx;
 for(const fn of f.previewListeners)fn([{playerId:peer.id,groupId:1,dx:650,dy:700,leaseId:'a'.repeat(32),receivedAt:1001}]);
 assert.equal(f.client.state.groups.find(g=>g.id===1).dx,650);assert.equal(f.client.snapshot.puzzle.groups.find(g=>g.id===1).dx,before);
 for(const fn of f.previewListeners)fn([]);assert.equal(f.client.state.groups.find(g=>g.id===1).dx,before);
});

for(const ids of [[0,1,2],[0,0,0]])test(`diagnostic drags ${ids.join('/')} send three complete gestures before any acknowledgement`,async t=>{
 const f=fixture(t),targets=ids.map((id,n)=>({id,dx:150+n*180,dy:600}));
 const gestures=targets.map(target=>f.gesture(target.id,target.dx,target.dy));
 assert.deepEqual(f.frames.map(frame=>frame.input.action.type),['claim','drop','claim','drop','claim','drop']);
 assert.equal(f.frames.filter(frame=>frame.settled).length,0);
 assert.deepEqual(f.frames.map(frame=>frame.input.ordinal),[1,2,3,4,5,6]);
 assert.equal(new Set(f.frames.map(frame=>frame.input.clientId)).size,1);
 assert.equal(new Set(f.frames.map(frame=>frame.input.gestureId)).size,3);
 assert.equal(f.calls.filter(call=>call.method==='POST').length,0,'drag writes must never use HTTP');
 const queue=f.events.filter(event=>event.name==='room:request-timing'&&event.data.action==='drop-queue');
 assert.equal(queue.length,3);assert.ok(queue.every(event=>event.data.ms===0),'drop queue measures sending, not delayed acknowledgements');
 f.advance(4500);
 for(const frame of f.frames){assert.equal(f.commit(frame).status,200);await settle();}
 assert.deepEqual(await Promise.all(gestures.map(gesture=>gesture.granted)),[true,true,true]);
 await Promise.all(gestures.map(gesture=>gesture.finished));
 for(const id of new Set(ids)){
  const target=targets.filter(target=>target.id===id).at(-1),server=f.room.puzzle.groups.find(group=>group.id===id),local=f.client.state.groups.find(group=>group.id===id);
  assert.equal(server.dx,target.dx);assert.equal(server.dy,target.dy);assert.equal(local.dx,target.dx);assert.equal(local.dy,target.dy);
 }
 assert.equal(f.client.snapshot.revision,6);
 assert.equal(f.events.some(event=>event.name==='puzzle:successful-drop'),false,'unconnected moves never predict a successful connection');
});

test('a real engine business rejection cancels only that gesture while later gestures still commit',async t=>{
 const f=fixture(t);
 f.room.leases[1]={playerId:'teammate',expires:20000,seq:0};
 const gestures=[f.gesture(0,150,600),f.gesture(1,350,600),f.gesture(2,510,600)];
 const statuses=[];for(const frame of f.frames){statuses.push(f.commit(frame).status);await settle();}
 assert.deepEqual(statuses,[200,200,409,409,200,200]);
 assert.deepEqual(await Promise.all(gestures.map(gesture=>gesture.granted)),[true,false,true]);
 await Promise.all(gestures.map(gesture=>gesture.finished));
 assert.equal(f.room.puzzle.groups.find(group=>group.id===0).dx,150);assert.equal(f.room.puzzle.groups.find(group=>group.id===2).dx,510);
 assert.equal(f.canceled.includes(0),false);assert.equal(f.canceled.includes(2),false);assert.equal(f.canceled.includes(1),true);
 assert.equal(f.calls.some(call=>call.method==='POST'),false);
 assert.equal(f.calls.some(call=>call.method==='GET'),true,'refused predictions reconcile with the authoritative room');
});

test('disconnect removes all pending predictions, reads authority, and starts a new stream epoch without replay',async t=>{
 const f=fixture(t),first=f.gesture(0,150,600),second=f.gesture(1,350,600),oldClientId=f.frames[0].input.clientId;
 // The server committed one drop, but its reply and the second gesture were lost.
 f.commit(f.frames[0],{ack:false});f.commit(f.frames[1],{ack:false});
 f.stream.disconnect();await settle();await Promise.all([first.finished,second.finished]);
 assert.equal(await first.granted,false);assert.equal(await second.granted,false);
 assert.equal(f.frames.length,4,'lost actions must never be replayed');assert.equal(f.calls.some(call=>call.method==='POST'),false);
 assert.equal(f.calls.some(call=>call.method==='GET'),true);assert.ok(f.canceled.includes(undefined));
 assert.equal(f.profileRefreshes,1,'lost acknowledgements also refresh the authoritative wallet');
 assert.equal(f.client.state.groups.find(group=>group.id===0).dx,150,'committed drop survives its lost acknowledgement');
 assert.equal(f.client.state.groups.find(group=>group.id===1).dx,260,'uncommitted prediction is removed');
 assert.equal(f.table.network.canAcquire(2),false);
 f.stream.reconnect();await settle();const next=f.gesture(2,510,600);
 assert.equal(f.frames.length,6);assert.notEqual(f.frames[4].input.clientId,oldClientId);assert.deepEqual(f.frames.slice(4).map(frame=>frame.input.ordinal),[1,2]);
 for(const frame of f.frames.slice(4)){assert.equal(f.commit(frame).status,200);await settle();}
 assert.equal(await next.granted,true);await next.finished;
 assert.equal(f.client.state.groups.find(group=>group.id===2).dx,510);assert.equal(f.calls.some(call=>call.method==='POST'),false);
});

test('once diagnostic transport activates, losing its capability never switches a gesture to HTTP',async t=>{
 const f=fixture(t),granted=f.table.network.acquire(0);assert.equal(f.frames.length,1);
 f.stream.actionsReady=false;
 const finished=f.table.network.drop(0,150,600);await settle();
 assert.equal(await granted,false);await finished;
 assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(f.frames.length,1);
 assert.equal(f.table.network.canAcquire(1),false);assert.equal(await f.table.network.acquire(1),false);
 assert.equal(f.calls.some(call=>call.method==='GET'),true);
});

test('a normal room ignores advertised action capability and keeps the existing two-gesture HTTP bound',async t=>{
 const f=fixture(t,{diagnostic:false,httpGate:true}),first=f.gesture(0,150,600),second=f.gesture(1,350,600);
 assert.equal(f.table.network.canAcquire(2),false);assert.equal(await f.table.network.acquire(2),false);await settle();
 assert.equal(f.frames.length,0);assert.equal(f.httpPending.length,1);assert.equal(f.httpPending[0].action.type,'claim');
 for(let n=0;n<4;n++){const pending=f.httpPending[n];assert.ok(pending,'the next HTTP write waits for its predecessor');pending.resolve(f.reply(f.apply(pending.action)));await settle();}
 assert.deepEqual(f.calls.filter(call=>call.action).map(call=>call.action.type),['claim','drop','claim','drop']);
 assert.deepEqual(await Promise.all([first.granted,second.granted]),[true,true]);await Promise.all([first.finished,second.finished]);
 assert.equal(f.client.diagnosticActionsActive,false);
});

for(const ids of [[0,1,2],[0,0,0]])test(`ordinary-room pipeline ${ids.join('/')} sends three gestures without waiting for acknowledgements`,async t=>{
 const f=fixture(t,{diagnostic:false,ordinaryActions:true}),targets=ids.map((id,n)=>({id,dx:150+n*180,dy:600}));
 const gestures=targets.map(target=>f.gesture(target.id,target.dx,target.dy));
 assert.deepEqual(f.frames.map(frame=>frame.input.action.type),['claim','drop','claim','drop','claim','drop']);
 assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(f.client.diagnosticActionsActive,true);
 f.advance(4500);for(const frame of f.frames){assert.equal(f.commit(frame).status,200);await settle();}
 assert.deepEqual(await Promise.all(gestures.map(gesture=>gesture.granted)),[true,true,true]);await Promise.all(gestures.map(gesture=>gesture.finished));
 for(const id of new Set(ids)){const target=targets.filter(target=>target.id===id).at(-1),actual=f.client.state.groups.find(group=>group.id===id);assert.equal(actual.dx,target.dx);assert.equal(actual.dy,target.dy);}
});

test('an ordinary-room energy refusal emits the existing prompt and does not discard another gesture',async t=>{
 const f=fixture(t,{diagnostic:false,ordinaryActions:true}),first=f.gesture(0,150,600),second=f.gesture(1,350,600);
 f.commit(f.frames[0]);await settle();f.frames[1].settled=true;f.frames[1].resolve({status:403,data:{code:'ENERGY_EMPTY',error:'体力不足',profile:{energy:0}}});await settle();
 // A rejected drop ends only its own reservation, as the real backend does.
 delete f.room.leases[0];for(const frame of f.frames.slice(2)){f.commit(frame);await settle();}
 await Promise.all([first.finished,second.finished]);assert.equal(await second.granted,true);
 assert.equal(f.events.filter(event=>event.name==='mobile:energy-empty').length,1);assert.equal(f.events.some(event=>event.name==='mobile:profile'&&event.data.energy===0),true);
 assert.equal(f.client.state.groups.find(group=>group.id===1).dx,350);assert.equal(f.stream.connected,true);assert.equal(f.calls.some(call=>call.method==='POST'),false);
});

test('an acknowledged ordinary contribution is retained when its delta needs a full read',async t=>{
 const f=fixture(t,{diagnostic:false,ordinaryActions:true}),gesture=f.gesture(0,0,0);
 f.commit(f.frames[0]);await settle();const frame=f.frames[1];
 frame.settled=true;const receipt={requestId:frame.input.id,groupId:0,creditedXp:1};
 frame.resolve({status:200,data:{...f.view(),kind:'delta',baseRevision:99,revision:100,elapsed:0,groups:[],removed:[],mobileContribution:receipt}});
 await settle();await gesture.finished;
 const feedback=f.events.filter(event=>event.name==='puzzle:successful-drop');assert.equal(feedback.length,1);assert.equal(feedback[0].data.requestId,receipt.requestId);
});
