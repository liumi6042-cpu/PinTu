import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {testDatabase} from './server-fixture-db.mjs';
import {makeRoom,addMember} from '../lib/room-engine.ts';
const base=process.env.PUZZLE_NODE_TEST_URL||'http://localhost:3000';
if(base!=='http://localhost:3000'&&base!=='http://127.0.0.1:3113')throw Error('Test server required');
if(base.includes('3113')&&!process.env.PUZZLE_NODE_TEST_DATABASE?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated database required');
const db=base.includes('3113')?new DatabaseSync(process.env.PUZZLE_NODE_TEST_DATABASE):await testDatabase();
const origin=base.includes('3113')?'https://jigsawnook.online':base;
const rooms=[],users=[],identities=[];
const id=()=>randomBytes(16).toString('hex'),hash=value=>createHash('sha256').update(value).digest('hex');
async function call(path,body,cookie='',token=''){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(base.includes('3113')?{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'198.51.100.67'}:{}),Origin:origin,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
}
try{
 const secret=randomBytes(32).toString('hex'),guestCookie='puzzle_guest='+secret,guestId='guest:'+hash(secret);identities.push(guestId);
 const input={imageId:'seaside',pieces:108,visibility:'solo'};
 assert.equal((await call('/api/rooms',input)).status,401);
 assert.equal((await call('/api/rooms',{...input,isMember:true,accountId:id()},guestCookie)).status,401);
 const account=await call('/api/auth/register',{username:'soloq_'+id().slice(0,12),name:'Solo QA',password:'FreeSolo-'+id()},guestCookie);
 assert.equal(account.status,201,JSON.stringify(account.data));users.push(account.data.account.id);identities.push(account.data.account.id);
 const signed=account.cookie+'; '+guestCookie;
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM puzzle_memberships WHERE user_id=?').get(account.data.account.id).n,0);
 const created=await call('/api/rooms',input,signed);assert.equal(created.status,201,JSON.stringify(created.data));rooms.push(created.data.room.id);
 const path='/api/rooms/'+created.data.room.id;
 assert.equal((await call(path+'/join',{},guestCookie)).status,401);
 assert.equal((await call(path,undefined,guestCookie,created.data.token)).status,401);
 assert.equal((await call(path,{type:'claim',groupId:0},guestCookie,created.data.token)).status,401);
 assert.equal((await call(path+'/join',{},signed)).status,200);
 assert.equal((await call(path,{type:'claim',groupId:0},signed,created.data.token)).status,200);
 assert.equal((await call(path,{type:'drop',groupId:0,dx:0,dy:0,seq:1},signed,created.data.token)).status,200);
 assert.equal((await call(path+'/cursors',undefined,signed,created.data.token)).status,400);
 assert.equal((await call('/api/rooms',{...input,visibility:'private'},signed)).status,403,'free login does not grant membership');
 // A pre-update guest solo fixture stays owned by that browser, after signing in.
 const old=makeRoom(id(),'seaside',108,Date.now()),oldToken=id();old.visibility='solo';old.ownerId=guestId;old.startedAt=null;old.participants={};
 const oldMember=addMember(old,id(),'Legacy guest',hash(oldToken),Date.now(),undefined,guestId);
 db.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(old.id,old.revision,JSON.stringify(old),old.expiresAt);rooms.push(old.id);
 const oldPath='/api/rooms/'+old.id,initial=JSON.stringify(old.puzzle);
 assert.equal((await call(oldPath+'/join',{},guestCookie)).status,401);
 assert.equal((await call(oldPath,undefined,guestCookie,oldToken)).status,401);
 assert.equal((await call(oldPath+'/join',{},account.cookie)).status,403,'login without original guest identity cannot claim the old room');
 const resumed=await call(oldPath+'/join',{},signed);assert.equal(resumed.status,200,JSON.stringify(resumed.data));assert.equal(resumed.data.playerId,oldMember.id);assert.equal(JSON.stringify(resumed.data.room.puzzle),initial);
 assert.equal((await call(oldPath,undefined,signed,resumed.data.token)).status,200);
 const publicRoom=await call('/api/rooms',{...input,visibility:'public'},guestCookie);assert.equal(publicRoom.status,201,JSON.stringify(publicRoom.data));rooms.push(publicRoom.data.room.id);
 const friendSecret=randomBytes(32).toString('hex');identities.push('guest:'+hash(friendSecret));
 assert.equal((await call('/api/rooms/'+publicRoom.data.room.id+'/join',{},'puzzle_guest='+friendSecret)).status,200);
 const saved=JSON.parse(db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(created.data.room.id).data).puzzle;
 await call('/api/auth/logout',{},signed);
 assert.equal((await call(path,{type:'heartbeat'},signed,created.data.token)).status,401);
 assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(created.data.room.id).data).puzzle,saved);
 console.log('Solo sign-in HTTP passed: free account create/play, anonymous denial, legacy owner continuity, logout, private membership and guest public play.');
}finally{
 for(const room of rooms){for(const table of ['puzzle_personal_hidden_rooms','puzzle_result_players','puzzle_achievement_settled','puzzle_achievement_facts','puzzle_room_cursors','puzzle_results','puzzle_room_directory'])db.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(room);db.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(room);}
 for(const identity of identities){for(const table of ['puzzle_achievement_profiles','puzzle_achievement_awards','puzzle_achievement_days'])db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).run(identity);db.prepare('DELETE FROM puzzle_beta_seats WHERE identity=?').run(identity);}
 for(const user of users){for(const table of ['puzzle_membership_orders','puzzle_memberships','puzzle_sessions'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user);db.prepare('DELETE FROM puzzle_users WHERE id=?').run(user);}
 db.close();
}
