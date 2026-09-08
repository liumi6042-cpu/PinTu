import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000';
async function call(path,body,cookie='',token='',origin){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text();assert.ok(response.headers.get('content-type')?.includes('application/json'),path+' '+response.status+' '+raw.slice(0,300));
 return {status:response.status,data:JSON.parse(raw),cookie:response.headers.get('Set-Cookie')};
}
test('local accounts, public directory, private/solo isolation and official rankings work end to end',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async t=>{
 const ids=[],roomIds=[];
 t.after(async()=>{
  // Only remove fixtures created by this test; never touch user accounts or seeded public tables.
  assert.ok([...ids,...roomIds].every(id=>/^[a-f0-9]{32}$/.test(id)));
  const quoted=values=>values.map(value=>"'"+value+"'").join(',');
  const statements=[];
  if(roomIds.length)for(const table of ['puzzle_results','puzzle_room_directory','puzzle_rooms'])statements.push('DELETE FROM '+table+' WHERE '+(table==='puzzle_rooms'?'id':'room_id')+' IN ('+quoted(roomIds)+');');
  if(ids.length){statements.push('DELETE FROM puzzle_sessions WHERE user_id IN ('+quoted(ids)+');');statements.push('DELETE FROM puzzle_login_attempts WHERE username IN (SELECT username FROM puzzle_users WHERE id IN ('+quoted(ids)+'));');statements.push('DELETE FROM puzzle_users WHERE id IN ('+quoted(ids)+');');}
  await mkdir(new URL('../work/',import.meta.url),{recursive:true});await writeFile(new URL('../work/community-test-cleanup.sql',import.meta.url),statements.join('\n'));
 });
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,10),username='test_'+suffix,password='test-pass-'+suffix;
 assert.equal((await call('/api/lobby')).status,401);
 assert.equal((await call('/api/rooms',{visibility:'solo',imageId:'seaside',pieces:12})).status,401);
 assert.equal((await call('/api/auth/register',{username,name:'甲',password},'','','https://untrusted.test')).status,403);
 const registered=await call('/api/auth/register',{username,name:'测试甲',password});assert.equal(registered.status,201);ids.push(registered.data.account.id);
 assert.match(registered.cookie,/HttpOnly/);assert.match(registered.cookie,/SameSite=Strict/);assert.ok(!JSON.stringify(registered.data).includes(password));
 let cookieA=registered.cookie.split(';')[0];
 assert.equal((await call('/api/auth/register',{username,name:'重复',password})).status,409);
 assert.equal((await call('/api/auth/login',{username,password:'incorrect'})).status,401);
 const loggedIn=await call('/api/auth/login',{username:username.toUpperCase(),password});assert.equal(loggedIn.status,200);cookieA=loggedIn.cookie.split(';')[0];
 assert.equal((await call('/api/auth/me',undefined,cookieA)).data.account.id,ids[0]);
 const b=await call('/api/auth/register',{username:'other_'+suffix,name:'测试乙',password});assert.equal(b.status,201);ids.push(b.data.account.id);const cookieB=b.cookie.split(';')[0];
 async function create(visibility,pieces=12){const result=await call('/api/rooms',{visibility,imageId:'seaside',pieces},cookieA);assert.equal(result.status,201,JSON.stringify(result.data));roomIds.push(result.data.room.id);return result.data;}
 const publicRoom=await create('public'),privateRoom=await create('private'),soloRoom=await create('solo');
 assert.equal((await call('/api/rooms/'+soloRoom.room.id,{type:'shuffle'},cookieA,soloRoom.token)).status,200);
 assert.equal((await call('/api/rooms/'+publicRoom.room.id,{type:'shuffle'},cookieA,publicRoom.token)).status,403);
 const large=await create('public',3000),largeJoin=await call('/api/rooms/'+large.room.id+'/join',{},cookieB);assert.equal(largeJoin.status,200);assert.equal(largeJoin.data.room.puzzle.groups.length,3000);
 assert.equal((await call('/api/rooms/'+large.room.id,{type:'claim',groupId:0},cookieA,large.token)).status,200);
 const largeDrop=await call('/api/rooms/'+large.room.id,{type:'drop',groupId:0,dx:1.76,dy:0,seq:1},cookieA,large.token);assert.equal(largeDrop.status,200);assert.ok(largeDrop.data.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));
 const directory=await call('/api/lobby',undefined,cookieB);assert.equal(directory.status,200);assert.ok(directory.data.rooms.some(r=>r.id===publicRoom.room.id));assert.ok(!directory.data.rooms.some(r=>[privateRoom.room.id,soloRoom.room.id].includes(r.id)));assert.ok(directory.data.rooms.length>=5);
 const summary=JSON.stringify(directory.data);for(const secret of ['digest','password_hash','accountId',publicRoom.token])assert.ok(!summary.includes(secret));
 assert.equal((await call('/api/rooms/'+soloRoom.room.id+'/join',{},cookieB)).status,403);
 assert.equal((await call('/api/rooms/'+soloRoom.room.id,undefined,cookieB,soloRoom.token)).status,401);
 const own=await call('/api/my-rooms',undefined,cookieA);assert.equal(own.status,200);assert.ok(own.data.rooms.some(r=>r.id===soloRoom.room.id));
 const joined=await call('/api/rooms/'+publicRoom.room.id+'/join',{},cookieB);assert.equal(joined.status,200);assert.equal(joined.data.room.members.length,2);
 const privateJoin=await call('/api/rooms/'+privateRoom.room.id+'/join',{},cookieB);assert.equal(privateJoin.status,200);
 assert.equal((await call('/api/rooms/'+publicRoom.room.id+'/join',{})).status,401);
 async function finish(ticket,second){
  const path='/api/rooms/'+ticket.room.id;
  let view=(await call(path,undefined,cookieA,ticket.token)).data;assert.equal(view.startedAt,null);assert.equal(view.puzzle.elapsed,0);
  let turn=0;
  while(view.puzzle.groups.some(g=>!g.locked)){
   const group=view.puzzle.groups.find(g=>!g.locked),isB=second&&turn%2===1,token=isB?second.token:ticket.token,cookie=isB?cookieB:cookieA;
   const claim=await call(path,{type:'claim',groupId:group.id},cookie,token);assert.equal(claim.status,200,JSON.stringify(claim.data));
   const dropped=await call(path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1},cookie,token);assert.equal(dropped.status,200,JSON.stringify(dropped.data));view=dropped.data;turn++;
  }
  assert.ok(view.completedAt);assert.ok(view.startedAt);const elapsed=view.completedAt-view.startedAt;
  await call(path,{type:'heartbeat'},cookieA,ticket.token);await call(path,undefined,cookieA,ticket.token);
  return elapsed;
 }
 const teamTime=await finish(publicRoom,joined.data),soloTime=await finish(soloRoom);
 const teamBoard=await call('/api/leaderboard?mode=team&imageId=seaside&pieces=12&players=2',undefined,cookieA);assert.equal(teamBoard.status,200);const teamRows=teamBoard.data.entries.filter(r=>r.roomId===publicRoom.room.id);assert.equal(teamRows.length,1);assert.equal(teamRows[0].elapsedMs,teamTime);assert.deepEqual(new Set(teamRows[0].names),new Set(['测试甲','测试乙']));
 const soloBoard=await call('/api/leaderboard?mode=solo&imageId=seaside&pieces=12',undefined,cookieA);assert.equal(soloBoard.status,200);assert.equal(soloBoard.data.entries.find(r=>r.roomId===soloRoom.room.id).elapsedMs,soloTime);
 assert.ok(!(await call('/api/lobby',undefined,cookieA)).data.rooms.some(r=>r.id===publicRoom.room.id));
 assert.equal((await call('/api/leaderboard?pieces=17',undefined,cookieA)).status,400);
 assert.equal((await call('/api/auth/logout',{},cookieA)).status,200);assert.equal((await call('/api/auth/me',undefined,cookieA)).data.account,null);
 assert.equal((await call('/api/rooms/'+privateRoom.room.id,undefined,cookieA,privateRoom.token)).status,401);
 assert.equal((await call('/api/lobby',undefined,cookieA)).status,401);
 for(let i=0;i<8;i++)assert.equal((await call('/api/auth/login',{username,password:'bad-password'})).status,401);
 assert.equal((await call('/api/auth/login',{username,password})).status,429);
});
