import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {xpForLevel} from '../server/mobile-economy.mjs';

// All business requests reach a fresh real gateway and isolated SQLite stores.
// Only OS share/clipboard callbacks are controllable; no business API is mocked.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
mkdirSync('work/mobile-share-rewards-browser',{recursive:true});
const run=mkdtempSync(resolve('work/mobile-share-rewards-browser/run-')),out=resolve('docs/verification/mobile-task-icons-v9');mkdirSync(out,{recursive:true});
const port=Number(process.env.MOBILE_SHARE_TEST_PORT||3238),base='http://127.0.0.1:'+port,databasePath=resolve(run,'mobile.sqlite'),requestId=()=>randomBytes(16).toString('hex');
const service=createMobileService({databasePath,adEnabled:false});
const gateway=createH5Gateway({mobileService:service,databasePath:resolve(run,'sessions.sqlite'),assetDir:resolve('public'),assetPaths:JSON.parse(readFileSync('h5/asset-manifest.json','utf8')),staticDir:resolve('outputs/h5'),upstream:'http://127.0.0.1:1',allowedOrigins:[base]});
await new Promise((done,reject)=>{gateway.once('error',reject);gateway.listen(port,'127.0.0.1',done);});
const db=new DatabaseSync(databasePath),browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],external=[],shares=[],checks=[];
let failNextShare=false;
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});
await context.route('**/*',route=>{const url=route.request().url();if(failNextShare&&url.endsWith('/api/mobile/invitations/share')){failNextShare=false;return route.abort('failed');}if(url.startsWith(base+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();external.push(url);return route.abort('blockedbyclient');});
await context.addInitScript(()=>{
 window.__shareMode='cancel';window.__copyMode='success';window.__copied='';window.__nativeShareCalls=0;window.__clipboardCalls=0;
 Object.defineProperty(navigator,'share',{configurable:true,get:()=>window.__shareMode==='unavailable'?undefined:async data=>{window.__nativeShareCalls++;window.__shared=data;if(window.__shareMode==='cancel')throw new DOMException('Share canceled','AbortError');if(window.__shareMode==='fail')throw new Error('OS share failed');}});
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__clipboardCalls++;if(window.__copyMode==='fail')throw new DOMException('Clipboard blocked','NotAllowedError');window.__copied=text;},readText:async()=>window.__copied}});
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/mobile/invitations/share')&&request.method()==='POST')shares.push(request.postDataJSON());});
let token,identity;
const profile=()=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity).data);
async function api(path,body){const response=await fetch(base+'/h5'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'X-Jigsaw-H5-Session':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${path} ${response.status}: ${JSON.stringify(data)}`);return data;}
const sheet=()=>page.getByRole('dialog',{name:'任务与礼包',exact:true});
async function open(){await page.getByRole('button',{name:/^任务与礼包，/}).click();await sheet().locator('.mobile-invite-link input').waitFor();return sheet();}
async function modes(copy,share){await page.evaluate(({copy,share})=>{window.__copyMode=copy;window.__shareMode=share;},{copy,share});}
async function notice(text){await sheet().getByText(text,{exact:true}).waitFor();}
function unchanged(before){const after=profile();assert.equal(after.energy,before.energy);assert.equal(after.totalXp,before.totalXp);}
try{
 await page.goto(base+'/#/zh/lobby');await page.locator('.mobile-task-entry').waitFor();await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('jigsaw:h5-session:')));
 token=await page.evaluate(()=>Object.entries(localStorage).find(([key])=>key.startsWith('jigsaw:h5-session:'))[1]);identity=createHash('sha256').update(token).digest('hex');
 // This isolated level fixture keeps the three 10 XP shares below a level-up,
 // so the exact +20 energy grant is distinguishable from an upgrade refill.
 const initial=profile();Object.assign(initial,{level:20,xp:0,totalXp:Array.from({length:20},(_,i)=>xpForLevel(i+1)).reduce((a,b)=>a+b,0),energy:40,energyAt:Date.now()});db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(initial),identity);
 await page.reload();await page.locator('.mobile-task-entry').waitFor();await open();const baseline=profile();

 await modes('fail','unavailable');await sheet().getByRole('button',{name:'复制链接',exact:true}).click();await notice('未能自动复制，请长按下方邀请链接复制；本次暂未领取分享奖励');assert.equal(shares.length,0);unchanged(baseline);
 checks.push('Clipboard failure does not call the reward endpoint or grant energy/XP.');
 await modes('success','cancel');await sheet().locator('.mobile-invite-copy button').click();await notice('邀请码已复制');assert.equal(shares.length,0);unchanged(baseline);
 checks.push('Copying only the invitation code does not claim a share reward.');
 await sheet().getByRole('button',{name:'邀请好友',exact:true}).click();await notice('本次分享已取消');assert.equal(shares.length,0);unchanged(baseline);
 await modes('success','fail');await sheet().getByRole('button',{name:'邀请好友',exact:true}).click();await notice('暂时无法打开分享，请使用复制链接');assert.equal(shares.length,0);unchanged(baseline);
 checks.push('Canceled and failed native share callbacks do not claim a reward.');

 await modes('success','unavailable');await sheet().getByRole('button',{name:'复制链接',exact:true}).click();await notice('分享奖励到账：体力 +20 · 经验 +10');assert.equal(shares.length,1);assert.equal(profile().energy,baseline.energy+20);assert.equal(profile().totalXp,baseline.totalXp+10);assert.match(await page.evaluate(()=>window.__copied),/#\/zh\/lobby\?ref=[a-f0-9]{12}$/);
 const firstReceipt=await api('/api/mobile/invitations/share',shares[0]);assert.equal(firstReceipt.shared.energy,20);assert.equal(firstReceipt.shared.xp,10);assert.equal(profile().energy,baseline.energy+20);assert.equal(profile().totalXp,baseline.totalXp+10);
 checks.push('Successful link copy grants exactly 20 energy and 10 XP; replaying its request returns the receipt without another grant.');

 await modes('success','success');await sheet().getByRole('button',{name:'邀请好友',exact:true}).click();await notice('分享奖励到账：体力 +20 · 经验 +10');assert.equal(shares.length,2);assert.equal(profile().energy,baseline.energy+40);assert.equal(profile().totalXp,baseline.totalXp+20);
 assert.match((await page.evaluate(()=>window.__shared)).url,/#\/zh\/lobby\?ref=/);checks.push('Resolved native sharing also grants the reward and includes friend attribution.');
 failNextShare=true;await sheet().getByRole('button',{name:'复制链接',exact:true}).click();await sheet().getByRole('button',{name:'重试领取分享奖励',exact:true}).waitFor();assert.equal(shares.length,3);assert.equal(profile().energy,baseline.energy+40);assert.equal(profile().totalXp,baseline.totalXp+20);
 const pending=await page.evaluate(()=>Object.entries(sessionStorage).find(([key])=>key.startsWith('jigsaw:mobile-pending-share:'))?.[1]);assert.equal(pending,shares[2].requestId);
 await sheet().getByRole('button',{name:'关闭',exact:true}).click();await sheet().waitFor({state:'detached'});
 const retryRoom=await api('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:requestId()});await page.goto(base+'/#/room/'+retryRoom.room.id);await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true&&!!document.querySelector('.mobile-game-board canvas'));
 await page.getByRole('button',{name:/^房间成员 /}).click();const clipboardBeforeRetry=await page.evaluate(()=>window.__clipboardCalls);await page.getByRole('button',{name:'重试分享奖励',exact:true}).click();await page.getByText('分享奖励到账：体力 +20 · 经验 +10',{exact:true}).waitFor();assert.equal(shares.length,4);assert.equal(shares[3].requestId,pending);assert.equal(profile().energy,baseline.energy+60);assert.equal(profile().totalXp,baseline.totalXp+30);assert.equal(await page.evaluate(()=>window.__clipboardCalls),clipboardBeforeRetry);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('jigsaw:mobile-pending-share:'))),false);
 checks.push('A real network-aborted task share retains one request ID; room-toolbar retry reuses it and grants once without copying or sharing again.');await page.screenshot({path:resolve(out,'share-retry-toolbar-390.png')});
 await page.keyboard.press('Escape');await page.goto(base+'/#/zh/lobby');await page.locator('.mobile-task-entry').waitFor();await open();await modes('success','unavailable');
 await sheet().getByRole('button',{name:'复制链接',exact:true}).click();await notice('今日分享奖励已领满，好友仍可通过链接加入');assert.equal(shares.length,5);assert.equal(profile().energy,baseline.energy+60);assert.equal(profile().totalXp,baseline.totalXp+30);
 const capped=await api('/api/mobile/tasks');assert.equal(capped.invitation.todayShared,3);assert.equal(capped.tasks.find(task=>task.id==='share-invitation').progress,3);assert.equal(capped.tasks.find(task=>task.id==='share-invitation').earned,true);
 checks.push('Three successful shares grant three rewards; the fourth copies the link but cannot exceed the daily energy/XP limit.');
 await page.screenshot({path:resolve(out,'share-daily-limit-390.png')});

 const icons=await sheet().locator('.mobile-task-card').evaluateAll(rows=>rows.map(row=>({task:[...row.classList].find(name=>name.startsWith('task-')),kind:[...(row.querySelector('.mobile-task-art')?.classList??[])].find(name=>name.startsWith('mobile-task-art-'))})));
 assert.equal(icons.length,7);assert.ok(icons.every(icon=>icon.kind));assert.equal(new Set(icons.map(icon=>icon.kind)).size,7,'every task type has its own icon kind');
 assert.equal(await sheet().locator('.mobile-ten-gift .mobile-task-art-ten').count(),1);assert.equal(await page.locator('.mobile-task-entry .mobile-task-art-task-book').count(),1);
 const atlas=JSON.parse(readFileSync('public/mobile-icons/task-atlas-v10-concept.json','utf8')),loaded=await page.evaluate(async()=>{const urls=[...new Set([...document.querySelectorAll('.mobile-task-art image')].map(image=>image.getAttribute('href')))];return Promise.all(urls.map(async src=>{const image=new Image();image.src=src;await image.decode();return {src,width:image.naturalWidth,height:image.naturalHeight};}));});assert.equal(loaded.length,1);assert.equal(loaded[0].width,atlas.width);assert.equal(loaded[0].height,atlas.height);
 checks.push({label:'Seven task rows use seven distinct icon kinds; the actual PNG atlas decodes successfully at its declared resolution.',icons,atlas:loaded});
 await sheet().evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:resolve(out,'task-icons-390.png')});
 await page.setViewportSize({width:844,height:390});await page.screenshot({path:resolve(out,'task-icons-844.png')});await page.setViewportSize({width:390,height:844});

 // A durable pre-v9 inventory fixture tests compatibility with already-earned
 // invite-friend gifts; new invitations are covered by the real two-player test.
 db.prepare('INSERT INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(requestId(),identity,'invite-friend',10,2,'legacy-fixture',Date.now());
 await sheet().getByRole('button',{name:'关闭',exact:true}).click();await sheet().waitFor({state:'detached'});await open();await sheet().getByRole('tab',{name:/^礼包/}).click();
 const beforeLegacy=profile();await sheet().locator('.gift-invite-friend').getByRole('button',{name:'开启1份邀友见面礼',exact:true}).click();await sheet().locator('.mobile-gift-receipt').getByText('体力 +10 · 经验 +2',{exact:true}).waitFor();assert.equal(profile().energy,beforeLegacy.energy+10);assert.equal(profile().totalXp,beforeLegacy.totalXp+2);
 checks.push('A stored legacy invitation gift still opens for its original 10 energy and 2 XP.');
 await page.screenshot({path:resolve(out,'legacy-invitation-gift-390.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={passed:checks.length,isolatedDatabase:databasePath,checks,errors,external};writeFileSync(resolve(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,screenshots:out},null,2));
}catch(error){try{await page.screenshot({path:resolve(out,'share-failure.png'),fullPage:true});}catch{}throw error;}
finally{await browser.close();db.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}


