import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base='http://localhost:3000',root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile),users=[],rooms=[],usernames=[];
async function call(path,body,cookie,token){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await r.json();return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function sql(name,content){
 const path=fileURLToPath(new URL('../work/'+name+'.sql',import.meta.url));await mkdir(new URL('../work/',import.meta.url),{recursive:true});await writeFile(path,content);
 await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file',path],{cwd:root,windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:1024*1024});
}
async function register(){const username='member_'+crypto.randomUUID().replaceAll('-','').slice(0,12);usernames.push(username);const r=await call('/api/auth/register',{username,password:'MembershipTest2026!',name:'会员测试'});if(r.data.account?.id)users.push(r.data.account.id);assert.equal(r.status,201);return r;}
test('member room quotas are atomic, only owners manage rooms, and expiry preserves old play',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
 try{
  const anonymous=await call('/api/membership');assert.equal(anonymous.status,200);assert.equal(anonymous.data.summary.account,false);assert.equal(anonymous.data.summary.canCreate,false);assert.deepEqual(anonymous.data.orders,[]);
  const owner=await register(),outsider=await register();
  const create={imageId:'seaside',pieces:108,visibility:'private',title:'朋友的桌面'};
  assert.equal((await call('/api/rooms',{...create,isMember:true,expiresAt:Date.now()+9999999},owner.cookie)).status,403);
  const now=Date.now();assert.match(owner.data.account.id,/^[a-f0-9]{32}$/);
  // Test-only entitlement seeded directly; there is no public grant or fake payment endpoint.
  await sql('membership-test-entitlement',`INSERT INTO puzzle_memberships VALUES ('${owner.data.account.id}','puzzle','active',${now-1000},${now+3600000},1);`);
  const enabled=(await call('/api/membership',undefined,owner.cookie)).data.summary;assert.equal(enabled.canCreate,true);assert.equal(enabled.membership.cancelAtPeriodEnd,true);
  const attempts=await Promise.all(Array.from({length:6},()=>call('/api/rooms',create,owner.cookie)));for(const result of attempts)if(result.status===201)rooms.push(result.data.room.id);
  assert.equal(attempts.filter(r=>r.status===201).length,3);assert.equal(attempts.filter(r=>r.status===409).length,3);
  let owned=(await call('/api/member-rooms',undefined,owner.cookie)).data.rooms;assert.equal(owned.length,3);assert.equal((await call('/api/member-rooms',undefined,outsider.cookie)).data.rooms.length,0);
  const ticket=attempts.find(r=>r.status===201).data,id=ticket.room.id,path='/api/rooms/'+id,manage='/api/member-rooms/'+id;
  const friend=await call(path+'/join',{},outsider.cookie);assert.equal(friend.status,200);
  const earlierGuest=await call(path+'/join',{});assert.equal(earlierGuest.status,200);
  const before=(await call(path,undefined,owner.cookie,ticket.token)).data;
  assert.equal((await call(manage,{title:'不应保存',visibility:'public'},outsider.cookie)).status,403);
  assert.equal((await call(manage,{title:'周末一起拼',visibility:'public',acceptingNew:false},owner.cookie)).status,200);
  const after=(await call(path,undefined,owner.cookie,ticket.token)).data;assert.deepEqual(after.puzzle,before.puzzle);assert.equal(after.expiresAt,before.expiresAt);assert.equal(after.startedAt,before.startedAt);assert.equal(after.title,'周末一起拼');assert.equal(after.acceptingNew,false);
  let lobby=(await call('/api/lobby')).data.rooms.find(r=>r.id===id);assert.ok(lobby);assert.equal(lobby.title,'周末一起拼');assert.equal(lobby.acceptingNew,false);
  assert.equal((await call(path+'/join',{})).status,403,'new guests cannot enter a closed room');
  const laterAccount=await register(),guestAndAccount=laterAccount.cookie+'; '+earlierGuest.cookie;
  const restoredGuest=await call(path+'/join',{},guestAndAccount);assert.equal(restoredGuest.status,200);assert.equal(restoredGuest.data.playerId,earlierGuest.data.playerId,'optional login preserves earlier guest admission');
  assert.equal((await call(path,{type:'leave'},outsider.cookie,friend.data.token)).status,200);
  assert.equal((await call(path+'/join',{},outsider.cookie)).status,200,'existing players may return');
  assert.equal((await call(manage,{visibility:'private'},owner.cookie)).status,200);
  assert.ok(!(await call('/api/lobby')).data.rooms.some(r=>r.id===id),'private room disappears from public cards');
  const expired=Date.now()-1000;
  await sql('membership-test-expire',`UPDATE puzzle_memberships SET starts_at=${expired-100000},expires_at=${expired} WHERE user_id='${owner.data.account.id}';`);
  const ended=(await call('/api/membership',undefined,owner.cookie)).data.summary;assert.equal(ended.status,'expired');assert.equal(ended.canCreate,false);
  assert.equal((await call('/api/rooms',create,owner.cookie)).status,403);
  assert.equal((await call(manage,{title:'到期仍可管理',acceptingNew:true},owner.cookie)).status,200);
  assert.equal((await call(path+'/join',{})).status,200,'subscription expiry does not gate existing rooms');
  assert.equal((await call(path,{type:'claim',groupId:0},owner.cookie,ticket.token)).status,200);
  assert.equal((await call(path,{type:'release',groupId:0},owner.cookie,ticket.token)).status,200);
  const obsolete=rooms.find(value=>value!==id);
  await sql('membership-test-release-quota',`UPDATE puzzle_memberships SET expires_at=${Date.now()+3600000} WHERE user_id='${owner.data.account.id}';
    UPDATE puzzle_rooms SET expires_at=${expired},data=json_set(data,'$.expiresAt',${expired}) WHERE id='${obsolete}';
    UPDATE puzzle_room_directory SET expires_at=${expired} WHERE room_id='${obsolete}';`);
  const replacement=await call('/api/rooms',create,owner.cookie);assert.equal(replacement.status,201);rooms.push(replacement.data.room.id);
  assert.equal((await call('/api/membership',undefined,owner.cookie)).data.summary.usedRooms,3);
  console.log(JSON.stringify({concurrentRequests:6,created:3,quotaRejected:3,ownershipEnforced:true,expiryPreservesPlay:true}));
 }finally{
  assert.ok(users.every(id=>/^[a-f0-9]{32}$/.test(id))&&rooms.every(id=>/^[a-f0-9]{32}$/.test(id))&&usernames.every(n=>/^member_[a-f0-9]{12}$/.test(n)));
  const uid=users.map(id=>`'${id}'`).join(',')||"''",rid=rooms.map(id=>`'${id}'`).join(',')||"''",names=usernames.map(id=>`'${id}'`).join(',')||"''";
  const statements=['puzzle_achievement_profiles','puzzle_achievement_awards','puzzle_achievement_facts','puzzle_achievement_days'].map(table=>`DELETE FROM ${table} WHERE owner_id IN (${uid});`);
  statements.push(...['puzzle_achievement_settled','puzzle_room_cursors','puzzle_results','puzzle_room_directory','puzzle_rooms'].map(table=>`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${rid});`));
  statements.push(...['puzzle_membership_orders','puzzle_memberships','puzzle_sessions'].map(table=>`DELETE FROM ${table} WHERE user_id IN (${uid});`),`DELETE FROM puzzle_login_attempts WHERE username IN (${names});`,`DELETE FROM puzzle_users WHERE id IN (${uid});`);
  await sql('membership-test-cleanup',statements.join('\n'));
 }
});
