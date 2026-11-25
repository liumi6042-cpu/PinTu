// Manual, strictly local capture: node tests/placed-piece-blend-shots.mjs
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const output=resolve(process.env.BLEND_SHOTS_DIR||'D:/chat/拼图/ui-revamp-shots/placed-piece-blend');
const label=process.env.BLEND_SHOTS_LABEL||'after',pieces=Number(process.env.BLEND_SHOTS_PIECES||108);
// POST /api/rooms takes no seed; the engine seeds from Date.now(). Freezing the in-process clock
// for the one creation call gives both labels the same tab shapes and scatter on the same day.
const today=new Date(),seedTime=Number(process.env.BLEND_SHOTS_SEED_TIME||Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));
assert.ok(/^[A-Za-z0-9_-]+$/.test(label),'BLEND_SHOTS_LABEL must be a plain file-name prefix');
assert.ok([48,108].includes(pieces),'BLEND_SHOTS_PIECES must be 48 or 108');
mkdirSync(output,{recursive:true});
mkdirSync(resolve('work/blend-shots-tmp'),{recursive:true});
const runtime=mkdtempSync(resolve('work/blend-shots-tmp/run-'));
const report={script:'tests/placed-piece-blend-shots.mjs',startedAt:new Date().toISOString(),runtime,output,label,pieces,seedTime,
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
  const width=844,height=390,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  try{
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();report.blockedExternalRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');});
    await context.addInitScript(({api,session,ticket,privacyVersion})=>{
      localStorage.setItem('jigsaw:room-guide:v1','done');localStorage.setItem('jigsaw:landscape-tools-open:v1','0');localStorage.setItem('jigsaw:h5-session:'+api,session);localStorage.setItem('jigsaw:shared-room:'+api+':'+ticket.room.id,JSON.stringify({token:ticket.token,playerId:ticket.playerId}));localStorage.setItem('jigsaw:mobile-privacy:'+privacyVersion,JSON.stringify({version:privacyVersion,necessary:true,hongKongStorage:true}));
    },{api,session:owner.session,ticket:owner.ticket,privacyVersion});
    const page=await context.newPage();
    page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});page.on('response',response=>{if(response.status()>=400)report.networkErrors.push({status:response.status(),path:new URL(response.url()).pathname});});
    await page.goto(base+'/?room='+snap.id,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>{const g=window.__JIGSAW_SHARED__;return g?.app.route==='room'&&g.app.imageReady&&g.app.board.rect.w>0&&!g.app.roomViewPending;},null,{timeout:25000});
    await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.realtime?.connected,null,{timeout:10000});await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>window.__JIGSAW_SHARED__.stage.font.includes('Jigsaw'),null,{timeout:15000});
    await page.waitForFunction(()=>!window.__JIGSAW_SHARED__.app.message,null,{timeout:15000});
    assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modal),null,'No modal may cover the board');
    const settle=()=>page.evaluate(()=>new Promise(done=>{window.__JIGSAW_SHARED__.app.invalidate();requestAnimationFrame(()=>requestAnimationFrame(done));}));
    // Fixed cameras from the board geometry alone, so both labels frame the same world rectangle.
    const camera=(z,cx,cy)=>page.evaluate(({z,cx,cy})=>{const a=window.__JIGSAW_SHARED__.app,b=a.board,r=b.rect,bd=b.board,zoom=z*Math.min(r.w/bd.width,r.h/bd.height);b.camera={x:r.w/2-(bd.x+cx*bd.width)*zoom,y:r.h/2-(bd.y+cy*bd.height)*zoom,z:zoom};a.invalidate();return b.camera;},{z,cx,cy});
    const restX=(restingCol+.95)/cols,restY=(restingRow+.38)/rows;
    const shot=async(name,cam)=>{await settle();await delay(300);await settle();const file=resolve(output,`${label}-${name}.png`);await page.screenshot({path:file});report.files.push(inventory(file));report.captures.push({file,name,camera:cam});};
    await shot('board',await camera(.82,.5,.5));
    await shot('zoom',await camera(2.1,restX,restY));
    // Hold the staged piece over the finished area, pointer still down, for the drag frame.
    const cam=await camera(1.6,.7,.72);
    const held=await page.evaluate(({id})=>{
      const {app:a,stage:s}=window.__JIGSAW_SHARED__,b=a.board,bw=b.board.width/b.state.cols,bh=b.board.height/b.state.rows,c=b.camera,r=b.rect;
      const screen=(x,y)=>({x:(r.x+c.x+x*c.z)*innerWidth/s.w,y:(r.y+c.y+y*c.z)*innerHeight/s.h});
      const g=b.state.groups.find(g=>g.pieces.includes(id)),p=b.pieces[id];
      return {group:g.id,from:screen(b.board.x+(p.col+.5)*bw+g.dx,b.board.y+(p.row+.5)*bh+g.dy),to:screen(b.board.x+8.3*bw,b.board.y+(b.state.rows-2.7)*bh)};
    },{id:heldId});
    for(const point of [held.from,held.to])assert.ok(point.x>20&&point.x<width-20&&point.y>20&&point.y<height-20,'Drag points must be on screen: '+JSON.stringify(point));
    await page.mouse.move(held.from.x,held.from.y);await page.mouse.down();await page.mouse.move(held.to.x,held.to.y,{steps:12});
    await page.waitForFunction(group=>window.__JIGSAW_SHARED__.app.board.drag?.id===group,held.group,{timeout:3000});
    await shot('drag',cam);report.held=held;
    await page.mouse.move(held.from.x,held.from.y,{steps:6});await page.mouse.up();
    // A live snap repaints only the new piece with its placed neighbours. Neither that patch
    // nor a full repaint may leave a visible seam: a pixel inside the placed area (opaque 3 px
    // away on all four sides) below alpha 250. Outer-edge anti-aliasing may differ slightly.
    const snapped=cols*(rows-2)+Math.ceil(cols/2);
    if(await page.evaluate(()=>'placedSurface' in window.__JIGSAW_SHARED__.app.board)){
      await drop(snapped,0,0);
      await page.waitForFunction(id=>window.__JIGSAW_SHARED__.app.board.state.groups.find(g=>g.pieces.includes(id))?.locked,snapped,{timeout:10000});await settle();
      report.seamCheck=await page.evaluate(async id=>{
        const a=window.__JIGSAW_SHARED__.app,b=a.board,read=()=>{const c=b.placedSurface.canvas;return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
        if(!b.placedSurface.ids.has(id))return {error:'snapped piece missing from the placed layer'};
        const incremental=read();b.placedSurface={...b.placedSurface,serial:-1};a.invalidate();await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
        const full=read(),w=b.placedSurface.canvas.width,hgt=b.placedSurface.canvas.height;
        const seams=data=>{const at=(x,y)=>data[(y*w+x)*4+3],found=[];for(let y=3;y<hgt-3;y++)for(let x=3;x<w-3;x++){const v=at(x,y);if(v>0&&v<250&&at(x-3,y)===255&&at(x+3,y)===255&&at(x,y-3)===255&&at(x,y+3)===255)found.push([x,y,v]);}return found;};
        let edgeDifferences=0;for(let i=3;i<full.length;i+=4)if(incremental[i]!==full[i])edgeDifferences++;
        const seamFull=seams(full),seamIncremental=seams(incremental);
        return {piece:id,size:[w,hgt],interiorSeams:{full:seamFull.length,incremental:seamIncremental.length,samples:[...seamFull.slice(0,8),...seamIncremental.slice(0,8)]},alphaDifferencesOnOuterEdges:edgeDifferences};
      },snapped);
      assert.ok(!report.seamCheck.error&&report.seamCheck.interiorSeams.full===0&&report.seamCheck.interiorSeams.incremental===0,'Placed layer must have no interior seams after a snap or a full repaint: '+JSON.stringify(report.seamCheck));
    }
  }finally{await context.close();}
  assert.equal(report.files.length,3,'Capture count');assert.equal(report.pageErrors.length,0,'Page errors');assert.equal(report.consoleErrors.length,0,'Console errors');assert.equal(report.networkErrors.length,0,'Network errors');

  // With both labels present, stack 改前 over 改后 for each frame, unscaled.
  if(label!=='before'&&['board','zoom','drag'].every(name=>existsSync(resolve(output,`before-${name}.png`)))){
    const page=await browser.newPage({viewport:{width:1688,height:400},deviceScaleFactor:1});
    for(const name of ['board','zoom','drag']){
      const src=n=>'data:image/png;base64,'+readFileSync(resolve(output,`${n}-${name}.png`)).toString('base64');
      await page.setContent(`<body style="margin:0;background:#2b2622;font:600 30px sans-serif;color:#fff6e6">${[['before','改前：拼好的块也带描边和阴影'],[label,'改后：拼好的块融进画面，散块保留描边和阴影']].map(([n,t])=>`<div style="padding:14px 22px">${t}</div><img src="${src(n)}" style="display:block;width:1688px;height:780px">`).join('')}</body>`);
      const file=resolve(output,`compare-${label}-${name}.png`);await page.screenshot({path:file,fullPage:true});report.files.push(inventory(file));
    }
    await page.close();
  }
}catch(error){failure=error;report.failure=error.stack;process.exitCode=1;}
finally{
  await browser?.close().catch(error=>report.problems.push('Browser cleanup: '+error.message));if(gateway){gateway.realtime?.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}else service?.close();report.finishedAt=new Date().toISOString();const json=resolve(output,`${label}-report.json`);writeFileSync(json,JSON.stringify(report,null,2)+'\n');copyFileSync(json,resolve(runtime,'report.json'));console.log(JSON.stringify({files:report.files.map(f=>f.path),room:report.room,report:json,problems:report.problems,failure:report.failure??null},null,2));
}
if(failure)console.error(failure.stack);
