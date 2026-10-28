import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {createMobileTasks,BEGINNER_TASKS} from '../server/mobile-tasks.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {defaultGameSettings} from '../server/game-settings.mjs';
import {defaultTaskRewardSettings} from '../server/task-reward-settings.mjs';
import {GALLERY_VISIBLE_PHOTOS} from '../outputs/mobile/engine.mjs';
import {GameClient} from '../mobile/client.ts';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),now=1800000000000;
function configuration(){
 const settings=defaultGameSettings(),rewards=defaultTaskRewardSettings();
 settings.energy.initial=0;settings.energy.firstRoomFree=false;settings.energy.naturalRecoveryMinutes=0;
 settings.collection.contributionCoins=7;rewards.invitationShare.coins=13;rewards.tenGrid.coins=11;
 const albums={schema:'jigsaw-albums/v1',albums:GALLERY_VISIBLE_PHOTOS.slice(0,2).map((photo,index)=>({id:index?'mobile-only':'pc-only',title:'测试相册',description:'',imageIds:[photo.id],coverImageId:photo.id,showOnPc:!index,showOnMobile:!!index,purchasable:false,price:0,decorationId:null,milestones:[]}))};
 return {settings,rewards,options:{now:()=>now,randomInt:min=>min,gameSettings:{read:()=>settings},taskRewardSettings:{read:()=>rewards},albumContent:{read:()=>albums}}};
}
const request=(service,url,body,token)=>service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
const expectedCapabilities=web=>({energy:!web,ads:false,shareRewards:!web,tapMultiplayer:false,soloLocalPlay:!web,offlineLevelClears:!web,albumTarget:web?'pc':'mobile-shared',createTickets:!web,customNames:web,cheers:true,privacyRequests:true,roomActionRevisionBody:!web,social:{friends:true,privateMessages:web,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9'}});

test('trusted Web profile completes a real zero-energy room, keeps shared rewards and idempotency, and selects PC albums',()=>{
 const config=configuration(),service=createMobileService({...config.options,runtimeProfile:'web',adEnabled:true});
 try{
  const initial=request(service,'/api/mobile/profile').data;
  assert.deepEqual(initial.capabilities,expectedCapabilities(true));assert.equal(initial.energy,0);
  assert.deepEqual(request(service,'/api/mobile/collection').data.albums.map(album=>album.id),['pc-only']);
  assert.equal(request(service,'/api/mobile/supply/challenge',{kind:'create',requestId:rid()}).data.code,'ADS_UNAVAILABLE');
  const made=request(service,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(made.status,201);
  const ticket=made.data,path='/api/rooms/'+ticket.room.id;let room=ticket.room,count=0;
  while(room.completedAt===null){
   const group=room.puzzle.groups.find(group=>!group.locked);assert.ok(group);
   assert.equal(request(service,path,{type:'claim',groupId:group.id,requestId:rid()},ticket.token).status,200);
   const input={type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},result=request(service,path,input,ticket.token);
   assert.equal(result.status,200);assert.equal(result.data.profile.energy,0);assert.equal(result.data.mobileContribution.creditedCoins,7+(BEGINNER_TASKS.find(task=>task.target===count+1)?.coins??0));
   assert.deepEqual(request(service,path,input,ticket.token),JSON.parse(JSON.stringify(result)),'replayed snap cannot pay twice');
   room=result.data;count++;
  }
  const end=request(service,'/api/mobile/profile').data;
  assert.equal(end.totalXp,count*config.settings.energy.contributionXp);assert.ok(end.collection.coins>=count*7);assert.equal(end.energy,0);
  assert.equal(room.mobileResult.energy,0);assert.ok(end.level>0,'level refills do not create Web energy');
  const share={requestId:rid()},first=request(service,'/api/mobile/invitations/share',share);
  assert.equal(first.data.shared.coins,13);assert.equal(first.data.shared.energy,0);assert.deepEqual(request(service,'/api/mobile/invitations/share',share),first);
  const gift=request(service,'/api/mobile/tasks').data.inventory.find(gift=>gift.kind.startsWith('ten-'));
  const opened=request(service,'/api/mobile/gifts/open',{kind:gift.kind,quantity:1,requestId:rid()});assert.equal(opened.status,200);assert.equal(opened.data.opened.coins,11);assert.equal(opened.data.opened.energy,0);
 }finally{service.close();}
});

test('Web selected public and private rooms require no tickets and preserve creation inventory',()=>{
 const config=configuration(),service=createMobileService({...config.options,runtimeProfile:'web'});
 try{
  const initial=request(service,'/api/mobile/profile').data,photo=GALLERY_VISIBLE_PHOTOS[0];assert.equal(initial.supply.create,0);
  for(const visibility of ['public','private']){
   const input={mode:'selected',imageId:photo.id,pieces:48,visibility,requestId:rid()};
   const made=request(service,'/api/rooms',input);assert.equal(made.status,201,made.data.error);assert.equal(made.data.room.visibility,visibility);
   assert.deepEqual(request(service,'/api/rooms',input),JSON.parse(JSON.stringify(made)),'replaying create must return its existing room');
  }
  const after=request(service,'/api/mobile/profile').data;assert.equal(after.supply.create,initial.supply.create);assert.equal(after.firstSelectionAvailable,initial.firstSelectionAvailable);
 }finally{service.close();}
});

test('mobile selected rooms spend three newcomer tickets once each, then require a reward',()=>{
 const config=configuration(),service=createMobileService(config.options);
 try{
  const photo=GALLERY_VISIBLE_PHOTOS[1],input={mode:'selected',imageId:photo.id,pieces:48,visibility:'public',runtimeProfile:'web',capabilities:{createTickets:false}};
  const initial=request(service,'/api/mobile/profile').data;
  assert.equal(initial.supply.create,3,'a first-time mobile player owns three creation tickets');
  assert.equal(initial.firstSelectionAvailable,false,'the ticket replaces the free-selection allowance');
  for(let remaining=2;remaining>=0;remaining--){
   const create={...input,requestId:rid()},result=request(service,'/api/rooms',create);assert.equal(result.status,201);
   assert.equal(request(service,'/api/rooms',create).data.room.id,result.data.room.id,'replay keeps the original room');
   assert.equal(request(service,'/api/mobile/profile').data.supply.create,remaining,'each room spends one ticket, including replay');
   assert.equal(service.handle({identity:owner,url:'/api/rooms/'+result.data.room.id,method:'DELETE'}).status,200,'remove the entry so room limits do not hide ticket checks');
  }
  const denied=request(service,'/api/rooms',{...input,requestId:rid()});assert.equal(denied.status,402);assert.equal(denied.data.code,'CREATE_TICKET_REQUIRED');
 }finally{service.close();}
});

test('ordinary mobile profile still blocks zero-energy snaps and ignores client-supplied Web flags',()=>{
 const config=configuration(),service=createMobileService(config.options);
 try{
  assert.deepEqual(service.capabilities,expectedCapabilities(false));
  assert.deepEqual(request(service,'/api/mobile/collection').data.albums.map(album=>album.id),['mobile-only']);
  const ticket=request(service,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid(),runtimeProfile:'web',capabilities:{energy:false}}).data;
  const group=ticket.room.puzzle.groups.find(group=>!group.locked),path='/api/rooms/'+ticket.room.id;
  request(service,path,{type:'claim',groupId:group.id,requestId:rid()},ticket.token);
  const denied=request(service,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid(),runtimeProfile:'web',capabilities:{energy:false}},ticket.token);
  assert.equal(denied.status,402);assert.equal(denied.data.code,'ENERGY_EMPTY');assert.equal(request(service,'/api/mobile/profile').data.totalXp,0);
 }finally{service.close();}
});

test('Web can collect the coin and XP portion of a legacy refill gift even with full stored energy',()=>{
 const db=new DatabaseSync(':memory:'),settings=defaultGameSettings(),profile={id:owner,level:0,xp:0,totalXp:0,energy:settings.energy.baseCap};let coins=0;
 const tasks=createMobileTasks({db,readProfile:()=>profile,saveProfile:()=>{},energyEnabled:false,awardCoins:(_owner,_source,value)=>{coins+=value;return value;}});
 try{
  const gift=rid();db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(gift,owner,'invite-refill',0,2,'legacy:'+gift,now);
  db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(gift,JSON.stringify({title:'邀请礼包',effect:'full-energy',energyMin:0,energyMax:0,xp:2,coins:17}));
  const opened=tasks.open(profile,{kind:'invite-refill',quantity:1,requestId:rid()},now);
  assert.equal(opened.coins,17);assert.equal(coins,17);assert.equal(opened.energy,0);assert.equal(profile.energy,settings.energy.baseCap);assert.equal(profile.totalXp,2);
  assert.throws(()=>tasks.open(profile,{kind:'invite-refill',quantity:1,requestId:rid()},now),{code:'GIFT_EMPTY'});
 }finally{db.close();}
});

test('gateway and browser client agree on explicit capabilities and never enable browser ads',async()=>{
 const service=createMobileService({runtimeProfile:'web',adEnabled:true});
 const server=createH5Gateway({upstream:'http://127.0.0.1',allowedOrigins:['http://127.0.0.1'],mobileService:service,adAssistanceEnabled:true,rewardedAdUnitId:'mobile-only'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=await(await fetch('http://127.0.0.1:'+server.address().port+'/h5/config')).json();
  assert.deepEqual(config.capabilities,expectedCapabilities(true));assert.equal(config.adRewardEnabled,false);assert.equal(config.rewardedAdUnitId,'');
  const store=new Map(),profile=request(service,'/api/mobile/profile').data;
  const client=new GameClient({config:{id:'web',apiBase:'http://127.0.0.1/h5',assetBase:'http://127.0.0.1/h5/assets',rewardedAdUnitId:'ignored'},storage:{get:key=>store.get(key),set:(key,value)=>store.set(key,value)},request:async input=>({status:200,headers:{},data:input.url.endsWith('/config')?config:input.url.endsWith('/session')?{token:'f'.repeat(64)}:profile})});
  await client.start();assert.deepEqual(client.config.capabilities,config.capabilities);assert.equal(client.config.adRewardEnabled,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
