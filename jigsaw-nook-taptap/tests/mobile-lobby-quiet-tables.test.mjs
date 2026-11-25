import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService,LOBBY_QUIET_HIDE_MS} from '../server/mobile-service.mjs';
import {ONLINE_MS} from '../outputs/mobile/engine.mjs';

const start=1800000000000,rid=()=>randomBytes(16).toString('hex'),player=n=>n.toString(16).padStart(64,'0');
function fixture(t){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-quiet-lobby-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=start;const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(identity,method,url,body,authorization)=>service.handle({identity,method,url,...(body?{body}:{}),...(authorization?{authorization:'Bearer '+authorization}:{})});
 const create=(identity,pieces=48)=>{const r=call(identity,'POST','/api/rooms',{mode:'random',pieces,visibility:'public',requestId:rid()});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
 const act=(identity,roomId,token,type)=>{const r=call(identity,'POST','/api/rooms/'+roomId,{type},token);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const listed=roomId=>{const r=call(player(999),'GET','/api/lobby?limit=24');assert.equal(r.status,200,JSON.stringify(r.data));return r.data.rooms.some(card=>card.id===roomId);};
 const lockPieces=(roomId,count)=>{const row=db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(roomId),room=JSON.parse(row.data);let left=count;for(const group of room.puzzle.groups){if(left<=0)break;group.locked=true;left-=group.pieces.length;}db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),roomId);};
 return {call,create,act,listed,lockPieces,advance:ms=>{now+=ms;}};
}

test('an empty public table under 10% leaves the lobby five minutes after the last player walks away',t=>{
 const f=fixture(t),{room,token}=f.create(player(1));
 // Sitting at the table keeps it listed, however long the player stays.
 for(let i=0;i<20;i++){f.advance(ONLINE_MS/2);f.act(player(1),room.id,token,'heartbeat');}
 assert.ok(f.listed(room.id),'occupied table is listed');
 f.act(player(1),room.id,token,'leave');
 assert.ok(f.listed(room.id),'still listed right after leaving');
 f.advance(LOBBY_QUIET_HIDE_MS-1000);assert.ok(f.listed(room.id),'listed just under five minutes');
 f.advance(1000);assert.ok(!f.listed(room.id),'hidden after five quiet minutes');
 // The table itself stays reachable: the owner keeps it, and joining it brings it back to the lobby.
 assert.ok(f.call(player(1),'GET','/api/my-rooms').data.rooms.some(card=>card.id===room.id));
 const joined=f.call(player(2),'POST','/api/rooms/'+room.id+'/join',{});assert.equal(joined.status,200,JSON.stringify(joined.data));
 assert.ok(f.listed(room.id),'back in the lobby once somebody sits down');
});

test('a dropped connection counts from the last heartbeat, not from the last move',t=>{
 const f=fixture(t),{room,token}=f.create(player(1));
 for(let i=0;i<10;i++){f.advance(ONLINE_MS/2);f.act(player(1),room.id,token,'heartbeat');}
 f.advance(LOBBY_QUIET_HIDE_MS-1000);assert.ok(f.listed(room.id));
 f.advance(1000);assert.ok(!f.listed(room.id));
});

test('an empty table at 10% or more keeps its usual lobby day',t=>{
 const f=fixture(t),busy=f.create(player(1)),barely=f.create(player(2));
 // A 48-piece pick is cut into 54 pieces here: 6 placed is over 10%, 5 is under (progress counts the real pieces).
 f.lockPieces(busy.room.id,6);f.lockPieces(barely.room.id,5);
 f.act(player(1),busy.room.id,busy.token,'leave');f.act(player(2),barely.room.id,barely.token,'leave');
 f.advance(LOBBY_QUIET_HIDE_MS*6);
 assert.ok(f.listed(busy.room.id),'10%+ table stays listed');
 assert.ok(!f.listed(barely.room.id),'under-10% table is hidden');
 f.advance(24*60*60*1000);assert.ok(!f.listed(busy.room.id),'the lobby day still ends as before');
});
