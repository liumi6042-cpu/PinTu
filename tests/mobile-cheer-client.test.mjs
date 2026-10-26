import test from 'node:test';
import assert from 'node:assert/strict';
import {CheerClient,CHEER_LABELS} from '../mobile/cheer-client.ts';
import {CHEER_EMOTES,RoomRealtime} from '../lib/room-realtime.ts';
import {TapPreviewRealtime} from '../mobile/tap-preview.ts';

const roomId='a'.repeat(32),token='b'.repeat(32),playerId='c'.repeat(32);
const hex=n=>n.toString(16).padStart(32,'0');
const cheer=(n=1,extra={})=>({seq:n,id:hex(n),playerId:'d'.repeat(32),name:'拼友',emote:'clap',at:10000,...extra});
const snapshot=(cheers=[],cursor=0,serverTime=10000)=>({cheers,cursor,serverTime});
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function stream(connected=true){
 const cheers=new Set(),states=new Set(),sent=[];
 return {connected,sent,subscribeCheers(fn){cheers.add(fn);return()=>cheers.delete(fn);},
  subscribeState(fn){states.add(fn);return()=>states.delete(fn);},subscribeRoom(){return()=>{};},subscribeCursors(){return()=>{};},
  sendCheer(data){sent.push(data);return true;},sendCursor(){return false;},
  push(data){for(const fn of cheers)fn(data);},status(value){this.connected=value;for(const fn of states)fn(value);},
  subscriptions:()=>cheers.size+states.size};
}
function fixture(t,{realtime=null,read=()=>Response.json(snapshot())}={}){
 let now=10000,serial=1000,timerId=0;const timers=new Map(),calls=[],shown=[];
 const client=new CheerClient({roomId,token,playerId,name:'我',realtime,now:()=>now,randomId:()=>hex(++serial),
  setTimer(callback,delay){const id=++timerId;timers.set(id,{callback,at:now+delay});return id;},clearTimer:id=>timers.delete(id),
  fetch:async(url,init)=>{calls.push({url,init});return read(url,init);},onCheer:(value,own)=>shown.push({value,own}),
 });
 const advance=async ms=>{
  const end=now+ms;
  for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   now=next[1].at;timers.delete(next[0]);next[1].callback();await settle();}
  now=end;await settle();
 };
 t.after(()=>client.close());return {client,calls,shown,advance,timers};
}

test('emote order and Chinese labels match the protocol',()=>{
 assert.deepEqual(CHEER_EMOTES,['clap','popper','heart','star','tea','cat']);
 assert.deepEqual(CHEER_EMOTES.map(id=>CHEER_LABELS[id]),['鼓掌','撒花','比心','好耶','干杯','喵～']);
});

test('throttle rejects gaps below 300 ms and a fifth cheer within 2 s, with no local effect',async t=>{
 const rt=stream(),f=fixture(t,{realtime:rt});
 assert.equal(f.client.send('clap'),true);await f.advance(299);assert.equal(f.client.send('heart'),false);
 await f.advance(1);assert.equal(f.client.send('heart'),true);
 for(let i=0;i<2;i++){await f.advance(300);assert.equal(f.client.send('cat'),true);}
 await f.advance(300);assert.equal(f.client.send('popper'),false);
 await f.advance(799);assert.equal(f.client.send('popper'),false);
 assert.equal(f.shown.length,4);assert.equal(rt.sent.length,4);
 await f.advance(1);assert.equal(f.client.send('popper'),true);assert.equal(f.shown.length,5);
 assert.equal(f.client.send('unknown'),false);
});

test('own effect is immediate, realtime sends once, and echoes and duplicate pushes are deduped even while inactive',t=>{
 const rt=stream(),f=fixture(t,{realtime:rt});
 assert.equal(rt.subscriptions(),2);assert.equal(f.client.send('tea'),true);
 assert.deepEqual(f.shown[0],{value:{seq:0,id:hex(1001),playerId,name:'我',emote:'tea',at:10000},own:true});
 assert.deepEqual(rt.sent,[{id:hex(1001),emote:'tea'}]);assert.equal(f.calls.length,0);
 const other=cheer(2);rt.push(snapshot([cheer(1,{id:hex(1001),playerId}),other,other],2));
 assert.deepEqual(f.shown,[f.shown[0],{value:other,own:false}]);
 f.client.close();f.client.close();assert.equal(rt.subscriptions(),0);rt.push(snapshot([cheer(3)],3));
 assert.equal(f.client.send('cat'),false);assert.equal(f.shown.length,2);
});

test('offline POST uses room bearer auth and cursor, and applies response with own echo suppressed',async t=>{
 let f;const effectsAtRequest=[];
 f=fixture(t,{read:(_url,init)=>{
  effectsAtRequest.push(structuredClone(f.shown));
  const body=JSON.parse(init.body);return Response.json(snapshot([cheer(1,{id:body.id,playerId}),cheer(2)],7));
 }});
 assert.equal(f.client.send('star'),true);assert.equal(f.shown.length,1);await settle();
 assert.deepEqual(effectsAtRequest[0],f.shown.slice(0,1),'local effect precedes the HTTP request');
 assert.equal(f.calls[0].url,`/api/rooms/${roomId}/cheers`);
 assert.equal(f.calls[0].init.method,'POST');assert.equal(f.calls[0].init.headers.Authorization,`Bearer ${token}`);
 assert.equal(f.calls[0].init.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{id:hex(1001),emote:'star',after:0});
 assert.equal(f.shown.length,2);assert.equal(f.shown[1].own,false);
 await f.advance(300);f.client.send('clap');assert.equal(JSON.parse(f.calls[1].init.body).after,7);
});

test('connected transports that lack, reject or throw from sendCheer fall back to POST',async t=>{
 for(const mode of ['missing','false','throw']){
  const rt=stream();if(mode==='missing')delete rt.sendCheer;else rt.sendCheer=()=>{if(mode==='throw')throw Error('socket');return false;};
  const f=fixture(t,{realtime:rt});assert.equal(f.client.send('clap'),true);await settle();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'POST');assert.equal(f.shown.length,1);
 }
});

test('polls every second only while active and disconnected, and follows connection changes',async t=>{
 const rt=stream(false),f=fixture(t,{realtime:rt});await f.advance(5000);assert.equal(f.calls.length,0);
 f.client.setActive(true);await f.advance(0);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,`/api/rooms/${roomId}/cheers?after=0`);
 assert.equal(f.calls[0].init.method,'GET');assert.equal(f.calls[0].init.headers.Authorization,`Bearer ${token}`);
 await f.advance(999);assert.equal(f.calls.length,1);await f.advance(1);assert.equal(f.calls.length,2);
 rt.status(true);await f.advance(5000);assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
 rt.status(false);await f.advance(0);assert.equal(f.calls.length,3);
 f.client.setActive(false);await f.advance(5000);assert.equal(f.calls.length,3);
 f.client.setActive(true);await f.advance(0);assert.equal(f.calls.length,4);
 f.client.close();await f.advance(5000);assert.equal(f.calls.length,4);assert.equal(f.timers.size,0);
});

test('a slow poll never overlaps another GET, including popup and connection changes',async t=>{
 let resolve;const rt=stream(false),f=fixture(t,{realtime:rt,read:()=>new Promise(done=>{resolve=done;})});
 f.client.setActive(true);await f.advance(0);await f.advance(5000);assert.equal(f.calls.length,1);
 f.client.setActive(false);f.client.setActive(true);rt.status(true);rt.status(false);
 await f.advance(5000);assert.equal(f.calls.length,1);
 resolve(Response.json(snapshot()));await settle();await f.advance(999);assert.equal(f.calls.length,1);
 await f.advance(1);assert.equal(f.calls.length,2);
 const signal=f.calls[1].init.signal;f.client.close();assert.equal(signal.aborted,true);
 resolve(Response.json(snapshot([cheer(1)],1)));await settle();assert.equal(f.shown.length,0);
});

test('GET and POST 404 disable network attempts while preserving throttled local effects',async t=>{
 for(const method of ['GET','POST']){
  const f=fixture(t,{read:()=>Response.json({error:'old backend'},{status:404})});
  if(method==='GET'){f.client.setActive(true);await f.advance(0);}else{f.client.send('cat');await settle();}
  assert.equal(f.client.supported,false);assert.equal(f.calls[0].init.method,method);
  await f.advance(5000);const previous=f.shown.length;assert.equal(f.client.send('heart'),true);
  assert.equal(f.shown.length,previous+1);assert.equal(f.client.send('heart'),false);
  f.client.setActive(false);f.client.setActive(true);await f.advance(5000);
  assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
 }
});

test('network, non-404 HTTP and JSON failures are swallowed without disabling future polls',async t=>{
 let attempt=0;const f=fixture(t,{read:()=>{
  if(++attempt===1)throw Error('offline');if(attempt===2)return Response.json({}, {status:503});
  if(attempt===3)return {ok:true,status:200,json:async()=>{throw Error('bad json');}};
  return Response.json(snapshot([cheer(1)],1));
 }});
 assert.equal(f.client.send('clap'),true);await settle();f.client.setActive(true);await f.advance(0);
 await f.advance(2000);assert.equal(f.calls.length,4);assert.equal(f.client.supported,true);
 assert.equal(f.shown.length,2);
});

test('uses server time to drop old cheers, accepts the 4 s boundary, and bounds remembered IDs to 200',t=>{
 const rt=stream(),f=fixture(t,{realtime:rt});
 const recent=cheer(2,{at:46000}),fresh=cheer(3,{at:50000});
 rt.push(snapshot([cheer(1,{at:45999}),recent,fresh],3,50000));
 assert.deepEqual(f.shown.map(item=>item.value),[recent,fresh]);
 for(let i=4;i<=201;i++)rt.push(snapshot([cheer(i,{at:50000})],i,50000));
 const count=f.shown.length;rt.push(snapshot([cheer(2,{at:50000})],201,50000));assert.equal(f.shown.length,count);
 rt.push(snapshot([cheer(202,{at:50000})],202,50000));rt.push(snapshot([cheer(2,{at:50000})],202,50000));
 assert.equal(f.shown.length,count+2,'oldest IDs are evicted after 200 distinct items');
});

test('advances cursor from pushes and HTTP replies, and resets it after a server restart',async t=>{
 const rt=stream(false);let read=0;
 const f=fixture(t,{realtime:rt,read:()=>Response.json(snapshot([],++read===1?950:4))});
 rt.push(snapshot([],900));f.client.setActive(true);await f.advance(0);
 assert.ok(f.calls[0].url.endsWith('?after=900'));await f.advance(1000);
 assert.ok(f.calls[1].url.endsWith('?after=950'));await f.advance(1000);
 assert.ok(f.calls[2].url.endsWith('?after=4'));f.client.send('popper');
 assert.equal(JSON.parse(f.calls[3].init.body).after,4);
});

test('HTTP fallback ignores malformed envelopes and items without breaking polling',async t=>{
 let read=0;const f=fixture(t,{read:()=>Response.json(++read===1?{cheers:[],cursor:'bad',serverTime:10000}:snapshot([null,cheer(1,{id:'bad'}),cheer(2)],2))});
 f.client.setActive(true);await f.advance(0);assert.equal(f.shown.length,0);
 await f.advance(1000);assert.deepEqual(f.shown.map(item=>item.value.id),[hex(2)]);
});

test('RoomRealtime dispatches cheers, counts nonfatal rejections and sends the cheer wire frame',async t=>{
 const sockets=[],received=[],states=[];
 const realtime=new RoomRealtime({url:'wss://game.test/h5/realtime',credentials:async()=>({roomId,token}),
  openSocket:(_url,handlers)=>{const socket={handlers,sent:[],closed:false,send(raw){this.sent.push(JSON.parse(raw));},close(){this.closed=true;}};sockets.push(socket);return socket;}});
 t.after(()=>realtime.close());const remove=realtime.subscribeCheers(data=>received.push(data));realtime.subscribeState(state=>states.push(state));
 assert.equal(realtime.sendCheer({id:hex(1),emote:'cat'}),false);realtime.start();await settle();
 const socket=sockets[0];socket.handlers.open();socket.handlers.message('{"type":"ready"}');
 socket.handlers.message(JSON.stringify({type:'cheers',data:snapshot([cheer(1)],1)}));
 assert.deepEqual(received,[snapshot([cheer(1)],1)]);
 socket.handlers.message(JSON.stringify({type:'cheer-error',status:429,code:'CHEER_RATE_LIMIT',id:hex(2)}));
 socket.handlers.message(JSON.stringify({type:'cheer-error',status:403,code:'ROOM_FORBIDDEN'}));
 assert.equal(realtime.connected,true);assert.equal(socket.closed,false);assert.deepEqual(states,[true]);
 assert.equal(realtime.sendCheer({id:hex(2),emote:'heart'}),true);
 assert.deepEqual(socket.sent.at(-1),{type:'cheer',data:{id:hex(2),emote:'heart'}});
 assert.equal(realtime.diagnostics().cheerMessages,1);assert.equal(realtime.diagnostics().cheerErrors,2);assert.equal(realtime.diagnostics().sentCheers,1);
 remove();socket.handlers.message(JSON.stringify({type:'cheers',data:snapshot([],2)}));assert.equal(received.length,1);
 realtime.setHidden(true);assert.equal(realtime.sendCheer({id:hex(3),emote:'tea'}),false);
 realtime.close();assert.equal(realtime.sendCheer({id:hex(3),emote:'tea'}),false);
});

test('malformed cheers never disconnect RoomRealtime and invalid items are filtered individually',async t=>{
 let socket;const received=[],realtime=new RoomRealtime({url:'wss://game.test/h5/realtime',credentials:async()=>({roomId,token}),
  openSocket:(_url,handlers)=>(socket={handlers,send(){},close(){}})});
 t.after(()=>realtime.close());realtime.subscribeCheers(data=>received.push(data));realtime.start();await settle();
 socket.handlers.open();socket.handlers.message('{"type":"ready"}');
 const push=data=>socket.handlers.message(JSON.stringify({type:'cheers',data}));
 for(const data of [null,[],{},snapshot([],1.5),snapshot([],1,Infinity),snapshot(Array(61).fill(cheer()))]){
  push(data);assert.equal(realtime.connected,true);
 }
 assert.equal(received.length,0);
 const invalid=[null,[],cheer(2,{seq:1.5}),cheer(3,{seq:Number.MAX_SAFE_INTEGER+1}),cheer(4,{id:'A'.repeat(32)}),
  cheer(5,{id:'a'.repeat(31)}),cheer(6,{playerId:3}),cheer(7,{name:null}),cheer(8,{emote:'invalid'}),cheer(9,{at:NaN})];
 push(snapshot([...invalid,cheer(10)],10));assert.deepEqual(received,[snapshot([cheer(10)],10)]);
 push(snapshot([],11));assert.deepEqual(received[1],snapshot([],11));
 const remove=realtime.subscribeCheers(()=>{throw Error('effect listener');});push(snapshot([],12));remove();assert.equal(realtime.connected,true);
});

test('TapPreviewRealtime passes cheers directly to authority and supports older authority implementations',t=>{
 for(const supported of [true,false]){
  const authority=stream(),shown=[];authority.start=()=>{};authority.close=()=>{};authority.setHidden=()=>{};authority.diagnostics=()=>({});
  if(!supported){delete authority.subscribeCheers;delete authority.sendCheer;}
  const preview=new TapPreviewRealtime({authority,manager:()=>undefined,request:async()=>{throw Error('unused');},
   room:{serverTime:10000,members:[],leases:{},completedAt:10000},playerId,randomId:()=>hex(1),now:()=>10000});
  t.after(()=>preview.close());const remove=preview.subscribeCheers(data=>shown.push(data));
  authority.push(snapshot([cheer(1)],1));assert.equal(shown.length,supported?1:0);
  assert.equal(preview.sendCheer({id:hex(2),emote:'star'}),supported);
  if(supported)assert.deepEqual(authority.sent,[{id:hex(2),emote:'star'}]);
  remove();authority.push(snapshot([cheer(3)],3));assert.equal(shown.length,supported?1:0);
 }
});
