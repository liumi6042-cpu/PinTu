import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const base=process.argv[2],filename=process.argv[3];
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||'')||!filename||!/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle\.sqlite$/.test(filename))throw Error('Isolated release fixture required');
const db=new DatabaseSync(resolve(filename)),origin='https://jigsawnook.online';
const id=()=>randomBytes(16).toString('hex'),rooms=[];
async function request(path,body,actor={},options={}){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1',Origin:options.origin||origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(actor.cookie?{Cookie:actor.cookie}:{}),...(actor.token?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const cookie=response.headers.get('set-cookie')?.split(';')[0];return {status:response.status,data:await response.json(),headers:response.headers,cookie};
}
async function create(actor={},visibility='public'){
 const result=await request('/api/rooms',{visibility,imageId:'seaside-native-v2',pieces:108,guestSecret:randomBytes(32).toString('hex')},actor);
 assert.equal(result.status,201,JSON.stringify(result.data));rooms.push(result.data.room.id);return {...result.data,cookie:result.cookie||actor.cookie};
}
try{
 const a=await create(),other=await create(),path='/api/rooms/'+a.room.id,chat=path+'/chat';
 const join=await request(path+'/join',{},other);assert.equal(join.status,200);const b={...join.data,cookie:other.cookie};
 assert.equal((await request(chat)).status,401);
 assert.equal((await request(chat,undefined,{token:a.token,cookie:other.cookie})).status,401);
 assert.equal((await request('/api/rooms/'+other.room.id+'/chat',undefined,a)).status,401);
 const first=await request(chat,undefined,a);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');assert.deepEqual(first.data.messages,[]);
 assert.equal((await request(chat+'?after=-1',undefined,a)).status,400);
 for(const text of ['', '🌿'.repeat(301)])assert.equal((await request(chat,{requestId:id(),text},a)).status,400);
 assert.equal((await request(chat,{requestId:id(),text:'hello'},a,{origin:'https://unrelated.example'})).status,403);
 const before=db.prepare('SELECT * FROM puzzle_rooms WHERE id=?').get(a.room.id),requestId=id(),text='你好 👋\n<script>alert(1)</script>';
 const sent=await request(chat,{requestId,text,name:'Forged name'},a);assert.equal(sent.status,200);assert.equal(sent.data.message.name,a.room.members[0].name);
 const retries=await Promise.all(Array.from({length:4},()=>request(chat,{requestId,text},a)));assert.ok(retries.every(r=>r.status===200&&r.data.message.id===sent.data.message.id));
 assert.equal((await request(chat,{requestId,text:'changed'},a)).status,409);
 const rate=await request(chat,{requestId:id(),text:'too fast'},a);assert.equal(rate.status,429);assert.ok(rate.headers.get('retry-after'));
 const seen=await request(chat,undefined,b);assert.equal(seen.data.messages.length,1);assert.equal(seen.data.messages[0].text,text);assert.ok(!JSON.stringify(seen.data).includes('identity'));
 const reply=await request(chat,{requestId:id(),text:'Hello! 🧩',after:sent.data.message.id},b);assert.equal(reply.status,200);assert.equal(reply.data.messages.length,1);
 assert.equal((await request(chat+'?after='+sent.data.message.id,undefined,a)).data.messages[0].text,'Hello! 🧩');
 assert.deepEqual(db.prepare('SELECT * FROM puzzle_rooms WHERE id=?').get(a.room.id),before,'chat must not change any room state');
 const account=await request('/api/auth/register',{username:'chatqa_'+id().slice(0,10),name:'Chat account',password:randomBytes(18).toString('hex')});assert.equal(account.status,201,JSON.stringify(account.data));
 const solo=await create(account,'solo');assert.equal((await request('/api/rooms/'+solo.room.id+'/chat',undefined,solo)).status,403);
 const now=Date.now();db.prepare("INSERT INTO puzzle_memberships(user_id,plan,status,starts_at,expires_at,cancel_at_period_end) VALUES(?,'puzzle','active',?,?,0)").run(account.data.account.id,now-1000,now+3600000);
 const privateRoom=await create(account,'private'),privateChat='/api/rooms/'+privateRoom.room.id+'/chat';
 assert.equal((await request(privateChat,undefined,b)).status,401);
 assert.equal((await request(privateChat,{requestId:id(),text:'Private table'},privateRoom)).status,200);
 const invitation=await request('/api/rooms/'+privateRoom.room.id+'/join',{},other);assert.equal(invitation.status,200);
 assert.equal((await request(privateChat,undefined,{...invitation.data,cookie:other.cookie})).data.messages[0].text,'Private table');
 await request(path,{type:'leave'},b);assert.equal((await request(chat,undefined,b)).status,409);
 db.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(a.room.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM puzzle_room_chat WHERE room_id=?').get(a.room.id).n,0);
 console.log(JSON.stringify({roomChat:true,twoPlayers:true,identityBound:true,privateIsolated:true,soloExcluded:true,retriesDeduplicated:true,rateLimited:true,plainText:true,puzzleRowUnchanged:true,deletionCascades:true}));
}finally{for(const roomId of rooms)db.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(roomId);db.close();}
