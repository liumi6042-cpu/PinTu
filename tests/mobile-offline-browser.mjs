import assert from 'node:assert/strict';
import http from 'node:http';
import {createReadStream,existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {extname,isAbsolute,relative,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {createOfflineRoomServer,pendingOfflineClears} from '../lib/offline-play.ts';
import {MOBILE_PRIVACY_CONSENT_KEY,MOBILE_PRIVACY_VERSION} from '../mobile/privacy-policy.ts';

const workspace=resolve(import.meta.dirname,'..');
function packageAt(path){
 const directory=resolve(path),parent=existsSync(resolve(directory,'build-record.json'))?directory:resolve(directory,'..');
 if(!existsSync(resolve(parent,'build-record.json')))return null;
 const record=JSON.parse(readFileSync(resolve(parent,'build-record.json'),'utf8')).platforms?.find(item=>item.platform==='taptap'&&item.config?.offlineCatalog);
 if(!record)return null;
 const root=existsSync(resolve(directory,'game.js'))?directory:resolve(directory,'jigsaw-nook');
 return existsSync(resolve(root,'game.js'))?{root,config:record.config}:null;
}
const packaged=process.argv[2]?packageAt(process.argv[2]):readdirSync(resolve(workspace,'work')).filter(name=>name.startsWith('taptap-package-'))
 .map(name=>resolve(workspace,'work',name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs).map(packageAt).find(Boolean);
assert.ok(packaged,'A built TapTap package with offlineCatalog is required');
const output=resolve(process.env.OFFLINE_SHOTS_DIR||resolve(workspace,'work/offline-play-logs/shots'));
mkdirSync(output,{recursive:true});
const report={package:packaged.root,output,checks:[],screenshots:[],abortedExternal:[],blockedMedia:[],pageErrors:[],freshConsentReachedOffline:false,completionMethod:'Node offline server seed, then real pointer drag of the last piece'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(packaged.root,'.'+(path==='/'?'/index.html':path));
 const part=relative(packaged.root,file);
 if(part.startsWith('..')||isAbsolute(part)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});createReadStream(file).pipe(res);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const check=(name)=>report.checks.push(name);
async function shot(page,name){const file=resolve(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function instrument(page){
 await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__);
 await page.evaluate(()=>{
  const {stage,app}=window.__JIGSAW_SHARED__,draw={buttons:[],texts:[]};window.__OFFLINE_DRAW=draw;
  const begin=stage.begin.bind(stage),text=stage.text.bind(stage),button=stage.button.bind(stage);
  stage.begin=(...args)=>{draw.buttons=[];draw.texts=[];return begin(...args);};
  stage.text=(value,...args)=>{draw.texts.push(String(value));return text(value,...args);};
  stage.button=(r,label,fn,options)=>{draw.buttons.push({r:{...r,x:r.x+stage.offset.x,y:r.y+stage.offset.y},label,disabled:!!options?.disabled});return button(r,label,fn,options);};
  app.invalidate();
 });
}
const hasText=(page,text)=>page.waitForFunction(value=>window.__OFFLINE_DRAW?.texts.some(text=>text.includes(value)),text);
async function click(page,label){
 await page.waitForFunction(label=>window.__OFFLINE_DRAW?.buttons.some(button=>button.label===label&&!button.disabled&&button.r.y>=0&&button.r.y+button.r.h<=innerHeight),label);
 const r=await page.evaluate(label=>window.__OFFLINE_DRAW.buttons.find(button=>button.label===label&&!button.disabled&&button.r.y>=0&&button.r.y+button.r.h<=innerHeight).r,label);
 await page.mouse.click(r.x+r.w/2,r.y+r.h/2);
}
async function openPage(viewport,{consent=true,seed={},mediaFailure=false}={}){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
 // All requests are intercepted before navigation; production apiBase is never contacted.
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(new URL(url).origin!==origin){report.abortedExternal.push(url);return route.abort('internetdisconnected');}
  if(mediaFailure&&/\.(woff2?|ttf|mp3|wav)(?:\?|$)/.test(url)){report.blockedMedia.push(url);return route.abort('internetdisconnected');}
  return route.continue();
 });
 if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>{report.abortedExternal.push(socket.url());socket.close();});
 await context.addInitScript(({consent,seed,key,version})=>{
  if(consent)localStorage.setItem(key,JSON.stringify({version,necessary:true,hongKongStorage:true}));
  localStorage.setItem('jigsaw:room-guide:v1','done');
  for(const [key,value]of Object.entries(seed))localStorage.setItem(key,value);
 },{consent,seed,key:MOBILE_PRIVACY_CONSENT_KEY,version:MOBILE_PRIVACY_VERSION});
 const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await instrument(page);
 return {context,page};
}
const firstLevel=packaged.config.offlineCatalog.chapters[0].levels[0];
async function openFirst(page){
 await click(page,'离线拼图');await hasText(page,'离线模式：');
 await click(page,'拼第 1 格（'+firstLevel.pieces+' 片）');
 await page.waitForFunction(()=>{const {app}=window.__JIGSAW_SHARED__;return app.route==='room'&&app.imageReady&&app.board?.imagePreparation.phase==='ready'&&!app.busy;});
}
async function drag(page,{finish=false}={}){
 // Use the real board geometry and real pointer events, including its pick-up path.
 const geometry=await page.evaluate(finish=>{
  const {app,stage}=window.__JIGSAW_SHARED__,board=app.board;
  app.modal=null;app.fitRoom();app.invalidate();
  const unit=board.board.width/board.state.cols;
  for(const group of [...board.state.groups].reverse()){
   if(group.locked)continue;
   for(const piece of group.pieces){
    const x=board.board.x+(piece%board.state.cols+.5)*unit,y=board.board.y+(Math.floor(piece/board.state.cols)+.5)*unit;
    const screen=(x,y)=>({x:board.rect.x+board.camera.x+x*board.camera.z,y:board.rect.y+board.camera.y+y*board.camera.z});
    const from=screen(x+group.dx,y+group.dy),to=finish?screen(x,y):{x:from.x+9,y:from.y+7};
    if(from.x<board.rect.x+10||from.y<board.rect.y+60||from.x>board.rect.x+board.rect.w-10||from.y>board.rect.y+board.rect.h-78||stage.hasHit(from.x,from.y))continue;
    return {from,to,id:group.id,room:app.room.ticket.room.id,before:localStorage.getItem('jigsaw:offline-room:v1:'+app.room.ticket.room.id)};
   }
  }
  return null;
 },finish);
 assert.ok(geometry,'A draggable piece must be reachable');
 await page.waitForTimeout(100);
 await page.mouse.move(geometry.from.x,geometry.from.y);await page.mouse.down();
 await page.mouse.move(geometry.to.x,geometry.to.y,{steps:12});await page.mouse.up();
 await page.waitForFunction(({id,before})=>localStorage.getItem('jigsaw:offline-room:v1:'+id)!==before,{id:geometry.room,before:geometry.before});
 return geometry.room;
}
try{
 for(const [label,viewport]of [['landscape',{width:844,height:390}],['portrait',{width:390,height:844}]]){
  const {context,page}=await openPage(viewport,{consent:label!=='landscape'});
  if(label==='landscape'){
   await hasText(page,'同意并登录');await click(page,'同意并登录');
  }
  await hasText(page,'离线拼图');await shot(page,label+'-01-startup');check(label+': startup offline entry');
  await click(page,'离线拼图');await hasText(page,'离线模式：');await shot(page,label+'-02-chapter');
  if(label==='landscape')report.freshConsentReachedOffline=true;
  await page.mouse.move(viewport.width/2,viewport.height*.75);await page.mouse.wheel(0,10000);
  await hasText(page,'离线图片');await shot(page,label+'-03-pictures');
  // The free row uses the same local room transport, with both fixed piece choices.
  await click(page,'选择图片');await hasText(page,'48 片');await hasText(page,'108 片');
  await click(page,'48 片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.imageReady);
  assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.offlineRoom),true);
  await page.evaluate(()=>window.__JIGSAW_SHARED__.app.exitRoom());
  await click(page,'拼第 1 格（'+firstLevel.pieces+' 片）');
  await page.waitForFunction(()=>{const {app}=window.__JIGSAW_SHARED__;return app.route==='room'&&app.imageReady&&!app.busy;});
  const room=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.room.ticket.room.id);
  const image=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.roomImage);
  assert.equal(new URL(image,origin).origin,origin);assert.ok(!report.abortedExternal.includes(image));
  await shot(page,label+'-04-board');check(label+': chapter/pictures/board use packaged artwork');
  await drag(page);await shot(page,label+'-05-drag');check(label+': real drag persisted by offline batch');
  const persisted=await page.evaluate(id=>JSON.parse(localStorage.getItem('jigsaw:offline-room:v1:'+id)),room);
  assert.ok(persisted.revision>0);
  await page.evaluate(()=>window.__JIGSAW_SHARED__.app.exitRoom());
  await click(page,'拼第 1 格（'+firstLevel.pieces+' 片）');
  await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.imageReady);
  assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.room.ticket.room.id),room);
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('jigsaw:offline-room:v1:'+id)).revision,room),persisted.revision);
  await shot(page,label+'-06-resumed');check(label+': same room and persisted revision resumed');
  const blockedBefore=report.abortedExternal.length;
  await page.evaluate(()=>{const {app}=window.__JIGSAW_SHARED__;for(const modal of ['invite','members','chat','manage','social','tasks'])app.showModal(modal);for(const tool of ['hint','underlay','chat'])app.roomTool(tool);app.refreshRoute();void app.loadChat();void app.loadAssistance();void app.loadRoomHistory();});
  await hasText(page,'需要联网才能使用');
  assert.equal(report.abortedExternal.length,blockedBefore,'Online-only controls sent a request');check(label+': online-only controls gated');
  await context.close();
 }
 // Seed using the actual offline service, never a hand-written storage schema.
 const values=new Map(),storage={get:key=>values.get(key)??null,set:(key,value)=>values.set(key,value),remove:key=>values.delete(key)};
 const offline=createOfflineRoomServer({catalog:packaged.config.offlineCatalog,storage,now:()=>Date.now(),randomId:()=>randomBytes(16).toString('hex')});
 const ticket=offline.createRoom({kind:'level',levelId:firstLevel.id}),keep=ticket.room.puzzle.groups[0].id;
 const drop=async(groupId,dx=0)=>await (await offline.fetch('/api/rooms/'+ticket.room.id,{method:'POST',body:JSON.stringify({type:'drop',groupId,dx,dy:0})})).json();
 for(const group of ticket.room.puzzle.groups)if(group.id!==keep)await drop(group.id);
 const seeded=await drop(keep,120);assert.equal(seeded.puzzle.groups.filter(group=>!group.locked).length,1);assert.equal(pendingOfflineClears(storage).length,0);
 for(const [label,viewport]of [['landscape',{width:844,height:390}],['portrait',{width:390,height:844}]]){
  const {page,context}=await openPage(viewport,{seed:Object.fromEntries(values),mediaFailure:true});
  await openFirst(page);await shot(page,label+'-07-seeded');
  await drag(page,{finish:true});
  await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion');
  await hasText(page,'离线完成 · 联网后同步通关');await hasText(page,'下一关');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jigsaw:offline-clears:v1')).length),1);
  await shot(page,label+'-08-completion');await click(page,'下一关');
  await page.waitForFunction(()=>{const {app}=window.__JIGSAW_SHARED__;return app.imageReady&&app.room.snapshot.levelId==='ch1-2';});
  check(label+': final real drag queues clear, completion and next level work with fonts/audio blocked');
  if(label==='landscape'){
   // Keep network interception in force. Stub only the client boundary to test
   // reconnection/sync/fallback wiring without ever contacting a real account.
   const previous=await page.evaluate(async()=>{
    const {app,client}=window.__JIGSAW_SHARED__,room=app.room.ticket.room.id,levels=app.offline.view;
    window.__OFFLINE_SYNC_CALLS=[];
    client.config.capabilities.offlineLevelClears=true;
    client.start=async()=>{};client.refresh=async()=>client.profile;app.social.refresh=async()=>{};
    client.json=async path=>{if(path==='/api/levels')return levels;throw Error('Unexpected online load: '+path);};
    client.post=async(path,body)=>{
     window.__OFFLINE_SYNC_CALLS.push({path,body});
     return {results:body.clears.map(clear=>({clearId:clear.clearId,levelId:clear.levelId,status:'accepted',energy:30})),levels,profile:{code:'123456789',name:'离线检查',level:1,energy:40,energyCap:100,supply:{energy:0,create:0},serverTime:Date.now()}};
    };
    await app.start();return room;
   });
   await page.waitForFunction(()=>window.__JIGSAW_SHARED__.client.profile?.energy===40&&!localStorage.getItem('jigsaw:offline-clears:v1'));
   assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.room.ticket.room.id),previous,'Reconnect yanked the offline board');
   assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.offline.active),false);
   await hasText(page,'离线通关已同步，体力 +30');
   const calls=await page.evaluate(()=>window.__OFFLINE_SYNC_CALLS);assert.equal(calls.length,1);assert.match(calls[0].body.requestId,/^[a-f0-9]{32}$/);
   assert.equal(calls[0].path,'/api/levels/offline-clears');assert.ok(!('roomId' in calls[0].body.clears[0]));
   assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('jigsaw:levels-cache:v1')).chapters[0].levels[0].status==='cleared'));
   check('client boundary simulation: reconnect keeps board, ordered clear sync applies profile/levels/cache and stamina note');
   const fallback=await page.evaluate(async levelId=>{
    const {app,client}=window.__JIGSAW_SHARED__,before=app.room.ticket.room.id;
    client.createRoom=async()=>{throw Object.assign(Error('关卡尚未解锁'),{status:403});};await app.launch({mode:'level',levelId});
    const httpRoom=app.room.ticket.room.id;
    client.createRoom=async()=>{throw new TypeError('Failed to fetch');};await app.launch({mode:'level',levelId});
    return {before,httpRoom,local:app.offlineRoom,level:app.room.snapshot.levelId,note:app.message,ready:app.ready};
   },firstLevel.id);
   assert.equal(fallback.httpRoom,fallback.before);assert.equal(fallback.local,true);assert.equal(fallback.level,firstLevel.id);assert.equal(fallback.ready,true);
   assert.equal(fallback.note,'网络不可用，先离线拼，联网后自动同步通关');
   check('client boundary simulation: HTTP 403 retains room; network failure opens packaged level offline');
  }
  await context.close();
 }
 assert.ok(report.abortedExternal.some(url=>url===packaged.config.apiBase+'/config'),'Expected production startup request was not intercepted');
 assert.ok(!report.abortedExternal.some(url=>/\/api\/rooms\//.test(url)),'An offline room ID reached the network transport');
 assert.equal(report.pageErrors.length,0,'Unexpected page errors');
 report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
finally{
 await browser.close();await new Promise(done=>server.close(done));
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
