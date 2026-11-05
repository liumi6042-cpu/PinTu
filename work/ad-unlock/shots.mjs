// v53.17 治愈时光: the ad album opens its picture preview; one watched video unlocks one picture, a closed one nothing.
// Strictly local: in-process backend ad-unlock-backend (live code + the ad unlock + the 10 pictures), live content
// 3312b401 plus the healing-time album; every other origin is blocked.
// Usage (from the client worktree root): SIZE=390x844 OUT=<dir> node work/ad-unlock/shots.mjs
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';

const harness=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(harness,'../..');process.chdir(root);
const backend=resolve(process.env.BACKEND||'G:/jigsaw-nook-work/ad-unlock-backend');
const release=process.env.RELEASE||'D:/chat/拼图/content-admin/work/content-releases/releases/release-20261030T103725889Z-3312b401';
const [vw,vh]=(process.env.SIZE||'390x844').split('x').map(Number),tag=vw+'x'+vh;
const output=resolve(process.env.OUT||resolve(harness,'shots'));mkdirSync(output,{recursive:true});
mkdirSync(resolve(harness,'tmp'),{recursive:true});const runtime=mkdtempSync(resolve(harness,'tmp/run-'));
const report={root,backend,size:[vw,vh],steps:[],files:[],pageErrors:[],consoleErrors:[],networkErrors:[],blocked:[]};
let gateway,browser,service;
async function freePort(){const probe=createServer();await new Promise((d,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',d);});const port=probe.address().port;await new Promise(d=>probe.close(d));return port;}
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

try{
 const {build}=await import('esbuild');
 await build({absWorkingDir:backend,entryPoints:[resolve(backend,'server/mobile-service.mjs'),resolve(backend,'server/h5-gateway.mjs')],outdir:resolve(runtime,'server'),bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',logLevel:'error',plugins:[{name:'isolated-engine',setup(b){b.onResolve({filter:/outputs\/mobile\/engine\.mjs$/},()=>({path:resolve(backend,'server/mobile-engine.entry.ts')}));b.onResolve({filter:/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve(backend,'server/room-realtime.mjs')}));}}]});
 const port=await freePort(),base='http://127.0.0.1:'+port,api=base+'/h5';
 const {buildMobileShared}=await import(pathToFileURL(resolve('scripts/build-mobile-shared.mjs')).href);
 const [built]=await buildMobileShared({outputRoot:resolve(runtime,'client'),prepareAssets:false,platforms:['taptap'],env:{JIGSAW_SHARED_API_BASE:api,JIGSAW_SHARED_ASSET_BASE:api+'/assets',JIGSAW_SHARED_GAME_BASE:base}});
 const {createMobileService}=await import(pathToFileURL(resolve(runtime,'server/mobile-service.js')).href);
 const {createH5Gateway}=await import(pathToFileURL(resolve(runtime,'server/h5-gateway.js')).href);
 const {runtimeAssets}=await import(pathToFileURL(resolve('scripts/release-files.mjs')).href);
 const assets=runtimeAssets(JSON.parse(readFileSync(resolve(backend,'content/puzzle-catalog.json'),'utf8')),JSON.parse(readFileSync('config/runtime-assets.json','utf8')));
 const dbPath=resolve(runtime,'mobile.sqlite');
 const albums=JSON.parse(readFileSync(resolve(release,'albums.json'),'utf8'));delete albums.configDigest;
 const ids=Array.from({length:10},(_,i)=>'album-healing-time-'+String(i+1).padStart(2,'0')+'-20261105');
 albums.albums.push({id:'healing-time',title:'治愈时光',description:'安静的小店、夏夜的书桌、晨雾里的湖。每张图看一次广告就能解锁，慢慢拼。',imageIds:ids,coverImageId:ids[0],showOnPc:false,showOnMobile:true,purchasable:true,price:1,decorationId:null,milestones:[{id:'milestone-3',target:3,coins:30,decorationId:null},{id:'milestone-6',target:6,coins:60,decorationId:null}]});
 service=createMobileService({databasePath:dbPath,adEnabled:true,assetDir:resolve(backend,'public'),albumContent:{read:()=>albums},dailyAppearanceDir:resolve(runtime,'daily-appearances'),deferDailyStart:true,gameConfigurationPath:resolve(release,'game-settings.json'),taskRewardConfigurationPath:resolve(release,'task-rewards.json')});
 gateway=createH5Gateway({mobileService:service,databasePath:resolve(runtime,'sessions.sqlite'),upstream:base,allowedOrigins:[base],assetDir:resolve(backend,'public'),assetPaths:assets,staticDir:built.directory,publicApiBase:'/h5',publicGameBase:'/',adAssistanceEnabled:true,rewardedAdUnitId:'1054324',rewardedAdUnitIdPortrait:'1054324',rewardedAdUnitIdLandscape:'1054323'});
 await new Promise((d,j)=>{gateway.once('error',j);gateway.listen(port,'127.0.0.1',d);});
 for(let n=0;n<200;n++){try{const h=await fetch(base+'/healthz',{signal:AbortSignal.timeout(3000)});if(h.ok)break;}catch{}if(n===199)throw Error('healthz');await delay(150);}
 const peek=new DatabaseSync(dbPath,{readOnly:true});
 const tickets=()=>peek.prepare('SELECT data FROM mobile_profiles').all().map(r=>JSON.parse(r.data).supply);

 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
 browser=await chromium.launch({channel:'msedge',headless:true});
 const privacyVersion=readFileSync('mobile/privacy-policy.ts','utf8').match(/MOBILE_PRIVACY_VERSION='([^']+)'/)[1];
 const session=(await (await fetch(api+'/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).json()).token;
 const context=await browser.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:Number(process.env.DPR||2),hasTouch:false});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();report.blocked.push(url.origin+url.pathname);return route.abort('blockedbyclient');});
 await context.addInitScript(({api,session,privacyVersion,orientation})=>{if(sessionStorage.getItem('seeded'))return;sessionStorage.setItem('seeded','1');localStorage.setItem('jigsaw:room-guide:v1','done');localStorage.setItem('jigsaw:orientation-picker:v1','done');localStorage.setItem('jigsaw:orientation:v1',orientation);localStorage.setItem('jigsaw:settings-tip:v1','1');localStorage.setItem('jigsaw:h5-session:'+api,session);localStorage.setItem('jigsaw:mobile-privacy:'+privacyVersion,JSON.stringify({version:privacyVersion,necessary:true,hongKongStorage:true}));},{api,session,privacyVersion,orientation:vw>vh?'landscape':'portrait'});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.networkErrors.push({status:r.status(),path:new URL(r.url()).pathname});});
 const posts=[];page.on('request',r=>{if(r.method()==='POST'&&/\/(share|supply|collection)\//.test(r.url()))posts.push(new URL(r.url()).pathname.replace('/h5/api/mobile/',''));});
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__JIGSAW_SHARED__?.app.ready,null,{timeout:40000});
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>{const s=window.__JIGSAW_SHARED__.stage,button=s.button.bind(s);window.__buttons=[];s.button=(r,label,...rest)=>{const t=s.ctx.getTransform(),k=t.a||1;window.__buttons.push({label:String(label),x:r.x+t.e/k,y:r.y+t.f/k,w:r.w,h:r.h,disabled:rest[1]?.disabled===true});if(window.__buttons.length>400)window.__buttons.splice(0,200);return button(r,label,...rest);};});
 const settle=()=>page.evaluate(()=>new Promise(done=>{window.__JIGSAW_SHARED__.app.invalidate();requestAnimationFrame(()=>requestAnimationFrame(done));}));
 const idle=()=>page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.busy,null,{timeout:30000});
 const shot=async name=>{await settle();await delay(300);const file=resolve(output,tag+'-'+name+'.png');await page.screenshot({path:file});report.files.push(file);return file;};
 const buttons=async()=>{await page.evaluate(()=>{window.__buttons=[];});await settle();return page.evaluate(()=>{const seen=new Map();for(const b of window.__buttons)seen.set(b.label,b);return [...seen.values()];});};
 const tapButton=async label=>{const list=await buttons(),b=list.find(b=>b.label===label);assert.ok(b,'button '+label+' not drawn; have '+list.map(b=>b.label).join('|'));assert.equal(b.disabled,false,label+' is disabled');const k=await page.evaluate(()=>innerWidth/window.__JIGSAW_SHARED__.stage.w);await page.mouse.click((b.x+b.w/2)*k,(b.y+b.h/2)*k);};
 const step=(name,data)=>{report.steps.push({name,...data});log(name,JSON.stringify(data));};



 await idle();await delay(1200);
 const fakeAd=outcome=>page.evaluate(outcome=>{const p=window.__JIGSAW_SHARED__.app.platform;window.__ads=window.__ads??[];p.prepareAd=()=>{};p.watchAd=async unit=>{window.__ads.push(unit);await new Promise(r=>setTimeout(r,300));return outcome;};},outcome);
 const message=()=>page.evaluate(()=>window.__JIGSAW_SHARED__.app.message);
 const owned=()=>peek.prepare("SELECT item_id FROM mobile_collection_owned WHERE kind='image'").all().map(r=>r.item_id);
 const app=fn=>page.evaluate(fn);
 // 1. collection → albums tab with the healing card
 await app(()=>{const a=window.__JIGSAW_SHARED__.app;a.modal=null;a.navigate('collection');});
 await page.waitForFunction(()=>{const a=window.__JIGSAW_SHARED__.app;return !!a.collection&&!a.busy;},null,{timeout:30000});
 const pack=await app(()=>window.__JIGSAW_SHARED__.app.collection.packs.find(p=>p.id==='healing-time'));
 step('pack',{unlock:pack?.unlock,owned:pack?.owned,unlocked:pack?.unlocked,images:pack?.images.length});assert.equal(pack.unlock,'ad');assert.equal(pack.unlocked,0);
 await app(()=>{const a=window.__JIGSAW_SHARED__.app;a.collectionTab='albums';a.albumDetailOpen=false;const order=a.orderedAlbums(a.collection);a.albumId='healing-time';a.scroll=0;a.invalidate();});await delay(1500);
 let list=await buttons();step('collection buttons',{labels:list.map(b=>b.label).filter(l=>/广告|解锁/.test(l))});
 // scroll the healing card into view
 for(let i=0;i<40&&!(await buttons()).some(b=>b.label==='看广告解锁'&&b.y>0&&b.y<vh-40);i++){await app(()=>{const a=window.__JIGSAW_SHARED__.app;a.scroll+=160;a.invalidate();});await delay(120);}
 await shot('collection-card');
 // 2. offer → preview grid
 await tapButton('看广告解锁');await delay(1500);
 assert.equal(await app(()=>window.__JIGSAW_SHARED__.app.modal),'packPreview');
 list=await buttons();step('preview grid',{labels:list.map(b=>b.label)});assert.ok(list.some(b=>b.label==='挑一张看广告解锁'));
 await shot('preview-grid');
 // 3. big view of picture 1 → watch → unlocked
 await tapButton('挑一张看广告解锁');await delay(1500);await shot('preview-locked');
 await fakeAd('completed');posts.length=0;await tapButton('看广告解锁这张图');await idle();await delay(400);
 const first={owned:owned(),ads:await app(()=>window.__ads),posts:[...posts],message:await message()};step('watched',first);
 assert.deepEqual(first.owned,[ids[0]]);assert.equal(first.ads[0],vw>vh?'1054323':'1054324');assert.match(first.message,/已解锁/);assert.deepEqual(first.posts,['collection/unlock/challenge','collection/unlock/redeem']);
 list=await buttons();assert.ok(list.some(b=>b.label==='已解锁 · 去建房'));await shot('preview-unlocked');
 // 4. picture 2 with a closed video → still locked
 await app(()=>{const a=window.__JIGSAW_SHARED__.app;a.stepPackPreview(1);});await delay(1200);await fakeAd('closed');posts.length=0;
 await tapButton('看广告解锁这张图');await idle();await delay(300);
 const closed={owned:owned(),posts:[...posts],message:await message()};step('closed early',closed);assert.deepEqual(closed.owned,[ids[0]]);assert.ok(posts.includes('collection/unlock/cancel'));assert.match(closed.message,/还没有解锁/);
 await app(()=>window.__JIGSAW_SHARED__.app.returnToPackGrid());await delay(1200);await shot('preview-grid-after');
 // 5. gallery for the album: tags and create panel
 await app(()=>{const a=window.__JIGSAW_SHARED__.app;a.message='';a.showModal(null);a.openPackGallery('healing-time');});await delay(2000);
 await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.busy&&!!window.__JIGSAW_SHARED__.app.sharedPhotos);await delay(800);
 const cards=vw>vh?[[1400/2*0+400,470/1],[530,470]]:[[80,210],[230,210]];
 await page.mouse.click(...(vw>vh?[545,470]:[230,210]));await delay(1500);step('selected',{selected:await app(()=>window.__JIGSAW_SHARED__.app.selected),route:await app(()=>window.__JIGSAW_SHARED__.app.route)});
 list=await buttons();step('gallery locked selected',{labels:list.map(b=>b.label).filter(l=>/广告|解锁|开一桌/.test(l))});
 await shot('gallery-locked');
 await page.mouse.click(...(vw>vh?[400,470]:[80,210]));await delay(1500);
 list=await buttons();step('gallery unlocked selected',{labels:list.map(b=>b.label).filter(l=>/广告|解锁|开一桌/.test(l))});
 await shot('gallery-unlocked');
 report.ok=true;
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}
finally{
 await browser?.close().catch(()=>{});if(gateway){gateway.realtime?.close();gateway.closeAllConnections();await new Promise(d=>gateway.close(d));}else service?.close();
 writeFileSync(resolve(output,tag+'-report.json'),JSON.stringify(report,null,1));log('report',resolve(output,tag+'-report.json'));
}
