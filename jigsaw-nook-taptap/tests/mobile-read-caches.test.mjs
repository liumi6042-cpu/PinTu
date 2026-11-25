import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
const actor=name=>createHash('sha256').update(name).digest('hex');
function setup(t){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/read-caches-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min,publicTestPolicy:{privateMessages:false,customNames:false}});
 const other=new DatabaseSync(databasePath);other.exec('PRAGMA busy_timeout=5000');
 t.after(()=>{other.close();service.close();rmSync(dir,{recursive:true,force:true});});
 const call=(owner,path,body,token,method)=>service.handle({identity:owner,method:method??(body===undefined?'GET':'POST'),url:path,body:body===undefined?undefined:{requestId:rid(),...body},authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 // Another connection writing the same file, as an operator script or a second service instance would.
 const external=(roomId,change)=>{const data=JSON.parse(other.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(roomId).data);change(data);other.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(data),roomId);};
 const plenty=owner=>other.prepare("UPDATE mobile_profiles SET data=json_set(data,'$.energy',100000) WHERE id=?").run(owner);
 const finish=(owner,ticket)=>{for(const group of ticket.room.puzzle.groups){const path='/api/rooms/'+ticket.room.id;assert.equal(call(owner,path,{type:'claim',groupId:group.id},ticket.token).status,200);assert.equal(call(owner,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1},ticket.token).status,200);}};
 return {service,call,external,plenty,finish,advance:(ms=1000)=>now+=ms};
}

test('realtime peers share one parsed room per committed state and still see every change',t=>{
 const f=setup(t),a=actor('cache-rt-a'),b=actor('cache-rt-b');
 const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.equal(created.status,201);
 const roomId=created.data.room.id,joined=f.call(b,'/api/rooms/'+roomId+'/join',{});assert.equal(joined.status,200);
 const ca=f.service.realtime.subscribe({roomId,identity:a,authorization:'Bearer '+created.data.token,artworkSnapshot:true});
 const cb=f.service.realtime.subscribe({roomId,identity:b,authorization:'Bearer '+joined.data.token,artworkSnapshot:true});
 assert.equal(ca.room,cb.room,'peers authorised against the same committed state share one parse');
 const before=f.service.realtime.readRoom(ca,null);assert.equal(before.members.length,2);
 const group=created.data.room.puzzle.groups[0];f.advance();
 assert.equal(f.call(b,'/api/rooms/'+roomId,{type:'claim',groupId:group.id},joined.data.token).status,200);
 const after=f.service.realtime.readRoom(ca,before.revision);
 assert.equal(after.revision,before.revision+1);assert.ok(after.leases[group.id],'the claim committed by another request is visible');
 assert.notEqual(ca.room,cb.room,'a commit retires the shared parse');
 f.service.realtime.readRoom(cb,null);assert.equal(ca.room,cb.room);
 // A write from another connection (operator script, second instance) is picked up through PRAGMA data_version.
 f.external(roomId,data=>{data.title='外部改名';});
 assert.equal(f.service.realtime.readRoom(ca,null).title,'外部改名');
 const members=f.service.realtime.readRoom(cb,null).members;assert.deepEqual(members.map(m=>typeof m.code),['string','string']);assert.ok(members.every(m=>Number.isInteger(m.level)));
});

test('the owned-room list follows joins, removals and writes from other connections',t=>{
 const f=setup(t),a=actor('cache-own-a'),b=actor('cache-own-b');
 const first=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}).data;
 let owned=f.call(a,'/api/mobile/profile').data.ownedRooms;assert.deepEqual(owned.map(r=>[r.id,r.players]),[[first.room.id,1]]);
 f.advance();assert.equal(f.call(b,'/api/rooms/'+first.room.id+'/join',{}).status,200);
 owned=f.call(a,'/api/mobile/profile').data.ownedRooms;assert.equal(owned[0].players,2,'another player joining the owner\'s table shows at once');
 const second=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}).data;
 assert.deepEqual(f.call(a,'/api/my-rooms').data.rooms.map(r=>r.id).sort(),[first.room.id,second.room.id].sort());
 assert.equal(f.call(a,'/api/my-rooms',{action:'remove',roomId:first.room.id}).status,200);
 assert.deepEqual(f.call(a,'/api/mobile/profile').data.ownedRooms.map(r=>r.id),[second.room.id],'a removed entry leaves the list at once');
 f.external(second.room.id,data=>{data.title='另一处改名';});
 assert.equal(f.call(a,'/api/mobile/profile').data.ownedRooms[0].title,'另一处改名');
 // A finished table stays listed as 已完成, exactly as before.
 f.plenty(a);f.finish(a,second);
 const done=f.call(a,'/api/mobile/profile').data.ownedRooms;assert.equal(done[0].title,'已完成');assert.equal(done[0].completed,true);
});

test('lobby, friends and the daily count see public tables change at once',t=>{
 const f=setup(t),a=actor('cache-lobby-a'),b=actor('cache-lobby-b'),c=actor('cache-lobby-c');
 for(const owner of [a,b,c])f.call(owner,'/api/mobile/social');
 const lobby=()=>f.call(c,'/api/lobby?limit=24').data;
 assert.equal(lobby().total,0);
 const one=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}).data;assert.equal(lobby().total,1);
 const two=f.call(b,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}).data;
 assert.deepEqual(lobby().rooms.map(r=>r.id).sort(),[one.room.id,two.room.id].sort());
 f.external(two.room.id,data=>{data.title='大厅外部改名';});
 assert.equal(lobby().rooms.find(r=>r.id===two.room.id).title,'大厅外部改名');
 // c and a become friends: c's friends page shows the table a is sitting at.
 const codeA=f.call(a,'/api/mobile/social').data.self.code,codeC=f.call(c,'/api/mobile/social').data.self.code;
 f.call(c,'/api/mobile/social/requests',{code:codeA});f.call(a,'/api/mobile/social/requests/respond',{code:codeC,accept:true});
 assert.equal(f.call(c,'/api/mobile/social').data.friends[0].room?.id,one.room.id);
 // Finishing the table removes it from the lobby and from the friend card.
 f.plenty(a);f.finish(a,one);
 assert.deepEqual(lobby().rooms.map(r=>r.id),[two.room.id]);assert.equal(f.call(c,'/api/mobile/social').data.friends[0].room,undefined);
 // The daily finished count moves as soon as a daily table completes.
 assert.equal(lobby().dailyFinished,0);
 const daily=f.call(b,'/api/rooms',{mode:'daily',visibility:'public'}).data;assert.equal(lobby().dailyFinished,0);
 f.plenty(b);f.finish(b,daily);assert.equal(lobby().dailyFinished,1);
});

test('finishing a table marks every player whose first table it was, including the acting one',t=>{
 const f=setup(t),a=actor('cache-first-a'),b=actor('cache-first-b'),c=actor('cache-first-c');
 const room=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}).data;
 for(const owner of [b,c])assert.equal(f.call(owner,'/api/rooms/'+room.room.id+'/join',{}).status,200);
 const tb=f.call(b,'/api/rooms/'+room.room.id+'/join',{}).data.token;assert.equal(f.call(b,'/api/rooms/'+room.room.id,{type:'leave'},tb).status,200);
 for(const owner of [a,b,c])assert.equal(f.call(owner,'/api/mobile/profile').data.firstRoomId,room.room.id);
 f.plenty(a);f.finish(a,room);
 for(const owner of [a,b,c])assert.equal(f.call(owner,'/api/mobile/profile').data.newcomer,false,'first table completed for '+owner.slice(0,6));
});

test('SQLite sync mode is normal by default and only accepts normal or full',t=>{
 assert.throws(()=>createMobileService({synchronous:'off'}),/MOBILE_SQLITE_SYNCHRONOUS/);
 for(const synchronous of ['normal','full',undefined]){const service=createMobileService(synchronous?{synchronous}:{});service.close();}
});
