import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebPlatform} from '../mobile/platform-web.ts';
import {GameClient} from '../mobile/client.ts';
import {RoomClient} from '../lib/room-client.ts';
import {makeFixtureRoom} from './legacy-fixtures.mjs';
import {addMember,applyAction,snapshot} from '../lib/room-engine.ts';

const base='https://game.test/h5-mobile-v3',config={mobileMode:'mobile-v3-isolated',adRewardEnabled:true,rewardedAdUnitId:'test-unit'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{browser,native}={}){
 const calls=[],memory=new Map([['jigsaw:h5-session:'+base,'a'.repeat(64)]]),pending=[];
 const values={document:{baseURI:'https://ma-h5-al.tapimg.com/game/'},location:{href:'https://ma-h5-al.tapimg.com/game/',origin:'https://ma-h5-al.tapimg.com'},
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)},
  sessionStorage:{getItem:()=>null,setItem(){}},
  window:{tap:{request(options){calls.push({transport:'native',options});
   if(native)queueMicrotask(()=>native(options));else pending.push(options);return {abort(){}};
  }}},fetch:async(url,init)=>{calls.push({transport:'browser',url,init});return browser?browser(url,init):Response.json(config);}};
 for(const [key,value]of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);}
 t.after(()=>{for(const options of pending)options.success({statusCode:200,data:config,header:{}});});
 const port=createWebPlatform({id:'taptap',gameName:'拼图小窝',apiBase:base,assetBase:base+'/assets'},{style:{}});
 return {port,calls};
}

test('TapTap room claim, movement and confirmed merge avoid a stalled host bridge after a successful browser probe',async t=>{
 const room=makeFixtureRoom('1'.repeat(32),'seaside-native-v2',12,Date.now()),player=addMember(room,'b'.repeat(32),'拼友','digest',Date.now()),actions=[];
 const f=fixture(t,{browser:async(url,init)=>{
  if(url===base+'/config')return Response.json(config);
  assert.equal(init.headers['X-Jigsaw-H5-Session'],'a'.repeat(64));
  assert.equal(init.headers.Authorization,'Bearer '+'c'.repeat(32));
  const action=init.body?JSON.parse(init.body):null;
  if(action){actions.push(action);applyAction(room,player,action,Date.now());room.revision++;}
  return Response.json(snapshot(room,Date.now()));
 }});
 await f.port.request({url:base+'/config'});
 const client=new GameClient(f.port),roomClient=new RoomClient({token:'c'.repeat(32),playerId:player.id,room:snapshot(room,Date.now())},{fetch:client.fetchLike,randomId:()=>f.port.randomId(),hidden:()=>false,emit(){}});
 const table={networkReady:true,cancelNetworkDrag(){},syncRemote(next){roomClient.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
 const detach=roomClient.attach(table);t.after(detach);
 const started=performance.now();
 assert.equal(await table.network.acquire(0),true);
 table.network.move(0,100,100);await tick();await table.network.drop(0,0,0);
 assert.ok(roomClient.state.groups.some(group=>group.locked&&group.pieces.includes(0)),'only the server-accepted merge is rendered');
 assert.ok(performance.now()-started<500,'drop must not wait for the unresolved native config request');
 assert.ok(actions.some(action=>action.type==='move'));assert.ok(actions.some(action=>action.type==='drop'));
 assert.equal(f.calls.filter(call=>call.transport==='native').length,1,'no gameplay writes cross the slow bridge');
 const probe=f.calls.find(call=>call.transport==='browser');
 assert.equal(probe.init.credentials,'omit');assert.equal(probe.init.headers.Authorization,'');assert.equal(probe.init.headers['X-Jigsaw-H5-Session'],'');
 t.diagnostic('The native bridge remains unresolved while the real RoomClient completes claim/move/drop and renders the server merge.');
});

test('blocked browser CORS falls back to the native host and HTTP refusals are never replayed',async t=>{
 const f=fixture(t,{browser:async()=>{throw new TypeError('Failed to fetch');},native:options=>options.success({statusCode:options.url.endsWith('/config')?200:409,data:options.url.endsWith('/config')?config:{error:'这组拼块正被另一位玩家移动'},header:{}})});
 await f.port.request({url:base+'/config'});
 const reply=await f.port.request({url:base+'/api/rooms/test',method:'POST',body:{type:'claim',groupId:1}});
 assert.equal(reply.status,409);assert.equal(f.calls.filter(call=>call.transport==='browser').length,1);
 assert.equal(f.calls.filter(call=>call.transport==='native'&&call.options.method==='POST').length,1);
});

test('the faster native config path remains selected when browser setup is slower',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,{browser:()=>pending,native:options=>options.success({statusCode:200,data:config,header:{}})});
 await f.port.request({url:base+'/config'});release(Response.json(config));await tick();
 await f.port.request({url:base+'/api/mobile/profile'});
 assert.equal(f.calls.filter(call=>call.transport==='browser').length,1);
 assert.equal(f.calls.filter(call=>call.transport==='native').length,2);
});

test('failed browser writes are not replayed; only subsequent reads can recover via the native host',async t=>{
 let writes=0;
 const f=fixture(t,{browser:async(url,init)=>{if(init.method==='POST'){writes++;throw Error('connection lost after send');}return Response.json(config);},native:options=>options.success({statusCode:200,data:config,header:{}})});
 // Hold the host response until after the browser wins the initial config race.
 let release;window.tap.request=options=>{f.calls.push({transport:'native',options});release=()=>options.success({statusCode:200,data:config,header:{}});return {};};
 await f.port.request({url:base+'/config'});release();await tick();
 window.tap.request=options=>{f.calls.push({transport:'native',options});queueMicrotask(()=>options.success({statusCode:200,data:config,header:{}}));return {};};
 await assert.rejects(f.port.request({url:base+'/api/mobile/supply/redeem',method:'POST',body:{requestId:'stable'}}),/connection lost/);
 assert.equal(writes,1);assert.equal(f.calls.filter(call=>call.transport==='native'&&call.options.method==='POST').length,0);
 await f.port.request({url:base+'/api/mobile/profile'});assert.equal(f.calls.at(-1).transport,'native');
});

test('browser read failure can fall back without retrying an HTTP refusal or another write',async t=>{
 let mode='ok';const pending=[];
 const f=fixture(t,{browser:async()=>{if(mode==='offline')throw Error('network lost');return Response.json(mode==='refused'?{error:'not authorized'}:config,{status:mode==='refused'?403:200});},native:options=>pending.push(options)});
 await f.port.request({url:base+'/config'});pending.shift().success({statusCode:200,data:config,header:{}});
 mode='refused';assert.equal((await f.port.request({url:base+'/api/mobile/profile'})).status,403);assert.equal(pending.length,0);
 mode='offline';const read=f.port.request({url:base+'/api/mobile/profile'});await tick();assert.equal(pending.length,1);pending.shift().success({statusCode:200,data:{ok:true},header:{}});assert.equal((await read).status,200);
});
