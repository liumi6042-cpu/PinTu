import test from 'node:test';
import assert from 'node:assert/strict';
import {createTapTapIdentity} from '../mobile/tap-identity.ts';
import {GameClient} from '../mobile/client.ts';

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const clock=t=>t.mock.timers.enable({apis:['setTimeout','Date'],now:1800000000000});
const user={userInfo:{nickName:'测试玩家'}};
const shortPolicy={bridgeTimeoutMs:1000,pollMs:100,loginTimeoutMs:300,userInfoTimeoutMs:300,retryDelaysMs:[50,100]};

test('a cold-start bridge injected after the page loads logs in without manual reconnect',async t=>{
 clock(t);let host,logins=0,reads=0;const events=[];
 const identity=createTapTapIdentity(()=>host,event=>events.push(event),shortPolicy),promise=identity();
 t.mock.timers.tick(300);await settle();assert.equal(logins,0);
 host={login(o){logins++;o.success({code:'synthetic-code'});},getUserInfo(o){reads++;o.success(user);}};
 t.mock.timers.tick(100);await settle();assert.deepEqual(await promise,{code:'synthetic-code',nickname:'测试玩家'});assert.equal(logins,1);assert.equal(reads,1);assert.equal(events.at(-1).state,'ready');
});

test('a login callback after the previous 8-second deadline remains valid and native timeout is passed',async t=>{
 clock(t);let complete,timeout,logins=0;const identity=createTapTapIdentity(()=>({login(o){logins++;timeout=o.timeout;complete=o.success;},getUserInfo:o=>o.success(user)}));
 const result=identity();await settle();assert.equal(timeout,15000);t.mock.timers.tick(10000);await settle();complete({code:'delayed-code'});assert.equal((await result).code,'delayed-code');assert.equal(logins,1);
});

test('a task acknowledgement Promise cannot beat callback credentials and one identity call is shared',async t=>{
 clock(t);let complete,logins=0;const identity=createTapTapIdentity(()=>({login(o){logins++;complete=o.success;return Promise.resolve(undefined);},getUserInfo:o=>o.success({data:user})}),undefined,shortPolicy);
 const first=identity(),other=identity();assert.equal(first,other);await settle();complete({data:{code:'synthetic-code'}});assert.equal((await first).nickname,'测试玩家');assert.equal(logins,1);
});

test('temporary login failure recovers once, never creating a guest or duplicating startup binding',async t=>{
 clock(t);const events=[],urls=[];let logins=0,binds=0;const identity=createTapTapIdentity(()=>({login(o){if(++logins===1)o.fail({errno:1000,errMsg:'internal code=private-login'});else o.success({code:'recovered-code'});},getUserInfo:o=>o.success(user)}),event=>events.push(event),shortPolicy);
 const storage=new Map(),client=new GameClient({config:{id:'taptap',gameName:'test',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets'},tapTapIdentity:identity,storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},request:async input=>{urls.push(input.url);if(input.url.endsWith('/config'))return {status:200,headers:{},data:{mobileMode:'mobile-v3-isolated',adRewardEnabled:false}};if(input.url.endsWith('/session'))return {status:200,headers:{},data:{token:'a'.repeat(64)}};assert.ok(input.url.endsWith('/api/taptap/bind'));binds++;assert.equal(input.body.code,'recovered-code');return {status:200,headers:{},data:{level:0,energy:30,energyCap:30,supply:{energy:0,create:1},name:'测试玩家',taptap:{bound:true}}};}});
 const a=client.start(),b=client.start();await settle();assert.deepEqual(urls,['https://game.test/h5/config']);t.mock.timers.tick(50);await settle();await Promise.all([a,b]);assert.equal(logins,2);assert.equal(binds,1);assert.equal(urls.filter(u=>u.endsWith('/api/mobile/profile')).length,0);assert.equal(client.profile.name,'测试玩家');assert.ok(!JSON.stringify(events).includes('private-login'));
});

test('cancelled authorization is not retried, but a later explicit reconnect is possible',async t=>{
 clock(t);let calls=0,allowed=false;const identity=createTapTapIdentity(()=>({login(o){calls++;if(allowed)o.success({code:'fresh-code'});else o.fail({errno:2001,errMsg:'auth deny'});},getUserInfo:o=>o.success(user)}),undefined,shortPolicy);
 await assert.rejects(identity(),error=>error.kind==='denied');assert.equal(calls,1);t.mock.timers.tick(5000);await settle();assert.equal(calls,1);allowed=true;assert.equal((await identity()).code,'fresh-code');assert.equal(calls,2);
});

test('temporary nickname failure retries only userInfo and never reuses a consumed login',async t=>{
 clock(t);let logins=0,reads=0;const identity=createTapTapIdentity(()=>({login(o){logins++;o.success({code:'code-'+logins});},getUserInfo(o){if(++reads===1)o.fail({errno:1000});else o.success(user);}}),undefined,shortPolicy);
 const first=identity();await settle();t.mock.timers.tick(50);await settle();assert.equal((await first).code,'code-1');assert.equal(logins,1);assert.equal(reads,2);assert.equal((await identity()).code,'code-2');
});

test('a permanently missing host ends cleanly without reaching our service',async t=>{
 clock(t);const identity=createTapTapIdentity(()=>undefined,undefined,shortPolicy),promise=identity();const rejected=assert.rejects(promise,error=>error.stage==='bridge'&&error.kind==='unavailable');t.mock.timers.tick(1000);await settle();t.mock.timers.tick(100);await settle();await rejected;
});

test('a missing callback times out without overlapping native calls; explicit reconnect ignores stale callbacks',async t=>{
 clock(t);const callbacks=[],events=[];const identity=createTapTapIdentity(()=>({login:o=>callbacks.push(o.success),getUserInfo:o=>o.success(user)}),event=>events.push(event),shortPolicy);
 const pending=identity(),rejected=assert.rejects(pending,error=>error.kind==='timeout');await settle();t.mock.timers.tick(300);await settle();await rejected;t.mock.timers.tick(5000);await settle();assert.equal(callbacks.length,1);
 const reconnect=identity();await settle();assert.equal(callbacks.length,2);callbacks[0]({code:'expired'});await settle();callbacks[1]({code:'current'});assert.equal((await reconnect).code,'current');assert.ok(events.some(e=>e.kind==='timeout'));
});

test('failure metadata never leaks login codes, raw native messages or unknown error-code strings',async t=>{
 clock(t);const events=[];const identity=createTapTapIdentity(()=>({login:o=>o.fail({errCode:'code=secret-native-value',errMsg:'network token=secret-token'}),getUserInfo:o=>o.success(user)}),e=>events.push(e),{...shortPolicy,retryDelaysMs:[]});await assert.rejects(identity(),error=>!error.message.includes('secret'));assert.equal(JSON.stringify(events).includes('secret'),false);assert.equal(events.at(-1).state,'failed');
});


test('plain-string cancellation is terminal for both callbacks and promise bridges',async t=>{
 clock(t);for(const message of ['cancel','permission denied','用户取消'])for(const promise of [false,true]){let calls=0;const identity=createTapTapIdentity(()=>({login(o){calls++;if(promise)return Promise.reject(message);o.fail(message);},getUserInfo:o=>o.success(user)}),undefined,shortPolicy);await assert.rejects(identity(),error=>error.kind==='denied');assert.equal(calls,1);}
});

test('first-time user waits for an explicit native nickname tap and cleans the button after approval',async t=>{
 clock(t);let click,reads=0,created=0,destroyed=0,shown=0,hidden=0,options;
 const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'first-time-code'}),getSetting:o=>o.success({authSetting:{}}),getUserInfo(){reads++;throw Error('unapproved getUserInfo must not run');},createUserInfoButton(o){created++;options=o;return {onTap(fn){click=fn;},show(){shown++;},hide(){hidden++;},destroy(){destroyed++;}};}}),undefined,shortPolicy,()=>({left:40,top:150,width:240,height:44}));
 const pending=identity();await settle();assert.equal(created,1);assert.equal(reads,0);assert.equal(options.withCredentials,false);assert.equal(options.text,'授权昵称并进入');assert.equal(identity(),pending);
 identity.setHidden(true);identity.setHidden(false);assert.equal(hidden,1);assert.equal(shown,2);
 click(user);assert.deepEqual(await pending,{code:'first-time-code',nickname:'测试玩家'});assert.equal(destroyed,1);click({userInfo:{nickName:'late-user'}});assert.equal(destroyed,1);
});

test('authorized users read their nickname without a new authorization button',async t=>{
 clock(t);let reads=0;const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'known-code'}),getSetting:o=>o.success({data:{authSetting:{'scope.userInfo':true}}}),getUserInfo(o){reads++;o.success(user);},createUserInfoButton(){assert.fail('already authorized');}}),undefined,shortPolicy);
 assert.equal((await identity()).nickname,'测试玩家');assert.equal(reads,1);
});

test('setting task acknowledgement waits for its callback, and an unapproved host needs no getUserInfo method',async t=>{
 clock(t);let setting,click,created=0;const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'settings-code'}),getSetting(o){setting=o.success;return Promise.resolve(undefined);},createUserInfoButton(){created++;return {onTap(fn){click=fn;},destroy(){}};}}),undefined,shortPolicy);
 const pending=identity();await settle();assert.equal(created,0);setting({authSetting:{'scope.userInfo':false}});await settle();assert.equal(created,1);click(user);assert.equal((await pending).code,'settings-code');
});

test('nickname rejection and authorization cancellation release the native button without fabricating a profile',async t=>{
 clock(t);for(const mode of ['denied','timeout','dispose']){let click,destroyed=0;const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'approval-code'}),getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(){return {onTap(fn){click=fn;},destroy(){destroyed++;}};}}),undefined,{...shortPolicy,authorizationTimeoutMs:500});
  const pending=identity(),rejected=assert.rejects(pending,e=>e.stage==='authorize'&&e.kind===(mode==='timeout'?'timeout':'denied'));await settle();if(mode==='denied')click({errMsg:'getUserInfo:fail auth deny'});if(mode==='timeout'){t.mock.timers.tick(500);await settle();}if(mode==='dispose')identity.cancel();await rejected;assert.equal(destroyed,1);click(user);assert.equal(destroyed,1);
 }
});

test('legacy permission failure offers a click button rather than retrying an unapproved read',async t=>{
 clock(t);let click,reads=0;const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'legacy-code'}),getUserInfo(o){reads++;o.fail({errno:2001,errMsg:'scope.userInfo unauthorized'});},createUserInfoButton(){return {onTap(fn){click=fn;},destroy(){}};}}),undefined,shortPolicy);
 const pending=identity();await settle();assert.equal(reads,1);click(user);assert.equal((await pending).nickname,'测试玩家');
});

test('a fresh client fetches only public config before authorization and binds the verified account once afterward',async t=>{
 clock(t);let click;const calls=[],identity=createTapTapIdentity(()=>({login:o=>o.success({code:'binding-code'}),getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(){return {onTap(fn){click=fn;},destroy(){}};}}),undefined,shortPolicy);
 const platform={config:{id:'taptap',apiBase:'https://first.test/h5'},tapTapIdentity:identity,storage:{get:()=>null,set(){}},request:async input=>{calls.push(input.url);if(input.url.endsWith('/config'))return {status:200,data:{mobileMode:'mobile-v3-isolated'}};if(input.url.endsWith('/session'))return {status:200,data:{token:'a'.repeat(64)}};assert.ok(input.url.endsWith('/api/taptap/bind'));assert.equal(input.body.code,'binding-code');return {status:200,data:{level:0,energy:30,energyCap:30,supply:{energy:0,create:1},taptap:{bound:true}},headers:{}};}};
 const client=new GameClient(platform),pending=client.start();await settle();assert.deepEqual(calls,['https://first.test/h5/config']);assert.equal(client.profile,null);click(user);await pending;assert.equal(calls.length,3);assert.equal(client.profile.taptap.bound,true);assert.equal(calls.some(p=>p.endsWith('/api/mobile/profile')),false);
});

test('explicit authorization test bypasses an existing permission and waits for the native tap before login',async t=>{
 clock(t);let click,destroyed=0;const calls=[];
 const identity=createTapTapIdentity(()=>({getSetting(){assert.fail('test must not reuse authorization cache');},getUserInfo(){assert.fail('test must use the native button');},createUserInfoButton(o){calls.push('button');assert.equal(o.withCredentials,false);return {onTap(fn){click=fn;},destroy(){destroyed++;}};},login(o){calls.push('login');o.success({code:'post-click-code'});}}),undefined,shortPolicy);
 const pending=identity(true);await settle();assert.deepEqual(calls,['button']);click(user);assert.deepEqual(await pending,{code:'post-click-code',nickname:'测试玩家'});assert.deepEqual(calls,['button','login']);assert.equal(destroyed,1);
});

test('self-test reauthorization preserves session/progress and cancellation does not rebind or create a guest',async t=>{
 clock(t);for(const cancel of [false,true]){const token='a'.repeat(64),calls=[],memory=new Map(),profile={level:3,energy:37,energyCap:40,supply:{energy:2,create:1},collection:{coins:1234},taptap:{bound:true}};let click;
  const identity=createTapTapIdentity(()=>({getSetting:o=>o.success({authSetting:{'scope.userInfo':true}}),getUserInfo:o=>o.success(user),login:o=>o.success({code:'same-account-code'}),createUserInfoButton(){return {onTap(fn){click=fn;},destroy(){}};}}),undefined,shortPolicy);
  const platform={config:{id:'taptap',apiBase:'https://recheck.test/h5',tapAuthorizationTest:true},tapTapIdentity:o=>identity(o?.forceAuthorization===true),storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v)},request:async input=>{calls.push(input.url);if(input.url.endsWith('/config'))return {status:200,data:{mobileMode:'mobile-v3-isolated'}};if(input.url.endsWith('/session'))return {status:200,data:{token}};assert.ok(input.url.endsWith('/api/taptap/bind'));return {status:200,data:profile,headers:{}};}};
  const client=new GameClient(platform);await client.start();const initialProfile=client.profile,stored=[...memory.entries()];const next=client.reauthorizeTapTap(),rejected=cancel?assert.rejects(next,e=>e.stage==='authorize'||e.code==='TAPTAP_IDENTITY_REQUIRED'):null;await settle();assert.equal(calls.filter(p=>p.endsWith('/api/taptap/bind')).length,1);assert.equal(calls.filter(p=>p.endsWith('/session')).length,1);assert.equal(client.profile,initialProfile);
  if(cancel){identity.cancel();await rejected;}else{click(user);await next;}
  assert.equal(client.profile.collection.coins,1234);assert.equal(client.profile.energy,37);assert.deepEqual([...memory.entries()],stored);assert.equal(calls.filter(p=>p.endsWith('/api/taptap/bind')).length,cancel?1:2);assert.equal(calls.some(p=>p.endsWith('/api/mobile/profile')),false);
 }
});

test('reauthorization is denied outside a TapTap self-test package before any identity or network call',async()=>{
 for(const config of [{id:'taptap'},{id:'web',tapAuthorizationTest:true},{id:'wechat',tapAuthorizationTest:true}]){const client=new GameClient({config,tapTapIdentity(){assert.fail('normal package must not start this flow');},request(){assert.fail('no request');}});await assert.rejects(client.reauthorizeTapTap(),/未开放/);}
});

test('transparent native authorization preserves the Canvas label and moves with the shared dialog',async t=>{
 clock(t);let click,button,options,creates=0,x=20;
 const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'image-button-code'}),getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(o){options=o;creates++;return button={style:o.style,onTap(fn){click=fn;},destroy(){}};}}),undefined,shortPolicy,()=>({left:x,top:200,width:280,height:48,transparent:true}));
 const pending=identity();await settle();assert.equal(options.type,'text');assert.equal(options.image,undefined);assert.equal(options.text,'');assert.equal(options.style.backgroundColor,'#00000000');assert.equal(options.style.color,'#00000000');assert.equal(options.style.borderWidth,0);assert.equal(options.withCredentials,false);x=50;identity.refreshLayout();assert.equal(button.style.left,50);assert.equal(creates,2);identity.refreshLayout();assert.equal(creates,2);click(user);assert.equal((await pending).nickname,'测试玩家');
});

test('a native button placed before the cold-start layout settles is rebuilt where the dialog is drawn, new before old',async t=>{
 clock(t);const buttons=[];let rect={left:0,top:0,width:0,height:0};
 const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'settled-code'}),getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(o){const button={style:o.style,destroyed:0,shown:0,hidden:0,handlers:[],onTap(fn){button.handlers.push(fn);},offTap(fn){assert.ok(button.handlers.includes(fn));button.handlers=button.handlers.filter(h=>h!==fn);},show(){button.shown++;},hide(){button.hidden++;},destroy(){button.destroyed++;}};buttons.push(button);return button;}}),undefined,shortPolicy,()=>({...rect,transparent:true}));
 const pending=identity();await settle();assert.equal(buttons.length,1);assert.equal(buttons[0].style.width,0);
 // 宿主旋转或画布首次排版完成时没有可靠的resize回调，靠创建后的布局复查追上。
 rect={left:207,top:500,width:173,height:38};t.mock.timers.tick(300);assert.equal(buttons.length,2);assert.equal(buttons[1].style.left,207);assert.equal(buttons[1].shown,1);
 // 新按钮先就位；旧按钮1.5秒后才隐藏，回调保留到授权结束，且每个按钮各有自己的回调函数。
 assert.equal(buttons[0].destroyed,0);assert.equal(buttons[0].hidden,0);t.mock.timers.tick(1500);assert.equal(buttons[0].hidden,1);assert.equal(buttons[0].destroyed,0);assert.notEqual(buttons[0].handlers[0],buttons[1].handlers[0]);
 t.mock.timers.tick(700);assert.equal(buttons.length,2);
 buttons[1].handlers[0](user);assert.equal((await pending).code,'settled-code');assert.deepEqual(buttons.map(b=>[b.destroyed,b.handlers.length]),[[1,0],[1,0]]);
});

test('a tap the native button missed rebuilds it synchronously; the old button still answers until approval',async t=>{
 clock(t);const buttons=[],events=[],lines=[];let logins=0;
 const identity=createTapTapIdentity(()=>({login(o){logins++;o.success({code:'retry-code'});},getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(){const button={destroyed:0,hidden:0,handlers:[],onTap(fn){button.handlers.push(fn);},offTap(fn){button.handlers=button.handlers.filter(h=>h!==fn);},hide(){button.hidden++;},destroy(){button.destroyed++;}};buttons.push(button);return button;}}),event=>events.push(event),shortPolicy,()=>({left:10,top:20,width:100,height:38,transparent:true}),text=>lines.push(text));
 const pending=identity(true);await settle();assert.equal(buttons.length,1);
 // 与“重新连接”一样，在这次点击内同步新建；600ms内最多强制重建一次；授权前不登录。
 assert.equal(identity.retryButton(),true);assert.equal(buttons.length,2);assert.equal(identity.retryButton(),false);assert.equal(buttons.length,2);assert.equal(logins,0);
 assert.equal(buttons[0].destroyed,0);assert.equal(buttons[0].handlers.length,1);assert.notEqual(buttons[0].handlers[0],buttons[1].handlers[0]);
 t.mock.timers.tick(600);assert.equal(identity.retryButton(),true);assert.equal(buttons.length,3);
 assert.deepEqual(events.filter(e=>e.stage==='authorize').map(e=>[e.attempt,e.state]),[[1,'waiting'],[2,'waiting'],[3,'waiting']]);
 // 迟到的最早按钮回调仍能完成授权，之后所有按钮（含等待隐藏的）统一释放。
 buttons[0].handlers[0](user);const result=await pending;assert.equal(result.nickname,'测试玩家');assert.equal(logins,1);assert.deepEqual(buttons.map(b=>[b.destroyed,b.handlers.length]),[[1,0],[1,0],[1,0]]);
 assert.equal(identity.retryButton(),false);t.mock.timers.tick(3000);assert.equal(buttons.length,3);assert.deepEqual(buttons.map(b=>b.hidden),[0,0,0]);
 assert.equal(identity.debugState().forced,2);assert.equal(identity.debugState().taps,1);
 const trail=lines.join('\n');assert.ok(trail.includes('原生按钮#1 回调 · ok'));assert.ok(trail.includes('强制重建'));assert.ok(!trail.includes('retry-code')&&!trail.includes('测试玩家'));
});

test('a native tap that also reaches the Canvas resolves through the original button handler',async t=>{
 clock(t);const buttons=[];
 const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'both-code'}),getSetting:o=>o.success({authSetting:{}}),createUserInfoButton(){const button={destroyed:0,onTap(fn){button.click=fn;},destroy(){button.destroyed++;}};buttons.push(button);return button;}}),undefined,shortPolicy,()=>({left:10,top:20,width:100,height:38,transparent:true}));
 const pending=identity(true);await settle();identity.retryButton();buttons[0].click(user);assert.equal((await pending).code,'both-code');t.mock.timers.tick(2000);assert.equal(buttons.length,2);assert.deepEqual(buttons.map(b=>b.destroyed),[1,1]);
});

test('a host that refuses to create the native button (TapTap PC client) fails at once as unavailable',async t=>{
 clock(t);let destroyed=0;const lines=[];
 // PC客户端H5桥：UserInfoButton不在主进程白名单，#CREATE返回错误JSON，句柄变成NaN，按钮不会绘制也不会回调。
 const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'pc-code'}),getUserInfo(){},createUserInfoButton(){const button={onTap(){},destroy(){destroyed++;}};Object.defineProperty(button,'$native_handle',{value:Number('{"errno":4}'),enumerable:false});return button;}}),undefined,shortPolicy,undefined,text=>lines.push(text));
 await assert.rejects(identity(true),error=>error.stage==='authorize'&&error.kind==='unavailable');assert.equal(destroyed,1);assert.equal(identity.debugState().refused,true);assert.ok(lines.some(line=>line.includes('宿主拒绝创建')));
});

const guestProfile={level:0,energy:30,energyCap:30,supply:{energy:0,create:1},name:'游客甲'};
function tapClient({identity,storage,request,lines=[]}){
 const calls=[];const client=new GameClient({config:{id:'taptap',gameName:'test',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets'},tapTapIdentity:identity,loginLog:{add:text=>lines.push(text),lines:()=>lines},storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},request:async input=>{calls.push(input);return request(input);}});
 return {client,calls,lines};
}
const tapServer=(bind)=>async input=>{const path=new URL(input.url).pathname;if(path.endsWith('/config'))return {status:200,headers:{},data:{mobileMode:'mobile-v3-isolated',adRewardEnabled:false}};if(path.endsWith('/session'))return {status:200,headers:{},data:{token:'b'.repeat(64)}};if(path.endsWith('/api/mobile/profile'))return {status:200,headers:{},data:guestProfile};if(path.endsWith('/api/taptap/bind'))return bind(input);throw Error('unexpected '+path);};

test('a missing TapTap bridge enters as a guest on the stored session, and a later launch binds that same session',async()=>{
 const storage=new Map();
 const first=tapClient({storage,identity:async()=>{throw Object.assign(Error('bridge'),{stage:'bridge'});},request:tapServer(()=>assert.fail('no bind without a TapTap identity'))});
 await first.client.start();assert.equal(first.client.tapGuest,true);assert.equal(first.client.tapNotice,'TapTap登录暂时不可用，已用游客身份进入，进度会保留');assert.equal(first.client.profile.name,'游客甲');
 assert.deepEqual(first.calls.map(c=>new URL(c.url).pathname),['/h5/config','/h5/session','/h5/api/mobile/profile']);assert.ok(first.lines.some(line=>line.startsWith('游客模式进入')));
 const session=[...storage.values()].find(value=>/^[a-f0-9]{64}$/.test(value));assert.equal(session,'b'.repeat(64));
 // 下次启动TapTap正常：沿用同一个会话绑定，服务器把这个游客进度归到TapTap账号上，不新建会话。
 const second=tapClient({storage,identity:async()=>({code:'later-code',nickname:'测试玩家'}),request:tapServer(input=>{assert.equal(input.headers['X-Jigsaw-H5-Session'],session);return {status:200,headers:{},data:{bound:true,profile:{...guestProfile,name:'测试玩家',taptap:{provider:'taptap',bound:true}}}};})});
 await second.client.start();assert.equal(second.client.tapGuest,false);assert.equal(second.client.tapNotice,'');assert.deepEqual(second.calls.map(c=>new URL(c.url).pathname),['/h5/config','/h5/api/taptap/bind']);assert.equal(second.client.profile.name,'测试玩家');
 assert.ok(!second.lines.join('\n').includes('later-code'));
});

test('a TapTap account already holding other progress keeps the guest session and says so; a failing bind request still enters',async()=>{
 const storage=new Map([['jigsaw:h5-session:https://game.test/h5','c'.repeat(64)]]);
 const conflict=tapClient({storage,identity:async()=>({code:'conflict-code',nickname:'测试玩家'}),request:tapServer(()=>({status:409,headers:{},data:{error:'该TapTap账号已有其他游戏进度',code:'TAPTAP_ACCOUNT_CONFLICT'}}))});
 await conflict.client.start();assert.equal(conflict.client.tapGuest,true);assert.equal(conflict.client.tapNotice,'该TapTap账号已有其他进度，本次继续以游客身份游玩，进度会保留');assert.equal(storage.get('jigsaw:h5-session:https://game.test/h5'),'c'.repeat(64));
 const offline=tapClient({storage,identity:async()=>({code:'offline-code',nickname:'测试玩家'}),request:tapServer(()=>{throw Error('网络连接失败，请重试');})});
 await offline.client.start();assert.equal(offline.client.tapGuest,true);assert.equal(offline.client.profile.name,'游客甲');assert.ok(offline.lines.some(line=>line.includes('TapTap绑定失败 · 网络')));
 // 自测重授权仍严格失败，不会悄悄转成游客。
 const strict=tapClient({storage,identity:async()=>{throw Error('cancelled');},request:tapServer(()=>assert.fail('no bind'))});
 strict.client.platform.config.tapAuthorizationTest=true;await assert.rejects(strict.client.reauthorizeTapTap());
});

test('the login dialog choice to continue skips the TapTap identity call entirely',async()=>{
 const storage=new Map();let asked=0;
 const guest=tapClient({storage,identity:async()=>{asked++;return {code:'unused',nickname:'x'};},request:tapServer(()=>assert.fail('no bind'))});
 guest.client.tapGuestRequested=true;await guest.client.start();assert.equal(asked,0);assert.equal(guest.client.tapGuest,true);
});

test('on a host that refuses the nickname button, the next identity call logs in afresh and returns a login-only identity',async t=>{
 clock(t);let logins=0,settings=0,reads=0;const lines=[];
 const identity=createTapTapIdentity(()=>({login(o){logins++;o.success({code:'pc-code-'+logins});},getSetting(){settings++;},getUserInfo(){reads++;},createUserInfoButton(){const button={onTap(){},destroy(){}};Object.defineProperty(button,'$native_handle',{value:NaN,enumerable:false});return button;}}),undefined,shortPolicy,undefined,text=>lines.push(text));
 await assert.rejects(identity(true),error=>error.kind==='unavailable');assert.equal(logins,0);assert.equal(identity.nicknameUnavailable(),true);
 // 玩家点“同意并登录”之后才取登录凭证，不读昵称、不再建按钮。
 assert.deepEqual(await identity(),{code:'pc-code-1',nickname:'',nicknameUnavailable:true});assert.equal(logins,1);assert.equal(settings,0);assert.equal(reads,0);
 assert.deepEqual(await identity(),{code:'pc-code-2',nickname:'',nicknameUnavailable:true});
 assert.ok(lines.includes('昵称接口不可用 → 仅用登录凭证绑定'));assert.ok(!lines.join('\n').includes('pc-code'));
});

test('a returning launch where getSetting and getUserInfo never answer binds with the login code only',async t=>{
 clock(t);const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'silent-code'}),getSetting(){},getUserInfo(){}}),undefined,shortPolicy);
 const pending=identity();await settle();t.mock.timers.tick(3000);await settle();t.mock.timers.tick(300);await settle();
 assert.deepEqual(await pending,{code:'silent-code',nickname:'',nicknameUnavailable:true});assert.equal(identity.nicknameUnavailable(),true);
});

test('a refused nickname (not an unavailable one) never turns into a login-only identity',async t=>{
 clock(t);const identity=createTapTapIdentity(()=>({login:o=>o.success({code:'refused-code'}),getSetting:o=>o.success({authSetting:{'scope.userInfo':true}}),getUserInfo:o=>o.fail({errMsg:'getUserInfo:fail auth deny'})}),undefined,shortPolicy);
 await assert.rejects(identity(),error=>error.kind==='denied');assert.equal(identity.nicknameUnavailable(),false);
});

test('a login-only identity binds without a nickname; conflict or failure keeps the guest',async()=>{
 const storage=new Map();const bodies=[];
 const pc=tapClient({storage,identity:async()=>({code:'pc-login-code',nickname:'',nicknameUnavailable:true}),request:tapServer(input=>{bodies.push(input.body);return {status:200,headers:{},data:{bound:true,profile:{...guestProfile,taptap:{provider:'taptap',bound:true,nickname:null}}}};})});
 await pc.client.start();assert.equal(pc.client.tapGuest,false);assert.equal(pc.client.tapNotice,'');assert.deepEqual(bodies,[{code:'pc-login-code'}]);assert.ok(pc.lines.includes('TapTap仅登录绑定成功'));assert.ok(!pc.lines.join('\n').includes('pc-login-code'));
 const conflict=tapClient({storage,identity:async()=>({code:'pc-conflict',nickname:'',nicknameUnavailable:true}),request:tapServer(()=>({status:409,headers:{},data:{error:'冲突',code:'TAPTAP_ACCOUNT_CONFLICT'}}))});
 await conflict.client.start();assert.equal(conflict.client.tapGuest,true);assert.equal(conflict.client.tapNotice,'该TapTap账号已有其他进度，本次继续以游客身份游玩，进度会保留');
 const failed=tapClient({storage,identity:async()=>{throw Object.assign(Error('login'),{stage:'login'});},request:tapServer(()=>assert.fail('no bind'))});
 await failed.client.start();assert.equal(failed.client.tapGuest,true);
 // 手机端有昵称时仍带昵称绑定。
 const phoneBodies=[];const phone=tapClient({storage,identity:async()=>({code:'phone-code',nickname:'测试玩家'}),request:tapServer(input=>{phoneBodies.push(input.body);return {status:200,headers:{},data:{bound:true,profile:{...guestProfile,name:'测试玩家',taptap:{provider:'taptap',bound:true}}}};})});
 await phone.client.start();assert.deepEqual(phoneBodies,[{code:'phone-code',nickname:'测试玩家'}]);
});
