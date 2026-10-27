// Manual, strictly local capture: node tests/locate-loose-shots.mjs
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const output=resolve(process.env.LOCATE_SHOTS_DIR||'D:/chat/拼图/ui-revamp-shots/locate-loose');
const label='locate',pieces=108;
// POST /api/rooms takes no seed; the engine seeds from Date.now(). Freezing the in-process clock
// for the one creation call gives both labels the same tab shapes and scatter on the same day.
const today=new Date(),seedTime=Number(process.env.LOCATE_SHOTS_SEED_TIME||Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));
mkdirSync(output,{recursive:true});
mkdirSync(resolve('work/locate-shots-tmp'),{recursive:true});
const runtime=mkdtempSync(resolve('work/locate-shots-tmp/run-'));
const report={script:'tests/locate-loose-shots.mjs',startedAt:new Date().toISOString(),runtime,output,label,pieces,seedTime,
  imageId:null,seed:null,room:null,captures:[],files:[],consoleErrors:[],pageErrors:[],networkErrors:[],blockedExternalRequests:[],problems:[]};
const rid=()=>randomBytes(16).toString('hex');
let gateway,browser,service,failure;

async function freePort(){
  const probe=createServer();await new Promise((done,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',done);});
  const port=probe.address().port;await new Promise(done=>probe.close(done));return port;
}
function inventory(file){
  const bytes=readFileSync(file);return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}

try{
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Node 24+ required');
  const {build}=await import('esbuild');
  await build({entryPoints:['server/mobile-service.mjs','server/h5-gateway.mjs'],outdir:resolve(runtime,'server'),bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',plugins:[{name:'isolated-engine',setup(builder){builder.onResolve({filter:/outputs\/mobile\/engine\.mjs$/},()=>({path:resolve('server/mobile-engine.entry.ts')}));builder.onResolve({filter:/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve('server/room-realtime.mjs')}));}}]});
  const port=await freePort(),base='http://127.0.0.1:'+port,api=base+'/h5';
  const {buildMobileShared}=await import('../scripts/build-mobile-shared.mjs');
  const [built]=await buildMobileShared({outputRoot:resolve(runtime,'client'),prepareAssets:false,platforms:['taptap'],
    env:{JIGSAW_SHARED_API_BASE:api,JIGSAW_SHARED_ASSET_BASE:api+'/assets',JIGSAW_SHARED_GAME_BASE:base}});
  const {createMobileService,mobileGridForPhoto}=await import(pathToFileURL(resolve(runtime,'server/mobile-service.js')).href);
  const {createH5Gateway}=await import(pathToFileURL(resolve(runtime,'server/h5-gateway.js')).href);
  const {runtimeAssets}=await import('../scripts/release-files.mjs');
  const assets=runtimeAssets(JSON.parse(readFileSync('content/puzzle-catalog.json','utf8')),JSON.parse(readFileSync('config/runtime-assets.json','utf8')));
  service=createMobileService({databasePath:resolve(runtime,'mobile.sqlite'),assetDir:resolve('public'),
    dailyAppearanceDir:resolve(runtime,'daily-appearances'),deferDailyStart:true});
  gateway=createH5Gateway({mobileService:service,databasePath:resolve(runtime,'sessions.sqlite'),
    upstream:base,allowedOrigins:[base],assetDir:resolve('public'),assetPaths:assets,staticDir:built.directory,
    publicApiBase:'/h5',publicGameBase:'/'});
  await new Promise((done,reject)=>{gateway.once('error',reject);gateway.listen(port,'127.0.0.1',done);});
  for(let n=0;n<40;n++){
    try{const health=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});if(health.ok&&(await health.json()).ok)break;}
    catch{}if(n===39)throw Error('Local /healthz did not become ready');await delay(150);
  }
  async function call(actor,path,body,token){
    const response=await fetch(api+path,{method:body===undefined?'GET':'POST',
      headers:{Origin:base,'Content-Type':'application/json',...(actor?{'X-Jigsaw-H5-Session':actor.session}:{}),...(token?{Authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const data=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(data)}`);return data;
  }
  const helpers=await build({stdin:{contents:"export {RESTORABLE_PHOTOS} from './lib/puzzle-catalog.ts'; export {currentRoomArtwork} from './lib/room-artwork.ts'; export {boardFor} from './lib/puzzle-engine.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
  const {RESTORABLE_PHOTOS,currentRoomArtwork,boardFor}=await import('data:text/javascript;base64,'+Buffer.from(helpers.outputFiles[0].text).toString('base64'));
  const catalogIds=new Set(JSON.parse(readFileSync('content/puzzle-catalog.json','utf8')).map(photo=>photo.id));

  // One room, built entirely over HTTP before the page opens: the top of the picture assembled,
  // the rest loose at their seeded scatter, and one loose piece left lying on the finished area.
  const players=[];for(let i=0;i<4;i++)players.push({session:(await call(null,'/session',{})).token});
  const owner=players[0],gallery=await call(owner,'/api/mobile/gallery'),visible=new Set(gallery.imageIds),free=new Set(gallery.freeImageIds),packed=new Set(gallery.packedImageIds);
  const photo=[...RESTORABLE_PHOTOS].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).find(photo=>catalogIds.has(photo.id)&&visible.has(photo.id)&&(!packed.has(photo.id)||free.has(photo.id))&&mobileGridForPhoto({...photo,...currentRoomArtwork(photo,pieces,true)},pieces));
  assert.ok(photo,`No catalog image is available to a fresh guest for a public ${pieces}-piece selected room`);report.imageId=photo.id;
  const realNow=Date.now;Date.now=()=>seedTime;
  try{owner.ticket=await call(owner,'/api/rooms',{mode:'selected',imageId:photo.id,pieces,visibility:'public',requestId:rid()});}finally{Date.now=realNow;}
  const path='/api/rooms/'+owner.ticket.room.id;for(const actor of players.slice(1))actor.ticket=await call(actor,path+'/join',{});
  let snap=await call(owner,path,undefined,owner.ticket.token),turn=0;
  const {cols,rows,seed}=snap.puzzle;report.seed=seed;assert.equal(seed,seedTime>>>0,'Room seed must come from the frozen clock');
  const drop=async(groupId,dx,dy)=>{const actor=players[turn++%4];await call(actor,path,{type:'claim',groupId,requestId:rid()},actor.ticket.token);snap=await call(actor,path,{type:'drop',groupId,dx,dy,seq:1,requestId:rid()},actor.ticket.token);return snap.puzzle.groups.find(g=>g.pieces.includes(groupId));};
  // Placed: every row but the last two, plus the left half of the second-last row.
  const placed=[];for(let id=0;id<cols*rows;id++){const row=Math.floor(id/cols),col=id%cols;if(row<rows-2||row===rows-2&&col<cols/2)placed.push(id);}
  const lost=cols*(rows-1)+cols-2;
  for(const id of placed){const group=snap.puzzle.groups.find(g=>g.pieces.includes(id));if(!group.locked)assert.ok((await drop(group.id,0,0)).locked,'Placed piece must lock');}
  // The lost piece rests half a cell off the grid inside the finished area, on similar artwork
  // (the second-last finished row), the way players report losing pieces. A second loose piece
  // waits in the empty slots so the drag frame can pick it up from inside the board.
  const restingCol=cols-4,restingRow=rows-3,lostRow=Math.floor(lost/cols),lostCol=lost%cols;
  const b=boardFor(cols,rows),cw=b.width/cols,ch=b.height/rows;
  const lostGroup=await drop(lost,(restingCol-lostCol+.45)*cw,(restingRow-lostRow-.12)*ch);
  assert.ok(lostGroup&&!lostGroup.locked&&lostGroup.pieces.length===1,'Lost piece must stay loose and alone');
  const heldId=cols*(rows-1)+2,heldGroup=await drop(heldId,(cols-3-2+.2)*cw,.1*ch);
  assert.ok(heldGroup&&!heldGroup.locked&&heldGroup.pieces.length===1,'Held piece must stay loose and alone');
  report.room={id:snap.id,cols,rows,placed:placed.length,loose:snap.puzzle.groups.filter(g=>!g.locked).length,lost,resting:{col:restingCol,row:restingRow},held:heldId,drops:turn};

  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const privacyVersion=readFileSync('mobile/privacy-policy.ts','utf8').match(/MOBILE_PRIVACY_VERSION='([^']+)'/)[1];
  // One page per orientation. stage.icon is wrapped so the 定位 button is tapped where it is drawn.
  async function open(width,height,{guide=false,video=null}={}){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true,...(video?{recordVideo:{dir:video,size:{width,height}}}:{})});
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();report.blockedExternalRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');});
    await context.addInitScript(({api,session,ticket,privacyVersion,guide})=>{
      if(!guide)localStorage.setItem('jigsaw:room-guide:v1','done');localStorage.setItem('jigsaw:landscape-tools-open:v1','1');localStorage.setItem('jigsaw:h5-session:'+api,session);localStorage.setItem('jigsaw:shared-room:'+api+':'+ticket.room.id,JSON.stringify({token:ticket.token,playerId:ticket.playerId}));localStorage.setItem('jigsaw:mobile-privacy:'+privacyVersion,JSON.stringify({version:privacyVersion,necessary:true,hongKongStorage:true}));
    },{api,session:owner.session,ticket:owner.ticket,privacyVersion,guide});
    const page=await context.newPage();
    page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});page.on('response',response=>{if(response.status()>=400)report.networkErrors.push({status:response.status(),path:new URL(response.url()).pathname});});
    await page.goto(base+'/?room='+snap.id,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>{const g=window.__JIGSAW_SHARED__;return g?.app.route==='room'&&g.app.imageReady&&g.app.board.rect.w>0&&!g.app.roomViewPending;},null,{timeout:25000});
    await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.realtime?.connected,null,{timeout:10000});await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>window.__JIGSAW_SHARED__.stage.font.includes('Jigsaw'),null,{timeout:15000});
    await page.evaluate(()=>{const s=window.__JIGSAW_SHARED__.stage,icon=s.icon.bind(s);window.__icons={};s.icon=(kind,r,...rest)=>{window.__icons[kind]={...r};return icon(kind,r,...rest);};window.__JIGSAW_SHARED__.app.invalidate();});
    if(!guide)await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.message,null,{timeout:15000});
    return {context,page};
  }
  const settle=page=>page.evaluate(()=>new Promise(done=>{window.__JIGSAW_SHARED__.app.invalidate();requestAnimationFrame(()=>requestAnimationFrame(done));}));
  const camera=(page,z,cx,cy)=>page.evaluate(({z,cx,cy})=>{const a=window.__JIGSAW_SHARED__.app,b=a.board,r=b.rect,bd=b.board,zoom=z*Math.min(r.w/bd.width,r.h/bd.height);b.camera={x:r.w/2-(bd.x+cx*bd.width)*zoom,y:r.h/2-(bd.y+cy*bd.height)*zoom,z:zoom};a.invalidate();return b.camera;},{z,cx,cy});
  const shot=async(page,name,wait=300)=>{await settle(page);await delay(wait);await settle(page);const file=resolve(output,`${name}.png`);await page.screenshot({path:file});report.files.push(inventory(file));report.captures.push({file,name,camera:await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.camera)});};
  // Taps the drawn 定位 icon like a finger would; returns the toast it shows.
  const tapLocate=async page=>{await settle(page);const p=await page.evaluate(()=>{const s=window.__JIGSAW_SHARED__.stage,r=window.__icons.locate;return r&&{x:(r.x+r.w/2)*innerWidth/s.w,y:(r.y+r.h/2)*innerHeight/s.h};});assert.ok(p,'定位 button must be on screen');await page.touchscreen.tap(p.x,p.y);await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.board.locating,null,{timeout:3000});return page.evaluate(()=>window.__JIGSAW_SHARED__.app.message);};
  const restX=(restingCol+.95)/cols,restY=(restingRow+.38)/rows;
  {
    const {context,page}=await open(844,390);
    try{
      await camera(page,.82,.5,.5);await shot(page,'1-landscape-before');
      report.toast=await tapLocate(page);await shot(page,'2-landscape-glow',120);
      await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.board.locating,null,{timeout:6000});
      await camera(page,2.6,restX,restY);await shot(page,'3-landscape-zoomed-before');
      const before=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.camera);await tapLocate(page);
      report.zoomedCamera={before,after:await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.camera)};await shot(page,'4-landscape-zoomed-glow',120);
      await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.board.locating,null,{timeout:6000});
      await page.evaluate(()=>window.__JIGSAW_SHARED__.app.showModal('tools'));await shot(page,'5-landscape-more');
    }finally{await context.close();}
  }
  {
    const {context,page}=await open(390,844);
    try{
      await page.evaluate(()=>{const a=window.__JIGSAW_SHARED__.app;a.toolsOpen=true;a.invalidate();});await shot(page,'6-portrait-tools');
      await tapLocate(page);await shot(page,'7-portrait-glow',120);
    }finally{await context.close();}
  }
  {
    const {context,page}=await open(844,390,{guide:true});
    try{
      await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.roomGuideStep===1,null,{timeout:15000});
      await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.message,null,{timeout:15000});
      await page.evaluate(()=>{const a=window.__JIGSAW_SHARED__.app;a.roomGuideStep=2;a.invalidate();});await shot(page,'8-landscape-guide');
    }finally{await context.close();}
  }
  {
    // Near the end only two pieces are loose: one lying on the finished lake, one in an empty slot.
    // Every other scattered piece is placed over HTTP, then the clip shows one tap on 定位.
    for(const group of snap.puzzle.groups.filter(g=>!g.locked&&!g.pieces.includes(lost)&&!g.pieces.includes(heldId)))assert.ok((await drop(group.id,0,0)).locked,'Scattered piece must lock');
    report.nearEnd={loose:snap.puzzle.groups.filter(g=>!g.locked).length};
    const videoDir=resolve(runtime,'video'),{context,page}=await open(844,390,{video:videoDir});let webm;
    try{
      await camera(page,.82,.5,.5);await settle(page);await delay(1500);await tapLocate(page);await shot(page,'9-near-end-glow',120);await delay(4000);
      await shot(page,'10-near-end-after',200);webm=await page.video().path();
    }finally{await context.close();}
    const mp4=resolve(output,'locate-loose.mp4'),{spawnSync}=await import('node:child_process');
    const result=spawnSync(process.env.FFMPEG||'C:/Users/Administrator/AppData/Local/oopz/ffmpeg.exe',['-y','-loglevel','error','-sseof','-7.5','-i',webm,'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',mp4],{encoding:'utf8'});
    if(result.status===0)report.files.push(inventory(mp4));else report.problems.push('ffmpeg: '+(result.stderr||result.error?.message));
  }
  assert.equal(report.pageErrors.length,0,'Page errors');assert.equal(report.consoleErrors.length,0,'Console errors');assert.equal(report.networkErrors.length,0,'Network errors');
}catch(error){failure=error;report.failure=error.stack;process.exitCode=1;}
finally{
  await browser?.close().catch(error=>report.problems.push('Browser cleanup: '+error.message));if(gateway){gateway.realtime?.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}else service?.close();report.finishedAt=new Date().toISOString();const json=resolve(output,'report.json');writeFileSync(json,JSON.stringify(report,null,2)+'\n');copyFileSync(json,resolve(runtime,'report.json'));console.log(JSON.stringify({files:report.files.map(f=>f.path),room:report.room,report:json,problems:report.problems,failure:report.failure??null},null,2));
}
if(failure)console.error(failure.stack);
