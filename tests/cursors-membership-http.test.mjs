import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fixtureFetch } from './room-http-fixture.mjs';
import { CursorClient } from '../lib/cursor-client.ts';
import { RoomClient } from '../lib/room-client.ts';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000',realFetch=globalThis.fetch,fixtures=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body,token,cookie,seed=false){
  const response=await (seed?fixtureFetch:realFetch)(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function until(check){const end=Date.now()+12000;while(!check()){assert.ok(Date.now()<end,'cursor clients failed to converge');await wait(50);}}
function fakeTable(client){return {state:client.state,networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protect){
  const previous=new Map(this.state.groups.filter(g=>protect.has(g.id)).map(g=>[g.id,g]));this.state.groups=structuredClone(next.groups);this.state.elapsed=next.elapsed;
  for(const g of this.state.groups){const old=previous.get(g.id);if(old&&!g.locked){g.dx=old.dx;g.dy=old.dy;}}
}};}

test('creation is server-gated, while solo requires sign-in and existing room invitations still work',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
  for(const visibility of ['private',undefined]){
    const result=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:108,name:'不应创建',...(visibility?{visibility}:{}),isMember:true,subscriptionActive:true});
    assert.equal(result.status,403);assert.match(result.data.error,/会员/);assert.ok(!result.data.room);
  }
  const solo=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:108,visibility:'solo'});assert.equal(solo.status,401);
  // A pre-existing invitation remains usable by guests with no subscription.
  const existing=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:108,visibility:'private'},undefined,undefined,true);assert.equal(existing.status,201);fixtures.push(existing.data.room.id);
  const joined=await call('/api/rooms/'+existing.data.room.id+'/join',{});assert.equal(joined.status,200);
  const cursorPath='/api/rooms/'+existing.data.room.id+'/cursors';
  assert.equal((await call(cursorPath)).status,401);
  assert.equal((await call(cursorPath,{clientId:'b'.repeat(32),seq:1,point:{x:20,y:30}},joined.data.token)).status,401,'guest cookie binding is enforced');
  assert.equal((await call(cursorPath,{clientId:'b'.repeat(32),seq:1,point:{x:20,y:30}},joined.data.token,joined.cookie)).status,200);
  await call('/api/rooms/'+existing.data.room.id,{type:'leave'},joined.data.token,joined.cookie);
  assert.equal((await call(cursorPath,undefined,existing.data.token,existing.cookie)).data.cursors.length,0,'departed players must disappear');
});

test('8 cursor channels coexist with concurrent 2000-piece dragging without changing the game on hover',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async t=>{
  const initial=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:2000,name:'鼠标测试1'},undefined,undefined,true);assert.equal(initial.status,201);
  const tickets=[initial.data],path='/api/rooms/'+initial.data.room.id;fixtures.push(initial.data.room.id);
  for(let i=1;i<8;i++){const joined=await call(path+'/join',{name:'鼠标测试'+(i+1)});assert.equal(joined.status,200);tickets.push(joined.data);}
  const before=(await call(path,undefined,tickets[0].token)).data;
  const seen=Array.from({length:8},()=>[]),requests=[];
  globalThis.fetch=async(url,options)=>{
    const started=performance.now(),response=await realFetch(typeof url==='string'&&url.startsWith('/')?base+url:url,options);
    if(String(url).endsWith('/cursors'))requests.push({status:response.status,ms:performance.now()-started});
    return response;
  };
  const cursors=tickets.map((ticket,i)=>new CursorClient(ticket.room.id,ticket.token,ticket.playerId,next=>seen[i]=next,()=>true));
  const clients=[],stops=[];
  try{
    cursors.forEach((client,i)=>{client.start();client.point({x:100+i*50,y:200+i*10});});
    await until(()=>seen.every(list=>list.length===7));
    for(let i=0;i<8;i++){assert.ok(seen[i].every(cursor=>cursor.playerId!==tickets[i].playerId));assert.ok(seen[i].every(cursor=>cursor.name&&cursor.color));}
    const hovered=(await call(path,undefined,tickets[0].token)).data;
    assert.equal(hovered.revision,before.revision);assert.equal(hovered.expiresAt,before.expiresAt);assert.deepEqual(hovered.puzzle.groups,before.puzzle.groups);
    const tables=tickets.map(ticket=>{const client=new RoomClient(ticket);clients.push(client);const table=fakeTable(client);stops.push(client.attach(table));return table;});
    assert.ok((await Promise.all(tables.map((table,i)=>table.network.acquire(i*100)))).every(Boolean));
    for(let step=0;step<5;step++){
      cursors.forEach((client,i)=>client.point({x:100+i*50+step*10,y:250}));
      tables.forEach((table,i)=>table.network.move(i*100,100+step*5,150));await wait(200);
    }
    await Promise.all(tables.map((table,i)=>table.network.drop(i*100,0,0)));
    await until(()=>clients.every(client=>Array.from({length:8},(_,i)=>i*100).every(id=>client.state.groups.some(group=>group.locked&&group.pieces.includes(id)))));
    cursors[0].point(null);await wait(400);assert.ok(seen.slice(1).every(list=>list.some(cursor=>cursor.playerId===tickets[0].playerId)),'leaving the canvas retains the last position');
    const cursorBody={clientId:'f'.repeat(32),seq:2,point:null};
    await call(path+'/cursors',cursorBody,tickets[0].token);
    await call(path+'/cursors',{...cursorBody,seq:1,point:{x:1,y:1}},tickets[0].token);
    assert.ok((await call(path+'/cursors',undefined,tickets[1].token)).data.cursors.some(cursor=>cursor.playerId===tickets[0].playerId));
    assert.ok(requests.every(request=>request.status===200));
    console.log(JSON.stringify({players:8,pieces:2000,cursorRequests:requests.length,cursorP95Ms:Math.round(requests.map(r=>r.ms).sort((a,b)=>a-b)[Math.floor(requests.length*.95)]),pieceStateConverged:true}));
  }finally{
    cursors.forEach(client=>client.stop());stops.forEach(stop=>stop());await wait(100);globalThis.fetch=realFetch;
    for(const ticket of tickets)await call(path,{type:'leave'},ticket.token);
    await mkdir(new URL('../work/',import.meta.url),{recursive:true});assert.ok(fixtures.every(id=>/^[a-f0-9]{32}$/.test(id)));
    await writeFile(new URL('../work/cursors-membership-cleanup.sql',import.meta.url),['puzzle_room_cursors','puzzle_results','puzzle_room_directory','puzzle_rooms'].map(table=>`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${fixtures.map(id=>`'${id}'`).join(',')});`).join('\n'));
  }
});
