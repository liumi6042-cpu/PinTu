import test from 'node:test';
import assert from 'node:assert/strict';
import {GameClient} from '../mobile/client.ts';
import {createWebPlatform,webGuestSecret} from '../mobile/platform-web.ts';
import {build} from 'esbuild';
const socialBundle=await build({stdin:{contents:'export {SocialPanel} from "./mobile/social-panel";export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {SocialPanel,GameApp}=await import('data:text/javascript;base64,'+Buffer.from(socialBundle.outputFiles[0].text+'\n//# sourceURL=shared-web-cookie-test-bundle.mjs').toString('base64'));

const roomId='a'.repeat(32),roomToken='b'.repeat(32),secret='c'.repeat(64);
const profile={name:'原玩家',level:6,xp:3,totalXp:25,xpToNext:10,energy:0,energyCap:0,giftProgress:4,supply:{energy:0,create:0},autoSupply:false,adEligible:false,ownedRooms:[],serverTime:10,collection:{coins:123,fragments:17,ownedPackIds:['old-pack'],ownedImageIds:['old-image'],equipped:null},account:{id:'old-account',username:'original',name:'原玩家'}};
const config={mobileMode:'web-managed-shared',identityMode:'web-cookie',capabilities:{energy:false,ads:false,albumTarget:'pc',supportedPieces:[108,300,500],social:{friends:true,privateMessages:false,reports:false,codeFormat:'hex12'}}};
const ok=data=>({status:200,data,headers:{}});

test('account-authorized Web diagnostic creation registers its original Cookie room ticket',async()=>{
 const room={id:roomId,diagnostic:true,puzzle:{cols:3,rows:3,groups:[]}},ticket={room,token:roomToken,playerId:'diagnostic-player'};
 const f=clientFixture(input=>ok(input.url.endsWith('/config')?config:input.url.endsWith('/profile')?{...profile,diagnostics:true}:ticket));
 await f.client.start();const made=await f.client.createDiagnosticRoom();assert.equal(made.room.id,roomId);assert.equal(f.client.ticket.token,roomToken);
 assert.equal(f.calls.at(-1).url,'https://game.test/api/shared/api/mobile/diagnostics/room');assert.ok(!('X-Jigsaw-H5-Session' in f.calls.at(-1).headers));
 f.client.profile.diagnostics=false;await assert.rejects(f.client.createDiagnosticRoom(),/指定账号/);
});
function clientFixture(request){const storage=new Map(),sessions=new Map(),calls=[];let restored=0;const port={config:{id:'web',apiBase:'https://game.test/api/shared',assetBase:'https://game.test',identityMode:'web-cookie'},storage:{get:key=>storage.get(key)||null,set:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key),getSession:key=>sessions.get(key)||null,setSession:(key,value)=>sessions.set(key,value)},restoreWebIdentity:async()=>{restored++;},randomId:()=> 'd'.repeat(32),request:async input=>{calls.push(input);return request?request(input):ok(input.url.endsWith('/config')?config:profile);}};return{client:new GameClient(port),storage,sessions,calls,port,restored:()=>restored};}

test('formal Web keeps the existing wallet and cookie identity without creating an H5 session',async()=>{
 const f=clientFixture();f.storage.set('jigsaw:h5-session:'+f.port.config.apiBase,secret);await f.client.start();
 assert.equal(f.restored(),1);assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>!call.url.endsWith('/session')&&!('X-Jigsaw-H5-Session'in(call.headers||{}))));
 assert.equal(f.client.profile.collection.coins,123);assert.deepEqual(f.client.profile.collection.ownedPackIds,['old-pack']);assert.equal(f.client.account.id,'old-account');assert.equal(f.client.config.identityMode,'web-cookie');assert.equal(f.client.config.capabilities.energy,false);assert.deepEqual(f.client.config.capabilities.supportedPieces,[108,300,500]);
 assert.equal(f.client.asset('/api/user-images/custom-original?room='+roomId),'https://game.test/api/user-images/custom-original?room='+roomId);assert.equal(f.client.asset('/puzzles/original.webp'),'https://game.test/puzzles/original.webp');
});

test('a verified same-account Web admission resumes from the original key and is preserved for the compatibility client',async()=>{
 const room={id:roomId,puzzle:{groups:[]}};const f=clientFixture(input=>ok(input.url.endsWith('/config')?config:input.url.endsWith('/profile')?profile:room));await f.client.start();
 f.sessions.set('together-puzzle:room:'+roomId,JSON.stringify({token:roomToken,playerId:'old-player',ownerIdentity:'account:old-account'}));const ticket=await f.client.joinRoom(roomId);
 assert.equal(ticket.playerId,'old-player');assert.ok(!f.calls.some(call=>call.url.endsWith('/join')));assert.equal(f.calls.at(-1).headers.Authorization,'Bearer '+roomToken);
 assert.equal(JSON.parse(f.storage.get('together-puzzle:room:'+roomId+':account')).token,roomToken);
});

test('guest-to-account and account switches rejoin as the current identity instead of reusing cached guest tickets',async()=>{
 const room={id:roomId,puzzle:{groups:[]}},guestProfile={...profile,account:null,code:'guest-code',serverTime:10},accountProfile={...profile,code:'account-code',serverTime:11},otherProfile={...profile,account:{...profile.account,id:'other-account'},code:'other-code',serverTime:12};let current=guestProfile,joins=0;
 const responseTicket=()=>({room,token:(current.account?current.account.id==='old-account'?'e':'f':'d').repeat(32),playerId:current.account?.id||'guest-player'});
 const f=clientFixture(input=>{if(input.url.endsWith('/config'))return ok(config);if(input.url.endsWith('/profile'))return ok(current);if(input.url.endsWith('/join')){joins++;return ok(responseTicket());}if(input.url.endsWith('/api/rooms'))return ok(responseTicket());return ok(room);});
 await f.client.start();await f.client.createRoom({mode:'selected',imageId:'old-image',pieces:108});const key='jigsaw:shared-room:'+f.port.config.apiBase+':'+roomId,legacy='together-puzzle:room:'+roomId;
 assert.equal(JSON.parse(f.storage.get(key)).ownerIdentity,'guest:guest-code');await f.client.joinRoom(roomId);assert.equal(joins,0,'same guest retains valid room admission');
 current=accountProfile;await f.client.joinRoom(roomId);assert.equal(joins,1);assert.equal(f.client.ticket.playerId,'old-account');assert.equal(JSON.parse(f.storage.get(key)).ownerIdentity,'account:old-account');assert.equal(JSON.parse(f.storage.get(legacy+':account')).ownerIdentity,'account:old-account');
 current=otherProfile;await f.client.joinRoom(roomId);assert.equal(joins,2);assert.equal(f.client.ticket.playerId,'other-account');
 current={...guestProfile,serverTime:13};await f.client.joinRoom(roomId);assert.equal(joins,3);assert.equal(f.client.ticket.playerId,'guest-player');assert.equal(JSON.parse(f.sessions.get(legacy)).ownerIdentity,'guest:guest-code');
});

test('logged-in room restoration prefers a verified account ticket over guest session and distrusts unmarked legacy keys',async()=>{
 const room={id:roomId,puzzle:{groups:[]}},accountToken='e'.repeat(32),legacy='together-puzzle:room:'+roomId;let joins=0;
 const f=clientFixture(input=>{if(input.url.endsWith('/config'))return ok(config);if(input.url.endsWith('/profile'))return ok(profile);if(input.url.endsWith('/join')){joins++;return ok({token:accountToken,playerId:'account-player',room});}return ok(room);});await f.client.start();
 f.sessions.set(legacy,JSON.stringify({token:roomToken,playerId:'guest-player',ownerIdentity:'guest:old-guest'}));f.storage.set(legacy+':account',JSON.stringify({token:accountToken,playerId:'account-player',ownerIdentity:'account:old-account'}));
 await f.client.joinRoom(roomId);assert.equal(joins,0);assert.equal(f.calls.at(-1).headers.Authorization,'Bearer '+accountToken);
 f.client.ticket=null;f.storage.delete('jigsaw:shared-room:'+f.port.config.apiBase+':'+roomId);f.storage.set(legacy+':account',JSON.stringify({token:roomToken,playerId:'guest-player'}));f.sessions.set(legacy,JSON.stringify({token:roomToken,playerId:'guest-player'}));
 await f.client.joinRoom(roomId);assert.equal(joins,1);assert.equal(f.client.ticket.playerId,'account-player');
});

test('cookie expiration clears only client identity and never retries a mutation or creates a guest',async()=>{
 const f=clientFixture();await f.client.start();let writes=0;f.port.request=async()=>{writes++;return{status:401,headers:{},data:{error:'请登录',code:'IDENTITY_REQUIRED'}};};
 await assert.rejects(f.client.post('/api/mobile/gifts/open',{kind:'daily:2026-10-14:cooperation-10',requestId:'stable'}),{code:'IDENTITY_REQUIRED'});assert.equal(writes,1);assert.equal(f.client.authRequired,true);assert.equal(f.client.profile,null);assert.equal(f.restored(),1);
});

test('legacy-room compatibility URLs survive errors and gift IDs are sent unchanged',async()=>{
 const f=clientFixture(input=>input.url.includes('/gifts/open')?ok({opened:{kind:input.body.kind}}):{status:409,headers:{},data:{error:'请用原版房间',code:'LEGACY_ROOM_REQUIRED',compatUrl:'/room/'+roomId}});
 await assert.rejects(f.client.joinRoom(roomId),{code:'LEGACY_ROOM_REQUIRED',compatUrl:'/room/'+roomId});const kind='daily:2026-10-14:cooperation-10';assert.equal((await f.client.post('/api/mobile/gifts/open',{kind,requestId:'one'})).opened.kind,kind);
});

function browserFixture(t,{account=null,fallback=null,idb,storageBlocked=false}={}){
 const calls=[],writes=[],store=new Map(fallback?[['puzzle:guest-fallback',fallback]]:[]),location={href:'https://game.test/play',origin:'https://game.test',assign:url=>calls.push({navigation:url})};
 const values={window:{},document:{baseURI:location.href},location,indexedDB:idb,localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>{if(storageBlocked)throw Error('Storage unavailable');writes.push({key,value});store.set(key,value);}},sessionStorage:{getItem:()=>null,setItem(){}},fetch:async(url,init)=>{calls.push({url,init});return{status:200,text:async()=>JSON.stringify(url.endsWith('/auth/me')?{account}:{ok:true}),headers:new Map()};}};
 for(const [key,value]of Object.entries(values)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
 const port=createWebPlatform({id:'web',gameName:'拼图小窝',apiBase:'/api/shared',assetBase:'/',identityMode:'web-cookie',uiBase:'/shared-client/build-1/'},{style:{},getBoundingClientRect:()=>({width:900,height:600})});return{port,calls,store,writes};
}

test('browser uses same-origin cookies, preserves an existing guest and resolves static UI independently',async t=>{
 const f=browserFixture(t,{fallback:secret});await f.port.restoreWebIdentity();assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/auth/me','/api/guest']);assert.ok(f.calls.every(call=>call.init.credentials==='same-origin'));assert.deepEqual(JSON.parse(f.calls[1].init.body),{secret});
 assert.equal(f.writes.length,0);
 const image={};f.port.setImageSource(image,'assets/ui/icon.png');assert.equal(image.src,'https://game.test/shared-client/build-1/assets/ui/icon.png');f.port.setImageSource(image,'/puzzles/photo.webp');assert.equal(image.src,'/puzzles/photo.webp');assert.throws(()=>f.port.openUrl('https://other.test/account'),/当前网站/);
});

test('an authenticated account never reads or creates a guest identity',async t=>{
 const f=browserFixture(t,{account:profile.account,fallback:secret});await f.port.restoreWebIdentity();assert.equal(f.calls.length,1);
 assert.equal(f.writes.length,0);assert.throws(()=>createWebPlatform({id:'web',apiBase:'https://other.test/api/shared',assetBase:'/',identityMode:'web-cookie'},{style:{}}),/当前网站/);
});

test('first guest visit persists the original fallback secret before authenticating and reuses it on refresh',async t=>{
 const f=browserFixture(t);await f.port.restoreWebIdentity();const saved=f.store.get('puzzle:guest-fallback');assert.match(saved,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(f.calls[1].init.body),{secret:saved});
 await f.port.restoreWebIdentity();assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse(f.calls[3].init.body),{secret:saved});assert.ok(f.calls.every(call=>!call.url.includes('/session')));
});

function fakeIdentityDatabase(initial){
 let value=initial,exists=initial!==undefined;const events=[];
 const idb={open(name,version){assert.equal(name,'together-puzzle-identity');assert.equal(version,1);const request={};
  const db={objectStoreNames:{contains:name=>exists&&name==='identity'},createObjectStore(name){assert.equal(name,'identity');exists=true;events.push('upgrade');},close(){events.push('close');},transaction(name,mode){assert.equal(name,'identity');assert.equal(mode,'readwrite');events.push('readwrite');let pending=value,aborted=false;
   const tx={abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return{get(key){assert.equal(key,'guest');const read={result:value};queueMicrotask(()=>{if(aborted)return;read.onsuccess?.();queueMicrotask(()=>{if(aborted)return;value=pending;events.push('commit');tx.oncomplete?.();});});return read;},put(next,key){assert.equal(key,'guest');pending=next;events.push('put');}};}};return tx;}};
  request.result=db;queueMicrotask(()=>{if(!exists)request.onupgradeneeded?.();request.onsuccess?.();});return request;
 }};return{idb,events,value:()=>value};
}

test('original IndexedDB initializes with a committed write and then reuses the same guest without rewriting it',async t=>{
 const db=fakeIdentityDatabase(),f=browserFixture(t,{idb:db.idb});await f.port.restoreWebIdentity();assert.match(db.value(),/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(f.calls[1].init.body),{secret:db.value()});assert.deepEqual(db.events,['upgrade','readwrite','put','commit','close']);assert.equal(f.writes.length,0);
 await f.port.restoreWebIdentity();assert.equal(db.events.filter(event=>event==='put').length,1);assert.deepEqual(JSON.parse(f.calls[3].init.body),{secret:db.value()});
});

test('a recovered database imports the original fallback identity instead of replacing its wallet',async t=>{
 const db=fakeIdentityDatabase();browserFixture(t,{idb:db.idb,fallback:secret});assert.equal(await webGuestSecret(),secret);assert.equal(db.value(),secret);
});

test('unavailable persistent storage never creates a cookie-only guest',async t=>{
 const f=browserFixture(t,{storageBlocked:true});await assert.rejects(f.port.restoreWebIdentity(),/保存游客进度/);assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/auth/me']);
});

test('formal room text chat preserves the original endpoint, limit, authorization and retry ID',async()=>{
 const calls=[],prompts=[],notes=[];let fail=true,sequence=0;
 const app=Object.create(GameApp.prototype);Object.assign(app,{room:{ticket:{room:{id:roomId},token:roomToken}},client:{cookieIdentity:true,json:async(path,method,body,headers)=>{calls.push({path,method,body,headers});if(fail)throw Error('发送暂时失败');return{};}},platform:{prompt:async(...args)=>{prompts.push(args);return'  一起拼图吧  ';},randomId:()=>String(++sequence)},stage:{invalidate(){}},invalidate(){},chatDraft:'',chatCursor:4,busy:false,attempts:new Map(),loadChat:async()=>{},note:message=>notes.push(message)});
 await app.sayText();assert.equal(app.chatDraft,'一起拼图吧');assert.deepEqual(prompts[0],['输入消息','',{multiline:true,maxLength:300}]);assert.equal(calls[0].path,'/api/rooms/'+roomId+'/chat');assert.deepEqual(calls[0].body,{text:'一起拼图吧',requestId:'1',after:4});assert.equal(calls[0].headers.Authorization,'Bearer '+roomToken);assert.deepEqual(notes,['发送暂时失败']);
 fail=false;await app.sayText();assert.equal(calls[1].body.requestId,'1');assert.equal(prompts[1][1],'一起拼图吧');assert.equal(app.chatDraft,'');assert.equal(app.attempts.size,0);
 app.platform.prompt=async()=>null;await app.sayText();assert.equal(calls.length,2);app.client.cookieIdentity=false;app.platform.prompt=()=>assert.fail('Mini-game must keep preset phrases');await app.sayText();
});

test('formal text messages wrap into scrollable rows and only formal Web has the text input button',()=>{
 const buttons=[],drawn=[],stage={w:844,h:390,palette:{},ctx:{fillRect(){}},measure:text=>text.length*14,panel(){},hit(){},segments(){},clip(_area,fn){fn();},icon(){},button(_area,label){buttons.push(label);},text(value,_x,_y,size){if(size===14)drawn.push(value);}};
 const app=Object.create(GameApp.prototype),message='共同完成这张拼图。'.repeat(20);Object.assign(app,{stage,platform:{viewport:()=>({top:0,bottom:0})},client:{cookieIdentity:true,profile:{code:'self'}},social:{blockedCodes:[]},roomArea:{y:63},messages:[{name:'玩家',code:'self',text:message}],phraseGroup:0,serverPhrases:new Set(),modalScroll:0,busy:false});
 app.drawPublicChat();assert.equal(drawn.join(''),message);assert.ok(drawn.length>1);assert.ok(app.modalExtent>app.modalArea.h);assert.ok(buttons.includes('输入消息'));
 buttons.length=0;app.client.cookieIdentity=false;app.drawPublicChat();assert.equal(app.modalExtent,56);assert.ok(!buttons.includes('输入消息'));
});

test('formal Web social accepts original hexadecimal IDs and exposes only supported friend operations',async()=>{
 const peer={code:'abcdef123456',name:'原好友',level:2,online:false,lastSeenAt:0},snapshot={self:{...peer,code:'123456abcdef'},friends:[peer],requests:{incoming:[],outgoing:[]},conversations:[],blocked:[],unread:0},calls=[],notes=[];
 const client={cookieIdentity:true,config,platform:{config:{id:'web'},randomId:()=> 'r1',prompt:async()=>peer.code},json:async path=>{calls.push(path);return path.includes('/search?')?{player:peer,relationship:'friend'}:snapshot;},post:async()=>assert.fail('Viewing/searching friends must not send unsupported messages')};
 const panel=new SocialPanel(client,{invalidate(){},note:message=>notes.push(message),joinRoom:async()=>{},room:()=>null});panel.open();await new Promise(resolve=>setTimeout(resolve,0));
 const stage={buttons:[],texts:[],tabs:[],ctx:{fillRect(){},beginPath(){},arc(){},fill(){}},measure:value=>String(value).length*7,text(value){this.texts.push(String(value));},wrap(){},icon(){},panel(){},hit(){},clip(_r,fn){fn();},segments(_r,tabs){this.tabs=tabs;},button(r,label,fn,options){this.buttons.push({r,label,fn,options});}};
 panel.render(stage,{x:0,y:0,w:370,h:500});assert.deepEqual(stage.tabs.map(tab=>tab[0]),['friends','requests']);assert.ok(!stage.buttons.some(button=>['私聊','屏蔽名单'].includes(button.label)));assert.ok(!stage.texts.includes('离线'));
 stage.buttons.find(button=>button.label==='添加').fn();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(calls.some(path=>path.endsWith('search?code='+peer.code)));assert.deepEqual(notes,[]);
 panel.openConversation(peer.code);await new Promise(resolve=>setTimeout(resolve,0));assert.ok(!calls.some(path=>path.includes('/messages')));assert.match(notes.at(-1),/暂未开放/);panel.destroy();
});
