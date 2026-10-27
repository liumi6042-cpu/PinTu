import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {ONLINE_MS,PHOTOS,currentRoomArtwork} from '../outputs/mobile/engine.mjs';

const owner='a'.repeat(64),now=1800000000000;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function fixture(t){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-lobby-order-test-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=url=>service.handle({identity:owner,method:'GET',url});
 const created=service.handle({identity:owner,method:'POST',url:'/api/rooms',body:{mode:'random',pieces:48,visibility:'public',requestId:randomBytes(16).toString('hex')}});assert.equal(created.status,201);
 const template=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(created.data.room.id).data);db.exec('DELETE FROM mobile_rooms');
 const add=(n,{players=1,...changes}={})=>{
  const room={...structuredClone(template),id:n.toString(16).padStart(32,'0'),createdAt:now-10000,lastPlayedAt:now-5000,...changes};
  room.members=Array.from({length:players},(_,i)=>({...template.members[0],id:i.toString(16).padStart(32,'0'),lastSeen:now-ONLINE_MS+1}));
  room.members.push({...template.members[0],id:'f'.repeat(32),lastSeen:now-ONLINE_MS},{...template.members[0],id:'e'.repeat(32),lastSeen:now-ONLINE_MS-1});
  db.prepare('INSERT INTO mobile_rooms(id,owner,visibility,pieces,created_at,completed_at,closed_at,data) VALUES(?,?,?,?,?,?,?,?)').run(room.id,room.ownerId,room.visibility,room.mobilePieces,room.createdAt,room.completedAt,room.closedAt??null,JSON.stringify(room));return room.id;
 };
 const lobby=query=>{const response=call('/api/lobby?'+query);assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
 return {add,call,lobby,template};
}

test('lobby orders online players first, then activity with creation fallback, then descending id',t=>{
 const f=fixture(t),empty=f.add(6,{players:0,createdAt:now,lastPlayedAt:now}),old=f.add(1,{players:1,createdAt:now,lastPlayedAt:now-8000});
 const three=f.add(2,{players:3,createdAt:now-20000,lastPlayedAt:now-19000}),recent=f.add(3,{lastPlayedAt:now-1000});
 const fallback=f.add(4,{createdAt:now-2000,lastPlayedAt:null}),missing=f.add(5,{createdAt:now-3000,lastPlayedAt:undefined}),tie=f.add(7,{lastPlayedAt:now-8000});
 const rooms=f.lobby('limit=24').rooms;assert.deepEqual(rooms.map(r=>r.id),[three,recent,fallback,missing,tie,old,empty]);assert.deepEqual(rooms.map(r=>r.players),[3,1,1,1,1,1,0]);
});

test('lobby filters before ordering and pagination while preserving public room eligibility',t=>{
 const f=fixture(t),size=f.template.artwork,direction=size.width===size.height?'square':size.width>size.height?'landscape':'portrait';
 const other=PHOTOS.find(photo=>{const s=currentRoomArtwork(photo,48,true);return (s.width===s.height?'square':s.width>s.height?'landscape':'portrait')!==direction;});assert.ok(other);
 f.add(1,{players:8});f.add(2,{players:6,acceptingNew:false});f.add(3,{players:0});f.add(4,{players:5,mobilePieces:108});f.add(5,{players:4,puzzle:{...f.template.puzzle,imageId:other.id},artwork:currentRoomArtwork(other,48,true)});
 f.add(6,{players:7,visibility:'private'});f.add(7,{players:7,expiresAt:now});f.add(8,{players:7,completedAt:now});f.add(9,{players:7,closedAt:now});
 const one=f.add(10),three=f.add(11,{players:3}),query='limit=1&direction='+direction+'&pieces=48&open=1&active=1';
 const first=f.lobby(query);assert.equal(first.total,2);assert.deepEqual(first.rooms.map(r=>r.id),[three]);assert.ok(first.nextCursor);
 const second=f.lobby(query+'&cursor='+first.nextCursor);assert.equal(second.total,2);assert.deepEqual(second.rooms.map(r=>r.id),[one]);assert.equal(second.nextCursor,null);
 const legacy=f.lobby(query+'&cursor='+encode([now,'f'.repeat(32)]));assert.equal(legacy.total,2);assert.deepEqual(legacy.rooms.map(r=>r.id),[three]);assert.deepEqual(JSON.parse(Buffer.from(legacy.nextCursor,'base64url').toString()),[now-10000,three]);
 const legacySecond=f.lobby(query+'&cursor='+legacy.nextCursor);assert.equal(legacySecond.total,2);assert.deepEqual(legacySecond.rooms.map(r=>r.id),[one]);assert.equal(legacySecond.nextCursor,null);
 assert.ok(f.lobby('active=1').rooms.every(r=>r.players>0));assert.ok(f.lobby('open=1').rooms.every(r=>r.players<8&&r.acceptingNew));
});

test('sorting-key cursors page through player, activity and id ties without losing rooms',t=>{
 const f=fixture(t),a=f.add(1,{players:0,lastPlayedAt:now}),b=f.add(2,{players:1,lastPlayedAt:now-2000}),c=f.add(3,{players:3,lastPlayedAt:now-9000});
 const d=f.add(4,{players:1,lastPlayedAt:now-1000}),e=f.add(5,{players:3,lastPlayedAt:now-9000}),g=f.add(6,{players:0,lastPlayedAt:now-1000}),h=f.add(7,{players:1,lastPlayedAt:now-1000});
 const expected=[e,c,h,d,b,a,g];
 for(const limit of [1,2,3,4]){
  const seen=[];let cursor=null,pages=0;
  do{const page=f.lobby('limit='+limit+(cursor?'&cursor='+cursor:''));assert.equal(page.total,expected.length);seen.push(...page.rooms.map(r=>r.id));cursor=page.nextCursor;
   if(cursor){const last=page.rooms.at(-1);assert.deepEqual(JSON.parse(Buffer.from(cursor,'base64url').toString()),[last.players,last.lastPlayedAt??last.createdAt,last.id]);}assert.ok(++pages<=expected.length);
  }while(cursor);
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,expected.length);
 }
});

test('legacy cursors finish creation-order pagination without repeating or losing rooms',t=>{
 const f=fixture(t),a=f.add(1,{players:8,createdAt:now-3000,lastPlayedAt:now}),b=f.add(2,{players:3,createdAt:now-1000,lastPlayedAt:now-9000});
 const c=f.add(3,{players:0,createdAt:now-1000,lastPlayedAt:now-8000}),d=f.add(4,{players:1,createdAt:now-2000,lastPlayedAt:now-7000}),e=f.add(15,{players:0,createdAt:now-1000,lastPlayedAt:now-9000});
 const g=f.add(6,{players:4,createdAt:now-3000,lastPlayedAt:now-6000}),h=f.add(7,{players:2,createdAt:now-2000,lastPlayedAt:now-5000}),expected=[e,c,b,h,d,g,a];
 for(const limit of [1,2,3,4]){
  const seen=expected.slice(0,2);let cursor=encode([now-1000,c]),pages=0;
  do{const page=f.lobby('limit='+limit+'&cursor='+cursor);assert.equal(page.total,expected.length);seen.push(...page.rooms.map(r=>r.id));cursor=page.nextCursor;
   if(cursor){const last=page.rooms.at(-1);assert.deepEqual(JSON.parse(Buffer.from(cursor,'base64url').toString()),[last.createdAt,last.id]);}assert.ok(++pages<=expected.length);
  }while(cursor);
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,expected.length);
 }
});

test('legacy cursor boundaries accept safe timestamps and do not require an existing anchor room',t=>{
 const f=fixture(t),id=f.add(1);
 assert.deepEqual(f.lobby('cursor='+encode([Number.MAX_SAFE_INTEGER,'f'.repeat(32)])).rooms.map(r=>r.id),[id]);
 const end=f.lobby('cursor='+encode([0,id]));assert.deepEqual(end.rooms,[]);assert.equal(end.nextCursor,null);assert.equal(end.total,1);
});

test('malformed lobby cursors still return 400 INVALID_CURSOR',t=>{
 const f=fixture(t),id=f.add(1);
 for(const cursor of [encode(null),encode({}),encode([]),encode([now]),encode([1,now]),encode([-1,id]),encode([1.5,id]),encode([String(now),id]),encode([Number.MAX_SAFE_INTEGER+1,id]),encode([null,id]),encode([now,[id]]),encode([now,'bad-id']),encode([now,'g'.repeat(32)]),encode([now,'a'.repeat(31)]),encode([1,now,id,'extra']),encode([-1,now,id]),encode([1.5,now,id]),encode(['1',now,id]),encode([1,'now',id]),encode([1,Number.MAX_SAFE_INTEGER+1,id]),encode([1,now,[id]]),encode([1,now,'bad-id']),'not-json']){
  const response=f.call('/api/lobby?cursor='+encodeURIComponent(cursor));assert.equal(response.status,400,cursor);assert.equal(response.data.code,'INVALID_CURSOR',cursor);
 }
 assert.equal(f.call('/api/lobby?cursor='+encode([1,now,id])).status,200);
});
