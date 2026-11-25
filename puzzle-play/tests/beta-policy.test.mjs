import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomWriteQueue } from '../lib/room-write-queue.ts';
import { retryDelay } from '../lib/request-backoff.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('per-room writes are serialized without blocking other rooms; failures release bounded queues',async()=>{
 const queue=new RoomWriteQueue(2,3),events=[];let release;
 const gate=new Promise(resolve=>release=resolve);
 const a=queue.run('a',async()=>{events.push('a1');await gate;throw new Error('test failure');});
 const b=queue.run('a',async()=>events.push('a2'));
 await assert.rejects(queue.run('a',async()=>0),/正在同步/);
 await queue.run('b',async()=>events.push('b1'));assert.deepEqual(events,['a1','b1']);
 release();await assert.rejects(a,/test failure/);await b;assert.deepEqual(events,['a1','b1','a2']);
 await queue.run('a',async()=>events.push('a3'));
});
test('Retry-After accepts seconds and dates and bounds malformed or huge values',()=>{
 assert.equal(retryDelay('2'),2000);assert.equal(retryDelay(null),1000);assert.equal(retryDelay('9999999'),60000);
 assert.equal(retryDelay('Thu, 10 Sep 2026 00:00:05 GMT',Date.parse('2026-09-10T00:00:00Z')),5000);
 assert.equal(retryDelay('invalid'),1000);
});
test('beta admission is atomic, renews current identities and releases expired slots',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE puzzle_users(id TEXT PRIMARY KEY);');db.exec('CREATE TABLE puzzle_sessions(user_id TEXT);');
 db.exec(readFileSync(new URL('../drizzle/0006_free_beta.sql',import.meta.url),'utf8'));
 const sql=readFileSync(new URL('../lib/beta-seats.ts',import.meta.url),'utf8').match(/prepare\(`([\s\S]*?)`\)/)[1];
 const seat=(who,now)=>db.prepare(sql).run(who,now+22000,who,now,now,2).changes;
 assert.equal(seat('a',100),1);assert.equal(seat('b',100),1);assert.equal(seat('c',100),0);assert.equal(seat('a',200),1);assert.equal(seat('c',22201),1);db.close();
});
