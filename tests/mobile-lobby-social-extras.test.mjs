import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
const actor=name=>createHash('sha256').update(name).digest('hex');
function setup(){
 let now=1800000000000;
 const service=createMobileService({publicTestPolicy:{privateMessages:true,customNames:true},now:()=>now,randomInt:min=>min});
 const call=(owner,path,body,authorization)=>service.handle({identity:owner,method:body===undefined?'GET':'POST',url:path,body:body===undefined?undefined:{requestId:rid(),...body},authorization:authorization?'Bearer '+authorization:undefined});
 return {call,advance:(ms=3000)=>now+=ms};
}

test('players who shared a table appear in each other\'s recent list until they become friends',()=>{
 const f=setup(),a=actor('recent-a'),b=actor('recent-b'),c=actor('recent-c');
 for(const owner of [a,b,c])f.call(owner,'/api/mobile/social');
 assert.deepEqual(f.call(a,'/api/mobile/social/recent').data.players,[]);
 const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.equal(created.status,201);
 const roomPath='/api/rooms/'+created.data.room.id;
 f.advance();assert.equal(f.call(b,roomPath+'/join',{}).status,200);
 const forA=f.call(a,'/api/mobile/social/recent').data.players,forB=f.call(b,'/api/mobile/social/recent').data.players;
 assert.equal(forA.length,1);assert.equal(forB.length,1);
 assert.equal(forA[0].code,f.call(b,'/api/mobile/social').data.self.code);assert.equal(forA[0].roomTitle,created.data.room.title);assert.equal(typeof forA[0].seenAt,'number');assert.equal(forA[0].requested,false);
 assert.ok(!JSON.stringify(forA).includes(b),'opaque identities never leak');
 assert.deepEqual(f.call(c,'/api/mobile/social/recent').data.players,[],'players who never sat together are not listed');
 // Becoming friends removes them from the recent list.
 const bc=forA[0].code,ac=forB[0].code;f.call(a,'/api/mobile/social/requests',{code:bc});
 assert.equal(f.call(a,'/api/mobile/social/recent').data.players[0].requested,true);
 f.call(b,'/api/mobile/social/requests/respond',{code:ac,accept:true});
 assert.deepEqual(f.call(a,'/api/mobile/social/recent').data.players,[]);
});

test('the lobby lists seated members and reports online and daily-finished counts',()=>{
 const f=setup(),a=actor('lobby-a'),b=actor('lobby-b');
 const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.equal(created.status,201);
 f.call(b,'/api/rooms/'+created.data.room.id+'/join',{});
 const lobby=f.call(a,'/api/lobby?limit=4').data;
 assert.equal(lobby.rooms.length,1);assert.equal(lobby.rooms[0].members.length,2);
 for(const member of lobby.rooms[0].members){assert.equal(typeof member.name,'string');assert.equal(typeof member.level,'number');assert.ok('decoration' in member);}
 assert.ok(!JSON.stringify(lobby).includes(a)&&!JSON.stringify(lobby).includes(b),'no opaque identities in the lobby');
 assert.equal(lobby.online,2);assert.equal(lobby.dailyFinished,0);
});

test('room members carry their 拼合 count and the result ranks every contributor',()=>{
 const f=setup(),a=actor('rank-a'),b=actor('rank-b');
 const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'}),path='/api/rooms/'+created.data.room.id,joined=f.call(b,path+'/join',{}).data;
 let current=created.data.room,turn=0;
 while(current.completedAt===null){
  const [who,token]=turn%3===2?[b,joined.token]:[a,created.data.token],group=current.puzzle.groups.find(g=>!g.locked);
  assert.equal(f.call(who,path,{type:'claim',groupId:group.id},token).status,200);
  const reply=f.call(who,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1},token);assert.equal(reply.status,200,JSON.stringify(reply.data));current=reply.data;turn++;f.advance(500);
 }
 const ranking=current.mobileResult.ranking;
 assert.equal(ranking.length,2);assert.ok(ranking[0].contribution>=ranking[1].contribution);
 assert.equal(ranking.reduce((n,row)=>n+row.contribution,0),turn);
 assert.equal(ranking.filter(row=>row.mine).length,1);
 assert.ok(!JSON.stringify(ranking).includes(a)&&!JSON.stringify(ranking).includes(b),'no opaque identities');
 const mine=current.members.find(member=>member.code===ranking.find(row=>row.mine).code);assert.equal(typeof mine?.contribution,'number');
});
