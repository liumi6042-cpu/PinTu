import test from 'node:test';
import assert from 'node:assert/strict';
import {roomImagePreload} from '../lib/room-image-preload.ts';
import {preloadPuzzleImage} from '../lib/puzzle-image-loading.ts';
import {joinPuzzle} from '../lib/community-client.ts';
import {roomSessionKey} from '../lib/room-client.ts';

const src='/puzzles/landscape-play-0123456789ab.webp',roomId='1'.repeat(32),token='2'.repeat(32),playerId='3'.repeat(32);
const room={id:roomId,visibility:'public',expiresAt:200,puzzle:{imageId:'landscape'}};
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
function global(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}

test('only unexpired public catalog artwork is announced before admission',()=>{
 const photos=[{id:'landscape',src}];
 assert.equal(roomImagePreload(room,photos,100),src);
 for(const visibility of ['private','solo',undefined])assert.equal(roomImagePreload({...room,visibility},photos,100),null);
 assert.equal(roomImagePreload({...room,customImage:{id:'custom-private'}},photos,100),null);
 assert.equal(roomImagePreload(room,photos,200),null);
 assert.equal(roomImagePreload(room,[],100),null);
});

test('selected-image hint is bounded, uses the original, and ignores private URLs',t=>{
 let hint=null,created=0;
 global(t,'document',{querySelector:()=>hint,createElement:()=>{created++;return {dataset:{}};},head:{appendChild:node=>{hint=node;}}});
 for(const path of [src,src,'/puzzles/second-play-abcdef123456.webp'])preloadPuzzleImage(path);
 assert.equal(created,1);assert.equal(hint.rel,'preload');assert.equal(hint.as,'image');assert.equal(hint.fetchPriority,'high');
 for(const path of ['/api/user-images/secret','https://other.example/image.webp','/puzzles/landscape-thumbnail-0123456789ab.webp'])preloadPuzzleImage(path);
 assert.equal(hint.href,'/puzzles/second-play-abcdef123456.webp');
});

function setup(t,{saved=true}={}){
 const session=storage(),local=storage(),calls=[];
 global(t,'sessionStorage',session);global(t,'localStorage',local);
 if(saved){const value=JSON.stringify({token,playerId});session.setItem(roomSessionKey(roomId),value);local.setItem(roomSessionKey(roomId)+':account',value);}
 // Exercise the stable fallback identity without a real IndexedDB.
 global(t,'indexedDB',undefined);local.setItem('puzzle:guest-fallback','a'.repeat(64));
 return calls;
}
const response=(data,status=200)=>Response.json(data,{status});

test('returning player makes one authenticated heartbeat with no redundant guest request',async t=>{
 const calls=setup(t);
 t.mock.method(globalThis,'fetch',async(path,init)=>{calls.push(path);assert.equal(init.headers.Authorization,'Bearer '+token);return response(room);});
 assert.deepEqual(await joinPuzzle(roomId),{token,playerId,room});assert.deepEqual(calls,['/api/rooms/'+roomId]);
});

test('missing cookie is restored before retrying the same ticket, preserving admission and leases',async t=>{
 const calls=setup(t);let beats=0;
 t.mock.method(globalThis,'fetch',async(path,init)=>{calls.push(path);if(path==='/api/guest'){assert.equal(JSON.parse(init.body).secret,'a'.repeat(64));return response({ready:true});}assert.equal(init.headers.Authorization,'Bearer '+token);return ++beats===1?response({error:'unauthorized'},401):response(room);});
 assert.deepEqual(await joinPuzzle(roomId),{token,playerId,room});assert.deepEqual(calls,['/api/rooms/'+roomId,'/api/guest','/api/rooms/'+roomId]);
});

test('new visitor still establishes persistent identity before joining',async t=>{
 const calls=setup(t,{saved:false});
 t.mock.method(globalThis,'fetch',async(path)=>{calls.push(path);return response(path==='/api/guest'?{ready:true}:{token,playerId,room});});
 assert.deepEqual(await joinPuzzle(roomId),{token,playerId,room});assert.deepEqual(calls,['/api/guest','/api/rooms/'+roomId+'/join']);
});

test('rejected ticket never bypasses the server join and solo login checks',async t=>{
 const calls=setup(t);
 t.mock.method(globalThis,'fetch',async(path)=>{calls.push(path);if(path==='/api/guest')return response({ready:true});return response({error:'sign in required'},401);});
 await assert.rejects(joinPuzzle(roomId),/sign in required/);
 assert.equal(calls.at(-1),'/api/rooms/'+roomId+'/join');assert.equal(calls.filter(path=>path==='/api/guest').length,1);
});
