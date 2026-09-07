import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHostname } from '../lib/room-invite.ts';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000';

test('localhost and the LAN invitation reach the same local room with correct origin checks',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
  const info=await (await fetch(base+'/api/connection')).json();
  assert.equal(info.app,'together-puzzle');assert.equal(info.mode,'local');
  assert.ok(isLocalHostname(new URL(info.inviteOrigin).hostname));
  const create=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(base).origin},body:JSON.stringify({imageId:'seaside',pieces:12,name:'本机测试'})});
  assert.equal(create.status,201);const a=await create.json();
  const path=`/api/rooms/${a.room.id}`;
  const join=await fetch(info.inviteOrigin+path+'/join',{method:'POST',headers:{'Content-Type':'application/json',Origin:info.inviteOrigin},body:JSON.stringify({name:'局域网测试'})});
  assert.equal(join.status,200);const b=await join.json();
  const shared=await (await fetch(base+path,{headers:{Authorization:`Bearer ${a.token}`}})).json();
  assert.equal(shared.members.length,2);assert.deepEqual(shared.puzzle.groups,b.room.puzzle.groups);
  const blocked=await fetch(info.inviteOrigin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com',Authorization:`Bearer ${b.token}`},body:JSON.stringify({type:'heartbeat'})});
  assert.equal(blocked.status,403);
  for(const ticket of [a,b])await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${ticket.token}`},body:JSON.stringify({type:'leave'})});
});
