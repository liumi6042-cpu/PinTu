import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile,managedDay,managedGift,TASK_DEFINITIONS} from '../lib/managed-economy-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.__sharedClientEnv={PUZZLE_LOCAL_ORIGIN:'http://localhost',PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export {POST as createRoomRoute} from "./app/api/rooms/route";export {sharedClientApi} from "./lib/shared-client-api";export * from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {applyRoomUpdate} from "./lib/room-sync";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedClientEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='a'.repeat(32),other='b'.repeat(32),token='c'.repeat(64),otherToken='d'.repeat(64),origin='http://localhost';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url))),now=Date.now();
 globalThis.__sharedClientEnv.PUZZLE_DB=db;
 for(const [id,secret,name] of [[owner,token,'原账号'],[other,otherToken,'另一个账号']]){db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(id,id,name,'kept-password-hash','kept-salt',now);db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(hash(secret),id,now+86400000);}
 const photos=api.RESTORABLE_PHOTOS.slice(0,3).map(p=>({...p,width:1200,height:900}));
 const paid={id:'paid',title:'原已购相册',description:'',showOnPc:true,showOnMobile:true,purchasable:true,price:20,imageIds:[photos[0].id],milestones:[]},free={...paid,id:'free',title:'免费相册',purchasable:false,price:0,imageIds:[photos[1].id]};
 const game=structuredClone(DEFAULT_GAME_SETTINGS),rewards=structuredClone(DEFAULT_TASK_REWARD_SETTINGS);
 rewards.tenGrid.coins=999;rewards.tenGrid.xp=999;
 const snapshot={releaseId:'shared-adapter-test',gameSettings:game,taskRewards:rewards,albums:{albums:[paid,free]},photos,dailyRuntime:{select:()=>photos[1],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT=()=>snapshot;
 const state=newManagedProfile();Object.assign(state,{level:4,xp:7,totalXp:900,coins:100,fragments:40,ownedAlbums:{paid:{imageIds:[photos[0].id,photos[2].id],price:20,at:now-10000}},ownedImages:{[photos[0].id]:true,[photos[2].id]:true},gifts:{'ten:1':{id:'ten:1',source:'ten:1',kind:'ten-grid',title:'旧礼包',coins:13,xp:5,createdAt:now-10000,openedAt:null},'ten:2':{id:'ten:2',source:'ten:2',kind:'ten-grid',title:'另一份礼包',coins:29,xp:11,createdAt:now-5000,openedAt:null}}});
 db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(owner,JSON.stringify(state),now);
 const legacy=JSON.stringify({balance:88,cosmetics:{cursors:['old-owned'],equipped:{cursor:'old-owned'}}});db.sql.prepare('INSERT INTO puzzle_courtyards(user_id,data) VALUES(?,?)').run(owner,legacy);
 const request=async(path,{method='GET',body,cookie=token,headers={}}={})=>{
  const response=await api.sharedClientApi(new Request(origin+'/api/shared'+path,{method,headers:{Cookie:'puzzle_session='+cookie,Origin:origin,...(method!=='GET'?{'Content-Type':'application/json'}:{}),...headers},...(method!=='GET'?{body:JSON.stringify(body??{})}:{})}),path.split('?')[0]);
  return {status:response.status,data:await response.json(),headers:response.headers};
 };
 return {db,request,snapshot,state,photos,legacy,close(){db.close();delete globalThis.__sharedClientEnv.PUZZLE_DB;}};
}
const stored=f=>JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(owner).data);

test('shared public creation reuses an empty table and admits the next account without resetting its board',async()=>{
 const f=fixture();try{
  const input={imageId:f.photos[1].id,pieces:108,visibility:'public',mode:'selected'};
  const first=await f.request('/api/rooms',{method:'POST',body:input});assert.equal(first.status,201,JSON.stringify(first.data));
  const next=await f.request('/api/rooms',{method:'POST',body:input,cookie:otherToken});assert.equal(next.status,201,JSON.stringify(next.data));assert.equal(next.data.reused,true);
  assert.equal(next.data.room.id,first.data.room.id);assert.deepEqual(next.data.room.puzzle.groups,first.data.room.puzzle.groups);
  assert.equal(next.data.room.members.length,2);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_rooms').get().n,1);
  const retained=await f.request('/api/rooms/'+first.data.room.id,{headers:{Authorization:'Bearer '+first.data.token}});assert.equal(retained.status,200,'the first player ticket remains valid');
  assert.equal(f.db.sql.prepare('SELECT owner_id FROM puzzle_room_directory').get().owner_id,owner);
 }finally{f.close();}
});

test('legacy public creation without managed content retains the catalog title',async()=>{
 const f=fixture();try{
  globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT=()=>null;
  const photo=api.RESTORABLE_PHOTOS.find(p=>p.status==='published');
  const response=await api.createRoomRoute(new Request(origin+'/api/rooms',{method:'POST',headers:{Cookie:'puzzle_session='+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({imageId:photo.id,pieces:108,visibility:'public'})}));
  const data=await response.json();assert.equal(response.status,201,JSON.stringify(data));assert.equal(data.room.title,photo.title);
 }finally{f.close();}
});

test('shared rooms keep old artwork and entitlements while upgraded creation ignores client-supplied URLs',async()=>{
 const f=fixture();try{
  const registry=JSON.parse(readFileSync(new URL('../content/artwork-revisions.json',import.meta.url),'utf8')),id='lantern-market',old=registry.legacy[id],next=registry.versions[id].find(p=>p.revision!==old.revision),photo=api.RESTORABLE_PHOTOS.find(p=>p.id===id);
  f.snapshot.photos.push({...photo,width:old.width,height:old.height});f.snapshot.albums.albums.find(a=>a.id==='free').imageIds.push(id);
  const input={imageId:id,pieces:108,visibility:'public',mode:'selected'},first=await f.request('/api/rooms',{method:'POST',body:input});assert.equal(first.status,201,JSON.stringify(first.data));
  const row=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(first.data.room.id).data);delete row.artwork;
  f.db.sql.prepare('UPDATE puzzle_rooms SET data=? WHERE id=?').run(JSON.stringify(row),row.id);
  const keptBoard=JSON.stringify(row.puzzle),keptWallet=JSON.stringify(stored(f)),keptCatalog=JSON.stringify(f.snapshot.photos);
  const gallery=await f.request('/api/mobile/gallery',{headers:{'X-Jigsaw-Artwork-Snapshot':'1'}});assert.equal(gallery.status,200);assert.equal(gallery.data.photos.find(p=>p.id===id).src,origin+next.src);assert.equal(JSON.stringify(f.snapshot.photos),keptCatalog,'presentation overlay preserves the source catalog and snapshot');
  const upgraded=await f.request('/api/rooms',{method:'POST',body:{...input,artwork:{...next,src:'https://untrusted.example/image.webp'}},headers:{'X-Jigsaw-Artwork-Snapshot':'1'}});
  assert.equal(upgraded.status,201,JSON.stringify(upgraded.data));assert.notEqual(upgraded.data.room.id,row.id);assert.deepEqual(upgraded.data.room.artwork,next);assert.equal(upgraded.data.room.photo.src,origin+next.src);
  const historical=await f.request('/api/rooms/'+row.id,{headers:{Authorization:'Bearer '+first.data.token}});assert.equal(historical.status,200);assert.equal(historical.data.photo.src,origin+old.src);assert.equal(JSON.stringify(historical.data.puzzle),keptBoard);
  const stale=await f.request('/api/rooms/'+upgraded.data.room.id,{headers:{Authorization:'Bearer '+upgraded.data.token}});assert.equal(stale.status,409);assert.equal(stale.data.code,'ARTWORK_CLIENT_UPDATE_REQUIRED');
  const lobby=await f.request('/api/lobby',{headers:{'X-Jigsaw-Artwork-Snapshot':'1'}});assert.equal(lobby.status,200);assert.equal(lobby.data.rooms.find(r=>r.id===row.id).thumbSrc,old.thumbSrc);assert.equal(lobby.data.rooms.find(r=>r.id===upgraded.data.room.id).thumbSrc,next.thumbSrc);
  assert.equal(JSON.stringify(stored(f)),keptWallet,'creation and picture versioning do not change player wallets, purchases or collections');
 }finally{f.close();}
});

test('shared configuration points to the packaged UI and original service pages',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../app/shared-client-build.json',import.meta.url),'utf8')),config=api.sharedConfig(origin);
 assert.equal(config.uiBase,manifest.uiBase);assert.equal(config.gameBase,origin+'/play');assert.equal(config.webLinks.feedback,'/feedback');
});

test('shared cookie profile and collection retain the original account, wallet and historical purchased images',async()=>{
 const f=fixture();try{
  const profile=await f.request('/api/mobile/profile');assert.equal(profile.status,200);assert.equal(profile.data.account.id,owner);assert.equal(profile.data.name,'原账号');assert.equal(profile.data.collection.coins,100);assert.equal(profile.data.xp,7);assert.equal(profile.data.totalXp,900);assert.equal(profile.data.energy,0);
  const collection=await f.request('/api/mobile/collection');assert.equal(collection.status,200);assert.equal(collection.data.wallet.coins,100);assert.equal(collection.data.packs[0].owned,true);assert.ok(collection.data.albums.find(a=>a.id==='shared-retained-rights').images.some(p=>p.id===f.photos[2].id));
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_players').get().n,1,'adapter does not create a second wallet');assert.equal(f.db.sql.prepare('SELECT data FROM puzzle_courtyards WHERE user_id=?').get(owner).data,f.legacy);
  assert.equal(f.db.sql.prepare('SELECT password_hash FROM puzzle_users WHERE id=?').get(owner).password_hash,'kept-password-hash');
 }finally{f.close();}
});

test('gallery separates free album images from paid packs, daily choices and retained purchases',async()=>{
 const f=fixture();try{
  const first=await f.request('/api/mobile/gallery');assert.equal(first.status,200);
  assert.deepEqual(first.data.freeImageIds,[f.photos[1].id]);assert.deepEqual(first.data.packedImageIds,[f.photos[0].id]);
  assert.ok(first.data.accessibleImageIds.includes(f.photos[0].id),'an owned paid image stays accessible, without being called free');
  assert.ok(first.data.imageIds.includes(f.photos[2].id));assert.ok(!first.data.freeImageIds.includes(f.photos[2].id),'historical purchased images retain access but are not unassigned free artwork');
  const profile=await f.request('/api/mobile/profile');assert.deepEqual(new Set(profile.data.collection.ownedImageIds),new Set([f.photos[0].id,f.photos[2].id]),'free albums do not become purchased image entitlements in the client');
  const extras=api.RESTORABLE_PHOTOS.slice(3,8).map(p=>({...p,width:1200,height:900}));f.snapshot.photos.push(...extras);
  const base=f.snapshot.albums.albums[1];f.snapshot.albums.albums.push(
   {...base,id:'zero-price',purchasable:true,price:0,imageIds:[extras[0].id]},
   {...base,id:'mobile-only',showOnPc:false,imageIds:[extras[1].id]},
   {...base,id:'hidden',showOnPc:false,showOnMobile:false,imageIds:[extras[2].id]}
  );
  f.snapshot.albums.albums[1].imageIds.push(f.photos[0].id);
  f.snapshot.dailyRuntime.managedImageIds=()=>new Set([extras[3].id]);f.snapshot.dailyRuntime.select=()=>extras[3];
  f.snapshot.albums.albums[1].imageIds.push(extras[3].id);
  const library=await f.request('/api/mobile/gallery',{cookie:otherToken});assert.equal(library.status,200);
  assert.deepEqual(new Set(library.data.freeImageIds),new Set([f.photos[0].id,f.photos[1].id,extras[0].id]));
  assert.deepEqual(library.data.packedImageIds,[],'free membership takes precedence over a paid pack');
  assert.ok(library.data.accessibleImageIds.includes(extras[0].id),'zero-price albums require no purchase');
  assert.ok(library.data.accessibleImageIds.includes(extras[3].id),'today remains playable without entering the regular free gallery early');
  assert.ok(!library.data.imageIds.includes(extras[1].id));assert.ok(!library.data.imageIds.includes(extras[2].id));assert.ok(!library.data.imageIds.includes(extras[4].id));
  const collection=await f.request('/api/mobile/collection',{cookie:otherToken});assert.ok(!collection.data.packs.some(pack=>pack.id==='zero-price'));
  assert.deepEqual(collection.data.profile.collection.ownedImageIds,[],'a player without purchases sees free images only in the free gallery, not owned packs');
  assert.deepEqual(stored(f).ownedImages,f.state.ownedImages);assert.equal(stored(f).coins,100);
 }finally{f.close();}
});

test('a gift wire ID replays the same saved reward, never the next gift or new configuration',async()=>{
 const f=fixture();try{
  const before=await f.request('/api/mobile/tasks');assert.deepEqual(before.data.inventory.map(g=>g.kind),['ten:1','ten:2']);assert.equal(before.data.inventory[0].coins,13);
  const open=()=>f.request('/api/mobile/gifts/open',{method:'POST',body:{kind:'ten:1',quantity:1,requestId:'e'.repeat(32)}});
  const responses=await Promise.all([open(),open()]);assert.ok(responses.every(r=>r.status===200));assert.equal(stored(f).coins,113);assert.equal(stored(f).totalXp,905);assert.equal(stored(f).gifts['ten:2'].openedAt,null);
  const retried=await open();assert.equal(retried.data.opened.coins,0);assert.equal(stored(f).coins,113);
  const otherResult=await f.request('/api/mobile/gifts/open',{method:'POST',cookie:otherToken,body:{kind:'ten:1',requestId:'f'.repeat(32)}});assert.equal(otherResult.status,404);
 }finally{f.close();}
});

test('purchases keep the original idempotency and invalid origins cannot mutate the wallet',async()=>{
 const f=fixture();try{
  const buy=()=>f.request('/api/mobile/collection/buy',{method:'POST',body:{packId:'paid',requestId:'e'.repeat(32)}});
  assert.equal((await buy()).status,200);assert.equal((await buy()).status,200);assert.equal(stored(f).coins,100,'already-purchased album is never charged again');
  const rejected=await f.request('/api/mobile/gifts/open',{method:'POST',body:{kind:'ten:1'},headers:{Origin:'https://elsewhere.example'}});assert.equal(rejected.status,403);assert.equal(stored(f).coins,100);
  const absentOrigin=new Request(origin+'/api/shared/api/mobile/gifts/open',{method:'POST',headers:{Cookie:'puzzle_session='+token,'Content-Type':'application/json'},body:'{"kind":"ten:1"}'});assert.equal((await api.sharedClientApi(absentOrigin,'/api/mobile/gifts/open')).status,403);
  assert.equal((await f.request('/api/mobile/social/messages',{method:'POST',body:{peer:'somebody',text:'test'}})).status,501,'unsupported messages never report success');
 }finally{f.close();}
});

test('every completed cooperation and friend task and invitation gift keeps a claimable original gift ID',async()=>{
 const f=fixture();try{
  const now=Date.now(),day=managedDay(now),ids=TASK_DEFINITIONS.map(task=>'daily:'+day+':'+task.id);
  f.state.daily[day]={cooperation:60,friend:30,shares:[]};
  for(const [index,task] of TASK_DEFINITIONS.entries())managedGift(f.state,ids[index],{source:ids[index],kind:task.id,title:task.title,coins:7+index,xp:1},now);
  const invitationId='invite:'+other;managedGift(f.state,invitationId,{source:invitationId,kind:'invite-friend',title:'邀友见面礼',coins:19,xp:2},now);
  f.db.sql.prepare('UPDATE puzzle_managed_players SET data=? WHERE owner=?').run(JSON.stringify(f.state),owner);
  const tasks=await f.request('/api/mobile/tasks');assert.equal(tasks.status,200);
  for(const id of ids){assert.equal(tasks.data.tasks.find(task=>task.kind===id)?.earned,true);assert.ok(tasks.data.inventory.some(gift=>gift.kind===id&&gift.claimable));}
  for(const id of [...ids,invitationId]){
   const gift=tasks.data.inventory.find(gift=>gift.kind===id),open=()=>f.request('/api/mobile/gifts/open',{method:'POST',body:{kind:gift.kind,quantity:1}});
   assert.equal((await open()).status,200);const replay=await open();assert.equal(replay.status,200);assert.equal(replay.data.opened.coins,0);
  }
  assert.equal(stored(f).coins,164);assert.equal(stored(f).totalXp,907);assert.equal(stored(f).gifts['ten:1'].openedAt,null);
 }finally{f.close();}
});

test('shared rooms use existing account authentication and return authoritative groups without rewriting legacy progress',async()=>{
 const f=fixture();try{
  const made=await f.request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:f.photos[1].id,pieces:108,visibility:'public',requestId:'e'.repeat(32)}});assert.equal(made.status,201,JSON.stringify(made.data));assert.ok(Array.isArray(made.data.room.puzzle.groups));assert.equal(made.data.initialState,undefined);
  const id=made.data.room.id,saved=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data);assert.equal(saved.ownerId,owner);assert.deepEqual(made.data.room.puzzle.groups,saved.puzzle.groups);
  const read=await f.request('/api/rooms/'+id,{headers:{Authorization:'Bearer '+made.data.token}});assert.equal(read.status,200);assert.deepEqual(read.data.puzzle.groups,saved.puzzle.groups);
  const headers={Authorization:'Bearer '+made.data.token},heartbeat=await f.request('/api/rooms/'+id+'?since='+read.data.revision,{method:'POST',headers,body:{type:'heartbeat',requestId:'f'.repeat(32)}});
  assert.equal(heartbeat.status,200);assert.equal(heartbeat.data.kind,'delta');assert.equal(heartbeat.data.puzzle,undefined);const merged=api.applyRoomUpdate(read.data,heartbeat.data);assert.deepEqual(merged.puzzle.groups,saved.puzzle.groups);assert.equal(merged.puzzle.scatterVersion,3);
  const delta=await f.request('/api/rooms/'+id+'?since='+merged.revision,{headers});assert.equal(delta.data.kind,'delta');assert.deepEqual(api.applyRoomUpdate(merged,delta.data).puzzle.groups,saved.puzzle.groups);
  const chatBody={text:'字'.repeat(300),requestId:'1'.repeat(32),after:0},chat=await f.request('/api/rooms/'+id+'/chat',{method:'POST',headers,body:chatBody});assert.equal(chat.status,200,JSON.stringify(chat.data));assert.equal(chat.data.message.text,chatBody.text);
  const replay=await f.request('/api/rooms/'+id+'/chat',{method:'POST',headers,body:chatBody});assert.equal(replay.status,200);assert.equal(replay.data.message.id,chat.data.message.id);
  const tooLong=await f.request('/api/rooms/'+id+'/chat',{method:'POST',headers,body:{...chatBody,text:'字'.repeat(301),requestId:'2'.repeat(32)}});assert.equal(tooLong.status,400);
  const wrong=await f.request('/api/rooms/'+id,{cookie:otherToken,headers:{Authorization:'Bearer '+made.data.token}});assert.equal(wrong.status,401,'room token cannot impersonate a different logged-in account');
  const legacy={...saved,puzzle:{...saved.puzzle,scatterVersion:undefined,cols:40,rows:25},customImage:{id:'custom-preserved',title:'旧上传',width:1600,height:1200}};f.db.sql.prepare('UPDATE puzzle_rooms SET revision=revision+1,data=? WHERE id=?').run(JSON.stringify(legacy),id);
  const unchanged=f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data,compat=await f.request('/api/rooms/'+id+'/join',{method:'POST',body:{}});assert.equal(compat.status,409);assert.equal(compat.data.compatUrl,'/play?room='+id);assert.equal(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data,unchanged);
 }finally{f.close();}
});

test('a paused guest-admitted room cannot issue a guest ticket labeled as the signed-in account',async()=>{
 const f=fixture();try{
  const made=await f.request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:f.photos[1].id,pieces:108,visibility:'public'}});assert.equal(made.status,201);
  const id=made.data.room.id,secret='3'.repeat(64),guestId='guest:'+hash(secret),room=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data);
  room.ownerId=guestId;room.acceptingNew=false;room.admitted={[guestId]:true};room.participants={[guestId]:'原游客'};
  for(const member of room.members){delete member.accountId;member.guestId=guestId;}
  const preserved=JSON.stringify(room);f.db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=revision+1 WHERE id=?').run(preserved,id);
  const headers={Cookie:'puzzle_session='+token+'; puzzle_guest='+secret},blocked=await f.request('/api/rooms/'+id+'/join',{method:'POST',headers,body:{}});
  assert.equal(blocked.status,409);assert.equal(blocked.data.code,'LEGACY_ROOM_REQUIRED');assert.equal(blocked.data.compatUrl,'/play?room='+id);assert.equal(blocked.data.token,undefined);
  assert.equal(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data,preserved,'guard runs before the original join mutates room tickets or membership');assert.equal(stored(f).coins,100);
  room.admitted[owner]=true;f.db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(room),id);
  const allowed=await f.request('/api/rooms/'+id+'/join',{method:'POST',headers,body:{}});assert.equal(allowed.status,200);
  const joined=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id).data).members.find(member=>member.id===allowed.data.playerId);assert.equal(joined.accountId,owner);assert.equal(joined.guestId,undefined);
 }finally{f.close();}
});

test('shared cursor presence follows room membership without extending online status',async()=>{
 const f=fixture();try{
  const made=await f.request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:f.photos[1].id,pieces:108,visibility:'public'}});assert.equal(made.status,201);
  const ticket=made.data,path='/api/rooms/'+ticket.room.id,headers={Authorization:'Bearer '+ticket.token};
  const joined=await f.request(path+'/join',{method:'POST',cookie:otherToken,body:{}});assert.equal(joined.status,200);
  const peerHeaders={Authorization:'Bearer '+joined.data.token},point={clientId:'e'.repeat(32),seq:1,point:{x:100,y:120}};
  assert.equal((await f.request(path+'/cursors',{method:'POST',headers,body:point})).status,200);
  const room=JSON.parse(f.db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(ticket.room.id).data);
  room.members.find(m=>m.id===ticket.playerId).lastSeen=Date.now()-10*60*1000;room.revision++;
  f.db.sql.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(room),room.revision,room.id);
  f.db.sql.prepare('UPDATE puzzle_room_cursors SET updated_at=? WHERE room_id=?').run(Date.now()-10*60*1000,room.id);
  const snapshot=await f.request(path,{cookie:otherToken,headers:peerHeaders});assert.equal(snapshot.status,200);
  assert.equal(snapshot.data.members.some(m=>m.id===ticket.playerId),false);
  const old=await f.request(path+'/cursors',{cookie:otherToken,headers:peerHeaders});assert.equal(old.status,200);assert.equal(old.data.cursors.find(p=>p.playerId===ticket.playerId).x,100);
  const sweep=await f.request(path+'/cursors',{method:'POST',cookie:otherToken,headers:peerHeaders,body:{clientId:'f'.repeat(32),seq:50,point:{x:200,y:220}}});assert.equal(sweep.status,200);assert.ok(sweep.data.cursors.some(p=>p.playerId===ticket.playerId),'cleanup preserves a stationary member');
  f.db.sql.prepare("INSERT INTO puzzle_account_security(user_id,status) VALUES(?,'suspended') ON CONFLICT(user_id) DO UPDATE SET status='suspended'").run(owner);
  const suspended=await f.request(path+'/cursors',{cookie:otherToken,headers:peerHeaders});assert.ok(!suspended.data.cursors.some(p=>p.playerId===ticket.playerId),'a suspended account cannot leave a visible decoration');
  f.db.sql.prepare("UPDATE puzzle_account_security SET status='active' WHERE user_id=?").run(owner);
  assert.equal((await f.request(path,{method:'POST',headers,body:{type:'leave'}})).status,200);
  const left=await f.request(path+'/cursors',{cookie:otherToken,headers:peerHeaders});assert.ok(!left.data.cursors.some(p=>p.playerId===ticket.playerId));
  assert.equal((await f.request(path+'/cursors',{method:'POST',headers,body:{...point,seq:2}})).status,409);
 }finally{f.close();}
});

test('shared drop feedback reads only this committed contribution receipt and stays silent for polls or ignored sequences',async()=>{
 const f=fixture();try{
  f.snapshot.gameSettings.energy.contributionXp=3;f.snapshot.gameSettings.collection.contributionCoins=7;
  const made=await f.request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:f.photos[1].id,pieces:108,visibility:'public'}});assert.equal(made.status,201);
  const path='/api/rooms/'+made.data.room.id,headers={Authorization:'Bearer '+made.data.token},send=body=>f.request(path,{method:'POST',headers,body}),drop={type:'drop',groupId:0,dx:0,dy:0,seq:1,requestId:'7'.repeat(32)};
  assert.equal((await send({type:'claim',groupId:0})).status,200);
  const [placed,gift]=await Promise.all([send(drop),f.request('/api/mobile/gifts/open',{method:'POST',body:{kind:'ten:1',quantity:1,requestId:'6'.repeat(32)}})]);assert.equal(placed.status,200);assert.equal(gift.status,200);assert.deepEqual(placed.data.mobileContribution,{requestId:drop.requestId,groupId:0,creditedXp:3},'another concurrent reward cannot inflate this drop receipt');
  assert.equal(stored(f).totalXp,908);assert.equal(stored(f).coins,120);assert.equal(stored(f).receipts['snap:'+made.data.room.id+':1'].xp,3);
  const event=f.db.sql.prepare('SELECT payload,settled_at FROM puzzle_managed_reward_events WHERE id=?').get('room:'+made.data.room.id+':'+placed.data.revision);assert.ok(event.settled_at);assert.equal(JSON.parse(event.payload).owners.find(p=>p.owner===owner).count,1);
  const replay=await send(drop);assert.equal(replay.status,409);assert.equal(replay.data.mobileContribution,undefined);assert.equal(stored(f).totalXp,908);
  const poll=await f.request(path,{headers});assert.equal(poll.data.mobileContribution,undefined,'polls cannot replay a completed reward');
  assert.equal((await send({type:'claim',groupId:1})).status,200);
  const g=poll.data.puzzle.groups.find(g=>g.id===1);assert.equal((await send({type:'move',groupId:1,dx:g.dx,dy:g.dy,seq:2})).status,200);
  const ignored=await send({...drop,groupId:1,requestId:'8'.repeat(32)});assert.equal(ignored.status,200);assert.equal(ignored.data.mobileContribution,undefined,'ignored old sequence receives no exact-revision event');assert.equal(stored(f).totalXp,908);
  const badRequest=await f.request(path,{method:'POST',cookie:otherToken,headers,body:{...drop,groupId:1,seq:3,requestId:'9'.repeat(32)}});assert.equal(badRequest.status,401);assert.equal(badRequest.data.mobileContribution,undefined);
  f.snapshot.gameSettings.energy.contributionXp=0;const zero=await send({...drop,groupId:1,seq:3,requestId:'a'.repeat(32)});assert.equal(zero.status,200);assert.equal(zero.data.mobileContribution,undefined,'zero XP cannot display a fabricated +1');assert.equal(stored(f).totalXp,908);
 }finally{f.close();}
});

test('shared drop without a settled payout succeeds without XP text and recovery never replays it through polling',async()=>{
 const f=fixture();try{
  f.snapshot.gameSettings.energy.contributionXp=4;
  const made=await f.request('/api/rooms',{method:'POST',body:{mode:'selected',imageId:f.photos[1].id,pieces:108,visibility:'public'}});assert.equal(made.status,201);
  const path='/api/rooms/'+made.data.room.id,headers={Authorization:'Bearer '+made.data.token},send=body=>f.request(path,{method:'POST',headers,body});
  assert.equal((await send({type:'claim',groupId:0})).status,200);
  globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT=()=>{throw Error('isolated test: reward release unavailable');};
  const result=await send({type:'drop',groupId:0,dx:0,dy:0,seq:1,requestId:'b'.repeat(32)});assert.equal(result.status,200);assert.equal(result.data.mobileContribution,undefined);assert.equal(stored(f).totalXp,900);
  assert.equal(f.db.sql.prepare('SELECT settled_at FROM puzzle_managed_reward_events WHERE room_id=?').get(made.data.room.id).settled_at,null);
  globalThis.__sharedClientEnv.PUZZLE_CONTENT_SNAPSHOT=()=>f.snapshot;
  const recovered=await f.request('/api/mobile/profile');assert.equal(recovered.status,200);assert.equal(stored(f).totalXp,904);assert.equal(recovered.data.mobileContribution,undefined);
  assert.equal((await f.request(path,{headers})).data.mobileContribution,undefined);
  assert.equal((await send({type:'heartbeat',requestId:'c'.repeat(32)})).data.mobileContribution,undefined);
 }finally{f.close();}
});
