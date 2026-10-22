import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {WebSocket} from 'ws';
import {GameClient} from '../mobile/client.ts';
import {RoomClient} from '../lib/room-client.ts';
import {applyAction} from '../lib/room-engine.ts';
import {createMobileService} from '../server/mobile-service.mjs';

const origin='https://ma-h5-al.tapimg.com',rid=()=>randomBytes(16).toString('hex'),now=1800000000000;
const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<end,'timed out waiting for normal-room HTTP/WS transport');await new Promise(resolve=>setTimeout(resolve,5));}};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

// Choose two ordinary moves that do not accidentally connect to scattered
// neighbours. The first target deliberately completes exactly one piece.
function targetsFor(room,playerId){
 let simulated=structuredClone(room);const targets=[];
 const execute=(value,groupId,dx,dy)=>{const member=value.members.find(member=>member.id===playerId);applyAction(value,member,{type:'claim',groupId},now);applyAction(value,member,{type:'drop',groupId,seq:1,dx,dy},now);};
 const first=simulated.puzzle.groups.find(group=>!group.locked).id;execute(simulated,first,0,0);assert.equal(simulated.puzzle.groups.find(group=>group.id===first).locked,true);targets.push({id:first,dx:0,dy:0});
 for(let n=0;n<2;n++){
  const group=simulated.puzzle.groups.find(group=>!group.locked&&!targets.some(target=>target.id===group.id));let found=false;
  for(const dx of [-600,-300,300,600]){for(const dy of [-500,-250,250,500]){
   const trial=structuredClone(simulated);execute(trial,group.id,dx,dy);const after=trial.puzzle.groups.find(value=>value.id===group.id);
   if(after&&!after.locked&&after.pieces.length===group.pieces.length&&trial.puzzle.groups.length===simulated.puzzle.groups.length){targets.push({id:group.id,dx:after.dx,dy:after.dy});simulated=trial;found=true;break;}
  }if(found)break;}
  assert.equal(found,true,'must find a normal nonconnecting drop for this real scatter');
 }
 return targets;
}

test('ordinary 48-piece rooms pipeline real WS writes, enforce two-player claims, and apply one authoritative reward/profile without HTTP drags',async t=>{
 const dir=mkdtempSync(resolve('work/room-action-http-ws-')),bundle=resolve(dir,'gateway.mjs');
 const built=await build({entryPoints:[resolve('server/h5-gateway.mjs')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'current-room-action-hub',setup(builder){
  builder.onResolve({filter:/^\.\.\/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve('server/room-realtime.mjs')}));
  builder.onResolve({filter:/^\.\/mobile-service\.mjs$/},args=>args.importer.endsWith('h5-gateway.mjs')?{path:pathToFileURL(resolve('server/mobile-service.mjs')).href,external:true}:undefined);
 }}],metafile:true});
 assert.ok(Object.keys(built.metafile.inputs).some(path=>path.replaceAll('\\','/').endsWith('server/room-realtime.mjs')),'use source hub rather than stale generated output');
 const {createH5Gateway}=await import(pathToFileURL(bundle).href);
 const service=createMobileService({databasePath:':memory:',now:()=>now,tapTap:{exchangeCode:async code=>({openid:'normal-room-integration-'+code})}});
 const gateway=createH5Gateway({upstream:'http://127.0.0.1',databasePath:resolve(dir,'sessions.sqlite'),allowedOrigins:[origin],mobileService:service});
 const players=[],sockets=[];
 t.after(async()=>{
  for(const player of players){player.detach?.();player.stream?.close();}for(const socket of sockets)socket.terminate();gateway.realtime.close();await new Promise(resolve=>gateway.close(resolve));
  assert.ok(dir.startsWith(resolve('work')+sep));rmSync(dir,{recursive:true,force:true});
 });
 await listen(gateway);const base='http://127.0.0.1:'+gateway.address().port+'/h5';
 function player(name){
  const storage=new Map(),p={name,requests:[],outgoing:[],incoming:[],held:[],hold:false,events:[]};
  const platform={config:{id:'taptap',apiBase:base,assetBase:base+'/assets',gameName:'normal room integration'},randomId:rid,
   storage:{get:key=>storage.get(key)||null,set:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key)},tapTapIdentity:async()=>({code:name,nickname:name}),
   request:async input=>{p.requests.push(input);const response=await fetch(input.url,{method:input.method||'GET',headers:{Origin:origin,...input.headers},body:input.body===undefined?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body)});return {status:response.status,data:await response.json(),headers:Object.fromEntries(response.headers)};},
   openSocket:(url,handlers)=>{const socket=new WebSocket(url,{headers:{Origin:origin}});sockets.push(socket);socket.on('open',handlers.open);socket.on('message',bytes=>{const raw=bytes.toString(),frame=JSON.parse(raw);p.incoming.push(frame);if(p.hold&&frame.type==='action-result')p.held.push(()=>handlers.message(raw));else handlers.message(raw);});socket.on('error',handlers.error);socket.on('close',handlers.close);return {send:raw=>{p.outgoing.push(JSON.parse(raw));socket.send(raw);},close:()=>socket.close()};},
  };
  p.game=new GameClient(platform);players.push(p);return p;
 }
 const owner=player('owner'),peer=player('peer');await owner.game.start();await peer.game.start();assert.equal(owner.game.profile.taptap.bound,true);assert.equal(peer.game.profile.taptap.bound,true);
 // Preserve the actual first-room protection rule by using a different room
 // for this paid-contribution check instead of mutating a test player's wallet.
 await owner.game.createRoom({mode:'random',pieces:48,visibility:'public'});await peer.game.createRoom({mode:'random',pieces:48,visibility:'public'});
 const ticket=await owner.game.createRoom({mode:'random',pieces:48,visibility:'public'}),peerTicket=await peer.game.joinRoom(ticket.room.id);
 assert.equal(ticket.room.requestedPieces,48);assert.ok(ticket.room.puzzle.cols*ticket.room.puzzle.rows>=48&&ticket.room.puzzle.cols*ticket.room.puzzle.rows<=55,'48-piece option keeps the existing photo-fitted grid');assert.notEqual(owner.game.profile.firstRoomId,ticket.room.id);assert.notEqual(peer.game.profile.firstRoomId,ticket.room.id);assert.notEqual(ticket.room.diagnostic,true);
 for(const [p,admission] of [[owner,ticket],[peer,peerTicket]]){
  p.ticket=admission;p.stream=p.game.roomRealtime(admission,()=>p.client?.snapshot.revision??admission.room.revision);assert.ok(p.stream);
  p.client=new RoomClient(admission,{fetch:p.game.fetchLike,realtime:p.stream,randomId:rid,hidden:()=>false,profile:data=>p.game.acceptRoomResponse(admission,data),emit:(name,data)=>p.events.push({name,data})});
  p.table={cancelNetworkDrag(){},playConnectionSound(){},syncRemote(next,_owners,protectedIds){const local=new Map(p.client.state.groups.map(group=>[group.id,group]));p.client.state.groups=next.groups.map(group=>structuredClone(protectedIds.has(group.id)&&local.has(group.id)?local.get(group.id):group));}};
  p.detach=p.client.attach(p.table);p.stream.start();
 }
 await until(()=>owner.stream.actionsReady&&peer.stream.actionsReady);for(const p of players){assert.equal(p.stream.actionsDiagnosticOnly,false);assert.deepEqual(p.incoming.find(frame=>frame.type==='ready').actions,{version:1,diagnosticOnly:false});}
 const contested=ticket.room.puzzle.groups.at(-1).id;assert.equal(await owner.table.network.acquire(contested),true);assert.equal(await peer.table.network.acquire(contested),false);
 assert.equal(peer.client.connected,true,'a denied claim is a gameplay conflict, not a lost connection');assert.ok(peer.incoming.some(frame=>frame.type==='action-result'&&frame.status===409));
 owner.table.network.release(contested);await until(()=>!owner.client.snapshot.leases[contested]);
 const before=structuredClone(owner.game.profile),peerBefore=structuredClone(peer.game.profile),targets=targetsFor(owner.client.snapshot,ticket.playerId),gestures=[];
 const sentBefore=owner.outgoing.filter(frame=>frame.type==='action').length;owner.hold=true;
 for(const target of targets){
  assert.equal(owner.table.network.canAcquire(target.id),true);const granted=owner.table.network.acquire(target.id);Object.assign(owner.client.state.groups.find(group=>group.id===target.id),{dx:target.dx,dy:target.dy});gestures.push({granted,finished:owner.table.network.drop(target.id,target.dx,target.dy)});
 }
 const writes=owner.outgoing.filter(frame=>frame.type==='action').slice(sentBefore);assert.deepEqual(writes.map(frame=>frame.action.type),['claim','drop','claim','drop','claim','drop']);assert.equal(owner.stream.pendingActionCount,6,'six frames must be sent before delivering any ACK');
 await until(()=>owner.held.length===6);const rewardAck=owner.incoming.find(frame=>frame.type==='action-result'&&frame.id===writes[1].id);assert.equal(rewardAck.status,200);assert.equal(rewardAck.data.mobileContribution.requestId,writes[1].id);
 assert.equal(owner.game.profile.totalXp,before.totalXp,'withheld ACK must not predict an award');
 owner.hold=false;for(const deliver of owner.held.splice(0))deliver();assert.deepEqual(await Promise.all(gestures.map(value=>value.granted)),[true,true,true]);await Promise.all(gestures.map(value=>value.finished));
 const immediate=structuredClone(owner.game.profile),receipt=rewardAck.data.mobileContribution;
 assert.equal(immediate.totalXp,before.totalXp+before.economy.contributionXp);assert.equal(immediate.lastReward.energySpent,before.economy.contributionCost);
 const levels=immediate.level-before.level,spent=before.energy-before.economy.contributionCost;
 const expectedEnergy=levels&&before.economy.upgradeRefill==='full'?Math.max(spent,immediate.energyCap):spent+(levels&&before.economy.upgradeRefill==='fixed'?levels*before.economy.upgradeEnergy:0);
 assert.equal(immediate.energy,expectedEnergy,'contribution cost and any existing level-up refill apply together');assert.equal(immediate.giftProgress,before.giftProgress+1);assert.equal(immediate.collection.coins,before.collection.coins+receipt.creditedCoins);
 assert.deepEqual(immediate,rewardAck.data.profile,'all subsequent ACK profiles retain the same authoritative resource state');
 assert.equal(owner.events.filter(event=>event.name==='puzzle:successful-drop').length,1);assert.equal(owner.events.find(event=>event.name==='puzzle:successful-drop').data.requestId,writes[1].id);
 assert.equal(peer.game.profile.totalXp,peerBefore.totalXp);assert.equal(peer.game.profile.energy,peerBefore.energy);
 const authority=await owner.game.json('/api/rooms/'+ticket.room.id,'GET',undefined,{Authorization:'Bearer '+ticket.token});assert.equal(authority.puzzle.groups.find(group=>group.id===targets[0].id).locked,true);assert.deepEqual(owner.client.state.groups,authority.puzzle.groups);
 const replay=await owner.stream.sendAction(writes[1]);assert.equal(replay.status,200);assert.equal(replay.data.mobileContribution,undefined,'receipt replay must not emit another contribution');owner.game.acceptRoomResponse(ticket,replay.data);
 const after=await owner.game.refresh();for(const key of ['energy','level','xp','totalXp','giftProgress','giftCount','supply','collection','lastReward'])assert.deepEqual(after[key],immediate[key],key+' changed after the exact same write receipt was replayed');
 for(const p of players){const httpDrags=p.requests.filter(input=>input.method==='POST'&&/\/api\/rooms\/[a-f0-9]{32}(?:\?|$)/.test(input.url)).map(input=>typeof input.body==='string'?JSON.parse(input.body):input.body).filter(body=>['claim','move','drop','release'].includes(body?.type));assert.equal(httpDrags.length,0,'ordinary room dragging must not silently use HTTP');}
});
