import { fixtureFetch as fetch } from './room-http-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3001';
async function call(path,method='GET',input,token){const r=await fetch(base+path,{method,headers:{...(input?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:input?JSON.stringify(input):undefined});return {status:r.status,data:await r.json()};}
test('two real HTTP clients share actions, reject conflicting claims, reconnect, and complete together',async()=>{
 const created=await call('/api/rooms','POST',{imageId:'seaside-native-v2',pieces:108,name:'测试甲'});assert.equal(created.status,201);const a=created.data,path='/api/rooms/'+a.room.id;
 const joined=await call(path+'/join','POST',{name:'测试乙'});assert.equal(joined.status,200);const b=joined.data;
 const read=await call(path,'GET',undefined,b.token);assert.deepEqual(read.data.puzzle.groups,a.room.puzzle.groups);assert.equal(read.data.members.length,2);assert.equal((await call(path)).status,401);
 const claims=await Promise.all([call(path,'POST',{type:'claim',groupId:0},a.token),call(path,'POST',{type:'claim',groupId:0},b.token)]);assert.deepEqual(claims.map(c=>c.status).sort(),[200,409]);const winner=claims[0].status===200?a:b,other=winner===a?b:a;
 assert.equal((await call(path,'POST',{type:'move',groupId:0,dx:180,dy:180,seq:2},winner.token)).status,200);
 assert.equal((await call(path,'POST',{type:'move',groupId:0,dx:100,dy:100,seq:1},winner.token)).status,200);
 const otherView=await call(path,'GET',undefined,other.token);assert.equal(otherView.data.puzzle.groups.find(g=>g.id===0).dx,180);
 assert.equal((await call(path,'POST',{type:'drop',groupId:0,dx:0,dy:0,seq:3},other.token)).status,409);
 assert.equal((await call(path,'POST',{type:'drop',groupId:0,dx:0,dy:0,seq:3},winner.token)).status,200);
 // Both members can independently drop different pieces concurrently.
 const before=await call(path,'GET',undefined,a.token),loose=before.data.puzzle.groups.filter(g=>!g.locked).slice(0,2);
 await Promise.all(loose.map((g,i)=>call(path,'POST',{type:'claim',groupId:g.id},i?a.token:b.token)));
 const moves=await Promise.all(loose.map((g,i)=>call(path,'POST',{type:'drop',groupId:g.id,dx:0,dy:0,seq:1},i?a.token:b.token)));assert.ok(moves.every(r=>r.status===200));
 for(let turn=0;turn<108;turn++){const s=await call(path,'GET',undefined,a.token),g=s.data.puzzle.groups.find(g=>!g.locked);if(!g)break;const token=turn%2?a.token:b.token;assert.equal((await call(path,'POST',{type:'claim',groupId:g.id},token)).status,200);assert.equal((await call(path,'POST',{type:'drop',groupId:g.id,dx:0,dy:0,seq:1},token)).status,200);}
 const aEnd=await call(path,'GET',undefined,a.token),bEnd=await call(path,'GET',undefined,b.token);assert.deepEqual(aEnd.data.puzzle.groups,bEnd.data.puzzle.groups);assert.equal(aEnd.data.puzzle.groups.length,1);assert.equal(aEnd.data.puzzle.groups[0].pieces.length,108);assert.ok(aEnd.data.puzzle.groups[0].locked);
 assert.equal((await call(path,'POST',{type:'leave'},b.token)).status,200);const alone=await call(path,'GET',undefined,a.token);assert.equal(alone.data.members.length,1);
 assert.equal((await call(path,'POST',{type:'heartbeat'},b.token)).status,200);const reconnected=await call(path,'GET',undefined,a.token);assert.equal(reconnected.data.members.length,2);
 await Promise.all([call(path,'POST',{type:'leave'},a.token),call(path,'POST',{type:'leave'},b.token)]);
});
