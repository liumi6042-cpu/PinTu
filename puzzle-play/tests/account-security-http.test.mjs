import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { testDatabase } from './server-fixture-db.mjs';
const base='http://localhost:3000',hash=s=>createHash('sha256').update(s).digest('hex');
async function call(path,body,cookie='',origin=base){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw new Error(path+' '+response.status+' '+text.slice(0,350));}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',headers:response.headers};}
test('account recovery is single-use, rejects CSRF and revokes old sessions; requests and roles stay isolated',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
 const db=await testDatabase(),username='secure_'+randomBytes(5).toString('hex'),password='Fixture-original-'+randomBytes(10).toString('hex'),next='Fixture-next-'+randomBytes(10).toString('hex');let id;
 try{
  const registered=await call('/api/auth/register',{username,name:'安全测试',password});assert.equal(registered.status,201);id=registered.data.account.id;const cookie=registered.cookie;
  assert.equal((await call('/api/admin',undefined,cookie)).status,403);assert.equal((await call('/api/auth/security')).status,401);
  assert.equal((await call('/api/auth/security',{action:'recovery',password},cookie,'https://untrusted.invalid')).status,403);
  assert.equal((await call('/api/auth/security',{action:'recovery',password:'incorrect'},cookie)).status,403);
  const first=await call('/api/auth/security',{action:'recovery',password},cookie);assert.equal(first.status,200);assert.equal(first.data.code.replaceAll('-','').length,64);
  const stored=db.prepare('SELECT recovery_hash FROM puzzle_account_security WHERE user_id=?').get(id);assert.equal(stored.recovery_hash,hash(first.data.code.replaceAll('-','')));
  const summary=await call('/api/auth/security',undefined,cookie);assert.equal(summary.data.recoveryReady,true);assert.ok(!JSON.stringify(summary.data).includes(first.data.code));assert.equal(summary.headers.get('x-content-type-options'),'nosniff');
  const second=await call('/api/auth/security',{action:'recovery',password},cookie);assert.equal(second.status,200);
  assert.equal((await call('/api/auth/recover',{username,code:first.data.code,newPassword:next})).status,403);
  const results=await Promise.all([call('/api/auth/recover',{username,code:second.data.code,newPassword:next}),call('/api/auth/recover',{username,code:second.data.code,newPassword:next})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
  assert.equal((await call('/api/auth/me',undefined,cookie)).data.account,null);assert.equal((await call('/api/auth/login',{username,password})).status,401);
  const login=await call('/api/auth/login',{username,password:next});assert.equal(login.status,200);
  const request=await call('/api/auth/security',{action:'privacy',password:next},login.cookie);assert.equal(request.status,200);assert.equal(request.data.status,'pending');
  assert.equal((await call('/api/auth/security',undefined,login.cookie)).data.privacy.status,'pending');
  assert.equal((await call('/api/auth/security',{action:'privacy',password:next,cancel:true},login.cookie)).data.status,'cancelled');
  db.prepare("UPDATE puzzle_privacy_requests SET status='completed',resolution='Fixture reviewed' WHERE user_id=?").run(id);
  assert.equal((await call('/api/auth/security',{action:'privacy',password:next,cancel:true},login.cookie)).status,409);
  assert.equal((await call('/api/auth/security',undefined,login.cookie)).data.privacy.status,'completed');
  assert.equal((await call('/api/auth/security',{action:'password',password:next,newPassword:password},login.cookie)).status,200);
  assert.equal((await call('/api/auth/me',undefined,login.cookie)).data.account,null);assert.equal((await call('/api/auth/login',{username,password})).status,200);
  const attempts=await Promise.all(Array.from({length:9},()=>call('/api/auth/recover',{username,code:first.data.code,newPassword:next})));assert.ok(attempts.some(r=>r.status===429));
  for(const path of ['/api/health','/api/site-info'])assert.equal((await call(path)).status,200);
 }finally{if(id){for(const table of ['puzzle_privacy_requests','puzzle_account_security','puzzle_sessions'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);db.prepare('DELETE FROM puzzle_request_limits WHERE key=?').run('password-check:'+hash(id));db.prepare('DELETE FROM puzzle_users WHERE id=?').run(id);}db.prepare('DELETE FROM puzzle_login_attempts WHERE username=?').run(username);db.prepare('DELETE FROM puzzle_request_limits WHERE key=?').run('recovery:'+hash(username));db.close();}
});
