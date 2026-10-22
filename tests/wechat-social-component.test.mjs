import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWechatSocialComponent} from '../mobile/wechat-social-component.ts';
import {createWechatPlatform} from '../mobile/platform-wechat.ts';
import {sharedPlatformPlugins} from '../scripts/build-mobile-shared.mjs';

function plugin({tabs=true,privateEntry=true,opening}={}){
 const events=new Map(),calls=[];let constructions=0,options;
 class Chat{
  constructor(value){constructions++;options=value;}
  on(name,callback){events.set(name,callback);}
  hide(){calls.push('hide');}
  close(){calls.push('close');assert.fail('component close callbacks must not recursively close it');}
  show(){assert.fail('hidden preparation must never show native chat');}
  open(){assert.fail('default/public native chat must never be opened');}
  setTabs(keys){assert.deepEqual(keys,['private']);calls.push(['setTabs',keys]);}
  openPrivate(...args){assert.deepEqual(args,[]);calls.push(['openPrivate',args]);return opening?.(events);}
  setChatSignature(){assert.fail('account signatures must not be guessed');}
 }
 if(!tabs)delete Chat.prototype.setTabs;
 if(!privateEntry)delete Chat.prototype.openPrivate;
 return {Chat,events,calls,get constructions(){return constructions;},get options(){return options;}};
}
const phone=()=>({getSystemInfoSync:()=>({platform:'ios'})});
const nativeOpenCalls=fake=>fake.calls.filter(call=>Array.isArray(call)&&call[0]==='openPrivate');
async function prepared(fake,wx=phone(),options={}){
 const service=createWechatSocialComponent(wx,()=>({default:fake.Chat}),options);
 const ready=service.prepare();fake.events.get('ready')();assert.equal((await ready).state,'ready');
 return service;
}

test('official component prepares hidden and shares one instance per genuine host',async()=>{
 const wx={},fake=plugin(),loaded=[];
 const load=(name,options)=>{loaded.push({name,options});return {default:fake.Chat};};
 const service=createWechatSocialComponent(wx,load),same=createWechatSocialComponent(wx,load);
 assert.equal(service,same);assert.deepEqual(service.status(),{state:'idle'});
 const first=service.prepare(),second=service.prepare();assert.equal(first,second);
 assert.equal(fake.constructions,1);assert.equal(loaded.length,1);assert.equal(loaded[0].name,'MiniGameChat');
 assert.equal(loaded[0].options.customEnv.wx,wx);assert.equal(loaded[0].options.enableRequireHostModule,true);
 assert.deepEqual(fake.options,{x:0,y:0,autoShow:false,logoUrl:'',movable:false,enableSnap:false,scale:1});
 assert.deepEqual(service.status(),{state:'loading'});fake.events.get('ready')();
 assert.deepEqual(await first,{state:'ready'});assert.equal(service.status().state,'ready');
 await service.prepare();assert.equal(fake.constructions,1);assert.ok(fake.calls.includes('hide'));
 assert.equal(fake.calls.includes('close'),false);
 assert.deepEqual(fake.calls.filter(call=>Array.isArray(call)),[['setTabs',['private']]]);
});

test('missing and invalid plugin hosts settle without throwing or exposing raw errors',async()=>{
 const unavailable=createWechatSocialComponent({});
 assert.deepEqual(await unavailable.prepare(),{state:'unavailable',error:{kind:'plugin-unavailable'}});
 assert.equal(await unavailable.openPrivate(),'unavailable');
 const failed=createWechatSocialComponent({},()=>{throw {errCode:1003,errMsg:'openid=test token=private account information'};});
 assert.deepEqual(await failed.prepare(),{state:'failed',error:{kind:'plugin-load-failed',code:1003}});
 assert.ok(!JSON.stringify(failed.status()).includes('private'));
 const invalid=createWechatSocialComponent({},()=>({default:{}}));
 assert.deepEqual(await invalid.prepare(),{state:'failed',error:{kind:'invalid-plugin'}});
 const invalidInstance=createWechatSocialComponent({},()=>({default:class {}}));
 assert.deepEqual(await invalidInstance.prepare(),{state:'failed',error:{kind:'invalid-plugin'}});
});

test('initialization and later runtime errors stay hidden and have safe diagnostic codes',async()=>{
 const fake=plugin(),service=createWechatSocialComponent({},()=>({default:fake.Chat}));
 const first=service.prepare();fake.events.get('error')({errCode:4001,signature:'secret'});
 assert.deepEqual(await first,{state:'failed',error:{kind:'initialization-error',code:4001}});
 const ready=plugin(),next=createWechatSocialComponent(phone(),()=>({default:ready.Chat}));
 const pending=next.prepare();ready.events.get('ready')();await pending;
 ready.events.get('error')({errCode:'openid-do-not-expose',errMsg:'secret'});
 assert.deepEqual(next.status(),{state:'failed',error:{kind:'initialization-error'}});
 const copy=next.status();copy.error.kind='plugin-load-failed';assert.equal(next.status().error.kind,'initialization-error');
 assert.deepEqual(await next.prepare(),{state:'failed',error:{kind:'initialization-error'}});
 assert.equal(await next.openPrivate(),'failed');assert.equal(nativeOpenCalls(ready).length,0);
});

test('a stalled plugin times out without blocking and ignores a late ready signal',async()=>{
 const fake=plugin(),service=createWechatSocialComponent({},()=>({default:fake.Chat}),{timeoutMs:5});
 assert.deepEqual(await service.prepare(),{state:'failed',error:{kind:'initialization-timeout'}});
 fake.events.get('ready')();assert.equal(service.status().state,'failed');
 assert.equal(fake.calls.filter(call=>Array.isArray(call)).length,0);
 await service.prepare();assert.equal(fake.constructions,1);
});

test('private tab configuration is required before any native entry can open',async()=>{
 const fake=plugin({tabs:false}),service=createWechatSocialComponent(phone(),()=>({default:fake.Chat}));
 const waiting=service.openPrivate();fake.events.get('ready')();
 assert.equal(await waiting,'failed');assert.deepEqual(service.status(),{state:'failed',error:{kind:'invalid-plugin'}});
 assert.equal(nativeOpenCalls(fake).length,0);
 const missing=plugin({privateEntry:false}),ready=await prepared(missing);
 assert.equal(await ready.openPrivate(),'failed');assert.deepEqual(ready.status(),{state:'failed',error:{kind:'invalid-plugin'}});
});

test('developer tools remain ready but cannot open an unsupported native private panel',async()=>{
 const fake=plugin(),service=await prepared(fake,{getSystemInfoSync:()=>({platform:'devtools'})});
 assert.equal(await service.openPrivate(),'unsupported');assert.deepEqual(service.status(),{state:'ready'});
 assert.equal(nativeOpenCalls(fake).length,0);
});

test('phone opening uses only openPrivate with no arguments and waits for the open event',async()=>{
 const fake=plugin(),service=createWechatSocialComponent(phone(),()=>({default:fake.Chat}));
 const first=service.openPrivate(),second=service.openPrivate();assert.equal(first,second);
 assert.deepEqual(service.status(),{state:'loading'});assert.equal(nativeOpenCalls(fake).length,0);
 let settled=false;void first.then(()=>{settled=true;});
 fake.events.get('ready')();
 await new Promise(setImmediate);
 assert.equal(nativeOpenCalls(fake).length,1);assert.equal(settled,false);
 fake.events.get('open')();assert.equal(await first,'opened');assert.deepEqual(service.status(),{state:'ready'});
 const hidden=fake.calls.filter(call=>call==='hide').length;
 fake.events.get('close')();assert.equal(fake.calls.filter(call=>call==='hide').length,hidden+1);
 assert.equal(fake.calls.includes('close'),false);
});

test('phone errors, rejected calls and thrown calls cannot report successful opening',async()=>{
 for(const opening of [
  events=>events.get('error')({errCode:4021,errMsg:'openid=secret signature=private'}),
  ()=>Promise.reject({errCode:4021,errMsg:'openid=secret signature=private'}),
  ()=>{throw {errCode:4021,errMsg:'openid=secret signature=private'};},
 ]){
  const fake=plugin({opening}),service=await prepared(fake);
  assert.equal(await service.openPrivate(),'failed');
  assert.deepEqual(service.status(),{state:'failed',error:{kind:'opening-error',code:4021}});
  fake.events.get('open')();assert.equal(service.status().state,'failed');
 }
});

test('phone opening without its open event times out and ignores a late event',async()=>{
 const fake=plugin(),service=await prepared(fake,phone(),{openTimeoutMs:5});
 assert.equal(await service.openPrivate(),'failed');
 assert.deepEqual(service.status(),{state:'failed',error:{kind:'opening-timeout'}});
 fake.events.get('open')();assert.deepEqual(await service.prepare(),{state:'failed',error:{kind:'opening-timeout'}});
 assert.equal(await service.openPrivate(),'failed');assert.equal(nativeOpenCalls(fake).length,1);
});

test('opening rechecks state when a runtime error invalidates a cached ready snapshot',async()=>{
 const fake=plugin(),service=await prepared(fake);
 const opening=service.openPrivate();fake.events.get('error')({errCode:91});
 assert.equal(await opening,'failed');assert.equal(nativeOpenCalls(fake).length,0);
 assert.deepEqual(service.status(),{state:'failed',error:{kind:'initialization-error',code:91}});
});

test('Wechat native preparation failure does not stop genuine game network requests',async()=>{
 const oldWx=globalThis.wx,oldLoader=globalThis.requirePlugin;
 globalThis.wx={createCanvas:()=>({}),request:input=>{queueMicrotask(()=>input.success({statusCode:200,data:'{"ok":true}'}));return {};}};
 globalThis.requirePlugin=()=>{throw {errCode:55,errMsg:'private value'};};
 const config={id:'wechat',gameName:'拼图小窝',apiBase:'https://game.test/h5',assetBase:'https://game.test/h5/assets'};
 try{
  assert.equal(createWechatPlatform(config).nativeSocial,undefined);
  const platform=createWechatPlatform({...config,nativeSocialEnabled:true});
  assert.equal((await platform.nativeSocial.prepare()).state,'failed');
  assert.equal((await platform.request({url:config.apiBase+'/config'})).data.ok,true);
  assert.equal(createWechatPlatform({...config,nativeSocialEnabled:true}).nativeSocial,platform.nativeSocial);
 }finally{
  if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx;
  if(oldLoader===undefined)delete globalThis.requirePlugin;else globalThis.requirePlugin=oldLoader;
 }
});

test('isolated-context plugin declaration belongs only to the enabled Wechat build',()=>{
 const configs=JSON.parse(readFileSync(new URL('../config/mobile-platforms.json',import.meta.url),'utf8'));
 // Keep the optional component disabled after the user removed its empty entry.
 assert.equal(configs.wechat.nativeSocialEnabled,false);
 assert.equal(sharedPlatformPlugins(configs.wechat),undefined);
 assert.deepEqual(sharedPlatformPlugins({...configs.wechat,nativeSocialEnabled:true}),{MiniGameChat:{version:'latest',provider:'wx2ea687f4258401a9',contexts:[{type:'isolatedContext'}]}});
 assert.equal(sharedPlatformPlugins({...configs.wechat,nativeSocialEnabled:false}),undefined);
 assert.equal(sharedPlatformPlugins(configs.taptap),undefined);
 assert.equal(sharedPlatformPlugins({...configs.taptap,nativeSocialEnabled:true}),undefined);
});
