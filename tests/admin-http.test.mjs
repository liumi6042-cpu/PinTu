import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,createHash } from 'node:crypto';
import { testDatabase,cleanupFixtureRooms } from './server-fixture-db.mjs';
import { makeRoom,addMember } from '../lib/room-engine.ts';
const base='http://localhost:3000',id=()=>randomBytes(16).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');
async function call(path,body,cookie='',token=''){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
test('configured administrator can reversibly moderate rooms, accounts and scores with an audit trail',{skip:process.env.PUZZLE_TEST_ADMIN!=='1'},async()=>{
 const fixture=JSON.parse(await readFile(new URL('../work/admin-http-fixture.json',import.meta.url),'utf8')),db=await testDatabase(),roomId=id(),token=id(),secret=randomBytes(32).toString('hex'),owner='guest:'+hash(secret),guest='puzzle_guest='+secret,username='moderate_'+id().slice(0,8);let userId;
 try{
  db.prepare('DELETE FROM puzzle_admin_audit WHERE actor_id=?').run(fixture.id);db.prepare('DELETE FROM puzzle_request_limits WHERE key=?').run('password-check:'+hash(fixture.id));
  const admin=await call('/api/auth/login',{username:fixture.username,password:fixture.password});assert.equal(admin.status,200);
  assert.equal((await call('/api/admin',undefined,admin.cookie)).status,200);assert.equal((await call('/api/admin')).status,401);
  const user=await call('/api/auth/register',{username,name:'运营验收',password:fixture.password});assert.equal(user.status,201);userId=user.data.account.id;
  const room=makeRoom(roomId,'seaside',108,Date.now());room.visibility='public';addMember(room,id(),'运营验收',hash(token),Date.now(),undefined,owner);
  db.prepare('INSERT INTO puzzle_rooms VALUES (?,?,?,?)').run(roomId,0,JSON.stringify(room),room.expiresAt);
  db.prepare('INSERT INTO puzzle_room_directory VALUES (?,?,?,?,?,?,?,?,NULL,NULL)').run(roomId,'public',owner,'运营验收','seaside',108,Date.now(),room.expiresAt);
  db.prepare('INSERT INTO puzzle_results VALUES (?,?,?,?,?,?,?,?)').run(roomId,'team','seaside',108,1,12345,Date.now(),'["运营验收"]');
  const action=(action,target=roomId,cookie=admin.cookie)=>call('/api/admin',{action,target,reason:'Independent local acceptance test',password:fixture.password},cookie);
  assert.equal((await action('close-room',roomId,user.cookie)).status,403);
  assert.equal((await action('close-room')).status,200);assert.equal((await call('/api/rooms/'+roomId,undefined,guest,token)).status,403);
  assert.equal((await action('open-room')).status,200);assert.equal((await call('/api/rooms/'+roomId,undefined,guest,token)).status,200);
  assert.equal((await action('hide-score')).status,200);let board=await call('/api/leaderboard?mode=team&imageId=seaside&pieces=108&players=1');assert.ok(!board.data.entries.some(r=>r.roomId===roomId));
  assert.equal((await action('show-score')).status,200);board=await call('/api/leaderboard?mode=team&imageId=seaside&pieces=108&players=1');assert.ok(board.data.entries.some(r=>r.roomId===roomId));
  assert.equal((await action('suspend-account',userId)).status,200);assert.equal((await call('/api/auth/me',undefined,user.cookie)).data.account,null);assert.equal((await call('/api/auth/login',{username,password:fixture.password})).status,403);
  assert.equal((await action('restore-account',userId)).status,200);assert.equal((await call('/api/auth/login',{username,password:fixture.password})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM puzzle_admin_audit WHERE actor_id=?').get(fixture.id).n,6);
 }finally{db.prepare('DELETE FROM puzzle_room_moderation WHERE room_id=?').run(roomId);db.prepare('DELETE FROM puzzle_score_moderation WHERE room_id=?').run(roomId);cleanupFixtureRooms(db,[roomId],[owner]);if(userId){for(const table of ['puzzle_sessions','puzzle_account_security'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);db.prepare('DELETE FROM puzzle_users WHERE id=?').run(userId);}db.prepare('DELETE FROM puzzle_login_attempts WHERE username=?').run(username);db.close();}
});
