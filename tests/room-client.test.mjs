import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/room-client.ts';
const base=process.env.PUZZLE_TEST_URL||'http://localhost:3001';
const originalFetch=globalThis.fetch;globalThis.fetch=(url,options)=>originalFetch(typeof url==='string'&&url.startsWith('/')?base+url:url,options);
const until=async(condition)=>{const end=Date.now()+6000;while(!condition()){if(Date.now()>end)throw new Error('Timed out waiting for clients to converge');await new Promise(r=>setTimeout(r,25));}};
function fakeTable(client){return {state:client.state,network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protect){const originals=new Map(this.state.groups.filter(g=>protect.has(g.id)).map(g=>[g.id,g]));this.state.groups=structuredClone(next.groups);for(const nextGroup of this.state.groups){const original=originals.get(nextGroup.id);if(original&&!nextGroup.locked){nextGroup.dx=original.dx;nextGroup.dy=original.dy;}}this.state.elapsed=next.elapsed;this.owners=owners;}};}
test('the actual polling clients propagate drag/drop, preserve the local held piece and reconnect to the same snapshot',async()=>{
 const create=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageId:'seaside',pieces:12,name:'客户端甲'})}),aTicket=await create.json();assert.equal(create.status,201);
 const join=await fetch(`/api/rooms/${aTicket.room.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'客户端乙'})}),bTicket=await join.json();assert.equal(join.status,200);
 const a=new RoomClient(aTicket),b=new RoomClient(bTicket),ta=fakeTable(a),tb=fakeTable(b),cleanA=a.attach(ta),cleanB=b.attach(tb);
 try{await until(()=>a.snapshot.members.length===2);assert.equal(await ta.network.acquire(0),true);assert.equal(await tb.network.acquire(0),false);
   const group=a.state.groups.find(g=>g.id===0);group.dx=150;group.dy=150;ta.network.move(0,150,150);
   await until(()=>b.state.groups.find(g=>g.id===0)?.dx===150);assert.equal(a.state.groups.find(g=>g.id===0).dx,150);assert.ok(tb.owners[0]);
   await ta.network.drop(0,0,0);await until(()=>b.state.groups.some(g=>g.locked&&g.pieces.includes(0)));assert.deepEqual(a.state.groups,b.state.groups);
   const restore=await fetch(`/api/rooms/${aTicket.room.id}`,{headers:{Authorization:`Bearer ${aTicket.token}`}}),latest=await restore.json();assert.deepEqual(latest.puzzle.groups,a.state.groups);
 }finally{a.leave();b.leave();cleanA();cleanB();}
});
