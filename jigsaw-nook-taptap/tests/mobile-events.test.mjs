import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileEvents} from '../server/mobile-events.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {placedCount} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64),helper='c'.repeat(64),spectator='d'.repeat(64);
function fixture(t){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-events-test-')),databasePath=resolve(dir,'mobile.sqlite'),now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+'\\'));rmSync(dir,{recursive:true,force:true});});
 const call=(actor,url,body,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(actor,url,body,token)=>{const result=call(actor,url,body,token);assert.ok(result.status===200||result.status===201,JSON.stringify(result));return result.data;};
 const stored=actor=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);
 const patch=(actor,changes)=>db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...stored(actor),...changes}),actor);
 for(const actor of [owner,peer,helper,spectator]){ok(actor,'/api/mobile/profile');patch(actor,{level:50,xp:0,totalXp:10000,energy:100,energyAt:now,firstRoomCompleted:true,firstRoomId:null,autoSupply:false,supply:{energy:0,create:3}});}
 const make=(actor=owner,input={})=>ok(actor,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid(),...input});
 const events=kind=>db.prepare('SELECT * FROM mobile_events WHERE kind=? ORDER BY id').all(kind).map(row=>({...row,data:JSON.parse(row.data)}));
 const room=ticket=>JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
 const patchRoom=(ticket,change)=>{const value=room(ticket);change(value);db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(value),value.id);};
 const claim=(ticket,actor=owner)=>{const groupId=room(ticket).puzzle.groups.find(g=>!g.locked).id;ok(actor,'/api/rooms/'+ticket.room.id,{type:'claim',groupId},ticket.token);return {type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()};};
 const almostComplete=ticket=>patchRoom(ticket,room=>{for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}});
 return {db,service,now,call,ok,stored,patch,make,events,room,patchRoom,claim,almostComplete};
}

test('recorder creates the event schema/index and accepts future level events without level logic',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const events=createMobileEvents({db});createMobileEvents({db});
 assert.deepEqual(db.prepare('PRAGMA table_info(mobile_events)').all().map(row=>[row.name,row.type,row.pk]),[['id','INTEGER',1],['owner','TEXT',0],['kind','TEXT',0],['room_id','TEXT',0],['data','TEXT',0],['created_at','INTEGER',0]]);
 assert.deepEqual(db.prepare('PRAGMA index_info(mobile_events_kind_created_at)').all().map(row=>row.name),['kind','created_at']);
 for(const kind of ['level-start','level-clear'])events.record(owner,kind,'room',{levelId:'ch1-1'},123);
 const rows=db.prepare('SELECT * FROM mobile_events ORDER BY id').all();assert.equal(rows.length,2);
 assert.deepEqual(rows.map(row=>[row.owner,row.kind,row.room_id,JSON.parse(row.data),row.created_at]),['level-start','level-clear'].map(kind=>[owner,kind,'room',{levelId:'ch1-1'},123]));
 db.exec('BEGIN');events.record(owner,'level-clear','rolled-back',{},124);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_events').get().n,2);
});

test('room creation/replay, daily reuse and joining record only actual new rooms and members',t=>{
 const f=fixture(t),input={mode:'random',pieces:48,visibility:'private',requestId:rid()},ticket=f.make(owner,input),path='/api/rooms/'+ticket.room.id;
 assert.equal(f.make(owner,input).room.id,ticket.room.id);assert.equal(f.events('room-create').length,1);
 assert.deepEqual(f.events('room-create')[0],{id:1,owner,kind:'room-create',room_id:ticket.room.id,data:{mode:'random',pieces:48,visibility:'private'},created_at:f.now});
 assert.equal(f.call(peer,path+'/join',{}).status,403);assert.equal(f.events('room-join').length,1);
 const joined=f.ok(peer,path+'/join',{inviteCode:ticket.inviteCode});
 f.ok(peer,path,{type:'heartbeat'},joined.token);f.ok(peer,path,undefined,joined.token);f.ok(peer,path,{type:'leave'},joined.token);
 assert.equal(f.ok(peer,path+'/join',{}).playerId,joined.playerId);f.ok(owner,path+'/join',{});
 assert.deepEqual(f.events('room-join').map(row=>[row.owner,row.room_id]),[[owner,ticket.room.id],[peer,ticket.room.id]]);
 const daily=f.make(owner,{mode:'daily',pieces:48}),reused=f.make(peer,{mode:'daily',pieces:500});assert.equal(daily.room.id,reused.room.id);
 assert.equal(f.events('room-create').length,2);assert.deepEqual(f.events('room-create')[1].data,{mode:'daily',pieces:108,visibility:'public'});
 assert.equal(f.events('level-start').length,0);assert.equal(f.events('level-clear').length,0);
});

test('ordinary events roll back with failed room creation and retry commits them once',t=>{
 const f=fixture(t),input={mode:'random',pieces:48,visibility:'public',requestId:rid()},before=f.stored(owner);
 f.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON mobile_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 assert.equal(f.call(owner,'/api/rooms',input).status,500);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_rooms').get().n,0);
 assert.equal(f.events('room-create').length,0);assert.equal(f.events('room-join').length,0);assert.deepEqual(f.stored(owner),before);
 f.db.exec('DROP TRIGGER reject_receipt');f.make(owner,input);assert.equal(f.events('room-create').length,1);assert.equal(f.events('room-join').length,1);
});

test('ENERGY_EMPTY persists after full rollback with the committed progress and no gameplay mutation',t=>{
 const f=fixture(t),ticket=f.make(),path='/api/rooms/'+ticket.room.id;
 f.patchRoom(ticket,room=>{for(const group of room.puzzle.groups.slice(1,13)){group.locked=true;group.dx=0;group.dy=0;}});
 f.patch(owner,{energy:0});const input=f.claim(ticket),before=f.room(ticket),profile=f.stored(owner),result=f.call(owner,path,input,ticket.token);
 assert.equal(result.status,402);assert.equal(result.data.code,'ENERGY_EMPTY');assert.deepEqual(f.room(ticket),before);assert.deepEqual(f.stored(owner),profile);
 const events=f.events('energy-empty');assert.equal(events.length,1);assert.equal(events[0].owner,owner);assert.equal(events[0].room_id,ticket.room.id);assert.equal(events[0].created_at,f.now);
 assert.deepEqual(events[0].data,{progressPercent:Math.round(placedCount(before.puzzle)/(before.puzzle.cols*before.puzzle.rows)*100)});assert.ok(events[0].data.progressPercent>0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_task_events').get().n,0);assert.equal(f.events('room-complete').length,0);
 f.ok(owner,path,{type:'heartbeat'},ticket.token);assert.equal(f.events('energy-empty').length,1,'pending event is cleared after the failed request');
});

test('ENERGY_EMPTY also persists after action savepoint rollback without duplicate action replay events',t=>{
 const f=fixture(t),ticket=f.make(),context=f.service.realtime.subscribe({identity:owner,roomId:ticket.room.id,authorization:'Bearer '+ticket.token}),clientId=rid(),gestureId=rid();
 f.patch(owner,{energy:0});const before=f.room(ticket).puzzle;
 const envelope=(ordinal,action)=>({id:rid(),clientId,gestureId,ordinal,action});
 assert.equal(f.service.realtime.writeAction(context,envelope(1,{type:'claim',groupId:0})).status,200);
 const drop=envelope(2,{type:'drop',groupId:0,seq:1,dx:0,dy:0});assert.equal(f.service.realtime.writeAction(context,drop).data.code,'ENERGY_EMPTY');
 assert.deepEqual(f.room(ticket).puzzle,before);assert.equal(f.events('energy-empty').length,1);assert.deepEqual(f.events('energy-empty')[0].data,{progressPercent:0});
 assert.equal(f.service.realtime.writeAction(context,drop).status,402);assert.equal(f.events('energy-empty').length,1);assert.equal(f.stored(owner).energy,0);
});

test('room completion records each newly inserted settlement, excluding ignored settlements and spectators',t=>{
 const f=fixture(t),ticket=f.make(),path='/api/rooms/'+ticket.room.id;
 for(const actor of [peer,helper,spectator])f.ok(actor,path+'/join',{});
 f.almostComplete(ticket);f.patchRoom(ticket,room=>{room.achievements={version:1,contributors:Object.fromEntries([owner,peer,helper].map(actor=>[actor,{count:1,days:[]}]))};});
 f.db.prepare('INSERT INTO mobile_settlements VALUES(?,?,?,?,?)').run(ticket.room.id,peer,1,1,f.now-1);
 const input=f.claim(ticket),result=f.ok(owner,path,input,ticket.token);assert.ok(result.completedAt);
 assert.deepEqual(f.events('room-complete').map(row=>[row.owner,row.room_id,row.data,row.created_at]),[[owner,ticket.room.id,{contribution:2},f.now],[helper,ticket.room.id,{contribution:1},f.now]]);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_settlements').get().n,3);f.ok(owner,path,input,ticket.token);
 f.patchRoom(ticket,room=>{room.mobileSettled=false;});f.ok(owner,path,{type:'heartbeat'},ticket.token);
 assert.equal(f.events('room-complete').length,2,'INSERT OR IGNORE and replay cannot emit another completion');
});

test('event insert failures only log while creation, joining, energy rejection and settlement keep their outcomes',t=>{
 const f=fixture(t),log=t.mock.method(console,'error',()=>{});
 f.db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON mobile_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END");
 const ticket=f.make(),path='/api/rooms/'+ticket.room.id;f.ok(peer,path+'/join',{});f.patch(owner,{energy:0});const input=f.claim(ticket),before=f.room(ticket);
 assert.equal(f.call(owner,path,input,ticket.token).data.code,'ENERGY_EMPTY');assert.deepEqual(f.room(ticket),before);
 f.patch(owner,{energy:100});f.almostComplete(ticket);const done=f.ok(owner,path,input,ticket.token);assert.ok(done.completedAt);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_settlements').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_events').get().n,0);
 assert.deepEqual(new Set(log.mock.calls.map(call=>call.arguments[1])),new Set(['room-create','room-join','energy-empty','room-complete']));
});

test('event serialization failure is logged and leaves the recorder usable',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const events=createMobileEvents({db}),log=t.mock.method(console,'error',()=>{}),data={};data.self=data;
 assert.doesNotThrow(()=>events.record(owner,'room-create','room',data,1));assert.equal(log.mock.callCount(),1);
 events.record(owner,'room-create','room',{},2);assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_events').get().n,1);
});
