import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPuzzle} from '../lib/puzzle-engine.ts';

const base=process.argv[2]||'http://127.0.0.1:3137';
const local=base.startsWith('http://127.0.0.1:');
const headers=local?{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'}:{};
const secret=randomBytes(32).toString('hex');let cookie='';
async function request(path,body,token){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];
 const text=await response.text();return {status:response.status,data:JSON.parse(text),bytes:Buffer.byteLength(text)};
}
const rooms=[];
try{
 const create=await request('/api/rooms',{imageId:'emerald-river-valley-native-v2',pieces:5000,visibility:'public',guestSecret:secret,initialState:'seed-v1'});
 assert.equal(create.status,201);rooms.push(create.data);assert.ok(cookie.startsWith('puzzle_guest='));
 assert.ok(create.bytes<1500);assert.equal(create.data.initialState,'seed-v1');assert.equal(create.data.room.puzzle.groups,undefined);
 const initial=create.data.room.puzzle;
 const full=await request('/api/rooms/'+create.data.room.id,undefined,create.data.token);
 assert.equal(full.status,200);assert.deepEqual(full.data.puzzle,createPuzzle(initial.imageId,initial.cols,initial.rows,initial.seed));
 const firstName=create.data.room.members[0].name;
 // A candidate cannot replace an established cookie identity.
 const legacy=await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility:'public',guestSecret:randomBytes(32).toString('hex')});
 assert.equal(legacy.status,201);rooms.push(legacy.data);assert.equal(legacy.data.room.puzzle.groups.length,108);assert.equal(legacy.data.room.members[0].name,firstName);
 for(const [visibility,status] of [['solo',401],['private',403]])assert.equal((await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility,guestSecret:secret,initialState:'seed-v1'})).status,status);
 assert.equal((await request('/api/rooms',{imageId:initial.imageId,pieces:108,visibility:'public',guestSecret:'invalid',initialState:'seed-v1'})).status,400);
 const validCookie=cookie;cookie='puzzle_guest='+randomBytes(32).toString('hex');
 assert.equal((await request('/api/rooms/'+create.data.room.id,undefined,create.data.token)).status,401);cookie=validCookie;
 console.log(JSON.stringify({compact5000Bytes:create.bytes,full5000Bytes:full.bytes,positionsMatch:true,legacyCompatible:true,cookieIdentityPreserved:true,privateAndSoloProtected:true}));
}finally{for(const room of rooms)await request('/api/rooms/'+room.room.id,{type:'leave'},room.token).catch(()=>{});}
