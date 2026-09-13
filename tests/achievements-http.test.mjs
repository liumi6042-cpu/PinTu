import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixtureFetch } from './room-http-fixture.mjs';
const base='http://localhost:3000',run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url)),ids=[],owners=[];
const pathFor=id=>'/api/rooms/'+id;
async function call(path,body,ticket,cookie,seed=false){
 const r=await (seed?fixtureFetch:fetch)(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(ticket?{Authorization:'Bearer '+ticket.token}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function sql(name,content){
 const path=fileURLToPath(new URL('../work/'+name+'.sql',import.meta.url));await mkdir(new URL('../work/',import.meta.url),{recursive:true});await writeFile(path,content);
 await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file',path],{cwd:root,windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
}
function trackCookie(cookie){assert.match(cookie,/^puzzle_guest=[a-f0-9]{64}$/);owners.push('guest:'+createHash('sha256').update(cookie.split('=')[1]).digest('hex'));}
async function prepare(ticket,loose){
 assert.match(ticket.room.id,/^[a-f0-9]{32}$/);ids.push(ticket.room.id);
 const groups=ticket.room.puzzle.groups.map(g=>({...g,locked:!loose.includes(g.id),dx:loose.includes(g.id)?350:0,dy:loose.includes(g.id)?350:0}));
 await sql('achievement-prepare-'+ticket.room.id,`UPDATE puzzle_rooms SET data=json_set(data,'$.puzzle.groups',json('${JSON.stringify(groups)}')) WHERE id='${ticket.room.id}';`);
}
async function place(ticket,cookie,id){
 assert.equal((await call(pathFor(ticket.room.id),{type:'claim',groupId:id},ticket,cookie)).status,200);
 const result=await call(pathFor(ticket.room.id),{type:'drop',groupId:id,seq:1,dx:0,dy:0},ticket,cookie);assert.equal(result.status,200,JSON.stringify(result.data));return result;
}
test('real guest achievements award once, exclude spectators, authorize equipment, decorate cursors and outlive rooms',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
 try{
  assert.deepEqual((await call('/api/achievements')).data.book.earned,{});
  const solo=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:108,visibility:'solo'});assert.equal(solo.status,201);trackCookie(solo.cookie);await prepare(solo.data,[0]);
  assert.equal((await call('/api/achievements',{action:'equip',badge:'first'},undefined,solo.cookie)).status,403);
  await place(solo.data,solo.cookie,0);
  const book=(await call('/api/achievements',undefined,undefined,solo.cookie)).data.book;assert.ok(book.earned.first);assert.equal(book.facts.length,1);assert.equal(book.days.length,1);assert.ok(!book.earned['team-first']);
  const again=(await call('/api/achievements',undefined,undefined,solo.cookie)).data.book;assert.equal(again.earned.first,book.earned.first);assert.equal(again.facts.length,1);
  assert.equal((await call('/api/achievements',{action:'equip',badge:'first'},undefined,solo.cookie)).status,200);
  assert.equal((await call('/api/achievements',{action:'award',badge:'team-first',earned:true},undefined,solo.cookie)).status,400);
  const team=await call('/api/rooms',{imageId:'seaside-native-v2',pieces:108,visibility:'private'},undefined,undefined,true);assert.equal(team.status,201);trackCookie(team.cookie);await prepare(team.data,[0,1]);
  const second=await call(pathFor(team.data.room.id)+'/join',{}),watcher=await call(pathFor(team.data.room.id)+'/join',{});assert.equal(second.status,200);assert.equal(watcher.status,200);trackCookie(second.cookie);trackCookie(watcher.cookie);
  await place(team.data,team.cookie,0);await place(second.data,second.cookie,1);
  for(const member of [team,second]){const b=(await call('/api/achievements',undefined,undefined,member.cookie)).data.book;assert.ok(b.earned.first);assert.ok(b.earned['team-first']);assert.equal(b.facts.length,1);}
  assert.deepEqual((await call('/api/achievements',undefined,undefined,watcher.cookie)).data.book.earned,{});
  assert.equal((await call('/api/achievements',{action:'equip',badge:'team-first'},undefined,watcher.cookie)).status,403);
  assert.equal((await call('/api/achievements',{action:'equip',badge:'team-first'},undefined,team.cookie)).status,200);
  assert.equal((await call('/api/achievements?room='+team.data.room.id,undefined,team.data,watcher.cookie)).status,401);
  assert.equal((await call(pathFor(team.data.room.id)+'/cursors',{clientId:'a'.repeat(32),seq:1,point:{x:100,y:100}},team.data,team.cookie)).status,200);
  let cursor=(await call(pathFor(team.data.room.id)+'/cursors',undefined,second.data,second.cookie)).data.cursors.find(c=>c.playerId===team.data.playerId);assert.equal(cursor.badge,'team-first');
  await call('/api/achievements',{action:'equip',badge:null},undefined,team.cookie);
  cursor=(await call(pathFor(team.data.room.id)+'/cursors',undefined,second.data,second.cookie)).data.cursors.find(c=>c.playerId===team.data.playerId);assert.equal(cursor.badge,null);
  assert.ok(ids.every(id=>/^[a-f0-9]{32}$/.test(id)));const values=ids.map(id=>`'${id}'`).join(',');
  await sql('achievement-test-delete-rooms',['puzzle_room_cursors','puzzle_results','puzzle_room_directory','puzzle_rooms'].map(table=>`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${values});`).join('\n'));
  const retained=(await call('/api/achievements',undefined,undefined,team.cookie)).data.book;assert.ok(retained.earned['team-first']);assert.equal(retained.facts.length,1);
 }finally{
  assert.ok(ids.every(id=>/^[a-f0-9]{32}$/.test(id))&&owners.every(owner=>/^guest:[a-f0-9]{64}$/.test(owner)));
  const rooms=ids.map(id=>`'${id}'`).join(',')||"''",players=owners.map(id=>`'${id}'`).join(',')||"''";
  const commands=['puzzle_achievement_awards','puzzle_achievement_days','puzzle_achievement_facts','puzzle_achievement_profiles'].map(table=>`DELETE FROM ${table} WHERE owner_id IN (${players});`);
  commands.push(...['puzzle_achievement_settled','puzzle_room_cursors','puzzle_results','puzzle_room_directory','puzzle_rooms'].map(table=>`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${rooms});`));
  await sql('achievement-test-cleanup',commands.join('\n'));
 }
});
