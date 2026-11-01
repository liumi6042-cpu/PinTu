import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createMobileService,mobileGridForPhoto} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {PHOTOS,photoGuidance,gridForDimensions,placedCount} from '../outputs/mobile/engine.mjs';
import {newProfile,xpForLevel,restoreEnergy,applyContribution,completionDistribution} from '../server/mobile-economy.mjs';
const rid=()=>randomBytes(16).toString('hex');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const photo=PHOTOS.find(p=>{const d=photoGuidance(p.id),g=gridForDimensions(d.width,d.height,48);return p.galleryVisible!==false&&g.count===48;});

void test('V3 economy boundaries, overflow, zero energy and exact contribution allocation',()=>{
 assert.equal(Array.from({length:29},(_,i)=>xpForLevel(i+1)).reduce((a,b)=>a+b,0),4417);assert.equal(xpForLevel(29),300);assert.equal(xpForLevel(1000),300);
 const p=newProfile('a',0);p.level=50;p.xp=298;p.totalXp=11015;p.energy=1;p.giftProgress=9;
 const first=applyContribution(p,{now:1,randomInt:(_min,max)=>max-1});assert.equal(first.gift,0);assert.equal(first.pendingGift.energy,7);assert.equal(first.pendingGift.maximum,7);assert.equal(p.energy,0);assert.equal(p.xp,299);p.energy=1;
 applyContribution(p,{now:2,randomInt:()=>1});assert.equal(p.level,51);assert.equal(p.energy,100);assert.equal(p.xp,0);
 p.energy=112;restoreEnergy(p,300002);assert.equal(p.energy,112);
 p.energy=0;p.energyAt=0;p.autoSupply=true;p.supply.energy=2;p.xp=0;
 applyContribution(p,{now:1,randomInt:()=>1});assert.equal(p.supply.energy,1);assert.equal(p.energy,99);
 p.energy=0;p.autoSupply=false;const before=structuredClone(p);assert.equal(applyContribution(p,{now:2,randomInt:()=>1}),null);assert.equal(p.totalXp,before.totalXp);
 restoreEnergy(p,600001);assert.equal(p.energy,2);
 const many=Object.fromEntries(Array.from({length:15},(_,i)=>[String(i),1]));const awards=completionDistribution(many,48);assert.equal(awards.reduce((n,v)=>n+v.energy,0),15);assert.ok(awards.every(v=>v.energy===1));
 const split=completionDistribution({a:30,b:10,watcher:0},500);assert.equal(split.reduce((n,v)=>n+v.energy,0),100);assert.equal(split.length,2);assert.ok(split[0].energy>split[1].energy);
});

void test('isolated HTTP service: authoritative multiplayer, growth, supply, permissions and replay',async()=>{
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-http-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=1800000000000,pcCalls=0;
 const upstream=createServer((_q,r)=>{pcCalls++;r.writeHead(500);r.end('PC must not be contacted');});const pcUrl=await listen(upstream);
 const service=createMobileService({shareRewards:false,databasePath,now:()=>now,randomInt:min=>min,adEnabled:true});
 const sessionDatabase=resolve(dir,'sessions.sqlite');const gateway=createH5Gateway({databasePath:sessionDatabase,upstream:pcUrl,allowedOrigins:['https://ma-h5-al.tapimg.com'],mobileService:service,assetDir:resolve('public'),assetPaths:[photo.thumbSrc],adAssistanceEnabled:true,rewardedAdUnitId:'test-only'});const base=await listen(gateway);
 const call=async(actor,path,body,extra={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://ma-h5-al.tapimg.com',...(actor?{'X-Jigsaw-H5-Session':actor.token}:{}),'Content-Type':'application/json',...(extra.token?{Authorization:'Bearer '+extra.token}:{})},body:body===undefined?undefined:JSON.stringify(body),...extra.fetch});return {status:r.status,data:await r.json()};};
 const session=async()=>{const s=await call(null,'/h5/session',{});assert.equal(s.status,201);return {token:s.data.token,identity:createHash('sha256').update(s.data.token).digest('hex')};};
 const request=(a,path,body,extra)=>call(a,'/h5'+path,body,extra);
 assert.ok(dir.startsWith(resolve('work')+'\\'));const fixture=new DatabaseSync(databasePath);
 const patchPlayer=(a,updates)=>{const p=JSON.parse(fixture.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(a.identity).data);Object.assign(p,updates);fixture.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),a.identity);};
 try{
  assert.equal((await call(null,'/healthz')).data.mode,'mobile-v3-isolated');const a=await session(),b=await session(),watcher=await session();
  assert.equal((await request(a,'/api/mobile/profile')).data.level,0);
  const sessions=new DatabaseSync(sessionDatabase);sessions.prepare('UPDATE h5_sessions SET expires_at=? WHERE token_hash=?').run(Date.now()+3600000,a.identity);await request(a,'/api/mobile/profile');assert.ok(sessions.prepare('SELECT expires_at FROM h5_sessions WHERE token_hash=?').get(a.identity).expires_at>Date.now()+29*86400000);sessions.close();
  assert.equal((await request(a,'/api/mobile/profile')).data.adEligible,true,'new accounts can request ads immediately');
  const firstAd={kind:'energy',requestId:rid()},firstChallenge=await request(a,'/api/mobile/supply/challenge',firstAd);assert.equal(firstChallenge.status,200);await request(a,'/api/mobile/supply/cancel',{...firstAd,rewardToken:firstChallenge.data.rewardToken});
  const firstReward={kind:'energy',requestId:rid()},firstRewardChallenge=(await request(watcher,'/api/mobile/supply/challenge',firstReward)).data;assert.equal((await request(watcher,'/api/mobile/supply/redeem',{...firstReward,rewardToken:firstRewardChallenge.rewardToken,completed:true})).data.supply.energy,1,'complete ad grants a new player a pack before their first room or first minute');
  const createInput={mode:'selected',imageId:photo.id,pieces:48,visibility:'private',requestId:rid()};
  const created=await Promise.all([request(a,'/api/rooms',createInput),request(a,'/api/rooms',createInput)]);assert.equal(created[0].status,201);assert.equal(created[0].data.room.id,created[1].data.room.id);
  const ticket=created[0].data,roomPath='/api/rooms/'+ticket.room.id;assert.equal(ticket.room.puzzle.cols*ticket.room.puzzle.rows,48);assert.equal(ticket.inviteCode.length,32);assert.equal(ticket.room.requestedPieces,48);assert.equal((await request(a,roomPath,undefined,{token:ticket.token})).data.inviteCode,ticket.inviteCode);
  assert.equal((await request(b,roomPath+'/join',{})).data.code,'INVITE_REQUIRED');
  assert.equal((await request(b,roomPath,undefined,{token:ticket.token})).data.code,'ROOM_IDENTITY_MISMATCH');
  const bt=(await request(b,roomPath+'/join',{inviteCode:ticket.inviteCode})).data;assert.ok(bt.token);assert.equal(bt.room.inviteCode,undefined);
  const wt=(await request(watcher,roomPath+'/join',{inviteCode:ticket.inviteCode})).data;assert.ok(wt.token);
  const aProfile=(await request(a,'/api/mobile/profile')).data;assert.equal(aProfile.ownedRooms.length,1);assert.equal(aProfile.starterSelectionAvailable,false);
  assert.equal((await request(b,roomPath,undefined,{token:bt.token,fetch:{method:'DELETE'}})).data.code,'OWNER_REQUIRED','only the owner can remove a room from their own created list');
  const publicInput={mode:'random',pieces:108,visibility:'public',requestId:rid()};assert.equal((await request(a,'/api/rooms',publicInput)).status,201);
  assert.equal((await request(a,'/api/rooms',{...publicInput,requestId:rid()})).status,201);
  for(let i=0;i<2;i++)assert.equal((await request(a,'/api/rooms',{...publicInput,requestId:rid()})).status,201);
  assert.equal((await request(a,'/api/rooms',{...publicInput,requestId:rid()})).data.code,'ROOM_LIMIT');
  const lobby=(await request(a,'/api/lobby?limit=1')).data;assert.equal(lobby.rooms.length,1);assert.ok(lobby.nextCursor);const second=(await request(a,'/api/lobby?limit=1&cursor='+lobby.nextCursor)).data;assert.equal(second.rooms.length,1);assert.notEqual(second.rooms[0].id,lobby.rooms[0].id);
  let current=ticket.room,successful=0;
  while(current.completedAt===null){
   const group=current.puzzle.groups.find(g=>!g.locked),actor=successful%2?a:b,memberTicket=actor===a?ticket:bt;
   const claimed=await request(actor,roomPath,{type:'claim',groupId:group.id,requestId:rid()},{token:memberTicket.token});assert.equal(claimed.status,200);
   const drop={type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()};
   const results=await Promise.all([request(actor,roomPath,drop,{token:memberTicket.token}),request(actor,roomPath,drop,{token:memberTicket.token})]);assert.equal(results[0].status,200);assert.equal(results[1].data.revision,results[0].data.revision);current=results[0].data;successful++;
  }
  assert.equal(placedCount(current.puzzle),48);
  const pa=(await request(a,'/api/mobile/profile')).data,pb=(await request(b,'/api/mobile/profile')).data,pw=(await request(watcher,'/api/mobile/profile')).data;
  assert.equal(pa.totalXp+pb.totalXp,successful);assert.equal(pw.totalXp,0);assert.equal(fixture.prepare('SELECT COUNT(*) n FROM mobile_settlements').get().n,2);assert.equal(fixture.prepare('SELECT SUM(energy) n FROM mobile_settlements').get().n,10);
  assert.equal(pa.newcomer,false);assert.equal(pa.adEligible,true);now+=61000;assert.equal((await request(a,'/api/mobile/profile')).data.adEligible,true);
  await request(a,roomPath,{type:'heartbeat'},{token:ticket.token});
  assert.equal((await request(a,roomPath,undefined,{token:ticket.token})).data.members.find(m=>m.id===ticket.playerId).level,pa.level);
  const cancelled={kind:'energy',requestId:rid()},cancelledChallenge=(await request(a,'/api/mobile/supply/challenge',cancelled)).data;const cancelledInput={...cancelled,rewardToken:cancelledChallenge.rewardToken};assert.equal((await request(a,'/api/mobile/supply/cancel',cancelledInput)).status,200);assert.equal((await request(a,'/api/mobile/supply/cancel',cancelledInput)).status,200);assert.equal((await request(a,'/api/mobile/supply/redeem',{...cancelledInput,completed:true})).data.code,'AD_EXPIRED');
  const dailyA=(await request(a,'/api/rooms',{mode:'daily',pieces:500,visibility:'public',requestId:rid()})).data;const dailyB=(await request(b,'/api/rooms',{mode:'daily',pieces:48,visibility:'public',requestId:rid()})).data;assert.equal(dailyA.room.id,dailyB.room.id);assert.equal((await request(a,'/api/lobby?pieces=108')).data.rooms.some(r=>r.id===dailyA.room.id),true);
  const starterB=await request(b,'/api/rooms',{mode:'selected',pieces:48,imageId:photo.id,visibility:'private',requestId:rid()});assert.equal(starterB.status,201);
  const refillInput={kind:'create',requestId:rid()},refillChallenge=(await request(b,'/api/mobile/supply/challenge',refillInput)).data;assert.equal((await request(b,'/api/mobile/supply/redeem',{...refillInput,rewardToken:refillChallenge.rewardToken,completed:true})).status,200);
  // 500-piece tables open at level 10 on TapTap.
  fixture.prepare("UPDATE mobile_profiles SET data=json_set(data,'$.level',10) WHERE id=?").run(b.identity);
  assert.equal((await request(b,'/api/rooms',{mode:'selected',imageId:'invalid',pieces:500,visibility:'public',requestId:rid()})).status,400);assert.equal((await request(b,'/api/mobile/profile')).data.supply.create,3,'one completed ad refills creation tickets after the first private room');
  const paidInput={mode:'selected',imageId:photo.id,pieces:500,visibility:'public',requestId:rid()},paid=await Promise.all([request(b,'/api/rooms',paidInput),request(b,'/api/rooms',paidInput)]);assert.equal(paid[0].status,201);assert.equal(paid[1].data.room.id,paid[0].data.room.id);assert.equal((await request(b,'/api/mobile/profile')).data.supply.create,2);
  const chatInput={text:'一起加油！',requestId:rid(),after:0};const chat=await request(a,roomPath+'/chat',chatInput,{token:ticket.token});assert.equal(chat.status,200);assert.equal((await request(a,roomPath+'/chat',chatInput,{token:ticket.token})).data.message.id,chat.data.message.id);assert.equal((await request(a,roomPath+'/chat',{text:'arbitrary text',requestId:rid()},{token:ticket.token})).data.code,'PRESET_CHAT_ONLY');
  const cursor=await request(a,roomPath+'/cursors',{clientId:rid(),seq:1,point:{x:100,y:100}},{token:ticket.token});assert.equal(cursor.status,200);assert.equal(cursor.data.cursors.find(c=>c.playerId===ticket.playerId).level,pa.level);
  const supplyReq={kind:'energy',requestId:rid()},challenge=(await request(a,'/api/mobile/supply/challenge',supplyReq)).data;
  assert.equal((await request(b,'/api/mobile/supply/redeem',{...supplyReq,rewardToken:challenge.rewardToken,completed:true})).status,403);
  assert.equal((await request(a,'/api/mobile/supply/redeem',{...supplyReq,rewardToken:challenge.rewardToken,completed:false})).status,403);
  const rewardInput={...supplyReq,rewardToken:challenge.rewardToken,completed:true};const redeemed=await Promise.all([request(a,'/api/mobile/supply/redeem',rewardInput),request(a,'/api/mobile/supply/redeem',rewardInput)]);assert.equal(redeemed[0].data.supply.energy,1);assert.equal((await request(a,'/api/mobile/profile')).data.supply.energy,1);
  for(let n=0;n<2;n++){const input={kind:'energy',requestId:rid()},c=(await request(a,'/api/mobile/supply/challenge',input)).data;assert.equal((await request(a,'/api/mobile/supply/redeem',{...input,rewardToken:c.rewardToken,completed:true})).status,200);}
  assert.equal((await request(a,'/api/mobile/supply/challenge',{kind:'energy',requestId:rid()})).data.code,'SUPPLY_FULL');assert.equal((await request(a,'/api/mobile/supply/challenge',{kind:'energy',requestId:rid(),context:'fake-other-context'})).data.code,'SUPPLY_FULL');
  patchPlayer(a,{energy:0,energyAt:now,level:50,xp:0,autoSupply:false});
  const play=await request(a,'/api/rooms/'+lobby.rooms[0].id+'/join',{}),game=play.data,actionPath='/api/rooms/'+game.room.id,group=game.room.puzzle.groups.find(g=>!g.locked);
  await request(a,actionPath,{type:'claim',groupId:group.id,requestId:rid()},{token:game.token});
  const beforeEnergy=(await request(a,'/api/mobile/profile')).data.totalXp;
  const denied=await request(a,actionPath,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},{token:game.token});assert.equal(denied.status,402);assert.equal(denied.data.code,'ENERGY_EMPTY');assert.equal((await request(a,'/api/mobile/profile')).data.totalXp,beforeEnergy);assert.equal(placedCount((await request(a,actionPath,undefined,{token:game.token})).data.puzzle),0);
  const use={kind:'energy',requestId:rid()};await Promise.all([request(a,'/api/mobile/supply/use',use),request(a,'/api/mobile/supply/use',use)]);assert.equal((await request(a,'/api/mobile/profile')).data.supply.energy,2);
  const landed=await request(a,actionPath,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},{token:game.token});assert.equal(landed.status,200);assert.equal((await request(a,'/api/mobile/profile')).data.totalXp,beforeEnergy+1);
  for(let n=0;n<2;n++){assert.equal((await request(a,actionPath+'/assistance',{kind:'underlay',requestId:rid()},{token:game.token})).status,200);now+=31000;}
  assert.equal((await request(a,actionPath+'/assistance',{kind:'underlay',requestId:rid()},{token:game.token})).data.code,'AD_REQUIRED');
  const toolReq={kind:'underlay',context:'room/'+game.room.id,requestId:rid()},tool=(await call(a,'/h5/rewarded/challenge',toolReq,{token:game.token})).data;assert.ok(tool.rewardToken);
  assert.equal((await request(a,actionPath+'/assistance',{kind:'underlay',requestId:toolReq.requestId,rewardToken:tool.rewardToken,completed:true},{token:game.token})).status,200);
  const noasset=await fetch(base+'/h5/assets/missing.webp',{headers:{Origin:'https://ma-h5-al.tapimg.com'}});assert.equal(noasset.status,404);
  const asset=await fetch(base+'/h5/assets/'+photo.thumbSrc.slice(1),{headers:{Origin:'https://ma-h5-al.tapimg.com'}});assert.equal(asset.status,200);await asset.arrayBuffer();assert.equal(pcCalls,0);
 }finally{fixture.close();await close(gateway);await close(upstream);rmSync(dir,{recursive:true,force:true});}
});

void test('two service instances share atomic last-energy decisions and durable create receipts',()=>{
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-concurrent-test-')),databasePath=resolve(dir,'mobile.sqlite');const now=1800000000000;
 const a=createMobileService({shareRewards:false,databasePath,now:()=>now,adEnabled:true}),b=createMobileService({shareRewards:false,databasePath,now:()=>now,adEnabled:true}),owner='d'.repeat(64),fixture=new DatabaseSync(databasePath);assert.ok(dir.startsWith(resolve('work')+'\\'));
 const call=(service,url,body,token)=>service.handle({identity:owner,method:body===undefined?'GET':'POST',url,body,authorization:token?'Bearer '+token:undefined});
 try{
  call(a,'/api/mobile/profile');const profile=JSON.parse(fixture.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);Object.assign(profile,{level:50,xp:100,totalXp:10817,energy:1,energyAt:now,firstRoomCompleted:true,createdAt:now-70000,starterSelectionAvailable:false,supply:{energy:0,create:0}});fixture.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),owner);
  const input={mode:'random',pieces:48,visibility:'public',requestId:rid()},one=call(a,'/api/rooms',input).data,two=call(b,'/api/rooms',{...input,requestId:rid()}).data;
  assert.equal(call(b,'/api/rooms',input).data.room.id,one.room.id);assert.equal(call(a,'/api/mobile/profile').data.ownedRooms.length,2);
  const first=one.room.puzzle.groups[0].id,second=two.room.puzzle.groups[0].id;
  call(a,'/api/rooms/'+one.room.id,{type:'claim',groupId:first,requestId:rid()},one.token);call(b,'/api/rooms/'+two.room.id,{type:'claim',groupId:second,requestId:rid()},two.token);
  const action={type:'drop',groupId:first,dx:0,dy:0,seq:1,requestId:rid()};assert.equal(call(a,'/api/rooms/'+one.room.id,action,one.token).status,200);
  assert.equal(call(b,'/api/rooms/'+two.room.id,{...action,groupId:second,requestId:rid()},two.token).data.code,'ENERGY_EMPTY');
  assert.equal(call(b,'/api/mobile/profile').data.energy,0);assert.equal(call(a,'/api/mobile/profile').data.totalXp,10818);
  assert.equal(placedCount(call(b,'/api/rooms/'+two.room.id,undefined,two.token).data.puzzle),0);
  const requests=Array.from({length:3},()=>({kind:'create',requestId:rid()}));for(const r of requests)assert.equal(call(a,'/api/mobile/supply/challenge',r).status,200);assert.equal(call(b,'/api/mobile/supply/challenge',{kind:'create',requestId:rid()}).data.code,'SUPPLY_FULL');
  assert.equal(call(b,'/api/mobile/supply/challenge',requests[0]).status,200);
  const droppedAgain=call(b,'/api/rooms/'+one.room.id,action,one.token);assert.equal(droppedAgain.status,200);assert.equal(call(b,'/api/mobile/profile').data.totalXp,10818);
 }finally{fixture.close();a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

void test('every published mobile grid stays between 48 and 500 actual pieces',()=>{
 for(const picture of PHOTOS)for(const count of [48,108,300,500]){
  const grid=mobileGridForPhoto(picture,count);assert.ok(grid,`${picture.id} ${count}`);assert.ok(grid.count>=48&&grid.count<=500,`${picture.id} ${count}: ${grid.count}`);assert.equal(grid.cols*grid.rows,grid.count);assert.ok(Math.abs(grid.count-count)<=count*.15);assert.ok(grid.pixels>=(count<=108?20:30));
 }
 assert.equal(mobileGridForPhoto(photo,1000),null);
});
