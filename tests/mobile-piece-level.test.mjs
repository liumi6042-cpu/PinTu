import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';

const start=1800000000000,rid=()=>randomBytes(16).toString('hex'),player=n=>n.toString(16).padStart(64,'0');
function fixture(t,options={}){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-piece-level-test-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>start,randomInt:min=>min,...options}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(identity,method,url,body)=>service.handle({identity,method,url,...(body?{body}:{})});
 const create=(identity,pieces)=>call(identity,'POST','/api/rooms',{mode:'random',pieces,visibility:'public',requestId:rid()});
 const profile=identity=>{const r=call(identity,'GET','/api/mobile/profile');assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const setLevel=(identity,level)=>{profile(identity);assert.equal(db.prepare("UPDATE mobile_profiles SET data=json_set(data,'$.level',?) WHERE id=?").run(level,identity).changes,1);};
 return {call,create,profile,setLevel};
}

test('a level-0 TapTap player cannot open a 500-piece table; at level 10 they can',t=>{
 const f=fixture(t),me=player(1);
 const locked=f.create(me,500);assert.equal(locked.status,403,JSON.stringify(locked.data));
 assert.equal(locked.data.code,'PIECES_LEVEL_LOCKED');assert.equal(locked.data.error,'10级解锁500片房间，先拼小一点的吧');assert.equal(locked.data.requiredLevel,10);
 f.setLevel(me,9);assert.equal(f.create(me,500).status,403);
 f.setLevel(me,10);const opened=f.create(me,500);assert.equal(opened.status,201,JSON.stringify(opened.data));assert.equal(opened.data.room.requestedPieces,500);
});

test('a level-0 player opens 300 pieces and joins someone else\'s 500-piece table',t=>{
 const f=fixture(t),owner=player(1),newcomer=player(2);
 assert.equal(f.create(newcomer,300).status,201);
 f.setLevel(owner,10);const {room}=f.create(owner,500).data;
 const joined=f.call(newcomer,'POST','/api/rooms/'+room.id+'/join',{});assert.equal(joined.status,200,JSON.stringify(joined.data));assert.equal(joined.data.room.members.length,2);
});

test('the profile carries the piece level rule for clients',t=>{
 const f=fixture(t);assert.deepEqual(f.profile(player(1)).pieceLevels,{500:10});
});

test('Web keeps 500-piece tables open to every level',t=>{
 const f=fixture(t,{runtimeProfile:'web'}),me=player(1);
 const opened=f.create(me,500);assert.equal(opened.status,201,JSON.stringify(opened.data));assert.deepEqual(f.profile(me).pieceLevels,{});
});
