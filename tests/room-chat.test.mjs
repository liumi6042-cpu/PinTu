import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
import {chatText,chatCursor,mergeChat} from '../lib/room-chat.ts';
const db=new SqliteD1(':memory:',resolve('drizzle'));globalThis.chatTestDb=db;
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'room-chat-test:env',shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url==='room-chat-test:env')return {format:'module',source:'export const env={PUZZLE_DB:globalThis.chatTestDb};',shortCircuit:true};return next(url,context);}});
const {sendChat,readChat}=await import('../lib/room-chat-store.ts');
function fixture(id,now){
 const member={id:'member-'+id,name:'Chat QA',color:'#99caf4',digest:'test',lastSeen:now+3600000,joinedAt:now};
 const room={id,visibility:'public',puzzle:{groups:[{id:0,pieces:[0],dx:5,dy:10,locked:false}],elapsed:17},members:[member],leases:{0:{playerId:member.id,seq:1,expires:now+60000}},expiresAt:now+7200000,revision:5,startedAt:now-17000};
 db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(id,room.revision,JSON.stringify(room),room.expiresAt);return {room,member};
}
test('text preserves emoji, accents, line breaks and inert markup, with Unicode and cursor limits',()=>{
 assert.equal(chatText('  你好 👋\r\ncafe\u0301\u0000  '),'你好 👋\ncafé');
 assert.equal(chatText('<img src=x onerror=alert(1)>'),'<img src=x onerror=alert(1)>');
 assert.equal(chatText('🌿'.repeat(300)),'🌿'.repeat(300));
 for(const value of ['🌿'.repeat(301),' '.repeat(5000),'\u0000\n',null,{},8])assert.equal(chatText(value),null);
 for(const value of [-1,1.5,'',null,'1e2','Infinity','9007199254740992'])assert.equal(chatCursor(value),null);
 assert.equal(chatCursor('123'),123);
});
test('atomic send limits and idempotency preserve every byte of the puzzle row',async()=>{
 const now=Date.now(),{room,member}=fixture('rate-room',now),before=db.sql.prepare('SELECT * FROM puzzle_rooms WHERE id=?').get(room.id);
 const concurrent=await Promise.all(Array.from({length:8},()=>sendChat(room.id,member,'alice','same','hello',now)));
 assert.ok(concurrent.every(m=>m.id===concurrent[0].id));
 assert.equal((await readChat(room.id)).messages.length,1);
 await assert.rejects(sendChat(room.id,member,'alice','same','different',now),{status:409});
 const rapid=await Promise.allSettled(Array.from({length:12},(_,i)=>sendChat(room.id,member,'alice','rapid'+i,'new',now+2000)));
 assert.equal(rapid.filter(result=>result.status==='fulfilled').length,1);
 for(let i=2;i<20;i++)await sendChat(room.id,member,'alice','next'+i,'next',now+i*2000);
 await assert.rejects(sendChat(room.id,member,'alice','over-quota','slow down',now+40000),{status:429});
 await sendChat(room.id,member,'bob','other-person','hello',now+40000);
 assert.deepEqual(db.sql.prepare('SELECT * FROM puzzle_rooms WHERE id=?').get(room.id),before);
 const other=fixture('other-room',now);
 await assert.rejects(sendChat(other.room.id,other.member,'alice','cross-room','hello',now+40000),{status:429});
});
test('history stays bounded, incremental reads isolate rooms, deletion cascades, stale admission cannot insert',async()=>{
 const now=Date.now(),{room,member}=fixture('history-room',now);
 for(let i=0;i<120;i++)await sendChat(room.id,member,'history-'+i%8,'request-'+i,'message-'+i,now+i*3000);
 const history=await readChat(room.id);assert.equal(history.messages.length,100);assert.equal(history.messages[0].text,'message-20');
 const last=history.messages.at(-1);assert.deepEqual((await readChat(room.id,last.id)).messages,[]);
 assert.deepEqual((await readChat(room.id,last.id-1)).messages,[last]);assert.deepEqual((await readChat('missing')).messages,[]);
 const merged=mergeChat(history.messages,[history.messages[0],last]);assert.equal(merged.length,100);assert.equal(merged.at(-1).id,last.id);
 db.sql.prepare('UPDATE puzzle_rooms SET expires_at=? WHERE id=?').run(now-1,room.id);
 await assert.rejects(sendChat(room.id,member,'new','expired','no',now),{status:429});
 db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(room.id);
 assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM puzzle_room_chat WHERE room_id=?').get(room.id).n,0);
});
test.after(()=>{db.close();delete globalThis.chatTestDb;});
