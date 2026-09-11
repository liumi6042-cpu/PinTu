import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { makeRoom,addMember } from '../lib/room-engine.ts';
import { testDatabase,cleanupFixtureRooms } from './server-fixture-db.mjs';
const id=()=>randomBytes(16).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex'),base='http://localhost:3000',sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('bounded multi-room load: 3 rooms of 2000 pieces, 24 players, cursors and configurable simultaneous drags',{skip:process.env.PUZZLE_TEST_LOAD!=='1'},async()=>{
 const draggers=Math.min(8,Math.max(1,Number(process.env.PUZZLE_LOAD_DRAGGERS||1))),seconds=Math.min(600,Math.max(10,Number(process.env.PUZZLE_LOAD_SECONDS||24)));
 const db=await testDatabase(),ids=[],owners=[],rooms=[],samples=[],errors=[],memory=[],report={};let stage=0;
 const call=async(player,suffix='',body,kind='poll')=>{const start=performance.now();try{const response=await fetch(base+'/api/rooms/'+player.roomId+suffix,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+player.token,Cookie:player.cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const data=await response.json();samples.push({stage,kind,status:response.status,ms:performance.now()-start});if(!response.ok)errors.push({stage,kind,status:response.status});return {ok:response.ok,data};}catch(error){errors.push({stage,kind,status:0});return {ok:false,data:null};}};
 try{
  for(let r=0;r<3;r++){const now=Date.now(),room=makeRoom(id(),'seaside',2000,now),players=[];ids.push(room.id);room.visibility='public';room.startedAt=null;room.participants={};for(let p=0;p<8;p++){const secret=randomBytes(32).toString('hex'),owner='guest:'+hash(secret),token=id();owners.push(owner);addMember(room,id(),'压力测试 '+r+'-'+p,hash(token),now,undefined,owner);players.push({roomId:room.id,token,cookie:'puzzle_guest='+secret,seq:0,cursorId:id(),revision:0});}db.prepare('INSERT INTO puzzle_rooms VALUES (?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);rooms.push(players);}
  async function measure(roomCount,seconds){stage=roomCount;const end=performance.now()+seconds*1000;await Promise.all(rooms.slice(0,roomCount).map(async players=>{
    await Promise.all(players.slice(0,draggers).map((player,index)=>call(player,'',{type:'claim',groupId:index},'claim').then(result=>assert.equal(result.ok,true))));
    await Promise.all(players.map(async(player,index)=>{let frame=0,lastHeartbeat=0;while(performance.now()<end){const frameAt=performance.now(),body={clientId:player.cursorId,seq:++player.seq,point:{x:100+index*50+frame%30,y:100+index*25}};
      const jobs=[call(player,'/cursors',body,'cursor'),call(player,'?since='+player.revision,undefined,'poll')];if(index<draggers)jobs.push(call(player,'?since='+player.revision,{type:'move',groupId:index,dx:200+frame%60,dy:200,seq:player.seq},'move'));else if(frameAt-lastHeartbeat>4000){lastHeartbeat=frameAt;jobs.push(call(player,'?since='+player.revision,{type:'heartbeat'},'heartbeat'));}
      const results=await Promise.all(jobs);for(const result of results)if(result.ok&&Number.isSafeInteger(result.data?.revision))player.revision=Math.max(player.revision,result.data.revision);frame++;
      if(errors.filter(e=>e.status>=500||e.status===0).length>3)throw new Error('Stopped load after repeated server errors');await sleep(Math.max(0,350-(performance.now()-frameAt)));
    }}));await Promise.all(players.slice(0,draggers).map((player,index)=>call(player,'',{type:'drop',groupId:index,dx:200+index*100,dy:200,seq:++player.seq},'drop')));
  }));try{const status=JSON.parse(await readFile(new URL('../work/local-server/status.json',import.meta.url),'utf8'));memory.push({rooms:roomCount,gatewayRssBytes:status.gatewayRssBytes,workerTreeRssBytes:status.workerTreeRssBytes});}catch{}}
  await measure(1,15);await measure(3,seconds);
  const info=await (await fetch(base+'/api/site-info')).json();
  if(info.capacity===24){
    const extra=makeRoom(id(),'seaside',108,Date.now()),secret=randomBytes(32).toString('hex'),token=id(),owner='guest:'+hash(secret);extra.visibility='public';ids.push(extra.id);owners.push(owner);
    addMember(extra,id(),'第 25 位测试玩家',hash(token),Date.now(),undefined,owner);db.prepare('INSERT INTO puzzle_rooms VALUES (?,?,?,?)').run(extra.id,0,JSON.stringify(extra),extra.expiresAt);
    const response=await fetch(base+'/api/rooms/'+extra.id,{headers:{Authorization:'Bearer '+token,Cookie:'puzzle_guest='+secret}});assert.equal(response.status,429,'global cap must also reject an authenticated 25th player on an otherwise empty table');await response.text();report.capacityRejected25th=true;
  }
  for(const players of rooms){const a=await call(players[0]),b=await call(players[7]);assert.ok(a.ok&&b.ok);assert.deepEqual(a.data.puzzle.groups,b.data.puzzle.groups);assert.equal(a.data.puzzle.groups.flatMap(g=>g.pieces).length,2000);}
  const percentile=(rows,q)=>{const values=rows.map(s=>s.ms).sort((a,b)=>a-b);return values.length?Math.round(values[Math.min(values.length-1,Math.floor(values.length*q))]):null;};
  Object.assign(report,{createdAt:new Date().toISOString(),scenario:`3 rooms × 8 players × 2000 pieces; all poll and move cursors; ${draggers} continuous drags per room`,durationSeconds:seconds+15,requests:samples.length,errors,memory,stages:[1,3].map(n=>{const rows=samples.filter(s=>s.stage===n);return {rooms:n,players:n*8,requests:rows.length,p50Ms:percentile(rows,.5),p95Ms:percentile(rows,.95),moveP95Ms:percentile(rows.filter(s=>s.kind==='move'),.95),failed:rows.filter(s=>s.status>=400).length};}),converged:true});
  assert.equal(errors.length,0,JSON.stringify(report));console.log(JSON.stringify(report));
 }finally{if(!report.createdAt)Object.assign(report,{createdAt:new Date().toISOString(),incomplete:true,requests:samples.length,errors,memory});await mkdir(new URL('../work/load-tests/',import.meta.url),{recursive:true});await writeFile(new URL(draggers===8?'../work/load-tests/full-concurrent.json':'../work/load-tests/latest.json',import.meta.url),JSON.stringify(report,null,2));cleanupFixtureRooms(db,ids,owners);db.close();}
});
