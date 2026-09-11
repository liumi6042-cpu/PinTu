import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {SqliteD1} from '../server/sqlite.mjs';
import {cleanupPublicRooms} from '../server/public-room-cleanup.mjs';
import {resolve} from 'node:path';
const base=process.env.PUZZLE_NODE_TEST_URL,filename=process.env.PUZZLE_NODE_TEST_DATABASE;
if(base!=='http://127.0.0.1:3113'||!filename?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated staging required');
const db=new SqliteD1(filename,resolve('drizzle')),origin='https://jigsawnook.online';
async function request(path,body,cookie='',token=''){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1',Origin:origin,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
const create=(visibility,cookie,title='HTTP QA')=>request('/api/rooms',{visibility,imageId:'seaside',pieces:108,title},cookie);
try{
 const initial=await request('/api/lobby');assert.equal(initial.status,200);assert.equal(initial.data.rooms.length,0,'empty public rooms must not be seeded');
 const guest=await create('public','');assert.equal(guest.status,201,JSON.stringify(guest.data));assert.ok(guest.cookie);assert.equal(guest.data.room.visibility,'public');
 assert.equal(guest.data.room.members.length,1,'creator is seated atomically');
 const roomId=guest.data.room.id,publicPath='/api/rooms/'+roomId;
 assert.ok((await request('/api/lobby')).data.rooms.some(r=>r.id===roomId));
 assert.equal((await create('private',guest.cookie)).status,403);
 assert.equal((await request('/api/member-rooms/'+roomId,{visibility:'private'},guest.cookie)).status,403);
 assert.equal(JSON.parse(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(roomId).data).visibility,'public');
 const owner=await request('/api/auth/register',{username:'qa_'+randomBytes(6).toString('hex'),name:'QA member',password:randomBytes(18).toString('hex')});assert.equal(owner.status,201);
 const ownerId=owner.data.account.id,now=Date.now();
 db.sql.prepare("INSERT INTO puzzle_memberships(user_id,plan,status,starts_at,expires_at,cancel_at_period_end) VALUES(?,'puzzle','active',?,?,0)").run(ownerId,now-1000,now+3600000);
 const privateRooms=await Promise.all(Array.from({length:4},()=>create('private',owner.cookie)));
 assert.equal(privateRooms.filter(r=>r.status===201).length,3);assert.equal(privateRooms.filter(r=>r.status===409).length,1);
 const publicRooms=await Promise.all([create('public',owner.cookie),create('public',owner.cookie)]);assert.ok(publicRooms.every(r=>r.status===201));
 assert.equal((await request('/api/membership',undefined,owner.cookie)).data.summary.usedRooms,3,'public rooms do not count toward private quota');
 const toPrivate=id=>request('/api/member-rooms/'+id,{visibility:'private'},owner.cookie);
 assert.equal((await toPrivate(publicRooms[0].data.room.id)).status,409);
 const oldPrivate=privateRooms.find(r=>r.status===201).data.room.id;
 const before=JSON.parse(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(oldPrivate).data).puzzle;
 assert.equal((await request('/api/member-rooms/'+oldPrivate,{visibility:'public'},owner.cookie)).status,200);
 assert.deepEqual(JSON.parse(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(oldPrivate).data).puzzle,before);
 const conversions=await Promise.all(publicRooms.map(r=>toPrivate(r.data.room.id)));
 assert.equal(conversions.filter(r=>r.status===200).length,1);assert.equal(conversions.filter(r=>r.status===409).length,1,'concurrent conversions cannot exceed private quota');
 db.sql.prepare('UPDATE puzzle_memberships SET expires_at=? WHERE user_id=?').run(Date.now()-1,ownerId);
 const remaining=publicRooms[conversions.findIndex(r=>r.status===409)].data.room.id;
 assert.equal((await toPrivate(remaining)).status,403);
 assert.equal((await create('public',owner.cookie)).status,201,'expired members can still create public rooms');
 assert.equal((await request(publicPath,{type:'leave'},guest.cookie,guest.data.token)).status,200);
 await cleanupPublicRooms(db);
 assert.equal((await request(publicPath,undefined,guest.cookie,guest.data.token)).status,404,'empty abandoned public room is actually deleted');
 assert.ok(!(await request('/api/lobby')).data.rooms.some(r=>r.id===roomId));
 console.log('HTTP public room creation, guest seating, private gate, private-only quota, atomic visibility conversion and abandoned-room deletion passed.');
}finally{db.close();}
