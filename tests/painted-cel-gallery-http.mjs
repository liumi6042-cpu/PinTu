import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {isolatedGet,assertSharedEntry} from './isolated-game-entry.mjs';
const base=process.argv[2];
assert.match(base,/^http:\/\/127\.0\.0\.1:31\d\d$/,'Only run against the disposable release server');
const catalog=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url),'utf8'));
const photos=catalog.filter(p=>p.status==='published'&&['厚涂','平涂'].includes(p.category));assert.ok(photos.length>0);
const headers={Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.42'};
const get=isolatedGet(base,headers);
const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({username:'art_'+randomBytes(6).toString('hex'),name:'Art test',password:randomBytes(16).toString('hex')})});assert.equal(registration.status,201);const accountCookie=registration.headers.get('set-cookie').split(';')[0];await registration.arrayBuffer();
await assertSharedEntry(get,'/gallery');
for(const [index,photo] of photos.entries()){
 await assertSharedEntry(get,'/puzzle/'+photo.id);
 const pieces=index%2?108:1000;
 const response=await fetch(base+'/api/rooms',{method:'POST',headers:{...headers,...(pieces>=500?{Cookie:accountCookie}:{}),'Content-Type':'application/json'},body:JSON.stringify({imageId:photo.id,pieces,visibility:'public',guestSecret:randomBytes(32).toString('hex'),initialState:'seed-v1'}),signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,201);const ticket=await response.json(),cookie=response.headers.get('set-cookie')?.split(';')[0]||(pieces>=500?accountCookie:null);assert.ok(cookie);
 const auth={...headers,Cookie:cookie,Authorization:'Bearer '+ticket.token};
 try{
  assert.equal(ticket.room.puzzle.imageId,photo.id);assert.equal(ticket.room.puzzle.groups,undefined);
  await assertSharedEntry(get,'/room/'+ticket.room.id,'/play?room='+ticket.room.id);
  const image=await get(photo.optimizedSrc);assert.equal(image.status,200);await image.arrayBuffer();
  // Catalog rooms are fitted to the picture, so the board is the grid the ticket
  // reported (1000 pieces on a 3:2 picture plays 38x26=988), not the level count.
  const snapshot=await fetch(base+'/api/rooms/'+ticket.room.id,{headers:auth});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).puzzle.groups.length,ticket.room.puzzle.cols*ticket.room.puzzle.rows);
 }finally{const left=await fetch(base+'/api/rooms/'+ticket.room.id,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({type:'leave'})});assert.equal(left.status,200);await left.arrayBuffer();}
}
console.log(JSON.stringify({painted:photos.filter(p=>p.category==='厚涂').length,celShading:photos.filter(p=>p.category==='平涂').length,newRoomCreation:true,legacyPagesRedirected:true,optimizedAssets:true,seedAndFullSnapshot:true}));
