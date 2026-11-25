import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';
import {shareOnTapTap,tapShareScene,TAPTAP_SHARE_TEMPLATE_ID} from '../mobile/taptap-share.ts';
import {TaskShareReward} from '../mobile/task-share-reward.ts';
import {build} from 'esbuild';
const appBuild=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(appBuild.outputFiles[0].text).toString('base64'));
const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64);

test('TapTap panel-open success cannot reward; only a later share channel callback completes, once',async()=>{
 let listener,shown,off=0,settled=false;const host={onShareMessage:value=>listener=value,offShareMessage:()=>off++,showShareboard:value=>{shown=value;value.success({errMsg:'ok'});}};
 const share=shareOnTapTap(host,{room:'1',ref:'invite'}).then(value=>(settled=true,value));await Promise.resolve();assert.equal(settled,false);
 assert.equal(shown.templateId,TAPTAP_SHARE_TEMPLATE_ID);assert.equal(shown.templateId,'ST1792415349659O9SC25PR4');
 assert.deepEqual(JSON.parse(shown.sceneParam),{room:'1',ref:'invite'});listener.success({});await Promise.resolve();assert.equal(settled,false);
 listener.success({channel:'wechat'});assert.equal(await share,'shared');listener.success({channel:'qq'});assert.equal(off,1);
});
test('copy, cancellation, absent host and failed panel never report a completed share',async()=>{
 for(const [event,expected]of [[{channel:'copy_link'},'copied'],[{fail:true,errMsg:'cancel'},'cancelled'],[{fail:true,errMsg:'unsupported'},'unavailable']]){
  const host={onShareMessage(listener){if(event.fail)listener.fail(event);else listener.success(event);},offShareMessage(){},showShareboard(){}};assert.equal(await shareOnTapTap(host,{}),expected);
 }
 assert.equal(await shareOnTapTap(undefined,{}),'unavailable');assert.deepEqual(tapShareScene('{"room":"room-id","ref":"friend","session":"secret"}'),{room:'room-id',ref:'friend'});
});
test('copy/open/cancel cannot complete invitation tasks, and old copied-link pending records are ignored',async()=>{
 const storage=new Map([['jigsaw:shared:pending-share:https://test.invalid','a'.repeat(32)]]);let claims=0;
 const reward=new TaskShareReward({config:{apiBase:'https://test.invalid'},storage:{get:k=>storage.get(k),set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},randomId:rid},async()=>{claims++;return {};});
 assert.equal(reward.pending(),null);for(const result of ['copied','opened','cancelled','unavailable'])assert.equal(await reward.complete(result),null);assert.equal(claims,0);await reward.complete('shared');assert.equal(claims,1);
});
function fixture(t){
 mkdirSync('work',{recursive:true});const directory=mkdtempSync(resolve('work/share-rewards-')),databasePath=resolve(directory,'synthetic.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,adEnabled:false,now:()=>now}),db=new DatabaseSync(databasePath);
 const call=(who,url,body,token)=>service.handle({identity:who,url,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined});
 const set=(who,kind,stock)=>{call(who,'/api/mobile/profile');const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(who).data);p.supply[kind]=stock;p.firstRoomCompleted=true;p.starterSelectionAvailable=false;db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),who);};
 t.after(()=>{db.close();service.close();rmSync(directory,{recursive:true,force:true});});return {service,call,set,advance:()=>now+=31000};
}
test('each real shared supply grants exactly one at partial inventories; no ads, no cross-owner or old receipt refill',t=>{
 const f=fixture(t);assert.equal(f.service.capabilities.ads,false);assert.equal(f.service.capabilities.shareRewards,true);
 for(const kind of ['create','energy'])for(const stock of [0,1,2]){
  f.set(owner,kind,stock);const input={kind,context:'supply',requestId:rid()},challenge=f.call(owner,'/api/mobile/share/challenge',input);assert.equal(challenge.status,200);
  const body={...input,rewardToken:challenge.data.rewardToken,completed:true};f.set(peer,kind,0);assert.equal(f.call(peer,'/api/mobile/share/redeem',body).status,403);
  assert.equal(f.call(owner,'/api/mobile/share/redeem',{...body,completed:false}).status,403);
  assert.equal(f.call(owner,'/api/mobile/share/redeem',body).data.supply[kind],stock+1);
  assert.equal(f.call(owner,'/api/mobile/share/redeem',body).status,200);assert.equal(f.call(owner,'/api/mobile/profile').data.supply[kind],stock+1);
  f.set(owner,kind,0);f.call(owner,'/api/mobile/share/redeem',body);assert.equal(f.call(owner,'/api/mobile/profile').data.supply[kind],0,'replayed old share cannot replenish spent stock');
 }
 assert.equal(f.call(owner,'/api/mobile/supply/challenge',{kind:'create',requestId:rid()}).data.code,'ADS_UNAVAILABLE');
 assert.equal(f.call(owner,'/api/mobile/invitations/share',{requestId:rid()}).data.code,'SHARE_REQUIRED');
});
test('cancelled shares release inventory reservations and cannot later redeem',t=>{
 const f=fixture(t);f.set(owner,'create',0);
 for(let n=0;n<4;n++){const input={context:'supply',kind:'create',requestId:rid()},c=f.call(owner,'/api/mobile/share/challenge',input);assert.equal(c.status,200);const body={...input,rewardToken:c.data.rewardToken};assert.equal(f.call(owner,'/api/mobile/share/cancel',body).status,200);assert.equal(f.call(owner,'/api/mobile/share/redeem',{...body,completed:true}).data.code,'SHARE_EXPIRED');}
 assert.equal(f.call(owner,'/api/mobile/profile').data.supply.create,0);
});
test('room tools preserve two free uses and then require a matching room/token share for 30 seconds',t=>{
 const f=fixture(t);f.set(owner,'create',3);const ticket=f.call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'private',requestId:rid()}).data;
 assert.ok(ticket.token);const context='room/'+ticket.room.id,path='/api/rooms/'+ticket.room.id+'/assistance';
 for(let n=0;n<2;n++){assert.equal(f.call(owner,path,{kind:'underlay',requestId:rid()},ticket.token).status,200);f.advance();}
 assert.equal(f.call(owner,path,{kind:'underlay',requestId:rid()},ticket.token).data.code,'SHARE_REQUIRED');
 const input={context,kind:'underlay',requestId:rid()},c=f.call(owner,'/api/mobile/share/challenge',input,ticket.token);assert.equal(c.status,200);
 const body={...input,rewardToken:c.data.rewardToken,completed:true};assert.equal(f.call(owner,path,{...body,rewardToken:'f'.repeat(64)},ticket.token).status,403);
 const result=f.call(owner,path,body,ticket.token);assert.equal(result.status,200);assert.equal(result.data.grants[0].expiresAt-result.data.serverTime,30000);
 f.advance();assert.equal(f.call(owner,path,body,ticket.token).status,200);assert.equal(f.call(owner,path,undefined,ticket.token).data.grants.length,0,'replay does not extend a grant');
});
test('shared supply UI never invokes ads, and ambiguous redemption retries do not open a second share',async()=>{
 for(const outcome of ['copied','cancelled','unavailable','shared']){
  const app=Object.create(GameApp.prototype),memory=new Map(),calls=[],completed=new Set();let shares=0,lose=true;
  app.run=fn=>fn();app.note=()=>{};app.tasks=null;app.room=null;const profile={code:'123456789',supply:{create:0,energy:0}};
  app.platform={config:{apiBase:'https://test.invalid',gameName:'test'},randomId:rid,storage:{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},share:async()=>{shares++;return outcome;},watchAd:()=>{throw Error('Ads must not be invoked');}};
  app.client={profile,config:{capabilities:{shareRewards:true}},post:async(path,body)=>{calls.push(path);if(path.endsWith('/challenge'))return {rewardToken:'f'.repeat(64)};if(path.endsWith('/redeem')){if(!completed.has(body.requestId)){completed.add(body.requestId);profile.supply[body.kind]++;}if(lose){lose=false;throw Object.assign(Error('lost response'),{status:503});}}return {};},refresh:async()=>{}};
  await assert.rejects(()=>app.claimSupply('create'));if(outcome==='shared'){assert.equal(memory.size,1);await app.claimSupply('create');assert.equal(profile.supply.create,1);}else{assert.equal(profile.supply.create,0);assert.ok(calls.some(path=>path.endsWith('/cancel')));assert.ok(!calls.some(path=>path.endsWith('/redeem')));}
  assert.equal(shares,1);
 }
});

test('room assistance UI uses the same actual sharing gate and no ad API',async()=>{
 const app=Object.create(GameApp.prototype),memory=new Map(),paths=[];app.run=fn=>fn();app.note=()=>{};app.tasks=null;app.attempts=new Map();app.aid={grants:[]};app.room={ticket:{room:{id:'a'.repeat(32)},token:'room-token'}};
 app.platform={config:{apiBase:'https://test.invalid',gameName:'test'},randomId:rid,storage:{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},share:async()=> 'shared',watchAd:()=>{throw Error('No ads');}};
 app.client={profile:{code:'123456789'},config:{capabilities:{shareRewards:true}},json:async(path,method,body)=>{paths.push(path);if(path.endsWith('/challenge'))return {rewardToken:'b'.repeat(64)};if(!body.rewardToken)throw Object.assign(Error('share'),{code:'SHARE_REQUIRED'});return {serverTime:Date.now(),grants:[{kind:'underlay',expiresAt:Date.now()+30000}],freeRemaining:{hint:2,underlay:0}};}};
 await app.activateAssistance('underlay');assert.ok(paths.includes('/api/mobile/share/challenge'));assert.equal(app.aid.grants.length,1);assert.equal(memory.size,0);
});


test('share diagnostics retain failure stage and errno, redact sensitive text and stay admin-only',async()=>{
 const details=[];
 assert.equal(await shareOnTapTap(undefined,{},20,value=>details.push(value)),'unavailable');
 assert.match(details.at(-1),/接口缺失.*面板:false/);
 const host={onShareMessage(){},showShareboard(options){options.fail({errno:123,errMsg:'templateId required token=private-value https://example.test/?secret=private'});}};
 assert.equal(await shareOnTapTap(host,{},20,value=>details.push(value)),'unavailable');
 assert.match(details.at(-1),/面板调用失败.*errno:123.*templateId required/);
 assert.doesNotMatch(details.at(-1),/private/);
 const app=Object.create(GameApp.prototype),alerts=[];
 app.platform={config:{id:'taptap'},alert:value=>alerts.push(value),shareDiagnostics:()=>details.at(-1)};
 app.client={profile:{taptap:{diagnostics:false}}};app.showShareFailureDiagnostic();assert.equal(alerts.length,0);
 app.client.profile.taptap.diagnostics=true;app.showShareFailureDiagnostic();assert.equal(alerts.length,1);assert.match(alerts[0],/errno:123/);
});
