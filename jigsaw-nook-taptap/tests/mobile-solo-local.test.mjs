import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {RoomClient} from '../lib/room-client.ts';
import {makeRoom,addMember,applyAction,snapshot,ONLINE_MS,PHOTO_IDS} from '../lib/room-engine.ts';
import {supportsPieceCount} from '../lib/piece-policy.ts';
import {createPuzzle,random,snapTolerance,neighbors} from '../lib/puzzle-engine.ts';
import {SOLO_ONLINE_MS,SOLO_BATCH_MAX,SOLO_MAX_PENDING,SOLO_INDEX_KEY,soloOutboxKey,applySoloDrop,replaySoloOps,otherPlayersPresent,soloCanAfford,saveSoloOutbox,loadSoloOutbox,listSoloOutboxes,flushStoredSoloOutboxes} from '../lib/solo-play.ts';

const roomId='a'.repeat(32),playerId='b'.repeat(32),token='c'.repeat(32);
const catalogImage=PHOTO_IDS.find(id=>supportsPieceCount(id,108));
let serial=100;
const randomId=()=> (++serial).toString(16).padStart(32,'0');
const storage=()=>{const values=new Map();return {values,get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const until=async condition=>{for(let i=0;i<200;i++){if(condition())return;await turn();}assert.fail('Room client did not settle');};
const groups=puzzle=>structuredClone(puzzle.groups).sort((a,b)=>a.id-b.id);
const energy=()=>({enabled:true,energy:1000,cap:1000,cost:1,xp:2,autoSupply:false,supplyEnergy:0,free:false});
function fixture(t,{store=storage(),solo=true,diagnostic=false,energyState=energy(),ticket:existingTicket,batch,fetchOverride}={}){
  const room=makeRoom(roomId,catalogImage,108,Date.now());room.puzzle=createPuzzle('seaside',12,9,123);
  const member=addMember(room,playerId,'玩家','digest',Date.now());
  const ticket=existingTicket??{token,playerId,room:{...snapshot(room,Date.now()),...(diagnostic?{diagnostic:true}:{})}};
  const requests=[],events=[],syncs=[],sounds=[];
  let client;
  const serverSnapshot=()=>({...snapshot(room,Date.now()),...(diagnostic?{diagnostic:true}:{})});
  const applyBatch=action=>{
    const applied=[];
    for(const op of action.ops){applyAction(room,member,{type:'claim',groupId:op.groupId},Date.now());applyAction(room,member,{type:'drop',groupId:op.groupId,dx:op.dx,dy:op.dy,seq:1},Date.now());room.revision++;applied.push(op.requestId);}
    return {...serverSnapshot(),profile:{energy:energyState.energy},soloBatch:{applied,skipped:[],stopped:null},mobileContributions:action.ops.map(op=>({requestId:op.requestId,groupId:op.groupId,creditedXp:2,creditedCoins:0}))};
  };
  const deps={storage:store,fetch:async(url,init)=>{
    const action=init?.body?JSON.parse(init.body):null;requests.push({url,init,action});
    if(fetchOverride)return fetchOverride(action,{url,init,room,member,serverSnapshot,applyBatch});
    if(action?.type==='batch')return batch?batch(action,{room,member,serverSnapshot,applyBatch}):Response.json(applyBatch(action));
    if(action&&action.type!=='leave'){applyAction(room,member,action,Date.now());room.revision++;}
    return Response.json(serverSnapshot());
  },randomId,emit:(name,detail)=>{events.push({name,detail});if(name==='mobile:profile'&&detail?.energy!==undefined)energyState.energy=detail.energy;},hidden:()=>false,now:()=>Date.now(),performanceNow:()=>Date.now(),...(solo?{solo:{enabled:()=>solo!=='disabled',storage:store,energy:()=>energyState}}:{})};
  client=new RoomClient(ticket,deps);
  const table={network:null,networkReady:true,fit(){},cancelNetworkDrag(){},playConnectionSound:source=>sounds.push(source),syncRemote:(next,owners,protectedIds,feedback)=>{syncs.push({puzzle:structuredClone(next),owners,protectedIds,feedback});client.state=structuredClone(next);}};
  const detach=client.attach(table);t.after(detach);
  return {client,table,room,member,requests,events,syncs,sounds,store,energyState,applyBatch,serverSnapshot,detach,ticket,deps,batches:()=>requests.filter(r=>r.action?.type==='batch')};
}
const drop=async(f,id,dx=0,dy=0)=>{assert.equal(await f.table.network.acquire(id),true);await f.table.network.drop(id,dx,dy);};

test('300 deterministic drops match the authoritative engine without mutating their input',()=>{
  assert.equal(SOLO_ONLINE_MS,ONLINE_MS);
  const rand=random(237);let puzzle,room,member;
  const reset=seed=>{room=makeRoom(roomId,catalogImage,108,Date.now());room.puzzle=createPuzzle('seaside',12,9,seed);member=addMember(room,playerId,'玩家','digest',Date.now());puzzle=structuredClone(room.puzzle);};
  reset(123);
  for(let i=0;i<300;i++){
    if(i%60===0)reset(123+i);
    const loose=puzzle.groups.filter(g=>!g.locked);if(!loose.length)reset(i+1);
    const candidates=puzzle.groups.filter(g=>!g.locked),group=candidates[Math.floor(rand()*candidates.length)];
    let dx,dy;
    switch(i%5){
      case 0:dx=dy=0;break;
      case 1:dx=snapTolerance(puzzle)*.4;dy=-snapTolerance(puzzle)*.3;break;
      case 2:{const ids=neighbors(group.pieces[0],puzzle.cols,puzzle.rows);const neighbor=puzzle.groups.find(g=>g.id!==group.id&&g.pieces.some(id=>ids.includes(id)))??group;dx=neighbor.dx+.25;dy=neighbor.dy-.25;break;}
      case 3:dx=rand()*1200-600;dy=rand()*1000-500;break;
      default:dx=(rand()>.5?1:-1)*19000;dy=(rand()>.5?1:-1)*18000;
    }
    const before=structuredClone(puzzle),result=applySoloDrop(puzzle,{groupId:group.id,dx,dy});
    assert.deepEqual(puzzle,before,`input at drop ${i}`);
    applyAction(room,member,{type:'claim',groupId:group.id},Date.now());
    applyAction(room,member,{type:'drop',groupId:group.id,dx,dy,seq:1},Date.now());
    assert.equal(result.applied,true);assert.deepEqual(groups(result.puzzle),groups(room.puzzle),`drop ${i}`);puzzle=result.puzzle;
  }
  const missing=applySoloDrop(puzzle,{groupId:-1,dx:0,dy:0});assert.equal(missing.puzzle,puzzle);assert.equal(missing.applied,false);
  const locked={...puzzle,groups:[{id:0,pieces:[0],dx:0,dy:0,locked:true}]};assert.equal(applySoloDrop(locked,{groupId:0,dx:5,dy:5}).puzzle,locked);
});

test('presence boundaries, leases and energy prediction follow the protocol',()=>{
  const s={serverTime:50000,members:[{id:'other',lastSeen:28000}],leases:{}};
  assert.equal(otherPlayersPresent(s,playerId),false);s.members[0].lastSeen++;assert.equal(otherPlayersPresent(s,playerId),true);
  s.members[0].lastSeen=0;assert.equal(otherPlayersPresent(s,playerId),false);
  s.leases[0]={playerId:'other'};assert.equal(otherPlayersPresent(s,playerId),true);
  s.leases[0].playerId=playerId;assert.equal(otherPlayersPresent(s,playerId),false);
  assert.equal(soloCanAfford(null,100),true);
  const e={...energy(),energy:1};assert.equal(soloCanAfford(e,0),true);assert.equal(soloCanAfford(e,1),false);
  for(const change of [{enabled:false},{free:true},{cost:0},{autoSupply:true,supplyEnergy:2}])assert.equal(soloCanAfford({...e,...change},5),true);
  assert.equal(soloCanAfford({...e,autoSupply:true,supplyEnergy:1,cap:0},1),false);
});

test('local acquire and snap are immediate, followed by one debounced batch and one reward event',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const f=fixture(t);await until(()=>!f.client.polling);
  const before=f.requests.length;assert.equal(await f.table.network.acquire(0),true);assert.equal(f.requests.length,before);
  f.table.network.move(0,0,0);const pending=f.table.network.drop(0,0,0);
  assert.equal(f.syncs.at(-1).puzzle.groups.find(g=>g.id===0).locked,true);assert.equal(f.syncs.at(-1).feedback,true);
  assert.deepEqual(f.sounds,['local']);assert.equal(f.batches().length,0);await pending;
  const successes=()=>f.events.filter(e=>e.name==='puzzle:successful-drop');
  assert.equal(successes().length,1);assert.equal(successes()[0].detail.creditedXp,2);
  const opId=successes()[0].detail.requestId;
  assert.equal(loadSoloOutbox(f.store,roomId).ops[0].requestId,opId);
  t.mock.timers.tick(799);await turn();assert.equal(f.batches().length,0);
  t.mock.timers.tick(1);await until(()=>f.client.pendingSoloOps===0);
  assert.equal(f.batches().length,1);assert.equal('snapped' in f.batches()[0].action.ops[0],false);
  assert.equal(f.store.get(soloOutboxKey(roomId)),null);assert.equal(f.store.get(SOLO_INDEX_KEY),null);
  assert.equal(successes().length,1);assert.equal(f.sounds.length,1);
});

test('five quick drops batch together, and consecutive unsent non-snaps coalesce',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const f=fixture(t);await until(()=>!f.client.polling);
  for(let id=0;id<5;id++)await drop(f,id);
  assert.equal(f.client.pendingSoloOps,5);t.mock.timers.tick(800);await until(()=>!f.client.pendingSoloOps);
  assert.ok(f.batches().length<=2);assert.equal(f.batches()[0].action.ops.length,5);
  for(let i=0;i<3;i++)await drop(f,80,500+i*10,300);
  assert.equal(f.client.pendingSoloOps,1);assert.equal(loadSoloOutbox(f.store,roomId).ops[0].dx,520);
});

test('a foreign member blocks new pickups, lets the current drag end, and drains before server claims',async t=>{
  const reply=deferred(),f=fixture(t,{batch:async action=>{await reply.promise;return Response.json(f.applyBatch(action));}});
  await until(()=>!f.client.polling);await drop(f,0);assert.equal(await f.table.network.acquire(2),true);
  f.room.members.push({id:'d'.repeat(32),name:'朋友',color:'blue',lastSeen:Date.now(),joinedAt:Date.now(),digest:'other'});f.room.revision++;
  f.client.receive(f.serverSnapshot());assert.equal(f.table.network.canAcquire(3),false);assert.equal(f.batches().length,0);
  await f.table.network.drop(2,0,0);await until(()=>f.batches().length===1);
  assert.equal(f.client.localPlay,true);assert.equal(await f.table.network.acquire(3),false);
  reply.resolve();await until(()=>!f.client.localPlay);
  assert.equal(await f.table.network.acquire(3),true);assert.equal(f.requests.at(-1).action.type,'claim');f.table.network.release(3);
});

test('network failure keeps local input ready, persists ops, retries with backoff and restores after attach',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let failing=true;const f=fixture(t,{batch:async(action,{applyBatch})=>{if(failing)throw new TypeError('offline');return Response.json(applyBatch(action));}});
  await until(()=>!f.client.polling);await drop(f,0);f.client.flushSoloNow();await until(()=>f.client.soloFailures===1);
  assert.equal(f.client.connected,true);assert.equal(f.table.networkReady,true);await drop(f,2);
  assert.equal(loadSoloOutbox(f.store,roomId).ops.length,2);assert.equal(f.batches().length,1);
  f.client.fail(new TypeError('poll offline'));assert.equal(f.client.connected,true);assert.equal(f.table.networkReady,true);
  t.mock.timers.tick(1999);await turn();assert.equal(f.batches().length,1);
  failing=false;t.mock.timers.tick(1);await until(()=>f.client.pendingSoloOps===0);assert.equal(f.batches().length,2);
  failing=true;await drop(f,5);f.client.flushSoloNow();await until(()=>f.client.soloFailures===1);f.detach();
  const next=fixture(t,{store:f.store,ticket:{...f.ticket,token:'e'.repeat(32),room:f.serverSnapshot()},batch:async action=>Response.json(f.applyBatch(action))});
  assert.equal(next.client.pendingSoloOps,1);assert.equal(loadSoloOutbox(f.store,roomId).token,'e'.repeat(32));
  t.mock.timers.tick(0);await until(()=>!next.client.pendingSoloOps);assert.equal(next.batches().length,1);
  assert.equal(next.batches()[0].init.headers.Authorization,`Bearer ${'e'.repeat(32)}`);
});

test('predicted energy exhaustion flushes first and returns the second snap when the fresh profile is empty',async t=>{
  const f=fixture(t,{energyState:{...energy(),energy:1},batch:async(action,{applyBatch})=>{const reply=applyBatch(action);reply.profile.energy=0;return Response.json(reply);}});
  await until(()=>!f.client.polling);await drop(f,0);const before=structuredClone(f.client.state);
  await drop(f,2);assert.equal(f.batches().length,1);assert.equal(f.client.pendingSoloOps,0);
  assert.deepEqual(groups(f.client.state),groups(before));assert.equal(f.syncs.at(-1).feedback,false);
  assert.equal(f.events.filter(e=>e.name==='puzzle:successful-drop').length,1);
  assert.equal(f.events.filter(e=>e.name==='mobile:energy-empty').length,1);
  assert.equal(f.events.find(e=>e.name==='mobile:gameplay-error').detail.code,'ENERGY_EMPTY');
});

test('server energy stop discards the whole dependent tail, including newly queued ops, and rebases the view',async t=>{
  const reply=deferred();const f=fixture(t,{batch:async action=>{await reply.promise;const first=f.applyBatch({...action,ops:action.ops.slice(0,1)});return Response.json({...first,soloBatch:{applied:[action.ops[0].requestId],skipped:[],stopped:{requestId:action.ops[1].requestId,code:'ENERGY_EMPTY',message:'体力不足'}}});}});
  await until(()=>!f.client.polling);await drop(f,0);await drop(f,2);f.client.flushSoloNow();await until(()=>f.batches().length===1);
  await drop(f,4);assert.equal(f.client.pendingSoloOps,3);reply.resolve();await until(()=>!f.client.pendingSoloOps);
  assert.deepEqual(groups(f.client.state),groups(f.room.puzzle));assert.equal(f.client.state.groups.find(g=>g.id===4).locked,false);
  assert.equal(f.events.filter(e=>e.name==='mobile:energy-empty').length,1);assert.equal(f.store.get(soloOutboxKey(roomId)),null);
});

test('in-flight ops cannot coalesce and overtaking polls cannot overwrite the optimistic board',async t=>{
  const reply=deferred(),f=fixture(t,{batch:async action=>{await reply.promise;return Response.json(f.applyBatch(action));}});
  await until(()=>!f.client.polling);await drop(f,80,500,300);f.client.flushSoloNow();await until(()=>f.batches().length===1);
  const inFlight=f.batches()[0].action.ops[0].requestId;
  await drop(f,80,520,300);assert.equal(f.client.pendingSoloOps,2);assert.equal(loadSoloOutbox(f.store,roomId).ops[0].requestId,inFlight);
  const before=f.syncs.length;f.client.receive({...f.serverSnapshot(),revision:5});assert.equal(f.syncs.length,before);assert.equal(f.client.state.groups.find(g=>g.id===80).dx,520);
  f.room.revision=5;reply.resolve();await until(()=>f.client.pendingSoloOps===1);
  assert.equal(f.client.state.groups.find(g=>g.id===80).dx,520);
  f.client.flushSoloNow();await until(()=>!f.client.pendingSoloOps);
});

test('outbox validation and unavailable storage are safe',()=>{
  const store=storage(),op={requestId:randomId(),groupId:0,dx:5,dy:10,snapped:false};
  const box={v:1,roomId,playerId,token,ops:[op],savedAt:Date.now()};saveSoloOutbox(store,box);
  assert.deepEqual(loadSoloOutbox(store,roomId),box);assert.equal(listSoloOutboxes(store).length,1);
  for(const bad of ['{',JSON.stringify({...box,token:'bad'}),JSON.stringify({...box,ops:[{...op,dx:Infinity}]}),JSON.stringify({...box,ops:[{...op,snapped:1}]}),JSON.stringify({...box,ops:[op,op]})]){
    store.set(soloOutboxKey(roomId),bad);assert.equal(loadSoloOutbox(store,roomId),null);assert.equal(store.get(SOLO_INDEX_KEY),null);
    saveSoloOutbox(store,box);
  }
  saveSoloOutbox(store,{...box,ops:[]});assert.equal(store.values.size,0);
  const unavailable={get(){throw Error('denied');},set(){throw Error('full');},remove(){throw Error('denied');}};
  assert.doesNotThrow(()=>saveSoloOutbox(unavailable,box));assert.doesNotThrow(()=>saveSoloOutbox(unavailable,{...box,ops:[]}));assert.equal(loadSoloOutbox(unavailable,roomId),null);assert.deepEqual(listSoloOutboxes(unavailable),[]);
});

test('launch recovery chunks sequentially, honors skip/expiry, clears revoked rooms and preserves network failures',async()=>{
  const store=storage(),now=Date.now(),makeBox=(id,n=1)=>({v:1,roomId:id,playerId,token,ops:Array.from({length:n},(_,groupId)=>({requestId:randomId(),groupId,dx:5,dy:5,snapped:false})),savedAt:now});
  const good=makeBox(roomId,SOLO_BATCH_MAX+1),gone=makeBox('d'.repeat(32)),offline=makeBox('e'.repeat(32)),skip=makeBox('f'.repeat(32)),old={...makeBox('1'.repeat(32)),savedAt:now-8*86400000};
  for(const box of [good,gone,offline,skip,old])saveSoloOutbox(store,box);
  const calls=[];let active=0;
  const summary=await flushStoredSoloOutboxes({storage:store,now:()=>now,randomId,skipRoomId:skip.roomId,fetch:async(url,init)=>{
    assert.equal(active++,0);try{await turn();const action=JSON.parse(init.body);calls.push({url,init,action});assert.equal(action.type,'batch');assert.equal(init.headers.Authorization,`Bearer ${token}`);assert.ok(action.ops.length<=40);assert.equal('snapped' in action.ops[0],false);
      if(url.endsWith(gone.roomId))return Response.json({}, {status:410});if(url.endsWith(offline.roomId))throw Error('offline');
      return Response.json({soloBatch:{applied:action.ops.map(op=>op.requestId),skipped:[],stopped:null}});
    }finally{active--;}
  }});
  assert.deepEqual(summary,{flushed:1,removed:2,failed:1,skipped:1});assert.equal(calls.length,4);
  assert.deepEqual(listSoloOutboxes(store).map(box=>box.roomId),[offline.roomId,skip.roomId]);
});

test('launch recovery removes skipped ops and the stopped tail, and does not loop on malformed receipts',async()=>{
  const store=storage(),ops=Array.from({length:5},(_,groupId)=>({requestId:randomId(),groupId,dx:0,dy:0,snapped:true}));
  saveSoloOutbox(store,{v:1,roomId,playerId,token,ops,savedAt:Date.now()});
  const result=await flushStoredSoloOutboxes({storage:store,now:()=>Date.now(),randomId,fetch:async()=>Response.json({soloBatch:{applied:[ops[0].requestId],skipped:[{requestId:ops[1].requestId,code:'CONFLICT'}],stopped:{requestId:ops[2].requestId,code:'ENERGY_EMPTY'}}})});
  assert.equal(result.flushed,1);assert.equal(listSoloOutboxes(store).length,0);
  saveSoloOutbox(store,{v:1,roomId,playerId,token,ops,savedAt:Date.now()});
  const failed=await flushStoredSoloOutboxes({storage:store,now:()=>Date.now(),randomId,fetch:async()=>Response.json({soloBatch:{applied:[],skipped:[],stopped:null}})});
  assert.equal(failed.failed,1);assert.equal(loadSoloOutbox(store,roomId).ops.length,5);
});

for(const config of [{solo:false},{solo:'disabled'},{diagnostic:true}])test(`server claim behavior is preserved with ${JSON.stringify(config)}`,async t=>{
  const f=fixture(t,config);await until(()=>!f.client.polling);assert.equal(f.client.localPlay,false);
  assert.equal(await f.table.network.acquire(0),true);assert.equal(f.requests.at(-1).action.type,'claim');f.table.network.release(0);
});

test('organize drains local ops before shuffle and refuses an active local drag',async t=>{
  const f=fixture(t);f.room.visibility='solo';f.room.ownerId='account';f.member.accountId='account';
  await until(()=>!f.client.polling);assert.equal(await f.table.network.acquire(0),true);
  await assert.rejects(f.client.organize(),/先放下/);f.table.network.release(0);
  await drop(f,80,500,300);await f.client.organize();
  assert.deepEqual(f.requests.filter(r=>['batch','shuffle'].includes(r.action?.type)).map(r=>r.action.type),['batch','shuffle']);
  assert.equal(f.client.pendingSoloOps,0);assert.equal(f.client.localPlay,true);
});

test('leave flushes persisted drops with keepalive before the leave request',async t=>{
  const f=fixture(t);await until(()=>!f.client.polling);await drop(f,0);f.client.leave();
  await until(()=>f.requests.some(r=>r.action?.type==='leave'));
  const actions=f.requests.filter(r=>['batch','leave'].includes(r.action?.type));assert.deepEqual(actions.map(r=>r.action.type),['batch','leave']);
  assert.equal(actions[0].init.keepalive,true);assert.equal(f.client.pendingSoloOps,0);assert.equal(f.store.get(soloOutboxKey(roomId)),null);
});

test('continuous drops cannot defer the first batch beyond three seconds',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const f=fixture(t);await until(()=>!f.client.polling);await drop(f,80,500,300);
  for(let i=1;i<=4;i++){t.mock.timers.tick(700);await turn();await drop(f,80,500+i*10,300);}
  assert.equal(f.batches().length,0);t.mock.timers.tick(199);await turn();assert.equal(f.batches().length,0);
  t.mock.timers.tick(1);await until(()=>!f.client.pendingSoloOps);assert.equal(f.batches().length,1);
});

test('25 unsent ops trigger an immediate flush, and the pending queue has a hard limit',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const f=fixture(t);await until(()=>!f.client.polling);
  for(let id=0;id<25;id++)await drop(f,id);
  t.mock.timers.tick(0);await until(()=>!f.client.pendingSoloOps);assert.equal(f.batches()[0].action.ops.length,25);
  f.client.soloOps=Array.from({length:SOLO_MAX_PENDING},(_,i)=>({requestId:randomId(),groupId:80,dx:500+i%3,dy:300,snapped:false}));
  assert.equal(f.table.network.canAcquire(80),false);assert.equal(await f.table.network.acquire(80),false);
});

test('a completing drop flushes immediately and returns to the completed server view',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const f=fixture(t);await until(()=>!f.client.polling);
  for(const group of f.room.puzzle.groups)if(group.id!==0){group.dx=0;group.dy=0;group.locked=true;}
  f.room.revision++;f.client.receive(f.serverSnapshot());await drop(f,0);
  assert.equal(f.batches().length,0);t.mock.timers.tick(0);await until(()=>!f.client.localPlay);
  assert.equal(f.batches().length,1);assert.notEqual(f.client.snapshot.completedAt,null);
});

test('429 honors Retry-After while another player is waiting for the pending queue',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let attempts=0;const f=fixture(t,{batch:async(action,{applyBatch})=>++attempts===1?Response.json({error:'busy'},{status:429,headers:{'Retry-After':'5'}}):Response.json(applyBatch(action))});
  await until(()=>!f.client.polling);await drop(f,0);
  // Isolate the exit/flush retry clock from the independently tested poll loop.
  clearTimeout(f.client.pollTimer);
  f.room.members.push({id:'d'.repeat(32),name:'朋友',color:'blue',lastSeen:Date.now()});f.room.revision++;
  f.client.receive(f.serverSnapshot());await until(()=>f.client.soloFailures===1);
  assert.equal(f.client.localPlay,true);assert.equal(f.table.network.canAcquire(2),false);
  t.mock.timers.tick(4999);await turn();assert.equal(attempts,1);
  t.mock.timers.tick(1);await until(()=>!f.client.localPlay);assert.equal(attempts,2);
});

for(const [status,code] of [[400,'INVALID_BATCH'],[404],[410]])test(`batch HTTP ${status} ${code??''} clears unrecoverable ops`,async t=>{
  const f=fixture(t,{batch:async()=>Response.json({error:'rejected',code},{status})});
  await until(()=>!f.client.polling);await drop(f,0);f.client.flushSoloNow();await until(()=>!f.client.flushing);
  assert.equal(f.client.pendingSoloOps,0);assert.equal(f.store.get(soloOutboxKey(roomId)),null);
  if(status===400||status===409){assert.equal(f.client.localPlay,true);assert.deepEqual(groups(f.client.state),groups(f.room.puzzle));assert.equal(f.requests.at(-1).action,null);}
  else{assert.equal(f.client.localPlay,false);assert.equal(f.client.connected,false);assert.equal(f.table.networkReady,false);}
});

for(const status of [400,401,403,409,422])test(`batch HTTP ${status} preserves every pending op and backs off`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const reply=deferred(),f=fixture(t,{batch:async()=>{await reply.promise;return Response.json({error:'rejected'},{status});}});
  await until(()=>!f.client.polling);clearTimeout(f.client.pollTimer);
  await drop(f,0);await drop(f,2);f.client.flushSoloNow();await until(()=>f.batches().length===1);
  await drop(f,4);const saved=loadSoloOutbox(f.store,roomId);reply.resolve();await until(()=>!f.client.flushing);
  assert.equal(f.client.pendingSoloOps,3);assert.deepEqual(loadSoloOutbox(f.store,roomId),saved);
  assert.equal(f.client.localPlay,false);assert.equal(f.client.soloFailures,1);assert.equal(f.client.soloRetryAt,102000);
  assert.equal(f.client.message,'rejected');
  const rejoins=()=>f.events.filter(e=>e.name==='room:rejoin-required');
  assert.deepEqual(rejoins(),status===401||status===403?[{name:'room:rejoin-required',detail:{roomId}}]:[]);
  t.mock.timers.tick(1999);await turn();assert.equal(f.batches().length,1);
  t.mock.timers.tick(1);await until(()=>!f.client.flushing);assert.equal(f.batches().length,2);
  assert.deepEqual(loadSoloOutbox(f.store,roomId),saved);assert.equal(f.client.soloFailures,2);
  assert.equal(rejoins().length,status===401||status===403?1:0);
});

test('a new player identity adopts the room outbox and flushes with the current ticket',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const store=storage(),op={requestId:randomId(),groupId:0,dx:0,dy:0,snapped:true};
  saveSoloOutbox(store,{v:1,roomId,playerId,token,ops:[op],savedAt:Date.now()});
  const nextPlayer='d'.repeat(32),nextToken='e'.repeat(32),room=makeRoom(roomId,catalogImage,108,Date.now());
  addMember(room,nextPlayer,'我','new-digest',Date.now());
  const f=fixture(t,{store,ticket:{playerId:nextPlayer,token:nextToken,room:snapshot(room,Date.now())}});
  const adopted=loadSoloOutbox(store,roomId);
  assert.equal(f.client.pendingSoloOps,1);assert.equal(adopted.playerId,nextPlayer);assert.equal(adopted.token,nextToken);assert.deepEqual(adopted.ops,[op]);
  t.mock.timers.tick(0);await until(()=>!f.client.pendingSoloOps);
  assert.equal(f.batches()[0].init.headers.Authorization,`Bearer ${nextToken}`);assert.equal(store.get(soloOutboxKey(roomId)),null);
});

for(const heartbeatStatus of [200,409,401])test(`stale room heartbeat ${heartbeatStatus} precedes any batch and preserves ops on refusal`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let stale=false;
  const f=fixture(t,{fetchOverride:async(action,{serverSnapshot,applyBatch})=>{
    if(stale&&action?.type==='heartbeat'&&heartbeatStatus!==200)return Response.json({error:'seat refused'},{status:heartbeatStatus});
    return Response.json(action?.type==='batch'?applyBatch(action):serverSnapshot());
  }});
  await until(()=>!f.client.polling);clearTimeout(f.client.pollTimer);await drop(f,0);await drop(f,2);
  const saved=loadSoloOutbox(f.store,roomId),start=f.requests.length;
  stale=true;f.client.receivedAt=Date.now()-15001;f.client.flushSoloNow();await until(()=>!f.client.flushing);
  assert.deepEqual(f.requests.slice(start).map(r=>r.action?.type),heartbeatStatus===200?['heartbeat','batch']:['heartbeat']);
  assert.equal(f.client.pendingSoloOps,heartbeatStatus===200?0:2);
  if(heartbeatStatus===200)assert.equal(f.store.get(soloOutboxKey(roomId)),null);
  else{assert.deepEqual(loadSoloOutbox(f.store,roomId),saved);assert.equal(f.client.soloFailures,1);assert.equal(f.client.localPlay,false);}
});

test('a stopped client acknowledged late only prunes its own ops from a replacement outbox',async t=>{
  const reply=deferred(),f=fixture(t,{batch:async action=>{await reply.promise;return Response.json(f.applyBatch(action));}});
  await until(()=>!f.client.polling);await drop(f,0);const sentOp=loadSoloOutbox(f.store,roomId).ops[0];f.client.leave();await until(()=>f.batches().length===1);
  const newer={requestId:randomId(),groupId:2,dx:0,dy:0,snapped:true},replacement={v:1,roomId,playerId:'d'.repeat(32),token:'e'.repeat(32),ops:[sentOp,newer],savedAt:Date.now()};
  saveSoloOutbox(f.store,replacement);reply.resolve();await until(()=>f.requests.some(r=>r.action?.type==='leave'));
  const kept=loadSoloOutbox(f.store,roomId);assert.deepEqual(kept.ops,[newer]);assert.equal(kept.token,replacement.token);assert.equal(kept.playerId,replacement.playerId);
});

for(const status of [400,401,403,404,409,410,500])test(`stopped batch HTTP ${status} cannot rewrite a replacement client's outbox`,async t=>{
  const reply=deferred(),f=fixture(t,{batch:async()=>{await reply.promise;return Response.json({error:'rejected',code:'SOLO_BATCH_DISABLED'},{status});}});
  await until(()=>!f.client.polling);await drop(f,0);f.client.leave();await until(()=>f.batches().length===1);
  const replacement={v:1,roomId,playerId:'d'.repeat(32),token:'e'.repeat(32),ops:[{requestId:randomId(),groupId:2,dx:0,dy:0,snapped:true}],savedAt:Date.now()};
  saveSoloOutbox(f.store,replacement);reply.resolve();await until(()=>f.requests.some(r=>r.action?.type==='leave'));
  assert.deepEqual(loadSoloOutbox(f.store,roomId),replacement);
  assert.equal(f.events.some(e=>e.name==='room:rejoin-required'),false);assert.equal(f.client.soloFailures,0);
});

for(const status of [401,403,410])test(`launch recovery HTTP ${status} only removes a gone room`,async()=>{
  const store=storage(),box={v:1,roomId,playerId,token,ops:[{requestId:randomId(),groupId:0,dx:0,dy:0,snapped:true}],savedAt:Date.now()};
  saveSoloOutbox(store,box);let calls=0;
  const summary=await flushStoredSoloOutboxes({storage:store,now:()=>Date.now(),randomId,fetch:async()=>{calls++;return Response.json({},{status});}});
  assert.equal(calls,1);assert.deepEqual(summary,{flushed:0,removed:status===410?1:0,failed:0,skipped:status===410?0:1});
  assert.deepEqual(loadSoloOutbox(store,roomId),status===410?null:box);
});

test('loaded ops drain before claims when a peer is already online',async t=>{
  const store=storage(),reply=deferred(),op={requestId:randomId(),groupId:0,dx:0,dy:0,snapped:true};
  saveSoloOutbox(store,{v:1,roomId,playerId,token,ops:[op],savedAt:Date.now()});
  const room=makeRoom(roomId,catalogImage,108,Date.now());room.puzzle=createPuzzle('seaside',12,9,123);
  addMember(room,playerId,'玩家','digest',Date.now());addMember(room,'d'.repeat(32),'朋友','other',Date.now());
  const f=fixture(t,{store,ticket:{token,playerId,room:snapshot(room,Date.now())},batch:async(action,{applyBatch})=>{await reply.promise;const data=applyBatch(action);data.members=snapshot(room,Date.now()).members;return Response.json(data);}});
  // Keep polls consistent with the joined peer during the controlled ACK.
  f.room.members=room.members;await until(()=>f.batches().length===1);
  assert.equal(f.client.localPlay,true);assert.equal(f.table.network.canAcquire(2),false);
  reply.resolve();await until(()=>!f.client.localPlay);assert.equal(f.client.pendingSoloOps,0);
});

test('an already completed room still drains a recovered outbox without local feedback',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const store=storage(),op={requestId:randomId(),groupId:0,dx:0,dy:0,snapped:true};
  saveSoloOutbox(store,{v:1,roomId,playerId,token,ops:[op],savedAt:Date.now()});
  const room=makeRoom(roomId,catalogImage,108,Date.now());room.completedAt=Date.now();
  const f=fixture(t,{store,ticket:{token,playerId,room:snapshot(room,Date.now())},fetchOverride:async action=>Response.json({...snapshot(room,Date.now()),...(action?.type==='batch'?{soloBatch:{applied:[op.requestId],skipped:[],stopped:null}}:{})})});
  t.mock.timers.tick(0);await until(()=>!f.client.pendingSoloOps);
  assert.equal(f.client.localPlay,false);assert.equal(f.batches().length,1);assert.equal(f.sounds.length,0);
});

test('leave times out at three seconds, keeps the outbox, and sends no later chunks',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  const reply=deferred(),f=fixture(t,{batch:async(action,{applyBatch})=>{await reply.promise;return Response.json(applyBatch(action));}});
  await until(()=>!f.client.polling);
  // More than one batch is pending when the slow first request reaches the deadline.
  for(let id=0;id<45;id++)await drop(f,id);f.client.leave();await until(()=>f.batches().length===1);
  t.mock.timers.tick(2999);await turn();assert.equal(f.requests.some(r=>r.action?.type==='leave'),false);
  t.mock.timers.tick(1);await until(()=>f.requests.some(r=>r.action?.type==='leave'));
  assert.equal(loadSoloOutbox(f.store,roomId).ops.length,45);reply.resolve();await until(()=>!f.client.flushing);
  assert.equal(f.batches().length,1);assert.equal(loadSoloOutbox(f.store,roomId).ops.length,5);
  t.mock.timers.tick(20000);await turn();assert.equal(f.batches().length,1);
});

test('a server kill switch returns the room to server drags instead of discarding later drops',async t=>{
  const f=fixture(t,{batch:async()=>Response.json({error:'disabled',code:'SOLO_BATCH_DISABLED'},{status:409})});
  await until(()=>!f.client.polling);await drop(f,0);f.client.flushSoloNow();await until(()=>!f.client.flushing);
  assert.equal(f.client.localPlay,false);assert.equal(f.client.pendingSoloOps,0);assert.equal(f.store.get(soloOutboxKey(roomId)),null);
  assert.deepEqual(groups(f.client.state),groups(f.room.puzzle));
  f.client.receive(f.serverSnapshot(),true);assert.equal(f.client.localPlay,false);
  assert.equal(await f.table.network.acquire(1),true);assert.equal(f.requests.at(-1).action.type,'claim');f.table.network.release(1);
  assert.equal(f.batches().length,1);
});
