import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { makeRoom, addMember } from '../lib/room-engine.ts';

const base=process.env.PUZZLE_NODE_TEST_URL,filename=process.env.PUZZLE_NODE_TEST_DATABASE;
if(base!=='http://127.0.0.1:3113'||!filename?.endsWith('/staging/puzzle.sqlite'))throw new Error('Requires isolated staging server and database');
const roomCount=process.env.PUZZLE_LOAD_ROOMS==='1'?1:3;
const origin='https://jigsawnook.online',db=new DatabaseSync(filename),id=()=>randomBytes(16).toString('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
const request=async(path,{body,cookie,token}={})=>{
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Proto':'https','X-Forwarded-Host':'jigsawnook.online','CF-Connecting-IP':'127.0.0.1',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text.slice(0,150);}
  return {status:response.status,data,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers:response.headers};
};
assert.equal((await request('/api/health')).status,200);
const lobby=await request('/api/lobby');assert.equal(lobby.status,200,JSON.stringify(lobby.data));assert.ok(Array.isArray(lobby.data.rooms));
assert.ok([401,403].includes((await request('/api/admin')).status));
const username='qa_'+id().slice(0,10),password=randomBytes(18).toString('hex');
assert.equal((await request('/api/auth/register',{body:{username,name:'Deploy QA',password:'123'}})).status,400);
const registration=await request('/api/auth/register',{body:{username,name:'Deploy QA',password}});
assert.equal(registration.status,201,JSON.stringify(registration.data));assert.match(registration.headers.get('set-cookie'),/Secure/);
assert.ok([401,403].includes((await request('/api/admin',{cookie:registration.cookie})).status));
const a=await request('/api/guest',{body:{secret:randomBytes(32).toString('hex')}}),b=await request('/api/guest',{body:{secret:randomBytes(32).toString('hex')}});
assert.match(a.headers.get('set-cookie'),/Secure/);
assert.equal((await request('/api/rooms',{cookie:a.cookie,body:{visibility:'private',imageId:'seaside',pieces:108}})).status,403);
assert.equal((await request('/api/rooms',{cookie:a.cookie,body:{visibility:'solo',imageId:'seaside',pieces:108}})).status,401);
const solo=await request('/api/rooms',{cookie:registration.cookie,body:{visibility:'solo',imageId:'seaside',pieces:2000}});
assert.equal(solo.status,201,JSON.stringify(solo.data));assert.equal(solo.data.room.puzzle.groups.length,2000);
assert.equal((await request('/api/rooms/'+solo.data.room.id+'/join',{cookie:b.cookie,body:{}})).status,401);
const created=await request('/api/rooms',{cookie:a.cookie,body:{visibility:'public',imageId:'seaside',pieces:108}});assert.equal(created.status,201);
const roomId=created.data.room.id;
const one=await request('/api/rooms/'+roomId+'/join',{cookie:a.cookie,body:{}}),two=await request('/api/rooms/'+roomId+'/join',{cookie:b.cookie,body:{}});
assert.equal(one.status,200,JSON.stringify(one.data));assert.equal(two.status,200,JSON.stringify(two.data));
const auth={cookie:a.cookie,token:one.data.token},path='/api/rooms/'+roomId;
assert.equal((await request(path,{...auth,body:{type:'claim',groupId:0}})).status,200);
assert.equal((await request(path,{...auth,body:{type:'move',groupId:0,dx:140,dy:220,seq:1}})).status,200);
const seen=await request(path,{cookie:b.cookie,token:two.data.token});assert.equal(seen.data.puzzle.groups.find(g=>g.id===0).dx,140);
assert.equal((await request(path+'/cursors',{...auth,body:{clientId:id(),seq:1,point:{x:135,y:215}}})).status,200);
const pointers=await request(path+'/cursors',{cookie:b.cookie,token:two.data.token});assert.equal(pointers.data.cursors[0].x,135);
assert.equal((await request(path)).status,401);
await request(path,{...auth,body:{type:'leave'}});await request(path,{cookie:b.cookie,token:two.data.token,body:{type:'leave'}});
// Only this separately provisioned staging database may be reset for the bounded load.
db.exec('DELETE FROM puzzle_beta_seats');
const rooms=[],samples=[],errors=[],start=performance.now();
for(let r=0;r<roomCount;r++){
  const room=makeRoom(id(),'seaside',2000,Date.now()),players=[];room.visibility='public';room.startedAt=null;room.participants={};
  for(let p=0;p<8;p++){
    const secret=randomBytes(32).toString('hex'),token=id(),owner='guest:'+hash(secret);
    addMember(room,id(),'QA '+r+'-'+p,hash(token),Date.now(),undefined,owner);
    players.push({cookie:'puzzle_guest='+secret,token,clientId:id(),revision:0,seq:0,groupId:p,roomId:room.id});
  }
  db.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);rooms.push(players);
}
async function call(player,suffix,body){const at=performance.now(),result=await request('/api/rooms/'+player.roomId+suffix,{cookie:player.cookie,token:player.token,body});samples.push(performance.now()-at);if(result.status!==200)errors.push(result.status);if(result.data?.revision!==undefined)player.revision=Math.max(player.revision,result.data.revision);return result;}
await Promise.all(rooms.flat().map(p=>call(p,'',{type:'claim',groupId:p.groupId}).then(r=>assert.equal(r.status,200))));
const end=performance.now()+12000;
await Promise.all(rooms.flat().map(async p=>{while(performance.now()<end){const at=performance.now();p.seq++;await Promise.all([
  call(p,'?since='+p.revision),
  call(p,'/cursors',{clientId:p.clientId,seq:p.seq,point:{x:150+p.seq%60,y:220}}),
  call(p,'?since='+p.revision,{type:'move',groupId:p.groupId,dx:140+p.seq%60,dy:220,seq:p.seq}),
]);if(errors.length>3)throw new Error('Load stopped after repeated errors');await new Promise(r=>setTimeout(r,Math.max(0,350-(performance.now()-at))));}}));
await Promise.all(rooms.flat().map(p=>call(p,'',{type:'release',groupId:p.groupId})));
for(const players of rooms){const left=await call(players[0],''),right=await call(players[7],'');assert.deepEqual(left.data.puzzle.groups,right.data.puzzle.groups);assert.equal(left.data.puzzle.groups.flatMap(g=>g.pieces).length,2000);}
const extra=await request('/api/rooms/'+rooms[0][0].roomId+'/join',{cookie:'puzzle_guest='+randomBytes(32).toString('hex'),body:{}});assert.equal(extra.status,429);
const sorted=samples.toSorted((a,b)=>a-b),report={at:new Date().toISOString(),scope:'Isolated origin test, not overseas network latency',players:roomCount*8,piecesPerRoom:2000,rooms:roomCount,simultaneousDraggers:roomCount*8,requests:samples.length,errors,p50Ms:Math.round(sorted[Math.floor(sorted.length*.5)]),p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]),durationMs:Math.round(performance.now()-start),statesConverged:true,capacityRejectedExtraPlayer:true};
assert.equal(errors.length,0);writeFileSync(filename+'.http-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));db.close();
