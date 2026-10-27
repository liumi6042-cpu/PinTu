import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),identity=n=>n.toString(16).padStart(64,'0');
function fixture(t,{completed=true,pieces=48}={}){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-cheers-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();rmSync(dir,{recursive:true,force:true});});
 const call=(url,body,token,owner=identity(1),method=body===undefined?'GET':'POST')=>service.handle({identity:owner,url,method,body,authorization:token?'Bearer '+token:undefined});
 const created=call('/api/rooms',{mode:'random',pieces,visibility:'public',requestId:rid()});assert.equal(created.status,201);const ticket=created.data,path='/api/rooms/'+ticket.room.id;
 const patchRoom=updates=>{const room=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);Object.assign(room,updates);db.prepare('UPDATE mobile_rooms SET data=?,completed_at=?,closed_at=? WHERE id=?').run(JSON.stringify(room),room.completedAt,room.closedAt??null,room.id);return room;};
 if(completed)patchRoom({completedAt:now});
 return {service,db,databasePath,ticket,path,call,patchRoom,now:()=>now,advance:ms=>now+=ms,post:(input={id:rid(),emote:'clap'})=>call(path+'/cheers',input,ticket.token),get:after=>call(path+'/cheers'+(after===undefined?'':'?after='+encodeURIComponent(after)),undefined,ticket.token)};
}

test('cheers HTTP snapshots use global cursors, trusted identity, dedupe and no durable room changes',t=>{
 const f=fixture(t),events=[];f.service.realtime.onChange((roomId,kind)=>events.push({roomId,kind}));
 assert.equal(f.service.capabilities.cheers,true);assert.equal(f.call('/api/mobile/profile').data.capabilities.cheers,true);
 const before=f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(f.ticket.room.id).data,start=f.get().data.cursor;assert.equal(start,f.now());
 const id=rid(),first=f.post({id,emote:'clap',playerId:'forged',name:'forged',at:1,seq:1});assert.equal(first.status,200);
 const member=JSON.parse(before).members.find(m=>m.id===f.ticket.playerId);
 assert.deepEqual(first.data,{cheers:[{seq:start+1,id,playerId:member.id,name:member.name,emote:'clap',at:f.now()}],cursor:start+1,serverTime:f.now()});
 assert.equal(f.post({id,emote:'clap'}).data.cursor,start+1);assert.equal(events.length,1);assert.equal(events[0].kind.cheers,true);assert.ok(!events[0].kind.room&&!events[0].kind.cursors);
 const second=f.post({id:rid(),emote:'tea',after:start+1});assert.equal(second.data.cheers.length,1);assert.equal(second.data.cheers[0].emote,'tea');assert.equal(second.data.cursor,start+2);
 assert.deepEqual(f.get(start+1).data,second.data);assert.equal(f.get(second.data.cursor).data.cheers.length,0);
 for(const after of ['invalid',-1,'Infinity','1.5'])assert.equal(f.get(after).data.cheers.length,2);
 assert.equal(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(f.ticket.room.id).data,before);
 const other=f.call('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()},undefined,identity(2));assert.equal(other.status,201);
 const room={...other.data.room,completedAt:f.now()};const stored=JSON.parse(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(room.id).data);stored.completedAt=f.now();f.db.prepare('UPDATE mobile_rooms SET data=?,completed_at=? WHERE id=?').run(JSON.stringify(stored),f.now(),room.id);
 const otherCheer=f.call('/api/rooms/'+room.id+'/cheers',{id:rid(),emote:'cat'},other.data.token,identity(2));assert.equal(otherCheer.data.cursor,start+3);
 assert.equal(f.get().data.cursor,start+3);assert.equal(f.get().data.cheers.length,2);
});

test('cheers require completed rooms, valid inputs and the same admitted member as cursors',t=>{
 const f=fixture(t,{completed:false});assert.equal(f.get().status,200);assert.deepEqual(f.get().data.cheers,[]);
 assert.equal(f.post().data.code,'ROOM_NOT_COMPLETED');f.patchRoom({completedAt:f.now()});
 for(const input of [{id:rid(),emote:'bad'},{id:'A'.repeat(32),emote:'clap'},{id:'short',emote:'clap'},{id:23,emote:'clap'},{}, {id:rid(),emote:['cat']}]){const result=f.post(input);assert.equal(result.status,400);assert.equal(result.data.code,'INVALID_CHEER');}
 assert.equal(f.call(f.path+'/cheers',undefined,f.ticket.token,identity(1),'PUT').data.code,'METHOD_NOT_ALLOWED');
 for(const actor of [{owner:identity(1)},{owner:identity(2),token:f.ticket.token},{owner:identity(1),token:rid()}])for(const body of [undefined,{id:rid(),emote:'heart'}]){
  const cheer=f.call(f.path+'/cheers',body,actor.token,actor.owner),cursor=f.call(f.path+'/cursors',body,actor.token,actor.owner);assert.deepEqual(cheer,cursor);
 }
 assert.equal(f.call(f.path,{type:'leave'},f.ticket.token).status,200);
 for(const body of [undefined,{id:rid(),emote:'heart'}]){const result=f.call(f.path+'/cheers',body,f.ticket.token);assert.equal(result.status,409);assert.equal(result.data.code,'ROOM_ADMISSION_REQUIRED');assert.deepEqual(result,f.call(f.path+'/cursors',body,f.ticket.token));}
});

test('cheers dedupe does not consume rate limits and the two-second window rolls forward',t=>{
 const f=fixture(t),id=rid();assert.equal(f.post({id,emote:'heart'}).status,200);
 for(let n=0;n<5;n++)assert.equal(f.post({id,emote:'heart'}).status,200);
 for(let n=0;n<3;n++)assert.equal(f.post().status,200);
 const denied=f.post();assert.equal(denied.status,429);assert.equal(denied.data.code,'CHEER_RATE_LIMIT');assert.equal(f.get().data.cheers.length,4);
 assert.equal(f.post({id,emote:'heart'}).status,200,'duplicate is accepted even at the limit');f.advance(1999);assert.equal(f.post().status,429);f.advance(1);assert.equal(f.post().status,200);
 const bt=f.call(f.path+'/join',{},undefined,identity(2)).data;assert.equal(f.call(f.path+'/cheers',{id,emote:'star'},bt.token,identity(2)).status,200,'dedupe is scoped to the member');
});

test('minute rate limits survive item expiry and the sweep, and recover after sixty seconds',t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=fixture(t);
 for(let batch=0;batch<10;batch++){for(let n=0;n<4;n++)assert.equal(f.post().status,200);f.advance(2000);}
 assert.equal(f.post().status,429);f.advance(15000);assert.equal(f.get().data.cheers.length,0);
 t.mock.timers.tick(30000);assert.equal(f.post().status,429,'sweeping an empty item list must retain minute bookkeeping');
 f.advance(25000);assert.equal(f.post().status,200,'the oldest four cheers leave the rolling minute window');
});

test('the sweep drops closed rooms even when their cheers have not expired',t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=fixture(t);assert.equal(f.post().status,200);
 f.patchRoom({closedAt:f.now()});t.mock.timers.tick(30000);f.patchRoom({closedAt:null});
 assert.deepEqual(f.get().data.cheers,[],'the fixture clock has not advanced, so cleanup came from room closure');
});

test('cheers expire at fifteen seconds, retain the newest sixty, and never replay after service restart',t=>{
 // Eight players need a 500-piece table; smaller tables seat four or six.
 const f=fixture(t,{pieces:500}),tickets=[f.ticket];for(let n=2;n<=8;n++){const joined=f.call(f.path+'/join',{},undefined,identity(n));assert.equal(joined.status,200);tickets.push(joined.data);}
 const ids=[];for(let batch=0;batch<2;batch++){for(let player=0;player<8;player++)for(let n=0;n<4;n++){const id=rid();ids.push(id);assert.equal(f.call(f.path+'/cheers',{id,emote:'popper'},tickets[player].token,identity(player+1)).status,200);}if(!batch)f.advance(2000);}
 const snapshot=f.get().data;assert.equal(snapshot.cheers.length,60);assert.deepEqual(snapshot.cheers.map(item=>item.id),ids.slice(-60));assert.equal(snapshot.cheers.at(-1).seq,snapshot.cursor);
 const restarted=createMobileService({databasePath:f.databasePath,now:f.now});try{const result=restarted.handle({identity:identity(1),method:'GET',url:f.path+'/cheers',authorization:'Bearer '+f.ticket.token});assert.equal(result.status,200);assert.deepEqual(result.data.cheers,[]);}finally{restarted.close();}
 f.advance(12999);assert.equal(f.get().data.cheers.length,60);f.advance(1);assert.equal(f.get().data.cheers.length,32);f.advance(2000);assert.equal(f.get().data.cheers.length,0);assert.equal(f.get().data.cursor,snapshot.cursor);
});

test('realtime cheer methods observe completion and leave after a subscribed room changes',t=>{
 const f=fixture(t,{completed:false}),context=f.service.realtime.subscribe({identity:identity(1),roomId:f.ticket.room.id,authorization:'Bearer '+f.ticket.token});
 assert.throws(()=>f.service.realtime.writeCheer(context,{id:rid(),emote:'cat'}),{status:409,code:'ROOM_NOT_COMPLETED'});
 f.patchRoom({completedAt:f.now()});assert.equal(f.call(f.path,{type:'heartbeat'},f.ticket.token).status,200);
 f.service.realtime.writeCheer(context,{id:rid(),emote:'cat'});const data=f.service.realtime.readCheers(context,0);assert.equal(data.cheers.length,1);assert.deepEqual(f.service.realtime.readCheers(context,null),{...data,cheers:[]});
 assert.equal(f.call(f.path,{type:'leave'},f.ticket.token).status,200);assert.throws(()=>f.service.realtime.writeCheer(context,{id:rid(),emote:'cat'}),{status:409,code:'ROOM_ADMISSION_REQUIRED'});assert.throws(()=>f.service.realtime.readCheers(context,0),{status:409,code:'ROOM_ADMISSION_REQUIRED'});
});
