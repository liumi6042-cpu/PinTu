import { fixtureFetch } from './room-http-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { RoomClient } from '../lib/room-client.ts';

const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000';
const originalFetch=globalThis.fetch, stats=[], fixtureIds=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body,token,cookie){
  const response=await fixtureFetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();assert.ok(response.ok,path+': '+JSON.stringify(data));
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
function fakeTable(client){return {state:client.state,network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protect){
  const before=new Map(this.state.groups.filter(g=>protect.has(g.id)).map(g=>[g.id,g]));
  this.state.groups=structuredClone(next.groups);this.state.elapsed=next.elapsed;
  for(const group of this.state.groups){const held=before.get(group.id);if(held&&!group.locked){group.dx=held.dx;group.dy=held.dy;}}
}};}
async function until(check){const end=Date.now()+15000;while(!check()){assert.ok(Date.now()<end,'Clients did not converge');await wait(50);}}

test('2, 4 and 8 real clients converge during concurrent 2000-piece drag/drop and recover a snapshot', {skip:process.env.PUZZLE_TEST_LOCAL!=='1'}, async t=>{
  const report=[];
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    await mkdir(new URL('../work/',import.meta.url),{recursive:true});
    await writeFile(new URL('../work/room-sync-benchmark.json',import.meta.url),JSON.stringify(report,null,2));
    assert.ok(fixtureIds.every(id=>/^[a-f0-9]{32}$/.test(id)));
    if(fixtureIds.length)await writeFile(new URL('../work/room-sync-cleanup.sql',import.meta.url),['puzzle_results','puzzle_room_directory','puzzle_rooms'].map(table=>`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${fixtureIds.map(id=>`'${id}'`).join(',')});`).join('\n'));
  });
  globalThis.fetch=async(url,options)=>{
    const start=performance.now(),response=await originalFetch(typeof url==='string'&&url.startsWith('/')?base+url:url,options),raw=await response.text();
    const parsed=JSON.parse(raw);stats.push({bytes:Buffer.byteLength(raw),elapsed:performance.now()-start,kind:parsed.kind||'full',status:response.status});
    return new Response(raw,{status:response.status,headers:response.headers});
  };
  for(const players of [2,4,8]){
    stats.length=0;
    const created=(await call('/api/rooms',{imageId:'mountain-lake-reflection',pieces:2000,name:'负载测试1'})).data;
    const path='/api/rooms/'+created.room.id;fixtureIds.push(created.room.id);
    const tickets=[created];for(let i=1;i<players;i++)tickets.push((await call(path+'/join',{name:'负载测试'+(i+1)})).data);
    const clients=tickets.map(ticket=>new RoomClient(ticket)),tables=clients.map(fakeTable),cleanup=clients.map((client,i)=>client.attach(tables[i]));
    try{
      await until(()=>clients.every(client=>client.snapshot.members.length===players));
      const held=await Promise.all(tables.map((table,i)=>table.network.acquire(i*100)));
      assert.ok(held.every(Boolean),'a distinct simultaneous claim was rejected');
      for(let turn=0;turn<3;turn++){
        tables.forEach((table,i)=>{const group=table.state.groups.find(g=>g.id===i*100);group.dx=70+turn*10;group.dy=90+turn*10;table.network.move(i*100,group.dx,group.dy);});
        await wait(160);
      }
      const dropStarted=performance.now();await Promise.all(tables.map((table,i)=>table.network.drop(i*100,0,0)));
      await until(()=>clients.every(client=>Array.from({length:players},(_,i)=>i*100).every(id=>client.state.groups.some(group=>group.locked&&group.pieces.includes(id)))));
      const dropConvergedMs=Math.round(performance.now()-dropStarted);
      const authoritative=(await call(path,undefined,created.token)).data;
      for(const client of clients)assert.deepEqual(client.state.groups,authoritative.puzzle.groups);
      const fullBytes=Buffer.byteLength(JSON.stringify(authoritative));
      const start=stats.length;await wait(6500);const idleRequests=stats.length-start;
      const payloadBytes=stats.reduce((sum,item)=>sum+item.bytes,0),equivalentFullBytes=stats.length*fullBytes;
      assert.ok(stats.every(item=>item.status===200),'load caused a request failure');
      assert.ok(stats.filter(item=>item.kind==='delta').length>stats.length*.8);
      assert.ok(payloadBytes<equivalentFullBytes*.15,'delta traffic did not improve enough');
      assert.ok(idleRequests<players*12,'idle clients still polled at the old 300ms rate');
      const times=stats.map(item=>item.elapsed).sort((a,b)=>a-b);
      report.push({players,pieces:2000,requests:stats.length,deltaResponses:stats.filter(item=>item.kind==='delta').length,payloadBytes,equivalentFullBytes,reductionPercent:Math.round((1-payloadBytes/equivalentFullBytes)*1000)/10,p95ResponseMs:Math.round(times[Math.floor(times.length*.95)]),dropConvergedMs,idleRequestsIn6500Ms:idleRequests});
      console.log(JSON.stringify(report.at(-1)));
      // The current state can be restored without relying on the bounded change history.
      const reconnect=new RoomClient({...tickets[0],room:authoritative});assert.deepEqual(reconnect.state.groups,clients[0].state.groups);
    }finally{cleanup.forEach(stop=>stop());await Promise.all(tickets.map(ticket=>call(path,{type:'leave'},ticket.token)));}
  }
});

test('guest personal space lists owned and joined rooms, with a 30-day expiry and private isolation', {skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
  const a=await call('/api/rooms',{imageId:'seaside',pieces:108,visibility:'private'}),path='/api/rooms/'+a.data.room.id;
  const b=await call(path+'/join',{});assert.ok(b.cookie);
  assert.ok(a.data.room.expiresAt-Date.now()>29*86400000);
  const own=await call('/api/my-rooms',undefined,undefined,a.cookie),joined=await call('/api/my-rooms',undefined,undefined,b.cookie);
  assert.ok(own.data.rooms.some(room=>room.id===a.data.room.id));assert.ok(joined.data.rooms.some(room=>room.id===a.data.room.id));
  assert.ok(!(await call('/api/my-rooms')).data.rooms.some(room=>room.id===a.data.room.id));
  await call(path,{type:'claim',groupId:0},a.data.token,a.cookie);
  await call(path,{type:'drop',groupId:0,dx:0,dy:0,seq:1},a.data.token,a.cookie);
  const updated=(await call(path,undefined,a.data.token,a.cookie)).data;
  const listed=(await call('/api/my-rooms',undefined,undefined,a.cookie)).data.rooms.find(room=>room.id===a.data.room.id);
  assert.equal(listed.expiresAt,updated.expiresAt);assert.equal(listed.placed,1);
  await call(path,{type:'leave'},a.data.token,a.cookie);await call(path,{type:'leave'},b.data.token,b.cookie);
});
