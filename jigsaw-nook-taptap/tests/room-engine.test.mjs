import { makeFixtureRoom as makeRoom } from './legacy-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, applyAction, authenticate, snapshot, LEASE_MS, ROOM_LIFETIME } from '../lib/room-engine.ts';
import { placedCount, boardFor, WORLD, restorePuzzle } from '../lib/puzzle-engine.ts';
function setup(){const r=makeRoom('test','seaside-native-v2',12,100000),a=addMember(r,'a','甲','digest-a',100000),b=addMember(r,'b','乙','digest-b',100000);r.puzzle.groups.forEach((g,i)=>{g.dx=2000+i*300;g.dy=3000+i*200;});return {r,a,b};}
test('two participants receive identical puzzle state without authentication secrets',()=>{const {r}=setup(),s=snapshot(r,100300);assert.equal(s.members.length,2);assert.equal(s.puzzle.groups.length,12);assert.ok(!JSON.stringify(s).includes('digest'));});
test('an unclaimed piece and another player’s lease cannot be moved',()=>{const {r,a,b}=setup();assert.throws(()=>applyAction(r,a,{type:'move',groupId:0,dx:2,dy:2,seq:1},100100));applyAction(r,a,{type:'claim',groupId:0},100100);assert.throws(()=>applyAction(r,b,{type:'claim',groupId:0},100101));assert.throws(()=>applyAction(r,b,{type:'move',groupId:0,dx:0,dy:0,seq:1},100102));});
test('stale moves cannot overwrite newer positions',()=>{const {r,a}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'move',groupId:0,dx:210,dy:210,seq:2},100200);applyAction(r,a,{type:'move',groupId:0,dx:110,dy:110,seq:1},100300);assert.equal(r.puzzle.groups[0].dx,210);});

test('expanded tabletop accepts all four new edges and bounds whole groups without changing saved progress',()=>{
 const {r,a}=setup(),group=r.puzzle.groups.find(g=>g.id===0);
 group.pieces=[0,1,4];r.puzzle.groups=r.puzzle.groups.filter(g=>g.id!==1&&g.id!==4);
 const locked=r.puzzle.groups.find(g=>g.id===11);locked.locked=true;locked.dx=0;locked.dy=0;r.puzzle.elapsed=173;
 const saved=structuredClone(r.puzzle),board=boardFor(saved.cols,saved.rows),w=board.width/saved.cols,h=board.height/saved.rows;
 assert.deepEqual(restorePuzzle(JSON.stringify(saved),[saved.imageId]),saved,'existing positions and progress load without migration');
 applyAction(r,a,{type:'heartbeat'},100100);assert.deepEqual(r.puzzle,saved,'opening/heartbeat does not rearrange existing pieces');
 const xs=group.pieces.map(id=>board.x+(id%saved.cols)*w),ys=group.pieces.map(id=>board.y+Math.floor(id/saved.cols)*h),minX=Math.min(...xs),maxX=Math.max(...xs)+w,minY=Math.min(...ys),maxY=Math.max(...ys)+h;
 applyAction(r,a,{type:'claim',groupId:0},100101);let seq=0;
 const move=(dx,dy)=>applyAction(r,a,{type:'move',groupId:0,dx,dy,seq:++seq},100101+seq);
 for(const [dx,dy] of [[-50-minX,100],[1570-maxX,100],[100,-40-minY],[100,1160-maxY]]){
  move(dx,dy);assert.deepEqual([group.dx,group.dy],[dx,dy],'positions beyond each old edge remain valid');
 }
 const lowX=WORLD.x+18-minX,highX=WORLD.x+WORLD.width-18-maxX,lowY=WORLD.y+18-minY,highY=WORLD.y+WORLD.height-18-maxY;
 for(const [dx,dy,expectedX,expectedY] of [[-5000,100,lowX,100],[5000,100,highX,100],[100,-5000,100,lowY],[100,5000,100,highY]]){
  move(dx,dy);assert.deepEqual([group.dx,group.dy],[expectedX,expectedY],'the whole group stays inside the new edge');
 }
 applyAction(r,a,{type:'drop',groupId:0,dx:5000,dy:5000,seq:++seq},100101+seq);
 assert.deepEqual([group.dx,group.dy],[highX,highY],'drop uses the same enlarged bounds as move');
 assert.deepEqual(group.pieces,[0,1,4]);assert.equal(group.locked,false);
 assert.deepEqual(r.puzzle.groups.filter(g=>g.id!==0),saved.groups.filter(g=>g.id!==0),'other pieces and completed groups retain their positions');
 assert.equal(r.puzzle.elapsed,173);assert.equal(placedCount(r.puzzle),1);assert.deepEqual(boardFor(r.puzzle.cols,r.puzzle.rows),board);
 assert.deepEqual(restorePuzzle(JSON.stringify(r.puzzle),[saved.imageId]),r.puzzle,'the moved group remains valid saved progress');
});
test('a drop cannot consume an adjacent group another player is holding',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,b,{type:'claim',groupId:1},100100);applyAction(r,b,{type:'move',groupId:1,dx:305,dy:305,seq:1},100200);applyAction(r,a,{type:'drop',groupId:0,dx:300,dy:300,seq:1},100250);assert.equal(r.puzzle.groups.length,12);assert.equal(r.leases[1].playerId,'b');applyAction(r,b,{type:'drop',groupId:1,dx:305,dy:305,seq:2},100300);assert.equal(r.puzzle.groups.length,11);assert.deepEqual(r.puzzle.groups.find(g=>g.pieces.includes(0)).pieces,[1,0]);});
test('expired leases release and stale owner operations are rejected',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,b,{type:'claim',groupId:0},100100+LEASE_MS+1);assert.equal(r.leases[0].playerId,'b');assert.throws(()=>applyAction(r,a,{type:'drop',groupId:0,dx:0,dy:0,seq:1},110200));});
test('presence heartbeat does not indefinitely hold a lost drag',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'heartbeat'},105000);applyAction(r,b,{type:'claim',groupId:0},110101);assert.equal(r.leases[0].playerId,'b');});
test('heartbeat renews a deliberately held piece and leaving releases it',()=>{const {r,a,b}=setup();applyAction(r,a,{type:'claim',groupId:0},100100);applyAction(r,a,{type:'heartbeat',groupId:0},109000);assert.throws(()=>applyAction(r,b,{type:'claim',groupId:0},111000));applyAction(r,a,{type:'leave'},111001);applyAction(r,b,{type:'claim',groupId:0},111002);assert.equal(r.leases[0].playerId,'b');});
test('invalid names, unsupported difficulty, invalid movement and unknown membership are rejected',()=>{const {r,a}=setup();assert.throws(()=>makeRoom('x','unknown',12,0));assert.throws(()=>makeRoom('x','seaside-native-v2',17,0));assert.throws(()=>addMember(r,'x','  ','x',100200));assert.throws(()=>authenticate(r,'bad',100200));applyAction(r,a,{type:'claim',groupId:0},100100);assert.throws(()=>applyAction(r,a,{type:'move',groupId:0,dx:NaN,dy:1,seq:1},100200));});
test('rooms enforce eight active players and expire at the extended retention deadline',()=>{const {r}=setup();for(let i=0;i<6;i++)addMember(r,`m${i}`,`玩家${i}`,`d${i}`,100100);assert.throws(()=>addMember(r,'ninth','第九位','d9',100200));assert.throws(()=>authenticate(r,'digest-a',r.expiresAt));});
test('shared completion count and timer remain stable after the last drop',()=>{const {r,a,b}=setup();for(let i=0;i<12;i++){const g=r.puzzle.groups.find(g=>g.pieces.includes(i));if(g.locked)continue;const player=i%2?a:b;applyAction(r,player,{type:'claim',groupId:g.id},101000+i*100);applyAction(r,player,{type:'drop',groupId:g.id,dx:0,dy:0,seq:1},101050+i*100);}assert.equal(placedCount(r.puzzle),12);const ended=r.completedAt;assert.ok(ended);assert.equal(snapshot(r,999999).puzzle.elapsed,Math.floor((ended-r.createdAt)/1000));});
