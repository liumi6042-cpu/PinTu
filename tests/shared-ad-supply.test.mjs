import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(result='shared'){
 const events=[],memory=new Map(),profile={code:"123456789",newcomer:true,adEligible:false,supply:{energy:0,create:0}},app=Object.create(GameApp.prototype);
 app.run=fn=>fn();app.note=message=>events.push(['note',message]);
 app.platform={config:{apiBase:'https://example.test/h5',gameName:'test'},randomId:()=>'a'.repeat(32),storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},share:async input=>(events.push(['share',input]),result),watchAd:()=>{throw Error('No ads');}};
 app.client={profile,config:{capabilities:{shareRewards:true}},async post(path,body){events.push([path,{...body}]);if(path.endsWith('/challenge'))return {rewardToken:'b'.repeat(64)};if(path.endsWith('/redeem'))profile.supply[body.kind]++;return {};},async refresh(){events.push(['refresh']);}};
 return {app,profile,events,memory};
}
test('fresh players can claim either supply despite cached old eligibility, with one verified share report',async()=>{
 for(const kind of ['energy','create']){const {app,profile,events,memory}=fixture();await app.claimSupply(kind);assert.equal(profile.supply[kind],1);assert.equal(profile.newcomer,true);assert.equal(events.filter(e=>e[0]==='share').length,1);const grants=events.filter(e=>e[0].endsWith('/redeem'));assert.equal(grants.length,1);assert.equal(grants[0][1].completed,true);assert.equal(grants[0][1].kind,kind);assert.equal(memory.size,0);}
});
test('early-close and failure cancel the opportunity without a grant',async()=>{
 for(const outcome of ['cancelled','unavailable']){const {app,profile,events}=fixture(outcome);await assert.rejects(()=>app.claimSupply('energy'));assert.equal(profile.supply.energy,0);assert.ok(events.some(e=>e[0].endsWith('/cancel')));assert.ok(!events.some(e=>e[0].endsWith('/redeem')));}
});
test('inventory limit, disabled ads and missing profile still block before requesting a share',async()=>{
 for(const mode of ['full','disabled','missing']){const {app,profile,events}=fixture();if(mode==='full')profile.supply.energy=3;if(mode==='disabled')app.client.config.capabilities.shareRewards=false;if(mode==='missing')app.client.profile=null;await assert.rejects(()=>app.claimSupply('energy'));assert.equal(events.length,0);}
});

test('TapTap energy uses ad 1054324, credits one pack and retries receipt without replaying video',async()=>{
 const {app,profile,events,memory}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';app.platform.watchAd=async unit=>(events.push(['ad',unit]),'completed');
 const post=app.client.post.bind(app.client);let fail=true;app.client.post=async(path,body)=>{if(path.endsWith('/redeem')&&fail){fail=false;throw Error('network');}return post(path,body);};
 await assert.rejects(()=>app.claimSupply('energy'));assert.equal(memory.size,1);await app.claimSupply('energy');assert.equal(profile.supply.energy,1);assert.deepEqual(events.filter(e=>e[0]==='ad'),[['ad','1054324']]);assert.equal(events.some(e=>e[0]==='share'),false);assert.equal(memory.size,0);
});
test('TapTap cancelled/failed/unavailable ad never awards energy and cancels challenge',async()=>{
 for(const outcome of ['closed','failed','unavailable']){const {app,profile,events}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';app.platform.watchAd=async()=>outcome;await assert.rejects(()=>app.claimSupply('energy'));assert.equal(profile.supply.energy,0);assert.ok(events.some(e=>e[0]==='/api/mobile/supply/cancel'));assert.ok(!events.some(e=>e[0].endsWith('/redeem')));}
});
test('TapTap paused ads use sharing; full inventory blocks either supply path before requesting',async()=>{
 const paused=fixture();paused.app.platform.config.id='taptap';paused.app.client.config.adRewardEnabled=false;paused.app.client.config.rewardedAdUnitId='1054324';await paused.app.claimSupply('energy');assert.equal(paused.profile.supply.energy,1);assert.ok(paused.events.some(e=>e[0]==='share'));
 for(const enabled of [false,true]){const {app,profile,events}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=enabled;app.client.config.rewardedAdUnitId='1054324';profile.supply.energy=3;await assert.rejects(()=>app.claimSupply('energy'));assert.equal(events.length,0);}
 const {app,profile,events}=fixture();app.platform.config.id='taptap';await app.claimSupply('create');assert.equal(profile.supply.create,1);assert.ok(events.some(e=>e[0]==='share'));
});

test('TapTap share fallback works with ads disabled and never calls video; cancellation never grants',async()=>{
 for(const outcome of ['shared','cancelled']){const {app,profile,events}=fixture(outcome);app.platform.config.id='taptap';app.client.config.adRewardEnabled=false;if(outcome==='shared'){await app.claimSupply('energy','share');assert.equal(profile.supply.energy,1);assert.ok(events.some(e=>e[0]==='/api/mobile/share/redeem'));}else{await assert.rejects(()=>app.claimSupply('energy','share'));assert.equal(profile.supply.energy,0);assert.ok(!events.some(e=>e[0].endsWith('/redeem')));}assert.ok(events.some(e=>e[0]==='share'));}
 const {app,profile,events}=fixture();app.platform.config.id='taptap';profile.supply.energy=3;await assert.rejects(()=>app.claimSupply('energy','share'));assert.equal(events.length,0);
});

test('TapTap sharing remains independent when official ads are enabled, including after an ad failure',async()=>{
 for(const failAdFirst of [false,true]){
  const {app,profile,events}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';
  app.platform.watchAd=async unit=>(events.push(['ad',unit]),'failed');
  if(failAdFirst)await assert.rejects(()=>app.claimSupply('energy'));
  await app.claimSupply('energy','share');assert.equal(profile.supply.energy,1);
  assert.equal(events.filter(e=>e[0]==='ad').length,failAdFirst?1:0);
  assert.equal(events.filter(e=>e[0]==='/api/mobile/share/redeem').length,1);
  assert.equal(events.some(e=>e[0]==='/api/mobile/supply/redeem'),false);
 }
});

test('cancelled sharing releases busy state without diagnostic alerts or rewards even if cleanup is slow',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {app,profile,events}=fixture('cancelled');let finishShare;
 app.platform.config.id='taptap';profile.taptap={bound:true,diagnostics:true};app.platform.alert=()=>assert.fail('ordinary cancellation is not a diagnostic error');
 app.platform.share=()=>new Promise(resolve=>finishShare=resolve);app.platform.cancelShare=()=>finishShare('cancelled');
 app.run=GameApp.prototype.run;app.invalidate=()=>{};
 const post=app.client.post.bind(app.client);app.client.post=(path,body)=>path.endsWith('/cancel')?(events.push([path,body]),new Promise(()=>{})):post(path,body);
 const promise=app.claimSupply('energy','share');for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(app.busy,true);assert.equal(app.sharing,true);app.platform.cancelShare();for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(app.sharing,false);t.mock.timers.tick(800);await promise;assert.equal(app.busy,false);
 assert.equal(profile.supply.energy,0);assert.equal(events.some(e=>e[0].endsWith('/redeem')),false);assert.ok(events.some(e=>e[0].endsWith('/cancel')));
 assert.match(events.find(e=>e[0]==='note')[1],/已取消分享/);
});

test('the allowlisted bound TapTap account can test the configured ad with full inventory and rewards disabled',async()=>{
 for(const outcome of ['completed','closed','failed','unavailable']){const {app,profile,events,memory}=fixture();profile.taptap={bound:true,diagnostics:true};profile.supply.energy=3;app.platform.config.id='taptap';app.client.config.adRewardEnabled=false;app.client.config.rewardedAdUnitId=outcome==='completed'?'':'1054324';app.platform.watchAd=async unit=>(events.push(['ad',unit]),outcome);app.platform.adDiagnostics=()=> '加载 · 码 1003 · adnCode 200001';app.platform.alert=message=>events.push(['alert',message]);
  await app.testRewardedAd();assert.deepEqual(events.filter(e=>e[0]==='ad'),[['ad','1054324']]);assert.equal(profile.supply.energy,3);assert.equal(memory.size,0);assert.equal(events.some(e=>e[0].startsWith('/api/')||e[0]==='share'),false);assert.ok(events.find(e=>e[0]==='alert')[1].includes('不发放奖励'));assert.equal(events.find(e=>e[0]==='alert')[1].includes('广告测试成功'),outcome==='completed');
 }
});

test('ad testing refuses other accounts and other platforms before any native call',async()=>{
 for(const [id,taptap] of [['taptap',{bound:true,diagnostics:false}],['taptap',{bound:false,diagnostics:true}],['web',{bound:true,diagnostics:true}],['wechat',{bound:true,diagnostics:true}]]){const {app,profile,events}=fixture();app.platform.config.id=id;profile.taptap=taptap;app.platform.watchAd=()=>assert.fail('restricted account');await app.testRewardedAd();assert.deepEqual(events,[]);}
});

test('TapTap picks the ad slot for the current orientation and falls back to the single configured slot',async()=>{
 for(const [width,height,config,expected] of [[390,844,{rewardedAdUnitId:'p0',rewardedAdUnitIdPortrait:'p1',rewardedAdUnitIdLandscape:'l1'},'p1'],[844,390,{rewardedAdUnitId:'p0',rewardedAdUnitIdPortrait:'p1',rewardedAdUnitIdLandscape:'l1'},'l1'],[844,390,{rewardedAdUnitId:'p0'},'p0']]){
  const {app,events}=fixture();app.platform.config.id='taptap';app.platform.viewport=()=>({width,height,dpr:1,top:0,bottom:0});Object.assign(app.client.config,{adRewardEnabled:true,...config});app.platform.watchAd=async unit=>(events.push(['ad',unit]),'completed');
  await app.claimSupply('energy');assert.deepEqual(events.filter(e=>e[0]==='ad'),[['ad',expected]]);
  const prepared=[];app.platform.prepareAd=unit=>prepared.push(unit);app.prepareRewardedAd();assert.deepEqual(prepared,[expected]);
 }
});

test('a failed TapTap ad unlocks at once: short challenge timeout, cancel not awaited, reason shown with the share hint',async()=>{
 const {app,profile,events}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';
 const post=app.client.post.bind(app.client),timeouts=[];app.client.post=(path,body,timeout)=>{timeouts.push([path,timeout]);return path.endsWith('/cancel')?(events.push([path,{...body}]),new Promise(()=>{})):post(path,body);};
 app.platform.watchAd=async()=>'failed';app.platform.adFailure=()=>'错误码 1004 无合适的广告';
 await assert.rejects(()=>app.claimSupply('energy'),/广告暂时加载不出来（错误码 1004 无合适的广告），可以先用分享领取/);
 assert.deepEqual(timeouts.find(t=>t[0].endsWith('/challenge')),['/api/mobile/supply/challenge',5000]);assert.ok(events.some(e=>e[0]==='/api/mobile/supply/cancel'));assert.equal(profile.supply.energy,0);
});

test('v53.15: with ads on, 建房券 come from the rewarded video only (no share), on TapTap and on WeChat with its own adunit',async()=>{
 for(const [id,unit] of [['taptap','1054324'],['wechat','adunit-abc123']]){
  const {app,profile,events,memory}=fixture();app.platform.config.id=id;app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId=unit;app.platform.watchAd=async u=>(events.push(['ad',u]),'completed');
  await app.claimSupply('create');assert.equal(profile.supply.create,1);assert.deepEqual(events.filter(e=>e[0]==='ad'),[['ad',unit]]);
  assert.equal(events.some(e=>e[0]==='share'||e[0].startsWith('/api/mobile/share/')),false);
  assert.deepEqual(events.find(e=>e[0]==='/api/mobile/supply/challenge')[1].kind,'create');assert.equal(events.find(e=>e[0]==='/api/mobile/supply/redeem')[1].kind,'create');
  assert.match(events.find(e=>e[0]==='note')[1],/建房券已补满/);assert.equal(memory.size,0);
 }
});
test('v53.15: an unfinished or failed video never grants 建房券 and points at retrying, not at sharing',async()=>{
 for(const outcome of ['closed','failed']){const {app,profile,events}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';app.platform.watchAd=async()=>outcome;
  await assert.rejects(()=>app.claimSupply('create'),outcome==='closed'?/本次未领取建房券/:/请稍后再试/);assert.equal(profile.supply.create,0);assert.ok(events.some(e=>e[0]==='/api/mobile/supply/cancel'));assert.equal(events.some(e=>e[0]==='share'),false);}
});
test('v53.15: ads switched off fall back to sharing for 建房券; WeChat without an adunit has no claim path at all',async()=>{
 const taptap=fixture();taptap.app.platform.config.id='taptap';taptap.app.client.config.adRewardEnabled=false;await taptap.app.claimSupply('create');assert.equal(taptap.profile.supply.create,1);assert.ok(taptap.events.some(e=>e[0]==='share'));
 const wechat=fixture();wechat.app.platform.config.id='wechat';wechat.app.client.config.capabilities.shareRewards=false;wechat.app.client.config.adRewardEnabled=false;wechat.app.platform.watchAd=()=>assert.fail('no adunit');
 await assert.rejects(()=>wechat.app.claimSupply('create'));assert.equal(wechat.events.length,0);assert.equal(wechat.app.ticketClaimAvailable,false);
 const web=fixture();web.app.platform.config.id='web';web.app.client.config.adRewardEnabled=true;web.app.client.config.rewardedAdUnitId='1054324';assert.equal(web.app.supplyAdAvailable,false);
});
test('v53.15: a video already watched for 体力包 is redeemed first when the player next taps 建房券',async()=>{
 const {app,profile,events,memory}=fixture();app.platform.config.id='taptap';app.client.config.adRewardEnabled=true;app.client.config.rewardedAdUnitId='1054324';app.platform.watchAd=async u=>(events.push(['ad',u]),'completed');
 const post=app.client.post.bind(app.client);let fail=true;app.client.post=async(path,body)=>{if(path.endsWith('/redeem')&&fail){fail=false;throw Error('network');}return post(path,body);};
 await assert.rejects(()=>app.claimSupply('energy'));assert.equal(memory.size,1);
 await app.claimSupply('create');assert.equal(profile.supply.energy,1);assert.equal(profile.supply.create,0);assert.equal(events.filter(e=>e[0]==='ad').length,1);assert.equal(memory.size,0);
});
test('v53.15: the WeChat policy only mentions rewarded video once a WeChat adunit exists; TapTap names its ads',async()=>{
 const {privacySectionsFor}=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['mobile/privacy-policy.ts'],bundle:true,write:false,platform:'node',format:'esm'})).outputFiles[0].text).toString('base64'));
 const text=(id,ads)=>privacySectionsFor(id,ads).map(s=>s[1]).join('\n');
 assert.match(text('wechat',false),/当前版本没有广告/);assert.doesNotMatch(text('wechat',false),/激励视频/);
 assert.match(text('wechat',true),/微信提供的激励视频广告/);assert.doesNotMatch(text('wechat',true),/没有广告/);
 assert.match(text('taptap',true),/TapTap提供的激励视频广告/);assert.doesNotMatch(text('taptap',true),/停止通过广告/);
});
