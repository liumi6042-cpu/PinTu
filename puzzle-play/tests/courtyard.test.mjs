import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {SqliteD1} from '../server/sqlite.mjs';
const dir=mkdtempSync(resolve(tmpdir(),'courtyard-test-')),db=new SqliteD1(resolve(dir,'test.sqlite'),resolve('drizzle'));
globalThis.__gardenEnv={PUZZLE_DB:db};
registerHooks({resolve(s,c,next){if(s==='cloudflare:workers')return {url:'test:cloudflare',shortCircuit:true};if(s.startsWith('.')&&!/\.[cm]?[jt]s$/.test(s)){try{return next(s+'.ts',c);}catch{}}return next(s,c);},load(u,c,next){if(u==='test:cloudflare')return {format:'module',source:'export const env=globalThis.__gardenEnv;',shortCircuit:true};return next(u,c);}});
const {gardenFor,gardenAction,settleGarden}=await import('../lib/courtyard-store.ts');
const {defs,validateLayout,snap,initialGarden}=await import('../lib/courtyard-model.mjs');
const user='a'.repeat(32),peer='b'.repeat(32);for(const id of [user,peer])db.sql.prepare('INSERT INTO puzzle_users(id,username,name,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)').run(id,id,id,'x','x',Date.now());
let n=0;const call=async(action,extra={})=>gardenAction(user,{action,version:(await gardenFor(user)).version,requestId:(++n).toString(16).padStart(32,'0'),...extra});
test('concurrent rewards, exchange caps, idempotency, cloud version and valid grid footprints',async()=>{try{
 assert.equal((await gardenFor(user)).state.balance,0);
 const checks=await Promise.allSettled([call('checkin'),call('checkin')]);assert.equal(checks.filter(x=>x.status==='fulfilled').length,1);assert.equal((await gardenFor(user)).state.balance,1);
 const room={id:'c'.repeat(32),completedAt:Date.now()+1,puzzle:{cols:26,rows:19,imageId:'test-picture'},achievements:{contributors:{[user]:{count:5},[peer]:{count:5}}}};
 await Promise.all([settleGarden(room),settleGarden(room)]);let x=await gardenFor(user);assert.equal(x.state.progress,15);assert.equal(x.state.balance,2);
 await assert.rejects(call('hatch'));await settleGarden({...room,id:'2'.repeat(32)});
 const hatchReady=(await gardenFor(user)).state;assert.equal(hatchReady.progress,25);hatchReady.progress=50;const cosmeticIds=(await import('../public/cosmetics/catalog.mjs')).styles.map(s=>s.id);hatchReady.cosmetics={bubbles:cosmeticIds,cursors:cosmeticIds,equipped:{bubble:null,cursor:null}};db.sql.prepare('UPDATE puzzle_courtyards SET data=? WHERE user_id=?').run(JSON.stringify(hatchReady),user);
 await call('hatch');x=await gardenFor(user);assert.equal(x.state.progress,0);assert.equal(x.state.balance,2);assert.equal(Object.values(x.state.owned).reduce((a,b)=>a+b,0),1);assert.deepEqual(x.state.redeemed,{});
 const saved=x.state; saved.balance=5;db.sql.prepare('UPDATE puzzle_courtyards SET data=? WHERE user_id=?').run(JSON.stringify(saved),user);
 await assert.rejects(call('buy',{item:'constructor'}));await assert.rejects(call('theme-buy',{item:'__proto__'}));
 await call('buy',{item:'plant'});assert.equal((await gardenFor(user)).state.redeemed.plant,1);await assert.rejects(call('buy',{item:'plant'}));
 await assert.rejects(gardenAction(user,{action:'layout',version:0,requestId:'f'.repeat(32),layout:[]}));
 const op='d'.repeat(32),version=(await gardenFor(user)).version;await gardenAction(user,{action:'layout',requestId:op,version,layout:[]});await gardenAction(user,{action:'layout',requestId:op,version,layout:[]});assert.equal((await gardenFor(user)).version,version+1);
 await assert.rejects(call('layout',{layout:[{id:1,type:'plant',x:0,y:0}]}));
 const state=(await gardenFor(user)).state;state.balance=1000;db.sql.prepare('UPDATE puzzle_courtyards SET data=? WHERE user_id=?').run(JSON.stringify(state),user);
 for(let i=1;i<10;i++)await call('buy',{item:'plant'});await assert.rejects(call('buy',{item:'plant'}));assert.equal((await gardenFor(user)).state.redeemed.plant,10);
 for(const type of Object.keys(defs)){let found=null;for(let y=250;y<870&&!found;y+=12)for(let x=150;x<1380;x+=24){let q=snap(type,x,y);try{validateLayout([{id:1,type,x:q.x,y:q.y}],{[type]:1});found=q;break;}catch{}}assert.ok(found,type+' has a valid footprint');}
 const low={...room,id:'e'.repeat(32),achievements:{contributors:{[user]:{count:4}}}};const before=(await gardenFor(user)).state.progress;await settleGarden(low);assert.equal((await gardenFor(user)).state.progress,before+20);
 const second={...room,id:'1'.repeat(32)};await settleGarden(second);assert.equal((await gardenFor(user)).state.progress,before+30);
 const hatchBoundary=(await gardenFor(user)).state;hatchBoundary.progress=200;db.sql.prepare('UPDATE puzzle_courtyards SET data=? WHERE user_id=?').run(JSON.stringify(hatchBoundary),user);
 await call('hatch');assert.equal((await gardenFor(user)).state.progress,100);await assert.rejects(call('hatch'));
 const fresh=initialGarden();assert.deepEqual(fresh.owned,{});assert.deepEqual(fresh.layout,[]);assert.deepEqual(fresh.themes,['wood']);assert.equal(fresh.activeTheme,'wood');
 const legacy={...fresh,balance:77,progress:45,owned:{plant:5,chair:1,lamp:2,lemon:1},redeemed:{plant:2,lemon:1},layout:[{id:1,type:'plant',x:1,y:2},{id:2,type:'plant',x:3,y:4},{id:3,type:'plant',x:5,y:6},{id:4,type:'chair',x:7,y:8},{id:5,type:'lemon',x:9,y:10}],themes:['wood','country']};delete legacy.inventoryVersion;
 db.sql.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=?').run(JSON.stringify(legacy),user);
 const beforeVersion=db.sql.prepare('SELECT version FROM puzzle_courtyards WHERE user_id=?').get(user).version;
 const migrated=await Promise.all(Array.from({length:6},()=>gardenFor(user)));for(const g of migrated){assert.equal(g.version,beforeVersion+1);assert.deepEqual(g.state.owned,{plant:2,lemon:1});assert.deepEqual(g.state.layout,legacy.layout.filter(i=>[1,2,5].includes(i.id)));assert.equal(g.state.balance,77);assert.equal(g.state.progress,45);assert.deepEqual(g.state.themes,legacy.themes);}
 await assert.rejects(gardenAction(user,{action:'layout',version:beforeVersion,requestId:'f1'.repeat(16),layout:[]}),/其他页面/);
 assert.equal((await gardenFor(user)).version,beforeVersion+1,'inventory upgrade runs exactly once');

 const peerState=(await gardenFor(peer)).state;peerState.cosmetics={bubbles:cosmeticIds,cursors:cosmeticIds,equipped:{bubble:null,cursor:null}};peerState.progress=150;peerState.owned=Object.fromEntries(Object.keys(defs).map(id=>[id,1]));peerState.redeemed=Object.fromEntries(Object.keys(defs).map(id=>[id,10]));peerState.balance=77;peerState.hatched=0;peerState.dailyHatches=0;peerState.day=new Date().toISOString().slice(0,10);
 db.sql.prepare('UPDATE puzzle_courtyards SET data=? WHERE user_id=?').run(JSON.stringify(peerState),peer);
 const peerVersion=(await gardenFor(peer)).version,hatchRequest={action:'hatch',requestId:'ab'.repeat(16),version:peerVersion,item:'wood'};
 await Promise.all([gardenAction(peer,hatchRequest),gardenAction(peer,hatchRequest)]);const reward=(await gardenFor(peer));assert.equal(reward.version,peerVersion+1);assert.equal(reward.state.progress,100);assert.equal(reward.state.balance,77);assert.deepEqual(reward.state.redeemed,peerState.redeemed);assert.ok(Object.hasOwn(defs,reward.state.lastHatch.item));assert.equal(reward.state.lastHatch.requestId,hatchRequest.requestId);assert.equal(Object.values(reward.state.owned).reduce((a,b)=>a+b,0),Object.keys(defs).length+1);assert.equal(reward.state.owned[reward.state.lastHatch.item],2);
 await gardenAction(peer,hatchRequest);assert.equal((await gardenFor(peer)).version,reward.version,'retry does not award a second item');assert.deepEqual((await gardenFor(peer)).state.owned,reward.state.owned,'newly hatched inventory survives reads');
 }finally{db.close();}});
