import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
import catalog from '../content/puzzle-catalog.json' with {type:'json'};
const base=process.env.PUZZLE_NODE_TEST_URL,file=process.env.PUZZLE_NODE_TEST_DATABASE;
if(base!=='http://127.0.0.1:3113'||!file?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated staging required');
const db=new SqliteD1(file,resolve('drizzle')),rooms=[],users=[],origin='https://jigsawnook.online';
function client(){let cookie='';return async(path,body,token='',source=origin)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'198.51.100.67',Origin:source,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return {status:r.status,data:await r.json()};};}
const a=client(),b=client(),outsider=client(),request=kind=>({kind,requestId:crypto.randomUUID().replaceAll('-','')});
try{
 const reg=await a('/api/auth/register',{username:'aid_'+crypto.randomUUID().slice(0,12).replaceAll('-',''),password:'Isolated-'+crypto.randomUUID(),name:'Assistance test'});assert.equal(reg.status,201,JSON.stringify(reg.data));users.push(reg.data.account.id);
 const created=await a('/api/rooms',{visibility:'public',imageId:catalog.find(p=>p.status==='published').id,pieces:108});assert.equal(created.status,201);let ticket=created.data;rooms.push(ticket.room.id);
 const root='/api/rooms/'+ticket.room.id,path=root+'/assistance',friend=await b(root+'/join',{});assert.equal(friend.status,200);
 assert.equal((await outsider(path)).status,401);assert.equal((await outsider(path,undefined,ticket.token)).status,401);
 assert.equal((await a(path,{...request('reference')},ticket.token,'https://unrelated.example')).status,403);
 assert.equal((await a(path,{...request('reference'),kind:'all'},ticket.token)).status,400);
 assert.equal((await a(path,undefined,ticket.token)).data.grants.length,0);
 const before=db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(ticket.room.id);
 const ref=request('reference'),burst=await Promise.all(Array.from({length:8},()=>a(path,ref,ticket.token)));
 assert.ok(burst.every(r=>r.status===200&&r.data.grants.length===1));const deadline=burst[0].data.grants[0].expiresAt;
 assert.ok(deadline-burst[0].data.serverTime<=30000&&deadline-burst[0].data.serverTime>28000);
 assert.equal((await a(path,ref,ticket.token)).data.grants[0].expiresAt,deadline);
 assert.equal((await b(path,undefined,friend.data.token)).data.grants.length,0,'teammate has an independent quota');
 assert.equal((await b(path,request('reference'),friend.data.token)).data.grants.length,1);
 assert.deepEqual(db.sql.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(ticket.room.id),before,'assistance never changes game revision or positions');
 ticket=(await a(root+'/join',{})).data;assert.equal((await a(path,undefined,ticket.token)).data.grants.length,1,'rejoining keeps usage');
 db.sql.prepare("UPDATE puzzle_assistance_grants SET expires_at=? WHERE room_id=? AND identity=? AND kind='reference'").run(Date.now()-1,ticket.room.id,users[0]);
 assert.equal((await a(path,request('reference'),ticket.token)).status,409,'reference allowance exhausted');
 assert.equal((await a(path,request('underlay'),ticket.token)).status,200);
 for(let i=0;i<3;i++){
  const use=request('hint'),r=await a(path,use,ticket.token);assert.equal(r.status,200,JSON.stringify(r.data));const hint=r.data.grants.find(g=>g.requestId===use.requestId);assert.equal(hint.pieceIds.length,3);assert.equal(new Set(hint.pieceIds).size,3);
  db.sql.prepare('UPDATE puzzle_assistance_grants SET expires_at=? WHERE request_id=?').run(Date.now()-1,use.requestId);
 }
 assert.equal((await a(path,request('hint'),ticket.token)).status,409);
 const solo=await a('/api/rooms',{visibility:'solo',imageId:catalog.find(p=>p.status==='published').id,pieces:108});assert.equal(solo.status,201);rooms.push(solo.data.room.id);
 assert.equal((await a('/api/rooms/'+solo.data.room.id+'/assistance',request('hint'),solo.data.token)).data.grants[0].pieceIds.length,3,'solo has the same allowance in a new puzzle');
 console.log('Assistance HTTP passed: auth, CSRF, 30-second deadline, retries, independent guest/player usage, rejoin, quotas, solo/public and unchanged puzzle state.');
}finally{
 for(const id of rooms){for(const table of ['puzzle_room_cursors','puzzle_room_directory','puzzle_personal_hidden_rooms'])db.sql.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(id);db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(id);}
 for(const id of users){db.sql.prepare('DELETE FROM puzzle_sessions WHERE user_id=?').run(id);db.sql.prepare('DELETE FROM puzzle_beta_seats WHERE identity=?').run(id);db.sql.prepare('DELETE FROM puzzle_users WHERE id=?').run(id);}
 db.close();
}
