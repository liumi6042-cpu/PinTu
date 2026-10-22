import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64),outsider='c'.repeat(64);
function fixture(){
 mkdirSync('work',{recursive:true});const dir=mkdtempSync(resolve('work/room-history-test-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now}),db=new DatabaseSync(databasePath);
 const call=(identity,url,body,token,method=body===undefined?'GET':'POST',instance=service)=>instance.handle({identity,url,method,body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const make=(identity=owner,visibility='public')=>{const result=call(identity,'/api/rooms',{mode:'random',pieces:48,visibility,requestId:rid()});assert.equal(result.status,201,JSON.stringify(result));now++;return result.data;};
 const history=(identity=owner)=>{const result=call(identity,'/api/room-history');assert.equal(result.status,200);return result.data.rooms;};
 const stored=id=>JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(id).data);
 const patch=(id,changes)=>{const room=Object.assign(stored(id),changes);db.prepare('UPDATE mobile_rooms SET data=?,completed_at=? WHERE id=?').run(JSON.stringify(room),room.completedAt,id);};
 return {call,make,history,stored,patch,db,databasePath,get now(){return now;},advance(ms){now+=ms;},close(){service.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('history keeps ten distinct recent admissions; polling does not reorder, explicit cached-ticket reentry does',()=>{
 const f=fixture();try{
  const tickets=[];
  for(let i=0;i<12;i++){const ticket=f.make((i+100).toString(16).padStart(64,'0'));tickets.push(ticket);assert.equal(f.call(peer,'/api/rooms/'+ticket.room.id+'/join',{}).status,200);f.advance(100);}
  const rooms=f.history(peer);assert.equal(rooms.length,10);assert.equal(rooms[0].id,tickets[11].room.id);assert.equal(rooms.at(-1).id,tickets[2].room.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_room_history WHERE owner=?').get(peer).n,10);
  const oldest=tickets[0],joined=f.call(peer,'/api/rooms/'+oldest.room.id+'/join',{}).data;
  assert.equal(f.history(peer)[0].id,oldest.room.id);
  const recent=tickets[11],recentJoin=f.call(peer,'/api/rooms/'+recent.room.id+'/join',{}).data;
  f.call(peer,'/api/rooms/'+oldest.room.id,{type:'heartbeat'},joined.token);
  assert.equal(f.history(peer)[0].id,recent.room.id,'presence polling must not replace the most recently entered room');
  f.call(peer,'/api/rooms/'+oldest.room.id,{type:'heartbeat',historyJoin:true},joined.token);
  assert.equal(f.history(peer)[0].id,oldest.room.id);assert.equal(f.history(peer).length,10);
  assert.ok(recentJoin.token);assert.equal(f.history(outsider).length,0);
 }finally{f.close();}
});

test('deleting an owned entry releases quota without changing either player history, shared progress or ownership',()=>{
 const f=fixture();try{
  const ticket=f.make(),path='/api/rooms/'+ticket.room.id,joined=f.call(peer,path+'/join',{}).data;
  const room=f.stored(ticket.room.id);room.puzzle.groups[0].locked=true;f.patch(room.id,room);
  f.make();f.make();assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:48,requestId:rid()}).data.code,'ROOM_LIMIT');
  assert.equal(f.call(outsider,'/api/my-rooms',{action:'remove',roomId:room.id}).status,403);
  const before=f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(room.id).data;
  const action={action:'remove',roomId:room.id};assert.equal(f.call(owner,'/api/my-rooms',action).status,200);assert.equal(f.call(owner,'/api/my-rooms',action).status,200);
  assert.equal(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(room.id).data,before);
  assert.ok(!f.call(owner,'/api/my-rooms').data.rooms.some(r=>r.id===room.id));
  assert.ok(f.history(owner).some(r=>r.id===room.id));assert.ok(f.history(peer).some(r=>r.id===room.id));
  f.call(peer,path,{type:'heartbeat'},joined.token);assert.equal(f.stored(room.id).ownerId,owner);assert.equal(f.stored(room.id).puzzle.groups[0].locked,true);
  assert.equal(f.call(owner,path+'/join',{}).status,200,'history can still resume a removed own entry');
  assert.ok(!f.call(owner,'/api/my-rooms').data.rooms.some(r=>r.id===room.id),'reentering must not restore the removed own entry');
  f.make();
  const second=createMobileService({databasePath:f.databasePath,now:()=>f.now});try{assert.ok(f.call(owner,'/api/room-history',undefined,undefined,'GET',second).data.rooms.some(r=>r.id===room.id));assert.ok(!f.call(owner,'/api/my-rooms',undefined,undefined,'GET',second).data.rooms.some(r=>r.id===room.id));}finally{second.close();}
 }finally{f.close();}
});

test('completed names are resolved on fetch in history and owned lists; completed rooms do not use quota',()=>{
 const f=fixture();try{
  const ticket=f.make(),id=ticket.room.id;f.make();f.make();
  f.patch(id,{completedAt:f.now});
  assert.equal(f.history().find(r=>r.id===id).title,'已完成');assert.equal(f.history().find(r=>r.id===id).completed,true);
  assert.equal(f.call(owner,'/api/my-rooms').data.rooms.find(r=>r.id===id).title,'已完成');f.make();
  assert.equal(f.call(owner,'/api/rooms/'+id,{},undefined,'DELETE').status,200);
  assert.ok(f.history().some(r=>r.id===id));assert.equal(f.db.prepare('SELECT closed_at FROM mobile_rooms WHERE id=?').get(id).closed_at,null);
 }finally{f.close();}
});

test('unfinished mobile public and private rooms remain resumable past lobby/expiry dates without relaxing private admission',()=>{
 const f=fixture();try{
  const publicRoom=f.make(),privateRoom=f.make(owner,'private');
  assert.equal(f.call(peer,'/api/rooms/'+privateRoom.room.id+'/join',{inviteCode:privateRoom.inviteCode}).status,200);
  f.advance(400*86400000);
  for(const ticket of [publicRoom,privateRoom])assert.equal(f.call(owner,'/api/rooms/'+ticket.room.id+'/join',{}).status,200);
  assert.equal(f.call(peer,'/api/rooms/'+privateRoom.room.id+'/join',{}).status,200);
  assert.equal(f.call(outsider,'/api/rooms/'+privateRoom.room.id+'/join',{}).data.code,'INVITE_REQUIRED');
  assert.ok(f.history(peer).some(r=>r.id===privateRoom.room.id));
 }finally{f.close();}
});

test('legacy admission history seeds once, survives eviction and excludes diagnostic rooms',()=>{
 const f=fixture();try{
  const ticket=f.make();f.db.exec('DELETE FROM mobile_room_history;DELETE FROM mobile_room_history_seeded;');
  assert.equal(f.history()[0].id,ticket.room.id);
  f.db.prepare('DELETE FROM mobile_room_history WHERE owner=?').run(owner);
  assert.deepEqual(f.history(),[],'seeded accounts must not resurrect evicted history');
  const old=f.stored(ticket.room.id);old.admitted={[peer]:true};old.members=[];f.patch(old.id,old);
  assert.equal(f.history(peer)[0].id,old.id,'historic admission survives member pruning');
  f.patch(old.id,{diagnostic:true});
  assert.deepEqual(f.history(outsider),[]);
 }finally{f.close();}
});
