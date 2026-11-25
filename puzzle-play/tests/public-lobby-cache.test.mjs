import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicLobbyCache} from '../lib/public-lobby-cache.ts';

const card=(id='public')=>({id,title:id,imageId:'image',pieces:300,visibility:'public',players:2,placed:10,elapsed:30,started:true,startedAt:1000,completed:false,expiresAt:100000});
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('a burst shares one successful public query and callers cannot mutate the cached list',async()=>{
 let calls=0,finish,now=1000;const database={},cache=new PublicLobbyCache(()=>now),source=[card()];
 const load=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const readers=Array.from({length:50},()=>cache.read(database,load));
 await settle();assert.equal(calls,1);finish(source);
 const lists=await Promise.all(readers);assert.ok(lists.every(list=>list[0].players===2));
 lists[0][0].players=8;lists[1].splice(0);source[0].title='changed by producer';
 now=1999;const fresh=await cache.read(database,load);
 assert.equal(calls,1);assert.equal(fresh[0].players,2);assert.equal(fresh[0].title,'public');assert.equal(fresh.length,1);
});

test('TTL expires exactly at one second and slow loads do not extend the freshness window',async()=>{
 let now=0,calls=0;const cache=new PublicLobbyCache(()=>now),database={};
 const load=async()=>{calls++;return [card(String(calls))];};
 assert.equal((await cache.read(database,load))[0].id,'1');
 now=999;assert.equal((await cache.read(database,load))[0].id,'1');
 now=1000;assert.equal((await cache.read(database,load))[0].id,'2');
 let finish;now=2000;const pending=cache.read(database,()=>new Promise(resolve=>{finish=resolve;}));
 await settle();now=3200;finish([card('slow')]);assert.equal((await pending)[0].id,'slow');
 assert.equal((await cache.read(database,load))[0].id,'3','a slow query must not be treated as freshly measured for another second');
});

test('failed queries coalesce but are never cached and the next request can recover',async()=>{
 const cache=new PublicLobbyCache(()=>10),database={};let calls=0,fail;
 const load=()=>{calls++;return new Promise((resolve,reject)=>{fail=reject;});};
 const readers=Array.from({length:10},()=>cache.read(database,load));
 const results=Promise.allSettled(readers);await settle();assert.equal(calls,1);fail(new Error('temporary database failure'));
 assert.ok((await results).every(result=>result.status==='rejected'));
 const recovered=await cache.read(database,async()=>{calls++;return [card('recovered')];});
 assert.equal(calls,2);assert.equal(recovered[0].id,'recovered');
});

test('one bounded slot isolates database instances and late old results cannot overwrite a newer database',async()=>{
 const cache=new PublicLobbyCache(()=>100),a={},b={};let finishA,bCalls=0;
 const old=cache.read(a,()=>new Promise(resolve=>{finishA=resolve;}));await settle();
 const loadB=async()=>{bCalls++;return [card('B')];};
 assert.equal((await cache.read(b,loadB))[0].id,'B');
 finishA([card('A')]);assert.equal((await old)[0].id,'A');
 assert.equal((await cache.read(b,loadB))[0].id,'B');assert.equal(bCalls,1);
 let aCalls=0;assert.equal((await cache.read(a,async()=>{aCalls++;return [card('new A')];}))[0].id,'new A');
 assert.equal(aCalls,1,'switching databases drops the prior slot instead of accumulating entries');
 const many=await cache.read({},async()=>Array.from({length:30},(_,i)=>card(String(i))));assert.equal(many.length,24);
});
