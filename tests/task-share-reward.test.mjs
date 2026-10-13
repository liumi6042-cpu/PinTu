import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskShareReward} from '../mobile/task-share-reward.ts';

function fixture(post){const memory=new Map();let sequence=0;return {memory,platform:{config:{apiBase:'https://game.test/h5'},storage:{get:key=>memory.get(key)??null,set:(key,value)=>memory.set(key,value),remove:key=>memory.delete(key)},randomId:()=>String(++sequence).padStart(32,'0')},post};}

test('only a copied link or confirmed completed system share can claim a sharing reward',async()=>{
 const requests=[],f=fixture(async requestId=>{requests.push(requestId);return {shared:{energy:23,xp:7,alreadyRewarded:false}};}),reward=new TaskShareReward(f.platform,f.post);
 for(const result of ['opened','cancelled','unavailable'])assert.equal(await reward.complete(result),null);
 assert.equal(requests.length,0);assert.equal(reward.pending(),null);
 assert.equal((await reward.complete('copied')).shared.energy,23);assert.equal((await reward.complete('shared')).shared.xp,7);assert.equal(requests.length,2);assert.notEqual(requests[0],requests[1]);assert.equal(reward.pending(),null);
});

test('a lost reward response keeps one request across restart and concurrent retries',async()=>{
 const requests=[],f=fixture(async requestId=>{requests.push(requestId);throw Error('network disconnected');}),reward=new TaskShareReward(f.platform,f.post);
 await assert.rejects(reward.complete('copied'),/disconnected/);const original=reward.pending();assert.match(original,/^[a-f0-9]{32}$/);
 let finish;const retry=new TaskShareReward(f.platform,requestId=>{requests.push(requestId);return new Promise(resolve=>finish=resolve);});
 const first=retry.claim(),second=retry.claim();assert.equal(first,second);finish({shared:{energy:23,xp:7,alreadyRewarded:false}});await first;
 assert.deepEqual(requests,[original,original]);assert.equal(retry.pending(),null);assert.equal(f.memory.size,0);
});
