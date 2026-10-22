import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';
import {GUEST_NAMES,guestName} from '../server/guest-names.mjs';

const actor=name=>createHash('sha256').update(name).digest('hex');
const setup=options=>{const service=createMobileService({now:()=>1800000000000,randomInt:min=>min,...options});return (owner,path,body)=>service.handle({identity:owner,method:body===undefined?'GET':'POST',url:path,body:body===undefined?undefined:{requestId:randomBytes(16).toString('hex'),...body}});};

test('the guest name list is about a hundred short, distinct names',()=>{
 assert.ok(GUEST_NAMES.length>=90&&GUEST_NAMES.length<=120);
 assert.equal(new Set(GUEST_NAMES).size,GUEST_NAMES.length);
 for(const name of GUEST_NAMES)assert.ok(name.length>=1&&name.length<=4,name);
});

test('a name is stable for an identity and gains two digits when taken',()=>{
 const id=actor('stable');assert.equal(guestName(id,()=>false),guestName(id,()=>false));
 const base=guestName(id,()=>false),other=guestName(id,name=>name===base);
 assert.ok(other.startsWith(base)&&/^[0-9]{2}$/.test(other.slice(base.length)),other);
});

test('new Web guests get a soft name that survives later reads; existing players keep theirs',()=>{
 const call=setup({runtimeProfile:'web'}),a=actor('web-a');
 const first=call(a,'/api/mobile/profile').data.name;
 assert.ok(GUEST_NAMES.some(name=>first===name||first.startsWith(name)),first);
 call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});
 assert.equal(call(a,'/api/mobile/profile').data.name,first);
 const names=new Set();for(let i=0;i<30;i++)names.add(call(actor('web-many-'+i),'/api/mobile/profile').data.name);
 assert.ok(names.size>=20,'names spread over the list');
});

test('mobile (TapTap) profiles keep the default until the platform nickname arrives',()=>{
 const call=setup({});assert.equal(call(actor('tap-a'),'/api/mobile/profile').data.name,'拼图朋友');
});

test('a taken name is not handed to a second Web guest',()=>{
 const call=setup({runtimeProfile:'web'}),seen=new Map();
 for(let i=0;i<160;i++){const owner=actor('crowd-'+i),name=call(owner,'/api/mobile/profile').data.name;call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.ok(!seen.has(name)||seen.get(name)===owner,'duplicate '+name);seen.set(name,owner);}
});
