import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {createPuzzle} from '../lib/puzzle-engine.ts';
import {PIECE_LOGIN_REQUIRED} from '../lib/piece-access.ts';
const base=process.argv[2],filename=process.argv[3];
assert.match(base,/^http:\/\/127\.0\.0\.1:31\d\d$/,'Run only against the disposable release smoke server');assert.match(filename??'',/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle\.sqlite$/);
const db=new DatabaseSync(resolve(filename)),id=()=>randomBytes(16).toString('hex'),rooms=[];
async function request(path,body,actor={}){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.41',Origin:'https://jigsawnook.online',...(body===undefined?{}:{'Content-Type':'application/json'}),...(actor.cookie?{Cookie:actor.cookie}:{}),...(actor.token?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const cookie=r.headers.get('set-cookie')?.split(';')[0];if(cookie)actor.cookie=cookie;
 return {status:r.status,data:await r.json()};
}
async function create(pieces,actor={}){const r=await request('/api/rooms',{imageId:'mountain-lake-reflection-hd-v3',pieces,visibility:'public',initialState:'seed-v1'},actor);assert.equal(r.status,201,JSON.stringify(r.data));rooms.push(r.data.room.id);actor.token=r.data.token;return r.data;}
const expired=(roomId,kind)=>db.prepare('UPDATE puzzle_assistance_grants SET expires_at=? WHERE room_id=? AND kind=?').run(Date.now()-1,roomId,kind);
try{
 const countBefore=db.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n;
 for(const pieces of [500,1000]){
  for(const extra of [{},{accountId:'pretend',member:true}]){
   const r=await request('/api/rooms',{imageId:'mountain-lake-reflection-hd-v3',pieces,visibility:'public',...extra});assert.equal(r.status,401);assert.equal(r.data.error,PIECE_LOGIN_REQUIRED);
  }
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,countBefore);
 const account={};const registered=await request('/api/auth/register',{username:'access_'+id().slice(0,10),name:'Free account',password:id()},account);assert.equal(registered.status,201,JSON.stringify(registered.data));
 for(const pieces of [500,1000]){
  const ticket=await create(pieces,account),path='/api/rooms/'+ticket.room.id;
  // Catalog rooms are fitted to the picture, so the board is the grid the ticket
  // reported (512 for the 500 level on this 2:1 landscape), not the level count.
  assert.equal(ticket.room.puzzle.groups,undefined);const full=await request(path,undefined,account);assert.equal(full.status,200);assert.equal(full.data.puzzle.groups.length,ticket.room.puzzle.cols*ticket.room.puzzle.rows);
  for(const [kind,limit] of [['underlay',pieces===500?4:6],['hint',pieces===500?8:12]]){
   for(let i=0;i<limit;i++){const use=await request(path+'/assistance',{kind,requestId:id()},account);assert.equal(use.status,200,JSON.stringify(use.data));assert.equal(use.data.grants.filter(g=>g.kind===kind).length,i+1);expired(ticket.room.id,kind);}
   assert.equal((await request(path+'/assistance',{kind,requestId:id()},account)).status,409);
  }
  const guest={};const guestJoin=await request(path+'/join',{accountId:registered.data.account.id},guest);
  assert.equal(guestJoin.status,200,'joining a high-count room needs no account');
  assert.notEqual(guestJoin.data.room.members.find(m=>m.id===guestJoin.data.playerId).name,'Free account','an accountId in the JSON body must not grant account identity');
  const joined=await request(path+'/join',{},account);assert.equal(joined.status,200);account.token=joined.data.token;
  assert.equal((await request(path,undefined,{token:account.token})).status,401,'a copied account ticket is insufficient');
 }
 const a={},b={};const low=await create(108,a),other=await create(300,b),path='/api/rooms/'+low.room.id,aid=path+'/assistance';
 const friend=await request(path+'/join',{},b);assert.equal(friend.status,200);b.token=friend.data.token;
 assert.equal((await request(aid)).status,401);assert.equal((await request(aid,{kind:'reference',requestId:id()},a)).status,400);
 assert.equal((await request(path,{type:'claim',groupId:0},a)).status,200);
 const before=db.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(low.room.id);
 const firstRequest=id();const burst=await Promise.all(Array.from({length:8},()=>request(aid,{kind:'underlay',requestId:firstRequest},a)));
 assert.ok(burst.every(r=>r.status===200&&r.data.grants.length===1));const first=burst[0].data.grants[0];
 assert.ok(first.expiresAt-burst[0].data.serverTime<=30000&&first.expiresAt-burst[0].data.serverTime>27000);
 assert.equal((await request(aid,{kind:'underlay',requestId:id()},a)).data.grants.length,1,'active use cannot consume the second window');
 assert.equal((await request(aid,undefined,b)).data.grants.length,0,'teammate quota remains separate');
 assert.deepEqual(db.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(low.room.id),before);
 expired(low.room.id,'underlay');
 const rejoined=await request(path+'/join',{},a);assert.equal(rejoined.status,200);a.token=rejoined.data.token;
 assert.equal((await request(aid,undefined,a)).data.grants.length,1,'rejoining retains first use');
 const second=await request(aid,{kind:'underlay',requestId:id()},a);assert.equal(second.status,200);assert.equal(second.data.grants.length,2);
 expired(low.room.id,'underlay');assert.equal((await request(aid,{kind:'underlay',requestId:id()},a)).status,409);
 assert.equal((await request(aid,{kind:'underlay',requestId:id()},b)).data.grants.length,1);
 const beforeHints=db.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(low.room.id);
 for(let i=0;i<3;i++){const requestId=id(),r=await request(aid,{kind:'hint',requestId},a);assert.equal(r.status,200);const grant=r.data.grants.find(g=>g.requestId===requestId);assert.equal(grant.pieceIds.length,3);assert.ok(!grant.pieceIds.includes(0));expired(low.room.id,'hint');}
 assert.equal((await request(aid,{kind:'hint',requestId:id()},a)).status,409);assert.deepEqual(db.prepare('SELECT data,revision FROM puzzle_rooms WHERE id=?').get(low.room.id),beforeHints);
 // Simulate an already-admitted 500-piece room without a production bypass.
 const row=db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(other.room.id),room=JSON.parse(row.data);
 room.puzzle=createPuzzle(room.puzzle.imageId,25,20,42);room.puzzle.groups[0].locked=true;room.puzzle.groups[0].dx=0;room.puzzle.groups[0].dy=0;room.revision++;
 db.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(room),room.revision,room.id);
 db.prepare('UPDATE puzzle_room_directory SET piece_count=500 WHERE room_id=?').run(room.id);
 const oldActor={cookie:b.cookie,token:other.token},oldPath='/api/rooms/'+room.id;
 assert.equal((await request(oldPath,{type:'heartbeat'},oldActor)).status,200);
 const continued=await request(oldPath+'/join',{},oldActor);assert.equal(continued.status,200);oldActor.token=continued.data.token;assert.deepEqual(continued.data.room.puzzle.groups,room.puzzle.groups);
 const lateGuest={};assert.equal((await request(oldPath+'/join',{},lateGuest)).status,200,'high-count rooms accept guests without an account');
 assert.equal((await request(oldPath,{type:'claim',groupId:1},oldActor)).status,200);
 assert.equal((await request(oldPath,{type:'move',groupId:1,dx:123,dy:234,seq:1},oldActor)).status,200);
 assert.equal((await request(oldPath+'/chat',{requestId:id(),text:'Existing guest continues'},oldActor)).status,200);
 await request('/api/auth/logout',{},account);
 assert.equal((await request('/api/rooms',{imageId:'mountain-lake-reflection-hd-v3',pieces:500,visibility:'public'},account)).status,401);
 console.log(JSON.stringify({free500And1000Account:true,guest108And300:true,creationRequiresAccount:true,guestJoinHighCount:true,forgedIdentityIgnored:true,expiredSessionRejected:true,oldGuestReconnectMovesChat:true,pieceCountQuotas500And1000:true,twoUnderlays30Seconds:true,referenceRemoved:true,threeHintsOfThree:true,identityQuotasAndRetries:true,puzzleStateUnaffected:true}));
}finally{for(const roomId of rooms)db.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(roomId);db.close();}
