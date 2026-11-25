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

test('mobile players without a platform nickname get a random name too',()=>{
 const call=setup({}),name=call(actor('tap-a'),'/api/mobile/profile').data.name;
 assert.notEqual(name,'拼图朋友');assert.ok(GUEST_NAMES.some(base=>name===base||name.startsWith(base)),name);
});

test('TapTap binding keeps an authorized nickname and falls back to a random one without it',async()=>{
 let open=0;const service=createMobileService({now:()=>1800000000000,randomInt:min=>min,tapTap:{exchangeCode:async()=>({openid:'open-'+(++open)})}});
 const bind=(owner,nickname)=>service.bindTapTap({identity:owner,code:'code-'+randomBytes(6).toString('hex'),...(nickname===undefined?{}:{nickname})});
 const named=await bind(actor('tap-named'),'阿树');assert.equal(named.status,200,JSON.stringify(named.data));
 assert.equal(named.data.profile.name,'阿树');
 const anonymous=await bind(actor('tap-anonymous'));assert.equal(anonymous.status,200);
 assert.notEqual(anonymous.data.profile.name,'拼图朋友');assert.ok(GUEST_NAMES.some(base=>anonymous.data.profile.name.startsWith(base)));
});

test('an existing player still called 拼图朋友 is renamed on the next visit; chosen names stay',async()=>{
 const {mkdtempSync,mkdirSync,rmSync}=await import('node:fs');const {resolve}=await import('node:path');const {DatabaseSync}=await import('node:sqlite');
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/guest-names-')),databasePath=resolve(dir,'mobile.sqlite');
 let service;
 try{
  service=createMobileService({databasePath,now:()=>1800000000000,randomInt:min=>min});const call=(owner,path)=>service.handle({identity:owner,method:'GET',url:path});
  const old=actor('old-default'),kept=actor('old-custom'),tap=actor('old-tap');call(old,'/api/mobile/profile');call(kept,'/api/mobile/profile');call(tap,'/api/mobile/profile');
  const db=new DatabaseSync(databasePath),set=(id,patch)=>{const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(id).data);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...p,...patch}),id);};
  set(old,{name:'拼图朋友'});set(kept,{name:'山间小屋'});set(tap,{name:'拼图朋友',nameSource:'taptap'});db.close();
  const renamed=call(old,'/api/mobile/profile').data.name;assert.notEqual(renamed,'拼图朋友');assert.equal(call(old,'/api/mobile/profile').data.name,renamed);
  assert.equal(call(kept,'/api/mobile/profile').data.name,'山间小屋');
  assert.equal(call(tap,'/api/mobile/profile').data.name,'拼图朋友','a platform-provided name is never replaced');
 }finally{service?.close();rmSync(dir,{recursive:true,force:true});}
});

test('a taken name is not handed to a second Web guest',()=>{
 const call=setup({runtimeProfile:'web'}),seen=new Map();
 for(let i=0;i<160;i++){const owner=actor('crowd-'+i),name=call(owner,'/api/mobile/profile').data.name;call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.ok(!seen.has(name)||seen.get(name)===owner,'duplicate '+name);seen.set(name,owner);}
});
