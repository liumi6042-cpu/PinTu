import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';

registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'lobby-cache-test:env',shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);return next(specifier,context);},load(url,context,next){if(url==='lobby-cache-test:env')return {format:'module',source:'export const env={get PUZZLE_DB(){return globalThis.lobbyCacheTestDb;}};',shortCircuit:true};return next(url,context);}});
const {roomCards,newPlayableRoom,insertPlayableRoom}=await import('../lib/lobby-store.ts');
const {GET}=await import('../app/api/lobby/route.ts');
const {PHOTOS}=await import('../lib/puzzle-catalog.ts');

test('public list shares across session wrappers, private lists bypass it, and API time stays current',async t=>{
 const db=new SqliteD1(':memory:',resolve('drizzle'));let summaries=0,sessions=0;
 const nativePrepare=db.prepare.bind(db),nativeBatch=db.batch.bind(db);
 const prepare=query=>{if(query.startsWith('SELECT ')&&query.includes(' AS customImageData'))summaries++;return nativePrepare(query);};
 globalThis.lobbyCacheTestDb={withSession(){sessions++;return {prepare,batch:nativeBatch};}};
 t.after(()=>{db.close();delete globalThis.lobbyCacheTestDb;});
 const now=Date.now(),publicRoom=newPlayableRoom('a'.repeat(32),PHOTOS[0].id,108,'public','owner',now);
 publicRoom.members=[{id:'guest',name:'Guest',digest:'digest',color:'#999',lastSeen:now,joinedAt:now}];
 const privateRoom=newPlayableRoom('b'.repeat(32),PHOTOS[0].id,108,'private','owner',now);
 await insertPlayableRoom(publicRoom);await insertPlayableRoom(privateRoom);
 const before=db.sql.prepare('SELECT * FROM puzzle_rooms ORDER BY id').all();
 const lists=await Promise.all(Array.from({length:30},()=>roomCards()));
 assert.equal(summaries,1);assert.ok(sessions>=30,'queries use separate primary session wrappers');
 for(const list of lists)assert.deepEqual(list.map(card=>card.id),[publicRoom.id]);
 lists[0][0].title='caller changed this';assert.notEqual((await roomCards())[0].title,'caller changed this');
 await roomCards('owner');await roomCards('owner');await roomCards('owner',true);
 assert.equal(summaries,4,'each personal or managed request runs its own query');
 const originalNow=Date.now;t.mock.method(Date,'now',()=>now+500);
 const response=await GET(),body=await response.json();
 assert.equal(body.serverTime,now+500);assert.equal(summaries,4);assert.deepEqual(body.rooms.map(card=>card.id),[publicRoom.id]);
 assert.equal(response.headers.get('Cache-Control'),'no-store','this is an internal public query cache, not a response cache');
 t.mock.method(Date,'now',originalNow);
 assert.deepEqual(db.sql.prepare('SELECT * FROM puzzle_rooms ORDER BY id').all(),before,'listing does not change live room state');
});
