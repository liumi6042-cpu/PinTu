import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

// 治愈时光 (2 ads per image, max 1/day) + 完图双倍奖励 client retry/cancel flows.
const view=(owned,adProgress=owned?2:0,dailyUsed=adProgress)=>({packs:[{id:'healing-time',unlock:'ad',adRequired:2,dailyLimit:2,dailyUsed,dailyUnlocked:owned?1:0,dailyUnlockLimit:1,images:[{id:'p1',title:'爬山虎小店',owned,adProgress,adRequired:2}]}],albums:[],decorations:[],wallet:{coins:0,fragments:0}});
function fixture(outcome='completed',{unlockResult}={}){
 const events=[],memory=new Map(),app=Object.create(GameApp.prototype);
 app.run=fn=>fn();app.note=message=>events.push(['note',message]);app.applyCollection=data=>events.push(['apply',data.packs[0].images[0].owned,data.packs[0].images[0].adProgress]);app.loadGallery=async()=>{};app.loadCollection=async()=>{};app.invalidate=()=>events.push(['invalidate']);
 app.room={snapshot:{id:'c'.repeat(32),requestedPieces:108,puzzle:{cols:9,rows:12},mobileResult:{roomId:'c'.repeat(32),coins:54,fragments:10,doubleClaimed:false}}};
 app.platform={config:{id:'taptap',apiBase:'https://example.test/h5'},randomId:()=>'a'.repeat(32),viewport:()=>({width:800,height:360}),storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},watchAd:async unit=>(events.push(['ad',unit]),outcome),playSound:src=>events.push(['sound',src])};
 app.client={profile:{code:'123456789'},config:{adRewardEnabled:true,rewardedAdUnitId:'1054324',rewardedAdUnitIdLandscape:'1054323'},async post(path,body){
  events.push([path,{...body}]);
  if(path.endsWith('/challenge'))return {rewardToken:'b'.repeat(64)};
  if(path==='/api/mobile/collection/unlock/redeem'){
   const u=unlockResult??{imageId:body.imageId,alreadyOwned:false,unlocked:true,progress:2,required:2,dailyUsed:2,dailyLimit:2};
   return {...view(u.unlocked!==false,u.progress??2,u.dailyUsed??2),unlocked:u};
  }
  if(path==='/api/mobile/completion/double/redeem')return {doubled:{roomId:body.roomId,coins:54,fragments:10,alreadyClaimed:false}};
  return {ok:true};
 },async refresh(){events.push(['refresh']);}};
 return {app,events,memory};
}

test('first ad records 1/2 progress without unlocking; second ad unlocks permanently and clears storage',async()=>{
 const first=fixture('completed',{unlockResult:{imageId:'p1',alreadyOwned:false,unlocked:false,progress:1,required:2,dailyUsed:1,dailyLimit:2}});
 await first.app.unlockAdImage('p1');
 assert.deepEqual(first.events.filter(e=>e[0]==='ad'),[['ad','1054323']]);
 assert.ok(first.events.some(e=>e[0]==='apply'&&e[1]===false&&e[2]===1));
 assert.equal(first.memory.size,0);
 assert.match(first.events.find(e=>e[0]==='note')[1],/1\/2.*再看 1 次/);

 const second=fixture('completed',{unlockResult:{imageId:'p1',alreadyOwned:false,unlocked:true,progress:2,required:2,dailyUsed:2,dailyLimit:2}});
 await second.app.unlockAdImage('p1');
 assert.ok(second.events.some(e=>e[0]==='apply'&&e[1]===true&&e[2]===2));
 assert.equal(second.memory.size,0);
 assert.match(second.events.find(e=>e[0]==='note')[1],/已永久解锁/);
});

test('closed or failed ads cancel unlock chance and never redeem',async()=>{
 for(const outcome of ['closed','failed','unavailable']){const {app,events}=fixture(outcome);await assert.rejects(()=>app.unlockAdImage('p1'));
  assert.ok(events.some(e=>e[0]==='/api/mobile/collection/unlock/cancel'));assert.ok(!events.some(e=>e[0].endsWith('/redeem')));}
});

test('a dropped unlock redeem retries from storage without a second video',async()=>{
 const {app,events,memory}=fixture();const post=app.client.post.bind(app.client);let fail=true;
 app.client.post=async(path,body)=>{if(path.endsWith('/redeem')&&fail){fail=false;throw Error('network');}return post(path,body);};
 await assert.rejects(()=>app.unlockAdImage('p1'));assert.equal(memory.size,1);await app.unlockAdImage('p1');
 assert.equal(events.filter(e=>e[0]==='ad').length,1);assert.equal(events.filter(e=>e[0]==='/api/mobile/collection/unlock/challenge').length,1);assert.equal(memory.size,0);
});

test('without ads unlock is rejected before calling server',async()=>{
 const {app,events}=fixture();app.client.config.adRewardEnabled=false;await assert.rejects(()=>app.unlockAdImage('p1'),/广告暂未开放/);assert.equal(events.length,0);
});

test('completion double ad redeems bonus coins & fragments, updates snapshot, and retries dropped redeem without a second video',async()=>{
 const roomId='c'.repeat(32);
 const {app,events,memory}=fixture();
 const post=app.client.post.bind(app.client);let fail=true;
 app.client.post=async(path,body)=>{if(path==='/api/mobile/completion/double/redeem'&&fail){fail=false;throw Error('network');}return post(path,body);};
 await assert.rejects(()=>app.claimCompletionDouble(roomId));
 assert.equal(memory.size,1);
 await app.claimCompletionDouble(roomId);
 assert.equal(events.filter(e=>e[0]==='ad').length,1);
 assert.equal(events.filter(e=>e[0]==='/api/mobile/completion/double/challenge').length,1);
 assert.equal(memory.size,0);
 assert.equal(app.room.snapshot.mobileResult.doubleClaimed,true);
 assert.deepEqual(app.room.snapshot.mobileResult.doubleBonus,{coins:54,fragments:10});
 assert.match(events.find(e=>e[0]==='note')[1],/金币 \+54.*碎片 \+10/);
});

test('completion double cancels on closed or failed ads and rejects when ads unavailable',async()=>{
 const roomId='c'.repeat(32);
 for(const outcome of ['closed','failed','unavailable']){
  const {app,events}=fixture(outcome);
  await assert.rejects(()=>app.claimCompletionDouble(roomId));
  assert.ok(events.some(e=>e[0]==='/api/mobile/completion/double/cancel'));
  assert.ok(!events.some(e=>e[0].endsWith('/redeem')));
 }
 const off=fixture();off.app.client.config.adRewardEnabled=false;
 await assert.rejects(()=>off.app.claimCompletionDouble(roomId),/广告暂未开放/);
 assert.equal(off.events.length,0);
});
