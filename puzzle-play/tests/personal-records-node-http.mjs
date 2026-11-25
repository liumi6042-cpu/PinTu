import assert from 'node:assert/strict';
import { SqliteD1 } from '../server/sqlite.mjs';
import { resolve } from 'node:path';
const base=process.env.PUZZLE_NODE_TEST_URL,filename=process.env.PUZZLE_NODE_TEST_DATABASE;
if(base!=='http://127.0.0.1:3113'||!filename?.endsWith('/staging/puzzle.sqlite'))throw Error('Isolated staging required');
const db=new SqliteD1(filename,resolve('drizzle')),origin='https://jigsawnook.online',ids=[];
async function request(path,body,cookie='',token='',source=origin){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https',Origin:source,Cookie:cookie,Authorization:token?'Bearer '+token:'',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
const create=async visibility=>{const result=await request('/api/rooms',{visibility,imageId:'seaside-native-v2',pieces:108,title:'Records HTTP QA'});assert.equal(result.status,201);ids.push(result.data.room.id);return result;};
const listed=async(cookie,id)=>(await request('/api/my-rooms',undefined,cookie)).data.rooms.some(r=>r.id===id);
try{
 const owner=await create('solo'),other=await create('solo'),id=owner.data.room.id;
 assert.equal(await listed(owner.cookie,id),true);
 assert.equal((await request('/api/my-rooms',{roomId:id,action:'remove'})).status,401);
 assert.equal((await request('/api/my-rooms',{roomId:id,action:'remove',ownerId:owner.data.room.ownerId},other.cookie)).status,404);
 assert.equal((await request('/api/my-rooms',{roomId:id,action:'remove'},owner.cookie,'','https://unrelated.example')).status,403);
 const before=db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data;
 assert.equal((await request('/api/my-rooms',{roomId:id,action:'remove'},owner.cookie)).status,200);
 assert.equal(await listed(owner.cookie,id),false);
 assert.equal((await request('/api/rooms/'+id,undefined,owner.cookie,owner.data.token)).status,200);
 assert.equal(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data,before);
 assert.equal((await request('/api/my-rooms',{roomId:id,action:'restore'},owner.cookie)).status,200);
 assert.equal(await listed(owner.cookie,id),true);
 const shared=await create('public'),roomId=shared.data.room.id;
 assert.equal((await request('/api/rooms/'+roomId+'/join',{},other.cookie)).status,200);
 assert.equal(await listed(other.cookie,roomId),true);
 assert.equal((await request('/api/my-rooms',{roomId,action:'remove'},other.cookie)).status,200);
 assert.equal(await listed(other.cookie,roomId),false);
 assert.equal(await listed(shared.cookie,roomId),true);
 assert.ok((await request('/api/lobby')).data.rooms.some(r=>r.id===roomId));
 console.log('Personal-record HTTP checks passed: authenticated scope, CSRF, deletion, undo, intact rooms and shared lobby.');
}finally{
 for(const id of ids){
  db.sql.prepare('DELETE FROM puzzle_personal_hidden_rooms WHERE room_id=?').run(id);
  db.sql.prepare('DELETE FROM puzzle_room_directory WHERE room_id=?').run(id);
  db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(id);
 }
 db.close();
}
