import { makeFixtureRoom as makeRoom } from './legacy-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addMember, applyAction, snapshot, roomElapsedMs } from '../lib/room-engine.ts';
import { passwordHash,equalHash,registration,sessionToken,sessionCookie,randomSecret } from '../lib/account-crypto.ts';
import { ADS_AVAILABLE,ASSISTANCE_POLICY } from '../lib/assistance-policy.ts';
function room(visibility='public'){const r=makeRoom('room','seaside',12,1000);Object.assign(r,{visibility,startedAt:null,ownerId:'owner',participants:{}});return r;}

test('password derivation is salted, repeatable and different from the password',async()=>{
 const a=await passwordHash('testing-password','salt-a'),b=await passwordHash('testing-password','salt-b');
 assert.notEqual(a,b);assert.equal(a.length,64);assert.ok(equalHash(a,await passwordHash('testing-password','salt-a')));assert.ok(!equalHash(a,b));
 assert.throws(()=>registration({username:'ab',name:'甲',password:'password'}));
 assert.throws(()=>registration({username:'tester',name:'甲',password:'short'}));
 assert.deepEqual(registration({username:' Tester ',name:'甲',password:'password'}),{username:'tester',name:'甲',password:'password'});
});
test('session cookies are opaque, HttpOnly, strict same-site and expire on logout',()=>{
 const token=randomSecret(),request=new Request('http://localhost:3000',{headers:{Cookie:'other=1; puzzle_session='+token+'; third=2'}});
 assert.equal(token.length,64);assert.equal(sessionToken(request),token);assert.match(sessionCookie(token,request),/HttpOnly; SameSite=Strict/);
 assert.match(sessionCookie('',request,true),/Max-Age=0/);assert.match(sessionCookie(token,new Request('https://example.test')),/Secure/);
 assert.equal(sessionToken(new Request('http://localhost',{headers:{Cookie:'puzzle_session=invalid'}})),null);
});
test('waiting in a public room does not count until the first valid claim',()=>{
 const r=room(),a=addMember(r,'a','甲','da',2000,'account-a');
 assert.equal(snapshot(r,3000).puzzle.elapsed,0);assert.throws(()=>applyAction(r,a,{type:'claim',groupId:-1},3000));assert.equal(r.startedAt,null);
 applyAction(r,a,{type:'claim',groupId:0},5000);assert.equal(r.startedAt,5000);assert.equal(roomElapsedMs(r,7250),2250);
 applyAction(r,a,{type:'release',groupId:0},7300);applyAction(r,a,{type:'claim',groupId:1},7400);assert.equal(r.startedAt,5000);
 assert.deepEqual(r.participants,{'account-a':'甲'});assert.equal(JSON.stringify(snapshot(r,7500)).includes('account-a'),false);
});
test('solo rooms enforce ownership and reconnect without creating another participant',()=>{
 const r=room('solo');assert.throws(()=>addMember(r,'other','乙','other',2000,'outsider'),error=>error.status===403);
 const a=addMember(r,'a','甲','da',2000,'owner'),again=addMember(r,'second','甲','db',2500,'owner');
 assert.equal(a.id,again.id);assert.equal(r.members.length,1);assert.equal(again.digest,'db');
});
test('completion freezes official time and counts only active account participants',()=>{
 const r=room(),a=addMember(r,'a','甲','da',2000,'account-a');addMember(r,'spectator','旁观','ds',2000,'spectator');
 for(let i=0;i<12;i++){const g=r.puzzle.groups.find(g=>g.pieces.includes(i));if(g.locked)continue;applyAction(r,a,{type:'claim',groupId:g.id},5000+i*100);applyAction(r,a,{type:'drop',groupId:g.id,dx:0,dy:0,seq:1},5050+i*100);}
 assert.ok(r.completedAt);assert.equal(roomElapsedMs(r,999999),r.completedAt-5000);assert.deepEqual(Object.keys(r.participants),['account-a']);
});
test('solo organization preserves connected pieces and never rearranges a public table',()=>{
 const r=room('solo'),a=addMember(r,'a','甲','da',2000,'owner');
 applyAction(r,a,{type:'claim',groupId:0},3000);assert.throws(()=>applyAction(r,a,{type:'shuffle'},3001),error=>error.status===409);
 applyAction(r,a,{type:'drop',groupId:0,dx:0,dy:0,seq:1},3100);
 const locked=structuredClone(r.puzzle.groups.find(g=>g.locked)),start=r.startedAt;
 applyAction(r,a,{type:'shuffle'},3200);assert.deepEqual(r.puzzle.groups.find(g=>g.locked),locked);assert.equal(r.startedAt,start);
 const publicRoom=room(),b=addMember(publicRoom,'b','乙','db',2000,'owner');assert.throws(()=>applyAction(publicRoom,b,{type:'shuffle'},3000),error=>error.status===403);
});
test('ad assistance remains locked and an unfinished game cannot preview the whole picture',async()=>{
 assert.equal(ADS_AVAILABLE,false);assert.equal(ASSISTANCE_POLICY.hint.maxPerGame,3);assert.equal(ASSISTANCE_POLICY.reference.maxPerGame,null);assert.equal(ASSISTANCE_POLICY.reference.durationSeconds,30);
 const source=await readFile(new URL('../app/puzzle-app.tsx',import.meta.url),'utf8'),game=source.slice(source.indexOf('export function Game'));
 assert.ok(!game.includes('.hint('));assert.ok(!game.includes('reference-card'));assert.match(game,/metrics\.placed\s*===\s*total\s*&&\s*<button className="text-button preview-game-button"/);
 for(const tool of ['hint','reference','underlay'])assert.ok(game.includes("setAssistance('"+tool+"')"));
});
