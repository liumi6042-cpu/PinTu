import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cursorInput, cursorWorld, cursorScreen } from '../lib/room-cursors.ts';
import { CursorClient } from '../lib/cursor-client.ts';
import { requiresRoomMembership, canCreateMemberRoom } from '../lib/membership-policy.ts';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('LAN HTTP crypto without randomUUID can create distinct cursor sessions and publish updates',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const originalCrypto=globalThis.crypto,originalFetch=globalThis.fetch,sent=[],clients=[];
  try{
    // LAN HTTP exposes getRandomValues, but not the secure-context-only randomUUID API.
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:originalCrypto.getRandomValues.bind(originalCrypto)}});
    assert.equal(globalThis.crypto.randomUUID,undefined);
    globalThis.fetch=async(url,options={})=>{
      if(options.body)sent.push(JSON.parse(options.body));
      return Response.json({cursors:[],serverTime:Date.now()});
    };
    for(let i=0;i<2;i++){
      const client=new CursorClient('room','token','player'+i,()=>{},()=>true);clients.push(client);
      client.start();client.point({x:100+i,y:200});
    }
    const deadline=Date.now()+2000;
    while(sent.length<2){assert.ok(Date.now()<deadline,'both cursor clients should publish');await wait(10);}
    const first=sent.slice();
    assert.equal(new Set(first.map(body=>body.clientId)).size,2);
    for(const body of first){assert.match(body.clientId,/^[a-f0-9]{32}$/);assert.ok(cursorInput(body));}
    clients.forEach(client=>client.stop());
    for(const body of first){
      const updates=sent.filter(update=>update.clientId===body.clientId);
      assert.equal(updates.length,2);assert.equal(updates[1].point,null);assert.ok(updates[1].seq>body.seq);
    }
  }finally{
    clients.forEach(client=>client.stop());globalThis.fetch=originalFetch;
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});

test('cursor positions use world coordinates across different zooms and reject invalid payloads',()=>{
  const world=cursorWorld({x:410,y:300},{left:10,top:20,width:900,height:600},{x:100,y:80,z:2});
  assert.deepEqual(world,{x:150,y:100});assert.deepEqual(cursorScreen(world,{x:-50,y:10,z:.5}),{x:25,y:60});
  const valid={clientId:'a'.repeat(32),seq:1,point:world};assert.deepEqual(cursorInput(valid),valid);
  for(const point of [{x:NaN,y:0},{x:-1,y:0},{x:1521,y:0},{x:0,y:1121},{x:'3',y:0},undefined])assert.equal(cursorInput({...valid,point}),null);
  assert.ok(cursorInput({...valid,point:null}));assert.equal(cursorInput({...valid,seq:Infinity}),null);
});
test('member gate covers private and legacy invitations, while public and solo creation remain free',()=>{
  for(const visibility of ['private',undefined])assert.equal(requiresRoomMembership(visibility),true);
  assert.equal(requiresRoomMembership('public'),false);assert.equal(requiresRoomMembership('solo'),false);assert.equal(canCreateMemberRoom(),false);
});
test('cursor tombstones prevent an older in-flight update reappearing after pointer leave',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec(readFileSync(new URL('../drizzle/0002_room_cursors.sql',import.meta.url),'utf8'));
    db.prepare('INSERT INTO puzzle_room_cursors VALUES (?,?,?,?,?,?,?)').run('r','p','c',2,null,null,100);
    const upsert=db.prepare(`INSERT INTO puzzle_room_cursors VALUES (?,?,?,?,?,?,?) ON CONFLICT(room_id,player_id) DO UPDATE SET seq=excluded.seq,x=excluded.x,y=excluded.y WHERE puzzle_room_cursors.client_id!=excluded.client_id OR excluded.seq>puzzle_room_cursors.seq`);
    upsert.run('r','p','c',1,30,40,99);assert.equal(db.prepare('SELECT x FROM puzzle_room_cursors').get().x,null);
  }finally{db.close();}
});
test('high frequency pointer events coalesce, do not enter puzzle actions, and hide on stop',async()=>{
  const original=globalThis.fetch,sent=[],seen=[];
  globalThis.fetch=async(url,options={})=>{sent.push({url,time:performance.now(),body:options.body?JSON.parse(options.body):null});await wait(35);return Response.json({cursors:[{playerId:'me',x:2,y:3},{playerId:'other',x:40,y:50,name:'友',color:'#ddd',updatedAt:Date.now()}]});};
  const client=new CursorClient('room','token','me',cursors=>seen.push(cursors),()=>true);client.start();
  try{
    for(let i=0;i<100;i++){client.point({x:i,y:30});await wait(2);}
    await wait(300);assert.ok(sent.length<20);for(let i=1;i<sent.length;i++)assert.ok(sent[i].time-sent[i-1].time>=180,'pointer requests must be throttled');assert.ok(sent.every(item=>item.url.endsWith('/cursors')));
    assert.ok(seen.every(cursors=>cursors.every(cursor=>cursor.playerId!=='me')));
    client.stop();await wait(60);assert.equal(sent.at(-1).body.point,null);
    assert.equal(sent.filter(item=>item.body).at(-2).body.point.x,99);
  }finally{client.stop();globalThis.fetch=original;}
});
