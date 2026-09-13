import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzle,LEVELS} from '../lib/puzzle-engine.ts';
import {expandCreatedTicket,rememberCreatedTicket,takeCreatedTicket} from '../lib/room-creation.ts';
import {apiJson,joinPuzzle} from '../lib/community-client.ts';
import {roomSessionKey} from '../lib/room-client.ts';

const id='1'.repeat(32),token='2'.repeat(32),playerId='3'.repeat(32),imageId='emerald-river-valley-native-v2';
function fixture(level=LEVELS.at(-1),seed=42){
 const puzzle=createPuzzle(imageId,level.cols,level.rows,seed);
 const {groups,...initial}=puzzle;
 const metadata={id,visibility:'public',revision:0,serverTime:100,expiresAt:86400100,members:[],leases:{},startedAt:null};
 return {full:{token,playerId,room:{...metadata,puzzle}},small:{token,playerId,initialState:'seed-v1',room:{...metadata,puzzle:initial}}};
}
test('compact fresh creation reproduces all piece positions through 5000, without transmitting groups',()=>{
 for(const level of LEVELS)for(const seed of [0,42,0xffffffff]){
  const {full,small}=fixture(level,seed);
  assert.deepEqual(expandCreatedTicket(small),full);
  assert.ok(JSON.stringify(small).length<1000);
 }
 const {full,small}=fixture();assert.ok(JSON.stringify(small).length<JSON.stringify(full).length/100);
});
test('full snapshots including old progress stay intact; malformed seed responses are rejected',()=>{
 const {full,small}=fixture();full.room.puzzle.groups[0].locked=true;full.room.revision=8;
 assert.equal(expandCreatedTicket(full),full);
 for(const bad of [{...small,initialState:'future'}, {...small,room:{...small.room,revision:1}}, {...small,room:{...small.room,puzzle:{...small.room.puzzle,elapsed:5}}}])assert.throws(()=>expandCreatedTicket(bad));
});
test('creation memory holds only the latest room, expires, and is taken once',()=>{
 const {full}=fixture();rememberCreatedTicket(full,100);
 assert.equal(takeCreatedTicket('wrong',101),null);assert.equal(takeCreatedTicket(id,102),full);assert.equal(takeCreatedTicket(id,103),null);
 rememberCreatedTicket(full,100);assert.equal(takeCreatedTicket(id,15100),null);
 rememberCreatedTicket(full,100);const next={...full,room:{...full.room,id:'4'.repeat(32)}};rememberCreatedTicket(next,101);
 assert.equal(takeCreatedTicket(id,102),null);assert.equal(takeCreatedTicket(next.room.id,102),next);
});
function global(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
function setup(t){
 const data=new Map([['puzzle:guest-fallback','a'.repeat(64)]]),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 global(t,'localStorage',storage);global(t,'sessionStorage',storage);global(t,'indexedDB',undefined);
 takeCreatedTicket(id,Number.MAX_SAFE_INTEGER);t.after(()=>takeCreatedTicket(id,Number.MAX_SAFE_INTEGER));return data;
}
test('create plus immediate room entry uses one request; returning stored ticket is revalidated',async t=>{
 const storage=setup(t),calls=[],{full,small}=fixture();
 t.mock.method(globalThis,'fetch',async(path,init)=>{
  calls.push(path);
  if(path==='/api/rooms'){const body=JSON.parse(init.body);assert.equal(body.guestSecret,'a'.repeat(64));assert.equal(body.initialState,'seed-v1');return Response.json(small,{status:201});}
  assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json(full.room);
 });
 assert.deepEqual(await apiJson('/api/rooms',{imageId,pieces:5000,visibility:'public'}),full);
 assert.deepEqual(await joinPuzzle(id),full);assert.deepEqual(calls,['/api/rooms']);
 assert.equal(JSON.parse(storage.get(roomSessionKey(id))).token,token);
 assert.deepEqual(await joinPuzzle(id),full);assert.deepEqual(calls,['/api/rooms','/api/rooms/'+id]);
});
test('legacy server response stays compatible and denied creation does not seed a session',async t=>{
 setup(t);const {full}=fixture();
 t.mock.method(globalThis,'fetch',async()=>Response.json(full,{status:201}));
 assert.deepEqual(await apiJson('/api/rooms',{imageId,pieces:5000}),full);assert.deepEqual(takeCreatedTicket(id),full);
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'membership required'},{status:403}));
 await assert.rejects(apiJson('/api/rooms',{imageId,pieces:5000}),/membership required/);assert.equal(takeCreatedTicket(id),null);
});
