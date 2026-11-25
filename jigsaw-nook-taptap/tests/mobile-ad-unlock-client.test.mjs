import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

// 治愈时光: one completed rewarded ad → one picture; failures cancel; a dropped redeem retries without a second video.
const view=owned=>({packs:[{id:'healing-time',unlock:'ad',images:[{id:'p1',title:'爬山虎小店',owned}]}],albums:[],decorations:[],wallet:{coins:0,fragments:0}});
function fixture(outcome='completed'){
 const events=[],memory=new Map(),app=Object.create(GameApp.prototype);
 app.run=fn=>fn();app.note=message=>events.push(['note',message]);app.applyCollection=data=>events.push(['apply',data.packs[0].images[0].owned]);app.loadGallery=async()=>{};
 app.platform={config:{id:'taptap',apiBase:'https://example.test/h5'},randomId:()=>'a'.repeat(32),viewport:()=>({width:800,height:360}),storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},watchAd:async unit=>(events.push(['ad',unit]),outcome)};
 app.client={profile:{code:'123456789'},config:{adRewardEnabled:true,rewardedAdUnitId:'1054324',rewardedAdUnitIdLandscape:'1054323'},async post(path,body){events.push([path,{...body}]);if(path.endsWith('/challenge'))return {rewardToken:'b'.repeat(64)};if(path.endsWith('/redeem'))return {...view(true),unlocked:{imageId:body.imageId}};return {ok:true};},async refresh(){events.push(['refresh']);}};
 return {app,events,memory};
}
test('a completed ad redeems that picture with the landscape slot and clears storage',async()=>{
 const {app,events,memory}=fixture();await app.unlockAdImage('p1');
 assert.deepEqual(events.filter(e=>e[0]==='ad'),[['ad','1054323']]);
 const redeem=events.find(e=>e[0]==='/api/mobile/collection/unlock/redeem');assert.equal(redeem[1].imageId,'p1');assert.equal(redeem[1].completed,true);assert.equal(redeem[1].rewardToken,'b'.repeat(64));
 assert.ok(events.some(e=>e[0]==='apply'&&e[1]===true));assert.equal(memory.size,0);assert.match(events.find(e=>e[0]==='note')[1],/爬山虎小店|这张图/);
});
test('closed or failed ads cancel the chance and never redeem',async()=>{
 for(const outcome of ['closed','failed','unavailable']){const {app,events}=fixture(outcome);await assert.rejects(()=>app.unlockAdImage('p1'));
  assert.ok(events.some(e=>e[0]==='/api/mobile/collection/unlock/cancel'));assert.ok(!events.some(e=>e[0].endsWith('/redeem')));}
});
test('a dropped redeem retries from storage without a second video',async()=>{
 const {app,events,memory}=fixture();const post=app.client.post.bind(app.client);let fail=true;
 app.client.post=async(path,body)=>{if(path.endsWith('/redeem')&&fail){fail=false;throw Error('network');}return post(path,body);};
 await assert.rejects(()=>app.unlockAdImage('p1'));assert.equal(memory.size,1);await app.unlockAdImage('p1');
 assert.equal(events.filter(e=>e[0]==='ad').length,1);assert.equal(events.filter(e=>e[0]==='/api/mobile/collection/unlock/challenge').length,1);assert.equal(memory.size,0);
});
test('without ads nothing is requested',async()=>{
 const {app,events}=fixture();app.client.config.adRewardEnabled=false;await assert.rejects(()=>app.unlockAdImage('p1'),/广告暂未开放/);assert.equal(events.length,0);
});
