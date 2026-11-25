import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';

const owner='a'.repeat(64),peer='b'.repeat(64),rid=()=>randomBytes(16).toString('hex');
async function fixture(t){
 mkdirSync(resolve('work'),{recursive:true});const folder=mkdtempSync(resolve('work/room-actions-test-')),databasePath=resolve(folder,'synthetic.sqlite');
 const now=1800000000000,service=createMobileService({databasePath,now:()=>now,randomInt:min=>min,diagnosticAccountIds:[owner],tapTap:{exchangeCode:async code=>({openid:code})}}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(folder.startsWith(resolve('work')+'\\'));rmSync(folder,{recursive:true,force:true});});
 const call=(identity,path,body,token)=>service.handle({identity,url:path,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const patchProfile=(identity,patch)=>{const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);Object.assign(profile,patch);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),identity);};
 for(const identity of [owner,peer]){call(identity,'/api/mobile/profile');patchProfile(identity,{level:50,xp:0,totalXp:10000,energy:30,energyAt:now,firstRoomCompleted:true,firstRoomId:null,autoSupply:false,supply:{energy:0,create:1}});}
 const made=call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(made.status,201,JSON.stringify(made));const ticket=made.data;
 const joined=call(peer,'/api/rooms/'+ticket.room.id+'/join',{},undefined);assert.equal(joined.status,200,JSON.stringify(joined));
 const actor=(identity,ticket)=>{const context=service.realtime.subscribe({identity,roomId:ticket.room.id,authorization:'Bearer '+ticket.token,artworkSnapshot:true}),clientId=rid();let ordinal=0;return {identity,ticket,context,envelope:(gestureId,action,extra={})=>({id:rid(),clientId,gestureId,ordinal:++ordinal,action,...extra}),write(input){return service.realtime.writeAction(context,input);}};};
 const a=actor(owner,ticket),b=actor(peer,joined.data);
 const profile=identity=>call(identity,'/api/mobile/profile').data;
 const read=()=>call(owner,'/api/rooms/'+ticket.room.id,undefined,ticket.token).data;
 const patchRoom=fn=>{const room=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);fn(room);db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),ticket.room.id);};
 return {service,db,call,ticket,a,b,actor,profile,read,patchProfile,patchRoom};
}

test('normal members advertise general actions while diagnostic rooms keep bound-owner admission',async t=>{
 const f=await fixture(t);assert.deepEqual(f.service.realtime.actionCapabilities(f.a.context),{version:1,diagnosticOnly:false});assert.deepEqual(f.service.realtime.actionCapabilities(f.b.context),{version:1,diagnosticOnly:false});
 assert.equal(f.service.realtime.writeAction({...f.a.context,identity:peer},f.a.envelope(rid(),{type:'claim',groupId:0})).status,403);
 assert.equal(f.service.realtime.writeAction({...f.a.context,authorization:'Bearer '+rid()},f.a.envelope(rid(),{type:'claim',groupId:0})).status,401);
 assert.equal(f.call(owner,'/api/mobile/diagnostics/room',{requestId:rid()}).status,403,'unbound allowlisted identity is insufficient');
 await f.service.bindTapTap({identity:owner,code:'owner',nickname:'same-name'});await f.service.bindTapTap({identity:peer,code:'peer',nickname:'same-name'});
 const made=f.call(owner,'/api/mobile/diagnostics/room',{requestId:rid()});assert.equal(made.status,200);
 const diagnostic=f.actor(owner,made.data);assert.deepEqual(f.service.realtime.actionCapabilities(diagnostic.context),{version:1,diagnosticOnly:true});
 assert.equal(f.service.realtime.writeAction({...diagnostic.context,identity:peer},diagnostic.envelope(rid(),{type:'claim',groupId:0})).status,403);
});

test('real normal drops charge energy and award XP/coins once, including strong replay and legacy HTTP',async t=>{
 const f=await fixture(t),before=f.profile(owner),gesture=rid();
 assert.equal(f.a.write(f.a.envelope(gesture,{type:'claim',groupId:0})).status,200);
 const input=f.a.envelope(gesture,{type:'drop',groupId:0,seq:1,dx:0,dy:0}),first=f.a.write(input);assert.equal(first.status,200,JSON.stringify(first));
 assert.equal(first.data.diagnostic,undefined);assert.equal(first.data.mobileContribution.requestId,input.id);assert.equal(first.data.profile.totalXp,before.totalXp+before.economy.contributionXp);assert.equal(first.data.profile.energy,before.energy-before.economy.contributionCost);
 const after=f.profile(owner),revision=f.read().revision;
 assert.equal(after.collection.coins,before.collection.coins+first.data.mobileContribution.creditedCoins);
 const replay=f.a.write({...input,since:0});assert.equal(replay.status,200);assert.equal(replay.data.mobileContribution,undefined,'a wrapper replay does not emit another XP animation receipt');assert.equal(f.read().revision,revision);
 for(const key of ['energy','totalXp','giftProgress','collection'])assert.deepEqual(f.profile(owner)[key],after[key]);
 const path='/api/rooms/'+f.ticket.room.id,groupId=f.read().puzzle.groups.find(group=>!group.locked).id;
 assert.equal(f.call(owner,path,{type:'claim',groupId},f.ticket.token).status,200);
 const legacy={type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()};assert.equal(f.call(owner,path,legacy,f.ticket.token).status,200);
 const legacyAfter=f.profile(owner);assert.equal(f.call(owner,path,legacy,f.ticket.token).status,200);assert.deepEqual(f.profile(owner),legacyAfter);
});

test('member-bound receipts and gestures cannot be replayed by another player, and competing claims stay isolated',async t=>{
 const f=await fixture(t),g1=rid(),g2=rid(),claim=f.a.envelope(g1,{type:'claim',groupId:0});assert.equal(f.a.write(claim).status,200);
 assert.equal(f.b.write(claim).status,409,'another member cannot replay the owner acknowledgement');
 assert.equal(f.b.write(f.b.envelope(g2,{type:'claim',groupId:0})).data.code,'DIAGNOSTIC_LEASE_BUSY');
 assert.equal(f.b.write(f.b.envelope(g2,{type:'drop',groupId:0,seq:1,dx:0,dy:0})).data.code,'DIAGNOSTIC_GESTURE_REJECTED');
 assert.equal(f.a.write(f.a.envelope(g1,{type:'release',groupId:0})).status,200);
 const g3=rid();assert.equal(f.b.write(f.b.envelope(g3,{type:'claim',groupId:0})).status,200);
 assert.equal(f.a.write(f.a.envelope(g1,{type:'release',groupId:0})).status,409);assert.equal(f.read().leases[0].playerId,f.b.ticket.playerId);
 assert.equal(f.b.write(f.b.envelope(g3,{type:'drop',groupId:0,seq:1,dx:0,dy:0})).status,200);
 assert.equal(f.profile(owner).totalXp,10000);assert.equal(f.profile(peer).totalXp,10001);
});

test('merged-away group ids are rejected without retargeting another group or blocking the following gesture',async t=>{
 const f=await fixture(t);f.patchRoom(room=>{for(const group of room.puzzle.groups){group.dx=-400;group.dy=-400;}room.puzzle.groups.find(group=>group.id===0).dx=120;room.puzzle.groups.find(group=>group.id===0).dy=120;room.puzzle.groups.find(group=>group.id===1).dx=120;room.puzzle.groups.find(group=>group.id===1).dy=120;});
 const gesture=rid();assert.equal(f.a.write(f.a.envelope(gesture,{type:'claim',groupId:0})).status,200);
 const drop=f.a.write(f.a.envelope(gesture,{type:'drop',groupId:0,seq:1,dx:120,dy:120}));assert.equal(drop.status,200,JSON.stringify(drop));
 const current=f.read();assert.equal(current.puzzle.groups.some(group=>group.id===1),false);assert.ok(current.puzzle.groups.find(group=>group.id===0).pieces.includes(1));
 const stale=rid();assert.equal(f.a.write(f.a.envelope(stale,{type:'claim',groupId:1})).status,409);assert.equal(f.a.write(f.a.envelope(stale,{type:'drop',groupId:1,seq:1,dx:0,dy:0})).status,409);
 const next=rid();assert.equal(f.a.write(f.a.envelope(next,{type:'claim',groupId:2})).status,200);assert.equal(f.a.write(f.a.envelope(next,{type:'release',groupId:2})).status,200);
 assert.equal(f.profile(owner).totalXp,10001,'stale ids cannot create a second reward');
});

test('energy rejection rolls back the attempted snap, returns authoritative profile, and leaves other gestures usable',async t=>{
 const f=await fixture(t);f.patchProfile(owner,{energy:0});const before=f.read(),profile=f.profile(owner),gesture=rid();
 assert.equal(f.a.write(f.a.envelope(gesture,{type:'claim',groupId:0})).status,200);
 const drop=f.a.envelope(gesture,{type:'drop',groupId:0,seq:1,dx:0,dy:0}),denied=f.a.write(drop);
 assert.equal(denied.status,402);assert.equal(denied.data.code,'ENERGY_EMPTY');assert.equal(denied.data.profile.energy,0);assert.equal(denied.data.profile.totalXp,profile.totalXp);
 assert.deepEqual(f.read().puzzle.groups,before.puzzle.groups);assert.equal(f.read().leases[0],undefined);assert.equal(f.a.write(drop).status,402);
 const other=rid();assert.equal(f.b.write(f.b.envelope(other,{type:'claim',groupId:1})).status,200);assert.equal(f.b.write(f.b.envelope(other,{type:'drop',groupId:1,seq:1,dx:0,dy:0})).status,200);
 const next=rid();assert.equal(f.a.write(f.a.envelope(next,{type:'claim',groupId:2})).status,200);assert.equal(f.a.write(f.a.envelope(next,{type:'release',groupId:2})).status,200);
});

test('many reconnects retire active entries without allowing retired ordinal-one writes or old disconnects to replay',async t=>{
 const f=await fixture(t),first=f.a.envelope(rid(),{type:'claim',groupId:0});assert.equal(f.a.write(first).status,200);f.service.realtime.disconnectActions(f.a.context);
 for(let n=0;n<80;n++){const actor=f.actor(owner,f.ticket),gesture=rid();assert.equal(actor.write(actor.envelope(gesture,{type:'claim',groupId:0})).status,200);assert.equal(actor.write(actor.envelope(gesture,{type:'release',groupId:0})).status,200);f.service.realtime.disconnectActions(actor.context);}
 const replacement=f.actor(owner,f.ticket);const old={...first,id:rid()};assert.equal(replacement.write(old).data.code,'DIAGNOSTIC_CLIENT_CONFLICT');
 const current=rid();assert.equal(replacement.write(replacement.envelope(current,{type:'claim',groupId:0})).status,200);f.service.realtime.disconnectActions(f.a.context);assert.ok(f.read().leases[0]);f.service.realtime.disconnectActions(replacement.context);assert.equal(f.read().leases[0],undefined);
 const raw=JSON.parse(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(f.ticket.room.id).data);assert.equal(Object.keys(raw.roomActions.streams).length,0);assert.ok(Object.keys(raw.roomActions.gestures).length<=128);assert.ok(Object.keys(raw.roomActions.receipts).length<=256);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_room_action_streams WHERE room_id=?').get(f.ticket.room.id).n,82);
});

test('physical room deletion atomically removes its replay frontiers while retained closed rooms and other rooms keep theirs',async t=>{
 const f=await fixture(t);assert.equal(f.a.write(f.a.envelope(rid(),{type:'claim',groupId:0})).status,200);
 const made=f.call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(made.status,201);const other=f.actor(owner,made.data);assert.equal(other.write(other.envelope(rid(),{type:'claim',groupId:0})).status,200);
 const count=roomId=>f.db.prepare('SELECT COUNT(*) n FROM mobile_room_action_streams WHERE room_id=?').get(roomId).n;
 f.db.prepare('UPDATE mobile_rooms SET closed_at=? WHERE id=?').run(1800000000001,f.ticket.room.id);assert.equal(count(f.ticket.room.id),1,'closing a retained archive must retain replay protection');
 f.db.exec('BEGIN IMMEDIATE');f.db.prepare('DELETE FROM mobile_rooms WHERE id=?').run(f.ticket.room.id);assert.equal(count(f.ticket.room.id),0);assert.equal(count(made.data.room.id),1);f.db.exec('ROLLBACK');assert.equal(count(f.ticket.room.id),1,'frontier removal rolls back with room deletion');
 f.db.exec('BEGIN IMMEDIATE');f.db.prepare('DELETE FROM mobile_rooms WHERE id=?').run(f.ticket.room.id);f.db.exec('COMMIT');assert.equal(count(f.ticket.room.id),0);assert.equal(count(made.data.room.id),1,'a different active room remains protected');
});
