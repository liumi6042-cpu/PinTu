import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000';
async function call(path,method='GET',body,token){
  const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,`${method} ${path} returned ${response.status}`);return response.json();
}
test('two HTTP clients can join, move, snap and reconnect to a real 5000 piece room',{skip:process.env.PUZZLE_TEST_LARGE!=='1'},async()=>{
  const a=await call('/api/rooms','POST',{imageId:'seaside',pieces:5000,name:'五千片甲'}),path='/api/rooms/'+a.room.id;
  const b=await call(path+'/join','POST',{name:'五千片乙'});assert.equal(b.room.puzzle.cols*b.room.puzzle.rows,5000);
  assert.deepEqual(a.room.puzzle.groups,b.room.puzzle.groups);
  await Promise.all([call(path,'POST',{type:'claim',groupId:0},a.token),call(path,'POST',{type:'claim',groupId:1},b.token)]);
  await call(path,'POST',{type:'move',groupId:0,dx:100,dy:100,seq:1},a.token);
  assert.equal((await call(path,'GET',undefined,b.token)).puzzle.groups.find(g=>g.id===0).dx,100);
  await call(path,'POST',{type:'drop',groupId:0,dx:1.76,dy:0,seq:2},a.token);
  await call(path,'POST',{type:'drop',groupId:1,dx:1.76,dy:0,seq:1},b.token);
  const saved=await call(path,'GET',undefined,a.token),other=await call(path,'GET',undefined,b.token);
  assert.deepEqual(saved.puzzle.groups,other.puzzle.groups);
  assert.equal(saved.puzzle.groups.flatMap(g=>g.pieces).length,5000);
  assert.ok(saved.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)&&g.pieces.includes(1)));
  await Promise.all([call(path,'POST',{type:'leave'},a.token),call(path,'POST',{type:'leave'},b.token)]);
});
