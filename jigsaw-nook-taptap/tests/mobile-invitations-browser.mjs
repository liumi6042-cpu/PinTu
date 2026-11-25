import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {energyCap} from '../server/mobile-economy.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';

// A fresh real gateway, session DB and game DB for each run. No preview data,
// external requests, or business API mocks are used by this acceptance check.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
mkdirSync('work/mobile-invitations-browser',{recursive:true});
const run=mkdtempSync(resolve('work/mobile-invitations-browser/run-')),out=resolve('docs/verification/mobile-task-icons-v9');mkdirSync(out,{recursive:true});
const port=Number(process.env.MOBILE_INVITATION_TEST_PORT||3237),base='http://127.0.0.1:'+port,databasePath=resolve(run,'mobile.sqlite');
const service=createMobileService({databasePath,adEnabled:false});
const gateway=createH5Gateway({mobileService:service,databasePath:resolve(run,'sessions.sqlite'),assetDir:resolve('public'),assetPaths:JSON.parse(readFileSync('h5/asset-manifest.json','utf8')),staticDir:resolve('outputs/h5'),upstream:'http://127.0.0.1:1',allowedOrigins:[base]});
await new Promise((done,reject)=>{gateway.once('error',reject);gateway.listen(port,'127.0.0.1',done);});
const db=new DatabaseSync(databasePath),browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],external=[],checks=[];let a,b;
const requestId=()=>randomBytes(16).toString('hex');
async function actor(){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();external.push(url);return route.abort('blockedbyclient');});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/#/zh/lobby');await page.locator('.mobile-task-entry').waitFor();
 await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('jigsaw:h5-session:')));
 const token=await page.evaluate(()=>Object.entries(localStorage).find(([key])=>key.startsWith('jigsaw:h5-session:'))[1]);
 return {context,page,token,identity:createHash('sha256').update(token).digest('hex')};
}
async function api(actor,path,body,roomToken){
 const response=await fetch(base+'/h5'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'X-Jigsaw-H5-Session':actor.token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(roomToken?{Authorization:'Bearer '+roomToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.ok(response.ok,`${path} ${response.status}: ${JSON.stringify(data)}`);return data;
}
const storedProfile=actor=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor.identity).data);
const taskSheet=page=>page.getByRole('dialog',{name:'任务与礼包',exact:true});
async function openTasks(page){await page.getByRole('button',{name:/^任务与礼包，/}).click();const sheet=taskSheet(page);await sheet.locator('.mobile-invite-link input').waitFor();return sheet;}
async function closeTasks(page){await taskSheet(page).getByRole('button',{name:'关闭',exact:true}).click();await taskSheet(page).waitFor({state:'detached'});}
const ready=page=>page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true&&!!document.querySelector('.mobile-game-board canvas'),null,{timeout:30000});
async function snapshotTicket(actor,roomId){const saved=await actor.page.evaluate(id=>JSON.parse(sessionStorage.getItem('together-puzzle:room:'+id)),roomId);return {...saved,room:{id:roomId}};}
async function drop(actor,ticket){
 const path='/api/rooms/'+ticket.room.id,room=await api(actor,path,undefined,ticket.token),group=room.puzzle.groups.find(g=>!g.locked);assert.ok(group,'a loose puzzle piece remains');
 await api(actor,path,{type:'claim',groupId:group.id,requestId:requestId()},ticket.token);
 const receipt=await api(actor,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:requestId()},ticket.token);
 assert.equal(receipt.mobileContribution.creditedXp,1);return receipt;
}
async function geometry(page,label,expectedScroll){
 const sheet=taskSheet(page);
 const box=await sheet.evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,bodyWidth:document.body.scrollWidth,viewportWidth:innerWidth,viewportHeight:innerHeight};});
 assert.ok(box.x>=-.5&&box.right<=box.viewportWidth+.5,`${label}: dialog exceeds viewport width`);
 assert.ok(box.y>=-.5&&box.bottom<=box.viewportHeight+.5,`${label}: dialog exceeds viewport height`);
 assert.ok(box.scrollWidth<=box.clientWidth+1,`${label}: dialog has horizontal overflow`);
 assert.ok(box.bodyWidth<=box.viewportWidth+1,`${label}: document has horizontal overflow`);
 if(expectedScroll)assert.ok(box.scrollHeight>box.clientHeight+20,`${label}: long contents should scroll`);
 if(box.scrollHeight>box.clientHeight){const moved=await sheet.evaluate(node=>{node.scrollTop=node.scrollHeight;return node.scrollTop;});assert.ok(moved>0,`${label}: content does not scroll`);await sheet.evaluate(node=>{node.scrollTop=0;});}
 checks.push({label,...box});
}
try{
 a=await actor();b=await actor();assert.notEqual(a.identity,b.identity);checks.push({label:'two independent browser identities on a fresh isolated gateway and SQLite database'});
 const oldPlayerRoom=await api(b,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:requestId()});await drop(b,oldPlayerRoom);assert.equal(storedProfile(b).totalXp,1);
 const initial=await openTasks(a.page),inviteLink=await initial.getByRole('textbox',{name:'邀请链接',exact:true}).inputValue();
 const code=new URLSearchParams(new URL(inviteLink).hash.split('?')[1]).get('ref');assert.match(code,/^[a-f0-9]{12}$/);assert.equal(new URL(inviteLink).origin,base);assert.match(inviteLink,/#\/zh\/lobby\?ref=/);
 await initial.getByRole('button',{name:'复制链接',exact:true}).click();const copied=await a.page.evaluate(()=>navigator.clipboard.readText());assert.equal(copied,inviteLink);await initial.getByText('分享奖励到账：体力 +20 · 经验 +10',{exact:true}).waitFor();await closeTasks(a.page);
 checks.push({label:'task sheet supplies and copies a real friend attribution link',code});

 const created=await api(a,'/api/rooms',{mode:'random',pieces:108,visibility:'private',requestId:requestId()});const roomId=created.room.id;assert.ok(created.inviteCode);
 await a.page.goto(base+'/#/room/'+roomId+'?inviteCode='+created.inviteCode);await ready(a.page);
 await a.page.getByRole('button',{name:/^房间成员 /}).click();const beforeRoomShare=storedProfile(a);await a.page.getByRole('button',{name:'邀请朋友',exact:true}).click();await a.page.getByText('已复制邀请',{exact:true}).waitFor();await a.page.getByText('分享奖励到账：体力 +20 · 经验 +10',{exact:true}).waitFor();assert.equal(storedProfile(a).energy,beforeRoomShare.energy+20);assert.equal(storedProfile(a).totalXp,beforeRoomShare.totalXp+10);
 const roomLink=await a.page.evaluate(()=>navigator.clipboard.readText()),roomQuery=new URLSearchParams(new URL(roomLink).hash.split('?')[1]);
 assert.equal(roomQuery.get('ref'),code);assert.equal(roomQuery.get('inviteCode'),created.inviteCode);assert.match(roomLink,new RegExp('#/room/'+roomId+'\\?'));
 checks.push({label:'room toolbar copies a private room invitation containing both inviteCode and friend ref',roomId});
 await a.page.keyboard.press('Escape');

 await b.page.goto(roomLink);const acceptance=b.page.getByRole('dialog',{name:'好友邀请',exact:true});await acceptance.waitFor();
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_invitation_bindings WHERE invitee=?').get(b.identity).n,0,'opening a URL never binds an identity without confirmation');
 await b.page.waitForFunction(()=>!new URLSearchParams(location.hash.split('?')[1]).has('ref'));
 let preserved=new URLSearchParams(new URL(b.page.url()).hash.split('?')[1]);assert.equal(preserved.get('inviteCode'),created.inviteCode);assert.match(b.page.url(),new RegExp('#/room/'+roomId+'\\?'));
 await b.page.screenshot({path:resolve(out,'01-invitation-confirmation.png')});
 await acceptance.getByRole('button',{name:'接受邀请',exact:true}).click();await acceptance.getByRole('heading',{name:'邀请已接受',exact:true}).waitFor();
 assert.equal(db.prepare('SELECT inviter FROM mobile_invitation_bindings WHERE invitee=?').get(b.identity).inviter,a.identity);
 await acceptance.getByRole('button',{name:'开始拼图',exact:true}).click();await acceptance.waitFor({state:'detached'});await ready(b.page);
 preserved=new URLSearchParams(new URL(b.page.url()).hash.split('?')[1]);assert.equal(preserved.get('inviteCode'),created.inviteCode);
 checks.push({label:'hash ref asks for explicit acceptance, stores the relation, and preserves private-room admission and destination'});
 const at=await snapshotTicket(a,roomId),bt=await snapshotTicket(b,roomId);assert.ok(at?.token&&bt?.token);
 // The server generates all task progress and gifts from real claim/drop HTTP
 // actions. Direct SQLite access below is read-only for durable assertions.
 let firstReceipt;for(let i=0;i<20;i++){const receipt=await drop(b,bt);if(i===0)firstReceipt=receipt;const binding=db.prepare('SELECT contributions,qualified_at FROM mobile_invitation_bindings WHERE invitee=?').get(b.identity);if(i<2)assert.equal(binding.qualified_at,null,'one or two new contributions do not qualify yet');if(i===2){assert.ok(binding.qualified_at);assert.equal(binding.contributions,3);}await drop(a,at);}
 const beforeReplay=storedProfile(b),eventCount=db.prepare('SELECT COUNT(*) n FROM mobile_task_events WHERE owner=?').get(b.identity).n;
 const replayed=await api(b,'/api/rooms/'+roomId,{type:'drop',groupId:firstReceipt.mobileContribution.groupId,dx:0,dy:0,seq:1,requestId:firstReceipt.mobileContribution.requestId},bt.token);
 assert.deepEqual(replayed.mobileContribution,firstReceipt.mobileContribution);assert.equal(storedProfile(b).totalXp,beforeReplay.totalXp);assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_task_events WHERE owner=?').get(b.identity).n,eventCount);
 const acceptedAgain=await api(b,'/api/mobile/invitations/accept',{code,requestId:requestId()});assert.equal(acceptedAgain.accepted.alreadyBound,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND kind='invite-refill'").get(a.identity).n,1);
 checks.push({label:'an existing player qualifies only after three post-acceptance contributions; replayed drops and repeated acceptance never duplicate invitation rewards'});
 const taskView=await api(a,'/api/mobile/tasks');assert.equal(taskView.invitation.qualifiedCount,1);assert.equal(taskView.invitation.todayRewarded,1);
 assert.equal(taskView.tasks.find(task=>task.id==='cooperation-10').earned,true);assert.equal(taskView.tasks.find(task=>task.id==='friend-10').earned,true);
 assert.equal(taskView.inventory.find(gift=>gift.kind.startsWith('ten-')).count,2);assert.equal(taskView.inventory.find(gift=>gift.kind==='invite-refill').count,1);
 checks.push({label:'real two-player puzzle contributions award stored ten gifts, daily cooperation, friend cooperation and invitation gifts'});

 await a.page.goto(base+'/#/zh/lobby');await a.page.locator('.mobile-task-entry-badge').waitFor();
 for(const [label,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  await a.page.setViewportSize(viewport);const sheet=await openTasks(a.page);
  await geometry(a.page,`tasks ${label} ${viewport.width}×${viewport.height}`,true);
  await a.page.screenshot({path:resolve(out,`02-tasks-${label}.png`)});
  await sheet.locator('.mobile-invite-link').scrollIntoViewIfNeeded();await a.page.screenshot({path:resolve(out,`03-tasks-invitation-${label}.png`)});
  await sheet.getByRole('tab',{name:/^礼包/}).click();await sheet.locator('.mobile-gift-list').waitFor();
  await geometry(a.page,`gift inventory ${label} ${viewport.width}×${viewport.height}`,label==='landscape');
  await a.page.screenshot({path:resolve(out,`04-gifts-${label}.png`)});
  await closeTasks(a.page);
 }
 checks.push({label:'tasks and unopened inventory stay within both orientations, long panels scroll, sticky close controls work'});

 await a.page.setViewportSize({width:390,height:844});const gifts=await openTasks(a.page);await gifts.getByRole('tab',{name:/^礼包/}).click();
 const ten=gifts.locator('.mobile-gift-card').filter({hasText:'十格小礼'});await ten.getByRole('combobox').selectOption('2');
 const before=storedProfile(a),tenRequest=a.page.waitForRequest(request=>request.url().endsWith('/api/mobile/gifts/open')&&request.method()==='POST');await ten.getByRole('button',{name:'开启2份十格小礼',exact:true}).click();await gifts.getByText('已开启 2 份',{exact:true}).waitFor();
 const energyGiven=Number((await gifts.locator('.mobile-gift-receipt p').textContent()).match(/体力 \+(\d+)/)[1]),after=storedProfile(a);
 assert.equal(after.energy,before.energy+energyGiven);assert.equal(after.totalXp,before.totalXp);assert.equal(after.giftProgress,before.giftProgress);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND kind LIKE 'ten-%' AND opened_at IS NOT NULL").get(a.identity).n,2);
 const originalOpen=(await tenRequest).postDataJSON(),openReplay=await api(a,'/api/mobile/gifts/open',originalOpen);assert.equal(openReplay.opened.energy,energyGiven);assert.equal(storedProfile(a).energy,after.energy);assert.equal(storedProfile(a).totalXp,after.totalXp);
 const duplicate=await fetch(base+'/h5/api/mobile/gifts/open',{method:'POST',headers:{Origin:base,'X-Jigsaw-H5-Session':a.token,'Content-Type':'application/json'},body:JSON.stringify({...originalOpen,requestId:requestId()})});assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,'GIFT_EMPTY');assert.equal(storedProfile(a).energy,after.energy);
 checks.push({label:'replaying a successful gift-open returns its original receipt without more energy; a new request cannot reopen consumed gifts'});
 assert.equal(await ten.count(),0);await a.page.screenshot({path:resolve(out,'05-gifts-opened.png')});
 const refill=gifts.locator('.gift-invite-refill');assert.ok(storedProfile(a).energy>=energyCap(storedProfile(a).level));assert.equal(await refill.getByRole('button',{name:'体力已满，保留补满体力包',exact:true}).isDisabled(),true);
 const fullAttempt=await fetch(base+'/h5/api/mobile/gifts/open',{method:'POST',headers:{Origin:base,'X-Jigsaw-H5-Session':a.token,'Content-Type':'application/json'},body:JSON.stringify({kind:'invite-refill',quantity:1,requestId:requestId()})});assert.equal(fullAttempt.status,409);assert.equal((await fullAttempt.json()).code,'ENERGY_FULL');assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND kind='invite-refill' AND opened_at IS NULL").get(a.identity).n,1);
 await closeTasks(a.page);const activeRoom=await api(a,'/api/rooms',{mode:'random',pieces:108,visibility:'public',requestId:requestId()});
 for(let i=0;storedProfile(a).energy>=energyCap(storedProfile(a).level)&&i<80;i++)await drop(a,activeRoom);
 const depleted=storedProfile(a);assert.ok(depleted.energy<energyCap(depleted.level),'real non-starter puzzle play spends energy');
 await a.page.reload();await a.page.locator('.mobile-task-entry').waitFor();const restock=await openTasks(a.page);await restock.getByRole('tab',{name:/^礼包/}).click();
 const refillRequest=a.page.waitForRequest(request=>request.url().endsWith('/api/mobile/gifts/open')&&request.method()==='POST');await restock.locator('.gift-invite-refill').getByRole('button',{name:'使用1份补满体力包',exact:true}).click();await restock.getByText('体力已补满',{exact:true}).waitFor();
 const replenished=storedProfile(a);assert.equal(replenished.energy,energyCap(depleted.level));assert.equal(replenished.totalXp,depleted.totalXp);assert.equal(replenished.giftProgress,depleted.giftProgress);assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND kind='invite-refill' AND opened_at IS NULL").get(a.identity).n,0);
 const refillReplay=await api(a,'/api/mobile/gifts/open',(await refillRequest).postDataJSON());assert.equal(refillReplay.opened.energy,energyCap(depleted.level)-depleted.energy);assert.equal(storedProfile(a).energy,replenished.energy);
 await a.page.screenshot({path:resolve(out,'06-invitation-refill-used.png')});await restock.getByRole('button',{name:'继续拼图',exact:true}).click();await restock.waitFor({state:'detached'});
 checks.push({label:'qualified invitations store a full-energy gift; full energy preserves it in UI and server; real energy spending allows one refill; receipt replay never awards twice'});
 assert.deepEqual(external,[],'test attempted an external request');assert.deepEqual(errors,[],'browser runtime errors');
 const report={passed:checks.length,base,isolatedDatabase:databasePath,checks,errors,external};writeFileSync(resolve(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,screenshots:out},null,2));
}catch(error){try{await a?.page.screenshot({path:resolve(out,'failure.png'),fullPage:true});}catch{}throw error;}
finally{await browser.close();db.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}

