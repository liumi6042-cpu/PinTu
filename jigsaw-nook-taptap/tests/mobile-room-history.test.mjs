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

test('history keeps twenty distinct recent unfinished admissions; polling does not reorder, explicit cached-ticket reentry does',()=>{
 const f=fixture();try{
  const tickets=[];
  for(let i=0;i<22;i++){const ticket=f.make((i+100).toString(16).padStart(64,'0'));tickets.push(ticket);assert.equal(f.call(peer,'/api/rooms/'+ticket.room.id+'/join',{}).status,200);f.advance(100);}
  const rooms=f.history(peer);assert.equal(rooms.length,20);assert.equal(rooms[0].id,tickets[21].room.id);assert.equal(rooms.at(-1).id,tickets[2].room.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_room_history WHERE owner=?').get(peer).n,22,'drafts are stored up to forty');
  const oldest=tickets[0],joined=f.call(peer,'/api/rooms/'+oldest.room.id+'/join',{}).data;
  assert.equal(f.history(peer)[0].id,oldest.room.id);
  const recent=tickets[21],recentJoin=f.call(peer,'/api/rooms/'+recent.room.id+'/join',{}).data;
  f.call(peer,'/api/rooms/'+oldest.room.id,{type:'heartbeat'},joined.token);
  assert.equal(f.history(peer)[0].id,recent.room.id,'presence polling must not replace the most recently entered room');
  f.call(peer,'/api/rooms/'+oldest.room.id,{type:'heartbeat',historyJoin:true},joined.token);
  assert.equal(f.history(peer)[0].id,oldest.room.id);assert.equal(f.history(peer).length,20);
  assert.ok(recentJoin.token);assert.equal(f.history(outsider).length,0);
 }finally{f.close();}
});

test('deleting an owned entry releases quota without changing either player history, shared progress or ownership',()=>{
 const f=fixture();try{
  const ticket=f.make(),path='/api/rooms/'+ticket.room.id,joined=f.call(peer,path+'/join',{}).data;
  const room=f.stored(ticket.room.id);room.puzzle.groups[0].locked=true;f.patch(room.id,room);
  for(let i=0;i<4;i++)f.make();assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:48,requestId:rid()}).data.code,'ROOM_LIMIT');
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
  const ticket=f.make(),id=ticket.room.id;for(let i=0;i<4;i++)f.make();
  assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:48,requestId:rid()}).data.code,'ROOM_LIMIT');
  f.patch(id,{completedAt:f.now});
  assert.equal(f.history().find(r=>r.id===id).title,'已完成');assert.equal(f.history().find(r=>r.id===id).completed,true);
  assert.equal(f.call(owner,'/api/my-rooms').data.rooms.find(r=>r.id===id).title,'已完成');f.make();
  assert.equal(f.call(owner,'/api/rooms/'+id,{},undefined,'DELETE').status,200);
  assert.ok(f.history().some(r=>r.id===id));assert.equal(f.db.prepare('SELECT closed_at FROM mobile_rooms WHERE id=?').get(id).closed_at,null);
 }finally{f.close();}
});

test('finished rooms keep their own thirty slots and never push unfinished drafts out',()=>{
 const f=fixture();try{
  const join=i=>{const ticket=f.make((i+300).toString(16).padStart(64,'0'));assert.equal(f.call(peer,'/api/rooms/'+ticket.room.id+'/join',{}).status,200);f.advance(100);return ticket.room.id;};
  const drafts=[];for(let i=0;i<20;i++)drafts.push(join(i));
  const finished=[];for(let i=0;i<35;i++){const id=join(100+i);f.patch(id,{completedAt:f.now});finished.push(id);}
  const rooms=f.history(peer),open=rooms.filter(r=>!r.completed),done=rooms.filter(r=>r.completed);
  assert.deepEqual(open.map(r=>r.id).sort(),[...drafts].sort(),'35 finished rooms must not evict any of the 20 drafts');
  assert.equal(done.length,30);assert.deepEqual(done.map(r=>r.id),finished.slice(5).reverse());assert.ok(done.every(r=>typeof r.completedAt==='number'));
  assert.equal(rooms[0].id,finished.at(-1),'combined list stays newest first for older clients');
  const late=join(500);const after=f.history(peer).filter(r=>!r.completed);assert.equal(after.length,20);assert.equal(after[0].id,late);assert.ok(!after.some(r=>r.id===drafts[0]));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_room_history WHERE owner=?').get(peer).n,51,'older drafts stay stored so they can return when a newer table finishes');
  assert.deepEqual(f.call(peer,'/api/room-history').data.limits,{drafts:20,completed:30});
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
