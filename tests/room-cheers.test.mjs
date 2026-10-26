import test from 'node:test';
import assert from 'node:assert/strict';
import {CHEER_EMOTES,CheerError,createRoomCheers} from '../lib/room-cheers.ts';
const id=n=>n.toString(16).padStart(32,'0');
const member={id:'player',name:'甲',lastSeen:1},room={id:'room',completedAt:1};
function fixture(){let now=100000;const store=createRoomCheers(()=>now);return {store,set:time=>now=time,put:(n,player=member,target=room)=>store.putCheer(target,player,{id:id(n),emote:'clap'})};}
function rejected(fn,status,code){assert.throws(fn,error=>error instanceof CheerError&&error.status===status&&error.code===code);}

test('fixed emotes, server identity, global cursor, after parsing and exact expiry',()=>{
 const f=fixture();assert.deepEqual(CHEER_EMOTES,['clap','popper','heart','star','tea','cat']);
 assert.deepEqual(f.store.cheersView('empty'),{cheers:[],cursor:100000,serverTime:100000});
 f.put(1);f.set(100001);f.put(2,member,{id:'other',completedAt:1});f.put(3);
 const view=f.store.cheersView(room.id);assert.deepEqual(view.cheers.map(c=>c.seq),[100001,100003]);assert.equal(view.cursor,100003);
 assert.deepEqual(view.cheers[0],{seq:100001,id:id(1),playerId:'player',name:'甲',emote:'clap',at:100000});
 assert.deepEqual(f.store.cheersView(room.id,'100001').cheers.map(c=>c.id),[id(3)]);
 for(const after of [undefined,null,'',-1,NaN,Infinity,'oops','1.2',{},true])assert.equal(f.store.cheersView(room.id,after).cheers.length,2);
 view.cheers[0].name='tampered';assert.equal(f.store.cheersView(room.id).cheers[0].name,'甲');
 f.set(114999);assert.equal(f.store.cheersView(room.id).cheers.length,2);
 f.set(115000);assert.deepEqual(f.store.cheersView(room.id).cheers.map(c=>c.id),[id(3)]);
 f.set(115001);assert.equal(f.store.cheersView(room.id).cheers.length,0);assert.equal(f.store.cheersView(room.id).cursor,100003);
});
test('cap keeps newest 60, dedupe is player+id and room isolated',()=>{
 const f=fixture();for(let n=1;n<=65;n++)f.put(n,{...member,id:'p'+n});
 const view=f.store.cheersView(room.id);assert.equal(view.cheers.length,60);assert.equal(view.cheers[0].id,id(6));
 assert.equal(f.put(65,{...member,id:'p65'}),false);assert.equal(f.store.cheersView(room.id).cursor,view.cursor);
 assert.equal(f.put(65,{...member,id:'other-player'}),true);assert.equal(f.put(65,member,{id:'other',completedAt:1}),true);
 f.store.forget(room.id);assert.equal(f.store.cheersView(room.id).cheers.length,0);assert.equal(f.store.cheersView('other').cheers.length,1);
 f.store.close();assert.equal(f.store.cheersView('other').cheers.length,0);
});
test('admission, completion and payload rules precede dedupe and rates',()=>{
 const f=fixture();rejected(()=>f.put(1,{...member,lastSeen:0}),409,'ROOM_ADMISSION_REQUIRED');
 for(const completedAt of [null,0,undefined])rejected(()=>f.put(1,member,{id:room.id,completedAt}),409,'ROOM_NOT_COMPLETED');
 for(const input of [null,{},[],{id:'A'.repeat(32),emote:'clap'},{id:id(1),emote:'bad'},{id:1,emote:'tea'}])rejected(()=>f.store.putCheer(room,member,input),400,'INVALID_CHEER');
 for(const [n,emote] of CHEER_EMOTES.entries())f.store.putCheer(room,{...member,id:'p'+n},{id:id(n),emote});
 assert.equal(f.store.cheersView(room.id).cheers.length,6);
});
test('four per rolling two seconds; duplicate retry is free even at the limit',()=>{
 const f=fixture();for(let n=1;n<=4;n++)f.put(n);
 assert.equal(f.put(1),false);rejected(()=>f.put(5),429,'CHEER_RATE_LIMIT');
 f.put(1,{...member,id:'another'});f.put(1,member,{id:'another-room',completedAt:1});
 f.set(101999);rejected(()=>f.put(5),429,'CHEER_RATE_LIMIT');f.set(102000);assert.equal(f.put(5),true);
});
test('40 per rolling minute survives expiry, empty-room reads and sweeping',()=>{
 const f=fixture();for(let batch=0;batch<10;batch++){f.set(100000+batch*2000);for(let n=1;n<=4;n++)f.put(batch*4+n);}
 f.set(140000);assert.equal(f.store.cheersView(room.id).cheers.length,0);rejected(()=>f.put(41),429,'CHEER_RATE_LIMIT');
 f.set(159999);rejected(()=>f.put(41),429,'CHEER_RATE_LIMIT');
 f.set(160000);for(let n=41;n<=44;n++)f.put(n);rejected(()=>f.put(45),429,'CHEER_RATE_LIMIT');
 f.set(220001);assert.equal(f.store.cheersView(room.id).cheers.length,0);assert.equal(f.put(45),true);
});
