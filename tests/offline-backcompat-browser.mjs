// Manual local-only acceptance: node tests/offline-backcompat-browser.mjs [--forward|--backward]
// Overrides: --v9 PATH --v17 PATH --control PATH --live PATH; never part of npm test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import './ts-register.mjs';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf('--'+name);return resolve(i<0?fallback:args[i+1]);};
const output=resolve(process.env.BACKCOMPAT_SHOTS_DIR||resolve(root,'work/offline-play-logs/backcompat'));
assert.ok(relative(root,output)&&!relative(root,output).startsWith('..')&&!isAbsolute(relative(root,output)),'Screenshots must stay in this worktree');
mkdirSync(output,{recursive:true});
const tempParent=resolve(root,'work/offline-backcompat-tmp');mkdirSync(tempParent,{recursive:true});
const runtime=mkdtempSync(resolve(tempParent,new Date().toISOString().replace(/[:.]/g,'-')+'-'));
const origin='https://jigsawnook.online',api=origin+'/h5-mobile-v3',game=origin+'/taptap-mobile-v3/';
const packages=[{id:'v9',root:option('v9',resolve(root,'../taptap-package-20261024-h5-feedback-v9/jigsaw-nook')),levels:false},
 {id:'v17',root:option('v17',resolve(root,'../play-path/work/taptap-package-20261027-play-path-v17/jigsaw-nook')),levels:true},
 {id:'v18',root:option('control',resolve(root,'work/taptap-package-20261027-offline-play-v18/jigsaw-nook')),levels:true}];
const live=option('live',resolve(root,'../play-path/work/mobile-backend-releases/20261027-chapter-name'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wav':'audio/wav','.mp3':'audio/mpeg','.css':'text/css'};
const report={script:'tests/offline-backcompat-browser.mjs',startedAt:new Date().toISOString(),output,
 safety:{externalHTTP:'all browser requests fulfilled locally or aborted; redirects never followed',realtime:'blocked; ordinary client polling used',backend:'loopback upstream plus socket/fetch guard',builds:'none; existing outputs/mobile and outputs/h5 reused',databases:'fresh harness-owned directories only'},backends:[],packages:[],screenshots:[]};
const rid=()=>randomBytes(16).toString('hex');
let browser;
const guard=resolve(runtime,'local-only.mjs');
writeFileSync(guard,`import net from 'node:net';
const local=h=>['127.0.0.1','localhost','::1','[::1]'].includes(String(h));
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];const host=typeof o==='object'?o.host??o.hostname??'localhost':typeof a[1]==='string'?a[1]:'localhost';if(!local(host))throw Error('LOCAL_ONLY_SOCKET_BLOCKED '+host);return connect.apply(this,a);};
const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!local(u.hostname))throw Error('LOCAL_ONLY_FETCH_BLOCKED '+u.origin);return original(input,{...init,redirect:'manual'});};
`);

function privacy(pkg){
 const source=readFileSync(resolve(pkg.root,'game.js'),'utf8');
 const literal=source.match(/jigsaw:mobile-privacy:([^"']+)/);
 let version=literal&&/^\d{4}-/.test(literal[1])?literal[1]:null;
 if(!version){const variable=source.match(/["']jigsaw:mobile-privacy:["']\s*\+\s*([\w$]+)/)?.[1];
  assert.ok(variable,`${pkg.id}: cannot find package privacy version`);
  version=source.match(new RegExp('(?:var |let |const |[,;])'+variable.replace(/\$/g,'\\$')+'=["\']([^"\']+)["\']'))?.[1];}
 assert.ok(version,`${pkg.id}: privacy version missing`);
 return {version,key:'jigsaw:mobile-privacy:'+version,exposed:source.includes('__JIGSAW_SHARED__'),sha256:createHash('sha256').update(source).digest('hex')};
}
async function startBackend(cwd,label){
 const directory=resolve(runtime,label);mkdirSync(directory);
 const contentRoot=resolve(root,'../../../content-admin/work');
 const env={...process.env,NODE_OPTIONS:'',H5_HOST:'127.0.0.1',H5_PORT:'0',H5_ALLOWED_ORIGINS:origin,
  H5_PUBLIC_API_BASE:'/h5',H5_PUBLIC_GAME_BASE:'/',H5_UPSTREAM:'http://127.0.0.1:1',H5_UPSTREAM_ORIGIN:'http://127.0.0.1:1',
  H5_SESSION_DB:resolve(directory,'sessions.sqlite'),MOBILE_DB:resolve(directory,'mobile.sqlite'),MOBILE_ASSET_DIR:resolve(cwd,'public'),
  JIGSAW_CONTENT_DIR:resolve(contentRoot,'content-releases'),MOBILE_DAILY_CONFIG:resolve(contentRoot,'daily-bridge/configuration.json'),
  MOBILE_TASK_REWARDS_CONFIG:resolve(contentRoot,'task-rewards/configuration.json'),MOBILE_GAME_SETTINGS_CONFIG:resolve(contentRoot,'game-settings/configuration.json'),MOBILE_ALBUMS_CONFIG:resolve(contentRoot,'albums/configuration.json'),
  MOBILE_DAILY_APPEARANCES:resolve(directory,'daily-appearances'),H5_AD_ASSISTANCE_ENABLED:'false',H5_REWARDED_AD_UNIT:'',
  TAPTAP_APP_ID:'',TAPTAP_APP_SECRET:'',TAPTAP_CODE2SESSION_URL:'http://127.0.0.1:1',MOBILE_TAP_MULTIPLAYER_ENABLED:'false'};
 delete env.MOBILE_SOLO_LOCAL_PLAY;delete env.MOBILE_OFFLINE_LEVEL_CLEARS;
 for(const key of ['JIGSAW_CONTENT_DIR','MOBILE_DAILY_CONFIG','MOBILE_TASK_REWARDS_CONFIG','MOBILE_GAME_SETTINGS_CONFIG','MOBILE_ALBUMS_CONFIG'])assert.ok(existsSync(env[key]),key+' missing '+env[key]);
 const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server/h5-gateway.mjs'],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';const append=b=>{logs+=b.toString();};child.stdout.on('data',append);child.stderr.on('data',append);
 try{
  let base;
  for(let i=0;i<100;i++){base=logs.match(/H5 preview: (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];if(base)break;if(child.exitCode!==null)throw Error('Backend exited '+logs);await delay(100);}
  assert.ok(base,'Backend startup timeout '+logs);assert.notEqual(new URL(base).port,'3211');
  const health=await (await fetch(base+'/healthz',{redirect:'manual'})).json();assert.equal(health.ok,true);
  const config=await (await fetch(base+'/h5/config',{redirect:'manual'})).json();
  const record={label,cwd,base,health,capabilities:config.capabilities,contentInputs:Object.fromEntries(Object.entries(env).filter(([k])=>k==='JIGSAW_CONTENT_DIR'||/^MOBILE_.*CONFIG$/.test(k)))};report.backends.push(record);
  return {base,child,record,logs:()=>logs,async close(){child.kill();await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);});writeFileSync(resolve(output,label+'-backend.log'),logs);}};
 }catch(e){child.kill();writeFileSync(resolve(output,label+'-backend.log'),logs);throw e;}
}
async function localCall(backend,result,path,session,body,token){
 const response=await fetch(backend.base+'/h5'+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json','X-Jigsaw-Artwork-Snapshot':'1',...(session?{'X-Jigsaw-H5-Session':session}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 result.localAPI.push({path,status:response.status,method:body===undefined?'GET':'POST',...(body?.type?{action:body.type}:{})});
 if(response.status>=400)result.httpErrors.push({source:'local helper',url:backend.base+'/h5'+path,status:response.status,body:data});
 assert.ok(response.ok,`${path}: ${response.status} ${text}`);return data;
}
async function instrument(page){
 await page.evaluate(()=>{
  const {stage,app}=window.__JIGSAW_SHARED__,draw={texts:[]};window.__BACKCOMPAT_DRAW=draw;
  const begin=stage.begin.bind(stage),text=stage.text.bind(stage);
  stage.begin=(...args)=>{draw.texts=[];return begin(...args);};
  stage.text=(value,...args)=>{draw.texts.push(String(value));return text(value,...args);};app.invalidate();
 });
}
async function state(page){return page.evaluate(()=>{const g=window.__JIGSAW_SHARED__;return g?{ready:g.app.ready,route:g.app.route,modal:g.app.modal,startupError:g.app.startupError,message:g.app.message,imageReady:g.app.imageReady,imageError:g.app.imageError,privacy:g.app.needsPrivacyChoice,login:g.app.loginDialogActive,roomId:g.app.room?.ticket.room.id,levelId:g.app.room?.snapshot.levelId,localPlay:g.app.room?.localPlay,texts:window.__BACKCOMPAT_DRAW?.texts}:null;}).catch(()=>null);}
async function shot(page,result,name){const file=resolve(output,name+'.png');await page.screenshot({path:file});result.screenshots.push(file);report.screenshots.push(file);}
async function waitRoom(page){await page.waitForFunction(()=>{const a=window.__JIGSAW_SHARED__?.app;return a?.route==='room'&&a.imageReady&&a.board?.network&&!a.busy;},null,{timeout:20000});}
async function complete(page,result,backend,{forward=false,kind}){
 const info=await page.evaluate(()=>{const {app,client}=window.__JIGSAW_SHARED__;return {roomId:app.room.ticket.room.id,token:app.room.ticket.token,session:localStorage.getItem('jigsaw:h5-session:'+client.platform.config.apiBase),localPlay:app.room.localPlay,levelId:app.room.snapshot.levelId};});
 let drops=0;
 if(forward){
  // Use the unchanged package's actual RoomClient acquire/drop pipeline for EVERY drop.
  assert.equal(info.localPlay,false,'Live backend must not select solo local mode');
  drops=await page.evaluate(async()=>{
   const {app}=window.__JIGSAW_SHARED__;let count=0;
   while(!app.room.snapshot.completedAt){
    if(count>600)throw Error('Client completion did not converge');
    const group=app.room.state.groups.find(g=>!g.locked);if(!group)throw Error('No movable group');
    if(!await app.board.network.acquire(group.id))throw Error('Acquire failed: '+app.room.message);
    await app.board.network.drop(group.id,0,0);count++;
   }return count;
  });
 }else{
  let snap=await localCall(backend,result,'/api/rooms/'+info.roomId,info.session,undefined,info.token);
  while(!snap.completedAt){
   assert.ok(drops<600,'API completion did not converge');const group=snap.puzzle.groups.find(g=>!g.locked);assert.ok(group);
   await localCall(backend,result,'/api/rooms/'+info.roomId,info.session,{type:'claim',groupId:group.id,requestId:rid()},info.token);
   snap=await localCall(backend,result,'/api/rooms/'+info.roomId,info.session,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},info.token);drops++;
  }
 }
 await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.room?.snapshot.completedAt,null,{timeout:15000});
 await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion',null,{timeout:15000});
 const settled=await page.evaluate(()=>{const a=window.__JIGSAW_SHARED__.app;return {roomId:a.room.snapshot.id,result:a.room.snapshot.mobileResult,placed:a.room.snapshot.puzzle.groups.filter(g=>g.locked).reduce((n,g)=>n+g.pieces.length,0)};});
 result.completions.push({kind,drops,...settled});assert.ok(drops>=8,kind+' requires >=8 successful drops');return settled;
}
async function runPackage(pkg,backend,forward=false){
 const result={id:forward?'fwd':pkg.id,package:pkg.root,backend:backend.record.label,checks:[],pageErrors:[],consoleErrors:[],httpErrors:[],httpResponses:[],abortedURLs:[],blockedWebSockets:[],requestFailures:[],requests:[],localAPI:[],completions:[],screenshots:[],failures:[]};report.packages.push(result);
 let context,page;const pending=new Set();
 try{
  const priv=privacy(pkg);result.packageEvidence=priv;assert.ok(priv.exposed,'Package must expose shared app');
  context=await browser.newContext({viewport:pkg.id==='v9'?{width:390,height:844}:{width:844,height:390},deviceScaleFactor:1,serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());let body;try{body=request.postDataJSON();}catch{}
   result.requests.push({url:url.href,method:request.method(),...(body?.type?{action:body.type}:{}),...(body?.mode?{mode:body.mode}:{}),...(body?.visibility?{visibility:body.visibility}:{})});
   if(url.origin===origin&&url.pathname.startsWith('/taptap-mobile-v3/')){
    const localPath=decodeURIComponent(url.pathname.slice('/taptap-mobile-v3/'.length))||'index.html',file=resolve(pkg.root,localPath),rel=relative(pkg.root,file);
    if(rel.startsWith('..')||isAbsolute(rel)||!existsSync(file)||!statSync(file).isFile())return route.fulfill({status:404,body:'Package file missing: '+localPath});
    return route.fulfill({status:200,path:file,contentType:mime[extname(file)]||'application/octet-stream'});
   }
   if(url.origin===origin&&url.pathname.startsWith('/h5-mobile-v3/')){
    const target=backend.base+'/h5/'+url.pathname.slice('/h5-mobile-v3/'.length)+url.search;
    try{const response=await route.fetch({url:target,method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{postData:request.postDataBuffer()}:{}),maxRedirects:0,maxRetries:0,timeout:20000});return await route.fulfill({response});}
    catch(e){result.failures.push('Local route fetch: '+url.href+' '+e.message);return route.abort('failed').catch(()=>{});}
   }
   result.abortedURLs.push(url.href);return route.abort('blockedbyclient');
  });
  assert.equal(typeof context.routeWebSocket,'function','WebSocket routing required to guarantee no production connection');
  await context.routeWebSocket('**/*',socket=>{result.blockedWebSockets.push(socket.url());socket.close({code:1000,reason:'Local acceptance: use HTTP polling'});});
  let session;
  if(pkg.id==='v9'){session=(await localCall(backend,result,'/session',null,{})).token;result.identity='fresh guest injected (v9 TapTap-only bridge)';}
  else result.identity='package desktop TapTap fallback creates fresh guest';
  await context.addInitScript(({key,version,session,api})=>{
   localStorage.setItem(key,JSON.stringify({version,necessary:true,hongKongStorage:true}));
   localStorage.setItem('jigsaw:room-guide:v1','done');
   if(session)localStorage.setItem('jigsaw:h5-session:'+api,session);
  },{key:priv.key,version:priv.version,session,api});
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>result.pageErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  page.on('requestfailed',r=>result.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('response',r=>{
   let action;try{action=r.request().postDataJSON()?.type;}catch{}
   result.httpResponses.push({url:r.url(),method:r.request().method(),status:r.status(),...(action?{action}:{})});
   if(r.status()<400)return;const p=(async()=>{result.httpErrors.push({source:'browser',url:r.url(),status:r.status(),body:await r.text().catch(e=>'Unavailable: '+e.message)});})();pending.add(p);p.finally(()=>pending.delete(p));
  });
  await page.goto(game,{waitUntil:'domcontentloaded'});
  if(pkg.id==='v9'){
   // This historical package mandates the native TapTap bridge even with a stored
   // session. Record that known desktop limitation, then run its OWN guest startup
   // branch with the injected real local session. Restore the platform before any
   // gameplay. No bind reply, profile, config response, or room action is mocked.
   await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__?.app.startupError);
   result.nativeStartup=await state(page);await shot(page,result,'v9-00-native-bridge');
   await page.evaluate(async()=>{
    const {client,app}=window.__JIGSAW_SHARED__,id=client.platform.config.id;
    try{client.platform.config.id='h5';await client.start();}finally{client.platform.config.id=id;}
    await app.start();
   });
   result.identity+='; native bridge unavailable as expected; test bootstrap uses shipped guest startup branch, restores taptap before gameplay';
  }
  await page.waitForFunction(()=>window.__JIGSAW_SHARED__?.app.ready&&!window.__JIGSAW_SHARED__.app.busy,null,{timeout:30000});
  await instrument(page);result.startup=await state(page);result.checks.push('startup and /h5/config 200; lobby/newcomer redirect reached');
  await page.evaluate(async()=>{const {app,client}=window.__JIGSAW_SHARED__;if(app.room)app.exitRoom();app.modal=null;app.navigate('lobby');await client.json('/api/lobby');});
  await shot(page,result,forward?'fwd-01-lobby':pkg.id+'-01-lobby');result.checks.push('lobby list 200');
  // Complete level first while the fresh guest has first-room protection; no economy overrides.
  if(pkg.levels){
   const levels=await page.evaluate(async()=>{const {app,client}=window.__JIGSAW_SHARED__;const view=await client.json('/api/levels');await app.launch({mode:'level',levelId:'ch1-1'});return view;});
   result.levels={firstClearEnergy:levels.firstClearEnergy};await waitRoom(page);
   const done=await complete(page,result,backend,{forward,kind:'level ch1-1'});
   assert.equal(done.result.levelClear.firstClear,true);assert.equal(done.result.levelClear.energy,levels.firstClearEnergy);
   await page.waitForFunction(()=>window.__BACKCOMPAT_DRAW?.texts.some(t=>t.includes('通关体力 +')),null,{timeout:10000});
   result.levels.visibleReward=await page.evaluate(()=>window.__BACKCOMPAT_DRAW.texts.filter(t=>t.includes('体力')));
   await shot(page,result,forward?'fwd-03-level':pkg.id+'-04-level');result.checks.push('levels 200; level 1 completed; first-clear stamina visible');
  }
  await page.evaluate(async()=>{const {app}=window.__JIGSAW_SHARED__;if(app.room)app.exitRoom();await app.launch({mode:'random',pieces:48,visibility:'private'});});
  await waitRoom(page);
  if(!forward)await shot(page,result,pkg.id+'-02-room');
  await complete(page,result,backend,{forward,kind:'private solo room'});
  await shot(page,result,forward?'fwd-02-room-complete':pkg.id+'-03-complete');result.checks.push('private room created; >=8 drops; completed with popup');
  if(forward){
   const {recordOfflineClear}=await import('../lib/offline-play.ts'),values=new Map(),storage={get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};
   const catalog=JSON.parse(readFileSync(resolve(pkg.root,'../build-record.json'),'utf8')).platforms.find(p=>p.config?.offlineCatalog).config.offlineCatalog;
   const level=catalog.chapters.flatMap(c=>c.levels).find(l=>l.id==='ch1-2');assert.ok(level);
   recordOfflineClear(storage,{levelId:level.id,roomId:rid(),completedAt:Date.now(),elapsedMs:5000,pieces:level.pieces,clearId:rid()});
   const key='jigsaw:offline-clears:v1',before=values.get(key);assert.ok(before);
   await page.evaluate(({key,before})=>{const {app}=window.__JIGSAW_SHARED__;app.exitRoom();app.navigate('lobby');localStorage.setItem(key,before);},{key,before});
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__JIGSAW_SHARED__?.app.ready&&!window.__JIGSAW_SHARED__.app.busy);await instrument(page);
   // Also exercise the real startup reconnect entry point with a pending clear.
   await page.evaluate(()=>window.__JIGSAW_SHARED__.app.start());await delay(800);
   const after=await page.evaluate(key=>({stored:localStorage.getItem(key),message:window.__JIGSAW_SHARED__.app.message,texts:window.__BACKCOMPAT_DRAW?.texts}),key);
   result.pendingClear={seedMethod:'lib/offline-play.ts recordOfflineClear',before,after:after.stored,message:after.message,texts:after.texts};assert.equal(after.stored,before,'Pending clear must be byte-for-byte unchanged');assert.equal(after.message,'','Reconnect must show no error note');
   await shot(page,result,'fwd-04-queued');result.checks.push('pending ch1-2 clear survives reload and reconnect unchanged, without an error note');
  }
  result.actionTypes=[...new Set(result.requests.map(r=>r.action).filter(Boolean))];
  result.actionCounts=Object.fromEntries(result.actionTypes.map(t=>[t,result.requests.filter(r=>r.action===t).length]));
  result.offlineClearsRequests=result.requests.filter(r=>r.url.includes('/api/levels/offline-clears'));
  for(const path of ['/config','/api/lobby',...(pkg.levels?['/api/levels']:[])])assert.ok(result.httpResponses.some(r=>new URL(r.url).pathname==='/h5-mobile-v3'+path&&r.status===200),path+' must return HTTP 200');
  result.pollingResponses=result.httpResponses.filter(r=>r.method==='GET'&&/\/api\/rooms\/[a-f0-9]{32}$/.test(new URL(r.url).pathname));
  assert.ok(result.pollingResponses.some(r=>r.status===200),'Blocked realtime must fall back to successful HTTP polling');
  assert.equal(result.offlineClearsRequests.length,0,'Unexpected offline-clears request');
  if(forward){assert.ok(!result.actionTypes.includes('batch'),'Live backend received a batch');assert.ok(result.actionCounts.claim>=16&&result.actionCounts.drop>=16);result.gameplayResponses=result.httpResponses.filter(r=>['claim','drop'].includes(r.action));assert.equal(result.gameplayResponses.length,result.actionCounts.claim+result.actionCounts.drop);assert.ok(result.gameplayResponses.every(r=>r.status===200));result.checks.push('all gameplay drops use normal client claim/drop HTTP 200; no batch; no offline-clears request');}
  if(pkg.id==='v18'&&!forward){assert.equal(backend.record.capabilities.offlineLevelClears,true);result.checks.push('offlineLevelClears capability true');}
  assert.equal(result.pageErrors.length,0,'Page errors');
 }catch(error){result.failures.push(error.stack);if(page){result.failureState=await state(page);await shot(page,result,result.id+'-failure').catch(()=>{});}}
 finally{await context?.close();await Promise.allSettled([...pending]);}
 result.httpErrors.forEach(e=>{e.explanation=e.status===402?'Economy refusal; see response code and scenario (a check fails unless explicitly expected).':'Unexpected HTTP failure; preserved response body and failing scenario.';});
 if(result.httpErrors.length)result.failures.push('HTTP >=400 observed; see httpErrors');
 result.passed=result.failures.length===0;
 console.log(JSON.stringify({package:result.id,passed:result.passed,checks:result.checks,failures:result.failures}));
}
try{
 for(const file of ['outputs/mobile/engine.mjs','outputs/mobile/room-realtime.mjs','outputs/h5/index.html'])assert.ok(existsSync(resolve(root,file)),file+' missing (not rebuilding shared artifacts)');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']});
 if(!args.includes('--forward')){const backend=await startBackend(root,'new');try{for(const pkg of packages)await runPackage(pkg,backend);}finally{await backend.close();}}
 if(!args.includes('--backward')){const backend=await startBackend(live,'live-version');try{assert.equal(Object.hasOwn(backend.record.capabilities,'soloLocalPlay'),false);assert.equal(Object.hasOwn(backend.record.capabilities,'offlineLevelClears'),false);await runPackage(packages[2],backend,true);}finally{await backend.close();}}
 report.passed=report.packages.length>0&&report.packages.every(p=>p.passed);
}catch(e){report.passed=false;report.failure=e.stack;}
finally{
 await browser?.close();
 // Only this run's mkdtemp subtree; never touch a pre-existing runtime or another process.
 assert.ok(runtime.startsWith(tempParent+sep)&&relative(tempParent,runtime)&&!relative(tempParent,runtime).startsWith('..'));
 rmSync(runtime,{recursive:true,force:true,maxRetries:8,retryDelay:100});report.runtimeRemoved=true;report.finishedAt=new Date().toISOString();
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
