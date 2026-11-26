import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
const sid=name=>createHash('sha256').update(name).digest('hex');

function setup(t){
 mkdirSync(resolve('work'),{recursive:true});
 const dir=mkdtempSync(resolve('work/ws-taptap-id-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=1800000000000;
 const service=createMobileService({
  databasePath,
  now:()=>now,
  randomInt:min=>min,
  tapMultiplayerEnabled:true,
  tapTap:{exchangeCode:async code=>({openid:'openid-'+code})},
  publicTestPolicy:{privateMessages:false,customNames:false},
 });
 t.after(()=>{service.close();rmSync(dir,{recursive:true,force:true});});
 const call=(identity,path,body,token)=>service.handle({
  identity,
  method:body===undefined?'GET':'POST',
  url:path,
  body:body===undefined?undefined:{requestId:rid(),...body},
  authorization:token?'Bearer '+token:undefined,
  artworkSnapshot:true,
 });
 return {service,call,advance:(ms=1000)=>now+=ms};
}

test('realtime WebSocket resolves bound TapTap session identity to canonical identity and still rejects strangers',async t=>{
 const f=setup(t),sessionA=sid('device-a'),sessionB=sid('device-b'),stranger=sid('stranger');

 // Bind TapTap account on device A first (establishes canonical identity = sessionA).
 const bindA=await f.service.bindTapTap({identity:sessionA,code:'user1',nickname:'小蜗'});
 assert.equal(bindA.status,200);
 // Bind the SAME TapTap account on a fresh device/session B (sessionB -> canonical sessionA).
 const bindB=await f.service.bindTapTap({identity:sessionB,code:'user1',nickname:'小蜗'});
 assert.equal(bindB.status,200);

 // Device B creates a private room (so inviteCode checks canonical owner identity too).
 const created=f.call(sessionB,'/api/rooms',{mode:'random',pieces:48,visibility:'private'});
 assert.equal(created.status,201);
 const {room,token}=created.data;

 // Subscribe to realtime WebSocket using raw sessionB (as h5-gateway passes session.key).
 const ctx=f.service.realtime.subscribe({roomId:room.id,identity:sessionB,authorization:'Bearer '+token,artworkSnapshot:true});
 assert.equal(ctx.identity,sessionA,'realtime context resolves to canonical TapTap identity');

 // readRoom returns full snapshot including owner inviteCode.
 const snap=f.service.realtime.readRoom(ctx,null);
 assert.equal(snap.id,room.id);
 assert.equal(snap.inviteCode,created.data.inviteCode,'owner inviteCode matches canonical identity');

 // writeCursor and writeAction work over the realtime context without ROOM_IDENTITY_MISMATCH.
 f.service.realtime.writeCursor(ctx,{clientId:rid(),seq:1,point:{x:100,y:200}});
 assert.equal(f.service.realtime.readCursors(ctx).cursors.length,1);
 const group=room.puzzle.groups[0];
 const claim=f.service.realtime.writeAction(ctx,{id:rid(),clientId:rid(),gestureId:rid(),ordinal:1,since:snap.revision,action:{type:'claim',groupId:group.id}});
 assert.equal(claim.status,200);

 // A different player using device B's room token is still rejected with ROOM_IDENTITY_MISMATCH.
 assert.throws(
  ()=>f.service.realtime.subscribe({roomId:room.id,identity:stranger,authorization:'Bearer '+token,artworkSnapshot:true}),
  err=>err.code==='ROOM_IDENTITY_MISMATCH'&&err.status===403,
 );
});

test('re-joining a room releases stale tap-preview registration immediately without waiting 20s',async t=>{
 const f=setup(t),sessionA=sid('rejoin-a');
 const bindA=await f.service.bindTapTap({identity:sessionA,code:'rejoin-user',nickname:'重连测试'});
 assert.equal(bindA.status,200);

 const created=f.call(sessionA,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});
 assert.equal(created.status,201);
 const roomId=created.data.room.id,token1=created.data.token;

 // First client reserves a tap-preview slot.
 const clientId1=rid();
 const res1=f.call(sessionA,`/api/rooms/${roomId}/tap-preview`,{op:'reserve',clientId:clientId1,tapPlayerId:'tap-player-1'},token1);
 assert.equal(res1.status,200);
 assert.equal(res1.data.peers.length,1);

 // A second concurrent client on the SAME admission still hits TAP_PREVIEW_ALREADY_CONNECTED.
 const resDup=f.call(sessionA,`/api/rooms/${roomId}/tap-preview`,{op:'reserve',clientId:rid(),tapPlayerId:'tap-player-1'},token1);
 assert.equal(resDup.status,409);
 assert.equal(resDup.data.code,'TAP_PREVIEW_ALREADY_CONNECTED');

 // Explicitly re-joining the room rotates admission token and releases stale preview binding immediately.
 const rejoined=f.call(sessionA,`/api/rooms/${roomId}/join`,{});
 assert.equal(rejoined.status,200);
 const clientId2=rid();
 const res2=f.call(sessionA,`/api/rooms/${roomId}/tap-preview`,{op:'reserve',clientId:clientId2,tapPlayerId:'tap-player-1'},rejoined.data.token);
 assert.equal(res2.status,200,'rejoin frees stale tap-preview slot without 20s wait');
 assert.deepEqual(res2.data.peers.map(p=>p.clientId),[clientId2]);
});
