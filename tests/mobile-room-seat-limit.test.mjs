import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {ONLINE_MS,addMember} from '../outputs/mobile/engine.mjs';

const start=1800000000000,rid=()=>randomBytes(16).toString('hex'),player=n=>n.toString(16).padStart(64,'0');
function fixture(t){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-seat-limit-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=start;const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(identity,method,url,body,authorization)=>service.handle({identity,method,url,...(body?{body}:{}),...(authorization?{authorization:'Bearer '+authorization}:{})});
 // 500-piece tables open at level 10 on TapTap.
 const create=(identity,pieces,mode='random')=>{if(mode!=='daily'&&pieces>=500){call(identity,'GET','/api/mobile/profile');db.prepare("UPDATE mobile_profiles SET data=json_set(data,'$.level',10) WHERE id=?").run(identity);}const r=call(identity,'POST','/api/rooms',{mode,...(mode==='daily'?{}:{pieces}),visibility:'public',requestId:rid()});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
 const join=(identity,roomId)=>call(identity,'POST','/api/rooms/'+roomId+'/join',{});
 const lobby=query=>{const r=call(player(999),'GET','/api/lobby?limit=24'+(query?'&'+query:''));assert.equal(r.status,200,JSON.stringify(r.data));return r.data.rooms;};
 return {call,create,join,lobby,db,advance:ms=>{now+=ms;}};
}

test('a room seats 4 below 300 pieces, 6 below 500 and 8 from 500, in tickets, snapshots and lobby cards',t=>{
 const f=fixture(t),expected={48:4,108:4,300:6,500:8},ids={};
 for(const [pieces,seats] of Object.entries(expected)){const ticket=f.create(player(Number(pieces)),Number(pieces));ids[pieces]=ticket.room.id;assert.equal(ticket.room.maxPlayers,seats,pieces);assert.equal(ticket.room.requestedPieces,Number(pieces));}
 const cards=new Map(f.lobby().map(card=>[card.id,card]));
 for(const [pieces,seats] of Object.entries(expected)){assert.equal(cards.get(ids[pieces]).maxPlayers,seats,pieces);assert.equal(cards.get(ids[pieces]).players,1);}
 const owner=f.call(player(108),'GET','/api/my-rooms');assert.equal(owner.data.rooms.find(room=>room.id===ids[108]).maxPlayers,4);
});

test('a full table refuses the next player with the usual room-full reply until a seat frees up',t=>{
 const f=fixture(t),{room,token}=f.create(player(1),108),tokens={1:token};
 for(const n of [2,3,4]){const r=f.join(player(n),room.id);assert.equal(r.status,200,JSON.stringify(r.data));tokens[n]=r.data.token;assert.equal(r.data.room.members.length,n);assert.equal(r.data.room.maxPlayers,4);}
 const full=f.join(player(5),room.id);assert.equal(full.status,409);assert.equal(full.data.error,'房间已有 4 位玩家，请稍后再试');assert.equal(full.data.code,'ROOM_ERROR');
 const card=f.lobby().find(card=>card.id===room.id);assert.equal(card.players,4);assert.equal(card.maxPlayers,4);
 assert.ok(!f.lobby('open=1').some(card=>card.id===room.id),'a full table is not offered as open');
 // Player 2 drops offline and the seat goes to player 5; player 2 cannot reconnect while the table is full.
 f.advance(ONLINE_MS+1000);for(const n of [1,3,4])assert.equal(f.call(player(n),'POST','/api/rooms/'+room.id,{type:'heartbeat'},tokens[n]).status,200);
 assert.ok(f.lobby('open=1').some(card=>card.id===room.id));
 assert.equal(f.join(player(5),room.id).status,200);
 const action=f.call(player(2),'POST','/api/rooms/'+room.id,{type:'heartbeat'},tokens[2]);assert.equal(action.status,409);assert.equal(action.data.error,'房间已有 4 位玩家，请稍后再连接');
 const back=f.join(player(2),room.id);assert.equal(back.status,409);assert.equal(back.data.error,'房间已有 4 位玩家，请稍后再试');
 assert.equal(f.call(player(3),'POST','/api/rooms/'+room.id,{type:'heartbeat'},tokens[3]).status,200);
 // A player who leaves frees the seat at once.
 assert.equal(f.call(player(4),'POST','/api/rooms/'+room.id,{type:'leave'},tokens[4]).status,200);
 assert.equal(f.join(player(2),room.id).status,200);
});

test('300-piece tables take six players, 500-piece tables eight',t=>{
 const f=fixture(t);
 for(const [pieces,seats] of [[300,6],[500,8]]){
  const {room}=f.create(player(pieces),pieces);
  for(let n=1;n<seats;n++)assert.equal(f.join(player(pieces+n),room.id).status,200);
  const full=f.join(player(pieces+seats),room.id);assert.equal(full.status,409);assert.equal(full.data.error,'房间已有 '+seats+' 位玩家，请稍后再试');
 }
});

test('a full daily table sends the next player to a fresh daily table',t=>{
 const f=fixture(t),first=f.create(player(1),108,'daily').room;assert.equal(first.maxPlayers,4);
 for(const n of [2,3,4])assert.equal(f.create(player(n),108,'daily').room.id,first.id);
 const next=f.create(player(5),108,'daily').room;assert.notEqual(next.id,first.id);assert.equal(next.members.length,1);
});

test('rooms without their own limit keep eight seats in the engine',()=>{
 const now=start,room={id:'r',visibility:'private',members:[],leases:{},expiresAt:now+86400000,completedAt:null,puzzle:{groups:[]}};
 for(let n=0;n<8;n++)addMember(room,'m'+n,'玩家'+n,'d'+n,now,undefined,player(n));
 assert.throws(()=>addMember(room,'m8','玩家8','d8',now,undefined,player(8)),/8 位玩家/);
 const small={...room,members:[],playerLimit:4};
 for(let n=0;n<4;n++)addMember(small,'m'+n,'玩家'+n,'d'+n,now,undefined,player(n));
 assert.throws(()=>addMember(small,'m4','玩家4','d4',now,undefined,player(4)),/4 位玩家/);
 assert.equal(small.members.filter(m=>now-m.lastSeen<ONLINE_MS).length,4);
});
