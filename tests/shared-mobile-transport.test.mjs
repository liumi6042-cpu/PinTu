import test from 'node:test';
import assert from 'node:assert/strict';
import {GameClient} from '../mobile/client.ts';
import {createWechatPlatform} from '../mobile/platform-wechat.ts';

const token='a'.repeat(64),roomId='b'.repeat(32),roomToken='c'.repeat(32);
const profile={name:'拼友',level:1,xp:0,totalXp:0,xpToNext:5,energy:50,energyCap:51,giftProgress:0,supply:{energy:0,create:0},autoSupply:false,adEligible:false,ownedRooms:[],serverTime:10};
function platform(request,id='wechat'){
 const memory=new Map();return {config:{id,gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets'},request,storage:{get:key=>memory.get(key)||null,set:(key,value)=>memory.set(key,value),remove:key=>memory.delete(key)},randomId:()=> 'd'.repeat(32)};
}
const ok=data=>({status:200,data,headers:{}});

test('a separate image CDN changes public puzzle URLs without moving private or other origin resources',()=>{
 const port=platform(()=>assert.fail('asset mapping does not make API requests'));port.config.assetBase='https://images.example/catalog/';
 const client=new GameClient(port);
 assert.equal(client.asset('/puzzles/cloud-optimized-0123456789ab.webp'),'https://images.example/catalog/puzzles/cloud-optimized-0123456789ab.webp');
 assert.equal(client.asset('puzzles/cloud-thumbnail-0123456789ab.webp'),'https://images.example/catalog/puzzles/cloud-thumbnail-0123456789ab.webp');
 assert.equal(client.asset('/api/user-images/custom-123?room=456'),'https://game.test/h5/api/user-images/custom-123?room=456');
 assert.equal(client.asset('/mobile-icons/example.png'),'https://game.test/h5/assets/mobile-icons/example.png');
 assert.equal(client.asset('https://game.test/h5/private-image?ticket=example'),'https://game.test/h5/private-image?ticket=example');
 assert.equal(client.asset(''),'');assert.throws(()=>client.asset('//other.test/photo.webp'),/素材地址无效/);
});

test('shared client keeps one device guest session and masks TapTap ad configuration on WeChat',async()=>{
 let sessions=0,updates=0;const requested=[];
 const port=platform(async input=>{requested.push(input);if(input.url.endsWith('/config'))return ok({mobileMode:'mobile-v3-isolated',adRewardEnabled:true,rewardedAdUnitId:'tap-placement'});if(input.url.endsWith('/session')){sessions++;return ok({token});}assert.equal(input.headers['X-Jigsaw-H5-Session'],token);return ok(profile);});
 const client=new GameClient(port);client.onChange=()=>updates++;
 await Promise.all([client.start(),client.start()]);await client.refresh();
 assert.equal(sessions,1);assert.equal(updates,2);assert.equal(client.config.adRewardEnabled,false);assert.equal(client.config.rewardedAdUnitId,'');assert.equal(client.config.identityMode,'guest-device');assert.equal(client.config.wechatLoginConfigured,false);
 const another=new GameClient(port);await another.refresh();assert.equal(sessions,1);assert.equal(another.profile.name,'拼友');
 assert.equal(client.asset('/puzzles/a.webp'),'https://game.test/h5/assets/puzzles/a.webp');
 assert.ok(requested.every(input=>!('Cookie'in(input.headers||{}))));
});

test('TapTap identity is bound before startup and profile reads',async()=>{
 let binds=0,profileReads=0;const port=platform(async input=>{
  if(input.url.endsWith('/config'))return ok({mobileMode:'mobile-v3-isolated',adRewardEnabled:false,capabilities:{energy:true}});
  if(input.url.endsWith('/session'))return ok({token});
  if(input.url.endsWith('/api/taptap/bind')){binds++;assert.deepEqual(input.body,{code:'one-time-code',nickname:'Tap玩家'});return ok({...profile,name:'Tap玩家',serverTime:11,taptap:{bound:true,provider:'taptap'}});}
  if(input.url.endsWith('/api/mobile/profile'))profileReads++;
  return ok(profile);
 },'taptap');
 port.tapTapIdentity=async()=>({code:'one-time-code',nickname:'Tap玩家'});
 const client=new GameClient(port);await client.start();
 assert.equal(binds,1);assert.equal(client.profile?.name,'Tap玩家');
 assert.equal(profileReads,0);
});

test('TapTap startup refuses to create a guest when platform identity is missing',async()=>{
 const requests=[];const port=platform(async input=>{requests.push(input.url);return ok({mobileMode:'mobile-v3-isolated'});},'taptap');
 port.tapTapIdentity=async()=>null;
 const client=new GameClient(port);
 await assert.rejects(client.start(),error=>error?.code==='TAPTAP_IDENTITY_REQUIRED'&&/未获取到TapTap账号信息/.test(error.message));
 assert.deepEqual(requests,['https://game.test/h5/config']);
});

test('TapTap startup refuses a login without public nickname',async()=>{
 const port=platform(async input=>{if(input.url.endsWith('/config'))return ok({mobileMode:'mobile-v3-isolated'});throw new Error('unexpected request');},'taptap');
 port.tapTapIdentity=async()=>({code:'one-time-code'});
 const client=new GameClient(port);
 await assert.rejects(client.start(),error=>error?.code==='TAPTAP_NICKNAME_REQUIRED'&&/未返回公开昵称/.test(error.message));
});

test('profile applies before actionable errors; stale profile cannot undo energy',async()=>{
 const port=platform(async input=>input.url.endsWith('/session')?ok({token}):{status:402,data:{error:'体力不足',code:'ENERGY_EMPTY',profile:{...profile,energy:0,serverTime:20}},headers:{}});
 const client=new GameClient(port);let updates=0;client.onChange=()=>updates++;
 await assert.rejects(client.post('/api/rooms/'+roomId,{type:'drop'}),{status:402,code:'ENERGY_EMPTY'});assert.equal(client.profile.energy,0);assert.equal(updates,1);
 port.request=async()=>ok({...profile,serverTime:10});await client.refresh();assert.equal(client.profile.energy,0);assert.equal(updates,1);
});

test('expired session is invalidated without replaying a write',async()=>{
 let writes=0;const port=platform(async input=>{if(input.url.endsWith('/session'))return ok({token});writes++;return {status:401,data:{error:'已过期'},headers:{'X-Jigsaw-H5-Session-Expired':'1'}};});
 const client=new GameClient(port);await assert.rejects(client.post('/api/mobile/supply/redeem',{requestId:'d'.repeat(32)}),{status:401,code:'IDENTITY_REQUIRED'});assert.equal(writes,1);assert.equal(port.storage.get('jigsaw:h5-session:https://game.test/h5'),null);
});

test('fetchLike retains admission and session headers and exposes Retry-After without browser Response',async()=>{
 const inputs=[];const port=platform(async input=>{inputs.push(input);return input.url.endsWith('/session')?ok({token}):{status:429,data:{error:'请稍候'},headers:{'retry-after':'6'}};});
 const client=new GameClient(port);const result=await client.fetchLike('/api/rooms/'+roomId+'?since=1',{method:'POST',headers:{Authorization:'Bearer '+roomToken},body:'{"type":"heartbeat"}',timeout:4200});
 assert.equal(result.status,429);assert.equal(result.ok,false);assert.equal(result.headers.get('Retry-After'),'6');assert.equal((await result.json()).error,'请稍候');
 assert.equal(inputs.at(-1).timeout,4200);assert.equal(inputs.at(-1).headers.Authorization,'Bearer '+roomToken);assert.equal(inputs.at(-1).headers['X-Jigsaw-H5-Session'],token);
 assert.equal(inputs.at(-1).headers['X-Jigsaw-Artwork-Snapshot'],'1');
 await assert.rejects(client.fetchLike('https://attacker.test/api/rooms'),/请求地址无效/);
});

test('join resumes stored admission; transient network failure never silently creates a new member',async()=>{
 let joins=0;const room={id:roomId,visibility:'public',puzzle:{groups:[]}};
 const port=platform(async input=>{if(input.url.endsWith('/session'))return ok({token});if(input.url.endsWith('/join')){joins++;return ok({token:roomToken,playerId:'p1',room});}return ok(room);});
 const client=new GameClient(port);await client.joinRoom(roomId);await client.joinRoom(roomId);assert.equal(joins,1);assert.equal(client.ticket.playerId,'p1');
 port.request=async()=>{throw Error('网络断开');};await assert.rejects(client.joinRoom(roomId),/网络断开/);assert.equal(joins,1);
});

test('WeChat uses genuine request, storage, capsule safety, touch events and share dispatch',async()=>{
 const old=globalThis.wx,events=new Map(),memory=new Map(),requests=[],shares=[];let adCalls=0;
 globalThis.wx={createCanvas:()=>({getContext(){}}),createImage:()=>({}),getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:3,safeArea:{top:24,bottom:810}}),getMenuButtonBoundingClientRect:()=>({bottom:58}),getLaunchOptionsSync:()=>({query:{room:roomId}}),
  request(input){requests.push(input);queueMicrotask(()=>input.success({statusCode:200,data:'{"ok":true}',header:{'X-Test':'1'}}));return {abort(){}};},
  getStorageSync:key=>memory.get(key),setStorageSync:(key,value)=>memory.set(key,value),removeStorageSync:key=>memory.delete(key),shareAppMessage:input=>shares.push(input),createRewardedVideoAd(){adCalls++;},
 };
 for(const name of ['Start','Move','End','Cancel']){globalThis.wx['onTouch'+name]=fn=>events.set(name,fn);globalThis.wx['offTouch'+name]=fn=>{if(events.get(name)===fn)events.delete(name);};}
 try{const port=createWechatPlatform({id:'wechat',gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets'});
  assert.deepEqual(port.viewport(),{width:390,height:844,dpr:3,top:62,bottom:34});assert.equal(port.initialQuery.room,roomId);
  const result=await port.request({url:'https://game.test/h5/api/mobile/profile',method:'PATCH',headers:{Cookie:'never-send',Authorization:'Bearer '+roomToken},body:{name:'拼友'}});
  assert.deepEqual(result,{status:200,data:{ok:true},headers:{'x-test':'1'}});assert.equal(requests[0].method,'PATCH');assert.equal(requests[0].header.Cookie,undefined);assert.equal(requests[0].header.Authorization,'Bearer '+roomToken);assert.equal(requests[0].data,'{"name":"拼友"}');
  assert.equal(await port.share({title:'一起拼图',roomId,inviteCode:'ff'}),'opened');assert.match(shares[0].query,/room=/);assert.match(shares[0].query,/ref=ff/);
  assert.equal(await port.watchAd('tap-placement'),'unavailable');assert.equal(adCalls,0);
  const touches=[];const off=port.onInput(input=>touches.push(input));events.get('Start')({touches:[{identifier:3,clientX:21,clientY:34}],changedTouches:[{identifier:3,clientX:21,clientY:34}]});assert.deepEqual(touches[0],{type:'down',points:[{id:3,x:21,y:34}],changed:[{id:3,x:21,y:34}]});off();assert.equal(events.size,0);
  port.storage.set('guest','opaque');assert.equal(port.storage.get('guest'),'opaque');port.storage.remove('guest');assert.equal(port.storage.get('guest'),null);assert.match(port.randomId(),/^[a-f0-9]{32}$/);
 }finally{if(old===undefined)delete globalThis.wx;else globalThis.wx=old;}
});

test('WeChat network timeout aborts native request and rejects, without fake response',async()=>{
 const old=globalThis.wx;let aborted=0;
 globalThis.wx={createCanvas:()=>({}),request:()=>({abort(){aborted++;}})};
 try{const port=createWechatPlatform({id:'wechat',gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets'});await assert.rejects(port.request({url:'https://game.test/h5/config',timeout:1}),/连接超时/);assert.equal(aborted,1);}
 finally{if(old===undefined)delete globalThis.wx;else globalThis.wx=old;}
});

test('WeChat private message keyboard preserves multiline text and cancels cleanly without a public short-text limit',async()=>{
 const old=globalThis.wx,events=new Map();let shown,hidden=0;
 globalThis.wx={createCanvas:()=>({}),request(){},showKeyboard:options=>{shown=options;},hideKeyboard:()=>hidden++};
 for(const name of ['KeyboardConfirm','KeyboardComplete','KeyboardInput','Hide']){
  globalThis.wx['on'+name]=handler=>events.set(name,handler);
  globalThis.wx['off'+name]=handler=>{if(events.get(name)===handler)events.delete(name);};
 }
 try{
  const port=createWechatPlatform({id:'wechat',gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets'});
  const draft='第一行消息\n第二行继续聊，超过二十字仍保留。',pending=port.prompt('发送私聊','',{multiline:true,maxLength:2000});
  assert.equal(shown.multiple,true);assert.equal(shown.maxLength,2000);
  events.get('KeyboardConfirm')({value:draft});assert.equal(await pending,draft);assert.equal(events.size,0);
  const cancelled=port.prompt('发送私聊','草稿',{multiline:true});events.get('KeyboardComplete')({value:'不发送'});assert.equal(await cancelled,null);
  const left=port.prompt('发送私聊','',{multiline:true});events.get('Hide')();assert.equal(await left,null);assert.equal(events.size,0);assert.equal(hidden,3);
 }finally{if(old===undefined)delete globalThis.wx;else globalThis.wx=old;}
});

test('WeChat rewards require its own placement and explicit ended=true; missing completion is closed',async()=>{
 const old=globalThis.wx,unit='adunit-123abc';let close,loaded=0,shown=0;
 globalThis.wx={createCanvas:()=>({}),request(){},createRewardedVideoAd:()=>({load:async()=>{loaded++;},show:async()=>{shown++;},onClose:fn=>close=fn,offClose(){},onError(){},offError(){}})};
 try{const port=createWechatPlatform({id:'wechat',gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets',rewardedAdUnitId:unit});
  assert.equal(await port.watchAd('another-placement'),'unavailable');
  const first=port.watchAd(unit);await new Promise(resolve=>setImmediate(resolve));assert.equal(loaded,1);assert.equal(shown,1);close({});assert.equal(await first,'closed');
  const second=port.watchAd(unit);await new Promise(resolve=>setImmediate(resolve));close({isEnded:true});assert.equal(await second,'completed');
 }finally{if(old===undefined)delete globalThis.wx;else globalThis.wx=old;}
});

test('TapTap public config overlaps login but session and binding wait for verified identity',async()=>{
 let finishIdentity,finishConfig;const calls=[];
 const port=platform(input=>{calls.push(input.url);if(input.url.endsWith('/config'))return new Promise(resolve=>finishConfig=()=>resolve(ok({mobileMode:'mobile-v3-isolated'})));if(input.url.endsWith('/session'))return Promise.resolve(ok({token}));assert.ok(input.url.endsWith('/api/taptap/bind'));return Promise.resolve(ok(profile));},'taptap');
 port.tapTapIdentity=()=>new Promise(resolve=>finishIdentity=resolve);const client=new GameClient(port),pending=client.start();await Promise.resolve();assert.deepEqual(calls,['https://game.test/h5/config']);finishConfig();await Promise.resolve();assert.equal(calls.length,1);finishIdentity({code:'one-time-code',nickname:'Tap玩家'});await pending;assert.equal(calls.length,3);assert.ok(calls[1].endsWith('/session'));assert.ok(calls[2].endsWith('/api/taptap/bind'));
});
test('public config transport failing before native injection retries only after identity is ready',async()=>{
 let finishIdentity,configs=0;const calls=[];const port=platform(async input=>{calls.push(input.url);if(input.url.endsWith('/config')){if(++configs===1)throw Error('early bridge unavailable');return ok({mobileMode:'mobile-v3-isolated'});}if(input.url.endsWith('/session'))return ok({token});assert.ok(input.url.endsWith('/api/taptap/bind'));return ok(profile);},'taptap');
 port.tapTapIdentity=()=>new Promise(resolve=>finishIdentity=resolve);const client=new GameClient(port),pending=client.start();await Promise.resolve();assert.equal(configs,1);finishIdentity({code:'one-time-code',nickname:'Tap玩家'});await pending;assert.equal(configs,2);assert.equal(calls.filter(u=>u.endsWith('/session')).length,1);
});
