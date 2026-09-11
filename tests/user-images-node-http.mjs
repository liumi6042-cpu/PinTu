import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
import catalog from '../content/puzzle-catalog.json' with {type:'json'};
const base=process.env.PUZZLE_NODE_TEST_URL,file=process.env.PUZZLE_NODE_TEST_DATABASE;
if(base!=='http://127.0.0.1:3113'||!file?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated staging required');
const db=new SqliteD1(file,resolve('drizzle')),origin='https://jigsawnook.online',users=[],rooms=[];
const bytes=readFileSync('public'+catalog[0].thumbSrc),otherBytes=readFileSync('public'+catalog[1].thumbSrc);
function form(image=bytes,rights='yes'){const value=new FormData();value.set('title','My private test photo');value.set('rights',rights);value.set('image',new Blob([image],{type:'image/webp'}),'image.webp');value.set('preview',new Blob([image],{type:'image/webp'}),'preview.webp');return value;}
async function raw(path,body,cookie='',token='',source=origin){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'198.51.100.66',Origin:source,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}
async function call(...args){const r=await raw(...args);return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
async function account(active){const username='imgqa_'+crypto.randomUUID().replaceAll('-','').slice(0,12),r=await call('/api/auth/register',{username,password:'ImageTest-'+crypto.randomUUID(),name:'Upload QA'});assert.equal(r.status,201,JSON.stringify(r.data));users.push(r.data.account.id);if(active)db.sql.prepare('INSERT INTO puzzle_memberships VALUES(?,?,?,?,?,0)').run(r.data.account.id,'puzzle','active',Date.now()-1000,Date.now()+3600000);return r;}
async function create(owner,id,visibility='private'){const r=await call('/api/rooms',{imageId:id,pieces:108,visibility},owner.cookie);if(r.status===201)rooms.push(r.data.room.id);return r;}
try{
 const owner=await account(true),free=await account(false),stranger=await account(true),ownerId=owner.data.account.id;
 assert.equal((await call('/api/user-images',form())).status,401);
 assert.equal((await call('/api/user-images',form(),free.cookie)).status,403);
 assert.equal((await call('/api/user-images',form(),owner.cookie,'','https://unrelated.example')).status,403);
 assert.equal((await call('/api/user-images',form(bytes,'no'),owner.cookie)).status,400);
 assert.equal((await call('/api/user-images',form(new TextEncoder().encode('<svg onload="bad">')),owner.cookie)).status,400);
 const uploaded=await call('/api/user-images',form(),owner.cookie);assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));const image=uploaded.data.image,id=image.id;
 assert.equal(image.width,480);assert.match(id,/^custom-[a-f0-9]{32}$/);
 assert.equal((await call('/api/user-images',form(),owner.cookie)).data.image.id,id,'retry/deduplication reuses the same image');
 assert.equal((await call('/api/user-images',undefined,owner.cookie)).data.images.length,1);
 assert.equal((await call('/api/user-images',undefined,free.cookie)).data.images.length,0);
 assert.equal((await raw(image.src)).status,404);assert.equal((await raw(image.src,undefined,stranger.cookie)).status,404);
 const ownBytes=await raw(image.src,undefined,owner.cookie);assert.equal(ownBytes.status,200);assert.equal(ownBytes.headers.get('Content-Type'),'image/webp');assert.match(ownBytes.headers.get('Cache-Control'),/private.*no-store/);assert.equal(ownBytes.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal((await create(owner,id,'public')).status,403);assert.equal((await create(stranger,id)).status,404);
 const attempts=await Promise.all(Array.from({length:5},()=>create(owner,id)));assert.equal(attempts.filter(r=>r.status===201).length,3);assert.equal(attempts.filter(r=>r.status===409).length,2);
 const solo=await create(owner,id,'solo');assert.equal(solo.status,201,'private-table quota does not consume custom solo slots');
 const ticket=attempts.find(r=>r.status===201).data,roomId=ticket.room.id,path='/api/rooms/'+roomId;
 assert.equal(ticket.room.customImage.id,id);
 assert.equal((await call('/api/user-images/'+id,{action:'delete'},owner.cookie)).status,409);
 assert.equal((await call('/api/user-images/'+id,{action:'delete'},stranger.cookie)).status,404);
 assert.equal((await call('/api/member-rooms/'+roomId,{visibility:'public'},owner.cookie)).status,403);
 assert.ok(!(await call('/api/lobby')).data.rooms.some(room=>rooms.includes(room.id)));
 const friend=await call(path+'/join',{});assert.equal(friend.status,200,JSON.stringify(friend.data));
 const privateUrl=image.src+'?room='+roomId;
 assert.equal((await raw(privateUrl,undefined,friend.cookie)).status,200,'admitted guest can load the image without membership');
 assert.equal((await raw(privateUrl,undefined,stranger.cookie)).status,404);
 const personal=(await call('/api/my-rooms',undefined,owner.cookie)).data.rooms;assert.equal(personal.filter(r=>rooms.includes(r.id)).length,4);assert.ok(personal.every(r=>!rooms.includes(r.id)||r.customImage.id===id));
 assert.ok((await call('/api/my-rooms',undefined,friend.cookie)).data.rooms.some(r=>r.id===roomId&&r.customImage.id===id));
 assert.equal((await call(path,{type:'claim',groupId:0},owner.cookie,ticket.token)).status,200);
 const drop=await call(path,{type:'drop',groupId:0,dx:0,dy:0,seq:1},owner.cookie,ticket.token);assert.equal(drop.status,200);assert.ok(drop.data.puzzle.groups.find(g=>g.id===0).locked);
 // An explicitly completed isolated fixture must not enter the public leaderboard.
 const saved=db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(roomId),completed=JSON.parse(saved.data);completed.puzzle.groups=completed.puzzle.groups.map(g=>({...g,locked:true,dx:0,dy:0}));completed.completedAt=Date.now();completed.leases={};completed.revision++;
 db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(completed),completed.revision,roomId);
 assert.equal((await call(path,undefined,owner.cookie,ticket.token)).status,200);assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM puzzle_results WHERE room_id=?').get(roomId).n,0);
 db.sql.prepare('UPDATE puzzle_memberships SET expires_at=? WHERE user_id=?').run(Date.now()-1000,ownerId);
 assert.equal((await call('/api/user-images',form(otherBytes),owner.cookie)).status,403);assert.equal((await create(owner,id,'solo')).status,403);
 assert.equal((await raw(privateUrl,undefined,friend.cookie)).status,200);assert.equal((await call(path+'/join',{},friend.cookie)).status,200);
 for(const room of rooms){db.sql.prepare('UPDATE puzzle_room_directory SET expires_at=? WHERE room_id=?').run(Date.now()-1000,room);db.sql.prepare('UPDATE puzzle_rooms SET expires_at=? WHERE id=?').run(Date.now()-1000,room);}
 assert.equal((await raw(privateUrl,undefined,friend.cookie)).status,404);assert.equal((await call('/api/user-images/'+id,{action:'delete'},owner.cookie)).status,200);assert.equal((await raw(image.src,undefined,owner.cookie)).status,404);
 db.sql.prepare('UPDATE puzzle_memberships SET expires_at=? WHERE user_id=?').run(Date.now()+3600000,ownerId);
 for(let i=0;i<9;i++)db.sql.prepare('INSERT INTO puzzle_user_images VALUES(?,?,?,?,?,?,?,?,?,?)').run('custom-'+crypto.randomUUID().replaceAll('-',''),ownerId,'Quota fixture',480,384,bytes.length*2,'fixture-'+i,Date.now(),bytes,bytes);
 const quota=await Promise.all([call('/api/user-images',form(),owner.cookie),call('/api/user-images',form(otherBytes),owner.cookie)]);assert.deepEqual(quota.map(r=>r.status).sort(),[201,409]);assert.equal((await call('/api/user-images',undefined,owner.cookie)).data.images.length,10);
 console.log('Private upload HTTP checks passed: real upload/read, auth/CSRF, metadata, ownership, guest images, quota races, solo/private play, expiry, delete protection and no public scores.');
}finally{
 for(const id of rooms){for(const table of ['puzzle_personal_hidden_rooms','puzzle_result_players','puzzle_achievement_settled','puzzle_achievement_facts','puzzle_room_cursors','puzzle_results','puzzle_room_directory'])db.sql.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(id);db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(id);}
 for(const id of users){for(const table of ['puzzle_achievement_profiles','puzzle_achievement_awards','puzzle_achievement_days'])db.sql.prepare(`DELETE FROM ${table} WHERE owner_id=?`).run(id);db.sql.prepare('DELETE FROM puzzle_beta_seats WHERE identity=?').run(id);for(const table of ['puzzle_membership_orders','puzzle_memberships','puzzle_sessions'])db.sql.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);db.sql.prepare('DELETE FROM puzzle_users WHERE id=?').run(id);}
 db.close();
}
