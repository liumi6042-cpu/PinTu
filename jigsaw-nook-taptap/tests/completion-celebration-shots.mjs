// Manual, strictly local capture: node tests/completion-celebration-shots.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync,readdirSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const output=resolve(process.env.CELEBRATION_SHOTS_DIR||'D:/chat/拼图/ui-revamp-shots/completion-celebration');
const label=process.env.CELEBRATION_SHOTS_LABEL||'after',set=process.env.CELEBRATION_SHOTS_SET||'compare';
assert.ok(/^[A-Za-z0-9_-]+$/.test(label),'CELEBRATION_SHOTS_LABEL must be a plain file-name prefix (letters, digits, _ or -)');
assert.ok(['compare','full'].includes(set),'CELEBRATION_SHOTS_SET must be compare or full');
mkdirSync(output,{recursive:true});
mkdirSync(resolve('work/celebration-shots-tmp'),{recursive:true});
const runtime=mkdtempSync(resolve('work/celebration-shots-tmp/run-'));
const report={script:'tests/completion-celebration-shots.mjs',command:'node tests/completion-celebration-shots.mjs',
  startedAt:new Date().toISOString(),runtime,output,label,set,imageId:null,seed:null,
  seedSupported:false,seedNote:'POST /api/rooms does not accept a seed; the engine uses Date.now() >>> 0. seed is the first room actual seed; each room records its own actual seed.',completionMethod:'real HTTP claim/drop; no database patches',
  builds:[],rooms:[],captures:[],timings:[],files:[],consoleErrors:[],pageErrors:[],networkErrors:[],blockedExternalRequests:[],problems:[]};
const rid=()=>randomBytes(16).toString('hex');
let gateway,browser,service,failure;

async function saveVideo(recording,file,start,seconds){
  const raw=resolve(runtime,'completion-4p-full.webm');await recording.saveAs(raw);
  const cache=resolve(process.env.LOCALAPPDATA||'C:/Users/Administrator/AppData/Local','ms-playwright');
  const ffmpeg=process.env.FFMPEG_PATH||(existsSync(cache)?readdirSync(cache).filter(name=>name.startsWith('ffmpeg-'))
    .map(name=>resolve(cache,name,'ffmpeg-win64.exe')).find(existsSync):undefined);
  assert.ok(ffmpeg,'Local Playwright FFmpeg unavailable; raw recording retained in the run directory, no untrimmed substitute exported');
  await new Promise((done,reject)=>{
    const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-ss',start.toFixed(3),'-i',raw,'-t',seconds.toFixed(3),
      '-c:v','libvpx','-deadline','realtime','-cpu-used','8','-an','-y',file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.on('data',chunk=>{error+=chunk.toString();});child.once('error',reject);
    child.once('exit',code=>code===0?done():reject(Error('Video trimming failed: '+error)));
  });
  report.video={path:file,startSeconds:start,durationSeconds:seconds,raw,method:'Playwright recordVideo; page-clock transition start mapped to Node wall clock relative to page creation; 0.3 s pre-roll, 4.2 s duration, encoded with local Playwright FFmpeg'};
}
async function freePort(){
  const probe=createServer();
  try{await new Promise((done,reject)=>{probe.once('error',reject);probe.listen(3291,'127.0.0.1',done);});}
  catch(error){if(error.code!=='EADDRINUSE')throw error;await new Promise((done,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',done);});}
  const port=probe.address().port;await new Promise(done=>probe.close(done));
  assert.notEqual(port,3211);return port;
}
function inventory(file){
  const bytes=readFileSync(file);return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}

try{
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Node 24+ required');
  console.log('Building isolated local server and shared TapTap Canvas client (reusing rebuilt fonts).');
  // Bundle server dependencies into this run directory without writing source/shared build outputs.
  const {build}=await import('esbuild');
  await build({entryPoints:['server/mobile-service.mjs','server/h5-gateway.mjs'],outdir:resolve(runtime,'server'),bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',plugins:[{name:'isolated-engine',setup(builder){builder.onResolve({filter:/outputs\/mobile\/engine\.mjs$/},()=>({path:resolve('server/mobile-engine.entry.ts')}));builder.onResolve({filter:/outputs\/mobile\/room-realtime\.mjs$/},()=>({path:resolve('server/room-realtime.mjs')}));}}]});
  report.builds.push('esbuild: isolated mobile service/gateway with source engine + realtime');
  const port=await freePort(),base='http://127.0.0.1:'+port,api=base+'/h5';
  const {buildMobileShared}=await import('../scripts/build-mobile-shared.mjs');
  const [built]=await buildMobileShared({outputRoot:resolve(runtime,'client'),prepareAssets:false,platforms:['taptap'],
    env:{JIGSAW_SHARED_API_BASE:api,JIGSAW_SHARED_ASSET_BASE:api+'/assets',JIGSAW_SHARED_GAME_BASE:base}});
  report.builds.push('buildMobileShared: isolated taptap, prepareAssets=false, all URLs loopback');
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
  report.base=base;
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
  const timeline=await build({stdin:{contents:"export {COMPLETION_POPUP_MS,COMPLETION_CELEBRATE_MS} from './mobile/completion-transition.ts'; export {RESTORABLE_PHOTOS} from './lib/puzzle-catalog.ts'; export {currentRoomArtwork} from './lib/room-artwork.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
  const {COMPLETION_POPUP_MS,COMPLETION_CELEBRATE_MS,RESTORABLE_PHOTOS,currentRoomArtwork}=await import('data:text/javascript;base64,'+Buffer.from(timeline.outputFiles[0].text).toString('base64'));
  report.timeline={celebrate:COMPLETION_CELEBRATE_MS,popup:COMPLETION_POPUP_MS};
  const catalogIds=new Set(JSON.parse(readFileSync('content/puzzle-catalog.json','utf8')).map(photo=>photo.id));
  async function makeRoom(){
    const players=[];for(let i=0;i<4;i++)players.push({session:(await call(null,'/session',{})).token});
    const owner=players[0];
    if(report.imageId===null){
      const gallery=await call(owner,'/api/mobile/gallery'),visible=new Set(gallery.imageIds),free=new Set(gallery.freeImageIds),packed=new Set(gallery.packedImageIds);
      // Mirror selected-room eligibility for a fresh guest; the first selection/newcomer ticket covers creation.
      const photo=[...RESTORABLE_PHOTOS].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).find(photo=>catalogIds.has(photo.id)&&visible.has(photo.id)&&(!packed.has(photo.id)||free.has(photo.id))&&mobileGridForPhoto({...photo,...currentRoomArtwork(photo,48,true)},48));
      assert.ok(photo,'No catalog image is available to a fresh guest for a public 48-piece selected room');
      report.imageId=photo.id;report.picturePinned=true;report.pictureSelection='First eligible catalog image sorted by id; local gallery visibility/free/packed rules and mobileGridForPhoto for 48 pieces; mode:selected';
    }
    owner.ticket=await call(owner,'/api/rooms',{mode:'selected',imageId:report.imageId,pieces:48,visibility:'public',requestId:rid()});
    const path='/api/rooms/'+owner.ticket.room.id;for(const actor of players.slice(1))actor.ticket=await call(actor,path+'/join',{});
    let snap=await call(owner,path,undefined,owner.ticket.token),drops=0;
    assert.equal(snap.puzzle.imageId,report.imageId,'Every capture must use the pinned image');
    report.seed??=snap.puzzle.seed;
    while(snap.puzzle.groups.filter(g=>!g.locked).length>1){
      assert.ok(drops<100,'Preparation did not converge');const actor=players[drops%4],group=snap.puzzle.groups.find(g=>!g.locked);
      await call(actor,path,{type:'claim',groupId:group.id,requestId:rid()},actor.ticket.token);
      snap=await call(actor,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},actor.ticket.token);drops++;
    }
    assert.equal(snap.puzzle.groups.filter(g=>!g.locked).length,1);assert.ok(!snap.completedAt);
    const summary={roomId:snap.id,imageId:snap.puzzle.imageId,seed:snap.puzzle.seed,players:4,pieces:snap.puzzle.cols*snap.puzzle.rows,drops,lastGroup:snap.puzzle.groups.find(g=>!g.locked).id};report.rooms.push(summary);
    return {players,path,snap,summary};
  }
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const privacyVersion=readFileSync('mobile/privacy-policy.ts','utf8').match(/MOBILE_PRIVACY_VERSION='([^']+)'/)[1];
  const scenarios=set==='full'?[[844,390,false],[390,844,false],[1920,1080,false],[844,390,true]]:[[844,390,false]];
  for(const [width,height,video] of scenarios){
    const room=await makeRoom(),owner=room.players[0],tag=`${width}x${height}${video?'-video':''}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:width<1000,hasTouch:width<1000,...(video?{recordVideo:{dir:resolve(runtime,'video'),size:{width,height}}}:{})});
    let page,recording,recordStart,transitionWallStart,videoReady=false;
    try{
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();report.blockedExternalRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');});
      await context.addInitScript(({api,session,ticket,privacyVersion})=>{
        // Install before GameApp: CheerEffects retains its constructor's Date.now function.
        // This delegating clock also freezes those retained references, so popper starts at offset 3600.
        window.__completionCapture={realNow:Date.now,freeze:false,start:null,offset:0,popup:null};
        Date.now=()=>{const s=window.__completionCapture;return s.freeze&&s.start!==null?s.start+s.offset:s.realNow();};
        localStorage.setItem('jigsaw:room-guide:v1','done');localStorage.setItem('jigsaw:landscape-tools-open:v1','0');localStorage.setItem('jigsaw:h5-session:'+api,session);localStorage.setItem('jigsaw:shared-room:'+api+':'+ticket.room.id,JSON.stringify({token:ticket.token,playerId:ticket.playerId}));localStorage.setItem('jigsaw:mobile-privacy:'+privacyVersion,JSON.stringify({version:privacyVersion,necessary:true,hongKongStorage:true}));
      },{api,session:owner.session,ticket:owner.ticket,privacyVersion});
      page=await context.newPage();recordStart=Date.now();recording=page.video();
      page.on('pageerror',error=>report.pageErrors.push({capture:tag,message:error.message}));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({capture:tag,message:message.text()});});page.on('response',response=>{if(response.status()>=400)report.networkErrors.push({capture:tag,status:response.status(),path:new URL(response.url()).pathname});});page.on('requestfailed',request=>{report.networkErrors.push({capture:tag,path:new URL(request.url()).pathname,error:request.failure()?.errorText});});
      await page.goto(base+'/?room='+room.snap.id,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>{const g=window.__JIGSAW_SHARED__;return g?.app.route==='room'&&g.app.imageReady&&g.app.board.rect.w>0&&!g.app.roomViewPending;},null,{timeout:25000});
      await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.realtime?.connected,null,{timeout:10000});await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>window.__JIGSAW_SHARED__.stage.font.includes('Jigsaw'),null,{timeout:15000});
      assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modal),null,'No modal may block the drag');
      const placement=await page.evaluate(()=>{const b=window.__JIGSAW_SHARED__.app.board,g=b.state.groups.find(g=>!g.locked),p=b.pieces[g.pieces[0]],pieceW=b.board.width/b.state.cols,pieceH=b.board.height/b.state.rows;return {group:g.id,pieceW,pieceH,home:{x:b.board.x+(p.col+.5)*pieceW,y:b.board.y+(p.row+.5)*pieceH},dx:1.3*pieceW,dy:.3*pieceH};});
      const placer=room.players[3];await call(placer,room.path,{type:'claim',groupId:placement.group,requestId:rid()},placer.ticket.token);
      const placed=await call(placer,room.path,{type:'drop',groupId:placement.group,dx:placement.dx,dy:placement.dy,seq:2,requestId:rid()},placer.ticket.token),last=placed.puzzle.groups.find(g=>g.id===placement.group);
      assert.ok(last&&!last.locked&&!placed.completedAt,'Staged last group must remain unlocked');assert.ok(Math.abs(last.dx-placement.dx)<.01&&Math.abs(last.dy-placement.dy)<.01,'Staged offset must match');room.summary.placement=placement;
      await page.waitForFunction(({group,dx,dy})=>{const g=window.__JIGSAW_SHARED__.app.board.state.groups.find(g=>g.id===group);return g&&!g.locked&&Math.abs(g.dx-dx)<.01&&Math.abs(g.dy-dy)<.01;},placement,{timeout:10000});
      await page.evaluate(({placement,zoomed})=>{const a=window.__JIGSAW_SHARED__.app,b=a.board,z=zoomed?a.roomZoomBase*1.8:b.camera.z;b.camera={x:b.rect.w/2-(placement.home.x+placement.dx/2)*z,y:b.rect.h/2-(placement.home.y+placement.dy/2)*z,z};a.invalidate();},{placement,zoomed:width===844&&height===390});
      await Promise.all(room.players.slice(1).map(actor=>call(actor,room.path,{type:'heartbeat',requestId:rid()},actor.ticket.token)));
      // The local guest-login notice would stay forever under the frozen clock; let it expire first.
      await page.waitForFunction(()=>{const a=window.__JIGSAW_SHARED__.app;return !a.message;},null,{timeout:15000});
      await page.evaluate(()=>new Promise(done=>{window.__JIGSAW_SHARED__.app.invalidate();requestAnimationFrame(()=>requestAnimationFrame(done));}));await delay(500);
      // Watch the actual app transition; no synthetic completion or modal calls.
      await page.evaluate(({freeze,initial})=>{
        const a=window.__JIGSAW_SHARED__.app,realNow=window.__completionCapture.realNow;window.__completionCapture={realNow,offset:initial,start:null,popup:null,freeze};
        const watch=()=>{const state=window.__completionCapture;if(a.completionFx&&state.start===null){state.start=a.completionFx.start;state.wallStart=performance.now();}
          if(a.modal==='completion'&&state.start!==null&&state.popup===null){state.popup=Date.now();state.wallPopup=performance.now();}state.raf=requestAnimationFrame(watch);};requestAnimationFrame(watch);
      },{freeze:!video,initial:1200});
      const drag=await page.evaluate(()=>{
        const {app:a,stage:s}=window.__JIGSAW_SHARED__,b=a.board,g=b.state.groups.find(g=>!g.locked),piece=b.pieces[g.pieces[0]],bw=b.board.width/b.state.cols,bh=b.board.height/b.state.rows,cam=b.camera,r=b.rect;
        const point=(dx,dy)=>({x:(r.x+cam.x+(b.board.x+(piece.col+.5)*bw+dx)*cam.z)*innerWidth/s.w,y:(r.y+cam.y+(b.board.y+(piece.row+.5)*bh+dy)*cam.z)*innerHeight/s.h});return {group:g.id,from:point(g.dx,g.dy),to:point(0,0)};
      });
      assert.equal(drag.group,placement.group);for(const point of [drag.from,drag.to])assert.ok(point.x>0&&point.x<width&&point.y>0&&point.y<height,'Drag endpoints must be inside the viewport: '+JSON.stringify(point));
      room.summary.drag={viewport:tag,...drag};await page.mouse.move(drag.from.x,drag.from.y);await page.mouse.down();await page.mouse.move(drag.to.x,drag.to.y,{steps:16});await page.mouse.up();
      let fallback=false;
      try{await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__.app.room.snapshot.completedAt,null,{timeout:3000});}
      catch{await page.keyboard.press('Escape');fallback=true;report.problems.push({capture:tag,code:'HTTP_LAST_PIECE_FALLBACK',message:'Mouse drag did not complete within 3 seconds; player 2 dropped through HTTP.'});const actor=room.players[1],snap=await call(actor,room.path,undefined,actor.ticket.token),g=snap.puzzle.groups.find(g=>!g.locked);if(g){await call(actor,room.path,{type:'claim',groupId:g.id,requestId:rid()},actor.ticket.token);await call(actor,room.path,{type:'drop',groupId:g.id,dx:0,dy:0,seq:2,requestId:rid()},actor.ticket.token);}}
      room.summary.fallback=fallback;await page.waitForFunction(()=>window.__completionCapture.start!==null,null,{timeout:10000});
      const frozenOffset=async offset=>{await page.evaluate(async offset=>{const state=window.__completionCapture;state.offset=offset;window.__JIGSAW_SHARED__.app.invalidate();await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));},offset);};
      const shot=async(name,offset)=>{
        await frozenOffset(offset);const file=resolve(output,`${label}-${name}`);await page.screenshot({path:file});report.files.push(inventory(file));
        report.captures.push({file,roomId:room.snap.id,viewport:{width,height},offset,state:await page.evaluate(()=>{const a=window.__JIGSAW_SHARED__.app;return {modal:a.modal,reveal:a.board.completionReveal,sweep:a.board.completionSweep,camera:a.board.camera};})});
      };
      if(video){
        // Read elapsed time on the page as soon as the actual transition is seen; drag duration is irrelevant.
        const sampleBefore=Date.now(),sample=await page.evaluate(()=>{const s=window.__completionCapture;return {start:s.start,elapsed:Date.now()-s.start};}),sampleAfter=Date.now();
        transitionWallStart=(sampleBefore+sampleAfter)/2-sample.elapsed;
        const trimStart=(transitionWallStart-recordStart)/1000-.3;
        assert.ok(trimStart>=0,'Recording must include at least 0.3 s before the transition');
        room.summary.videoClock={recordStart,transitionWallStart,pageStart:sample.start,elapsed:sample.elapsed,sampleBefore,sampleAfter,roundTripMs:sampleAfter-sampleBefore,trimStartSeconds:trimStart};
        await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion',null,{timeout:10000});
        // Keep recording 1.5 s past the clip end: Playwright drops the last frames before the context closes.
        await delay(Math.max(0,transitionWallStart+5400-Date.now()));
        const timing=await page.evaluate(()=>{const s=window.__completionCapture;return {start:s.start,popup:s.popup,delay:s.popup-s.start,wallDelay:s.wallPopup-s.wallStart};});
        assert.ok(timing.popup!==null&&timing.delay>=COMPLETION_POPUP_MS&&timing.delay<COMPLETION_POPUP_MS+500,'Real-time popup delay');
        report.timings.push({viewport:tag,clock:'real',...timing,...room.summary.videoClock,preRollMs:300,durationMs:4200,cheersSent:0});videoReady=true;
      }else{
        for(const offset of width===844?[1200,1600,2400]:[1600])await shot(`t${String(offset).padStart(4,'0')}-${width}x${height}.png`,offset);
        if(width===844){
          await frozenOffset(3600);await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion',null,{timeout:10000});
          const actor=room.players[1];await call(actor,room.path+'/cheers',{id:rid(),emote:'popper'},actor.ticket.token);
          await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.cheerEffects.bubbles.length>0,null,{timeout:10000});
          const cheer=await page.evaluate(()=>{const a=window.__JIGSAW_SHARED__.app,s=window.__completionCapture;return {start:s.start,bubbles:a.cheerEffects.bubbles.map(b=>({playerId:b.playerId,emote:b.emote,born:b.born})),particleStarts:[...new Set([...a.cheerEffects.particles.filter(p=>p.kind!=='heart').map(p=>p.start),...(a.cheerEffects.celebrations??[]).map(c=>c.start)])]};});
          assert.ok(cheer.bubbles.some(b=>b.playerId===actor.ticket.playerId&&b.emote==='popper'&&b.born===cheer.start+3600),'Popper must start at the frozen clock');
          assert.deepEqual(cheer.particleStarts,[cheer.start+3600]);room.summary.cheer={offset:3600,...cheer};
          await shot('popper-t0300-844x390.png',3900);await shot('popper-t0700-844x390.png',4300);
        }
        const timing=await page.evaluate(()=>{const s=window.__completionCapture;return {start:s.start,offset:s.offset,popup:s.popup,popupOffset:s.popup===null?null:s.popup-s.start};});
        report.timings.push({viewport:tag,clock:'frozen',...timing});
      }
    }finally{
      if(page)await page.evaluate(()=>{const s=window.__completionCapture;if(s){Date.now=s.realNow;cancelAnimationFrame(s.raf);}}).catch(error=>report.problems.push('Clock restore: '+error.message));
      await context.close();if(video&&recording&&videoReady){const file=resolve(output,`${label}-completion-844x390.webm`);await saveVideo(recording,file,(transitionWallStart-recordStart)/1000-.3,4.2);report.files.push(inventory(file));}
    }
  }
  const pngCount=report.files.filter(file=>file.path.endsWith('.png')).length,webmCount=report.files.filter(file=>file.path.endsWith('.webm')).length;
  report.expectedFiles={png:set==='full'?7:5,webm:set==='full'?1:0};
  assert.equal(pngCount,report.expectedFiles.png,'PNG count');assert.equal(webmCount,report.expectedFiles.webm,'WebM count');
  assert.equal(report.files.length,set==='full'?8:5,'Total capture count');assert.equal(report.pageErrors.length,0,'Page errors');assert.equal(report.consoleErrors.length,0,'Console errors');assert.equal(report.networkErrors.length,0,'Network errors');
}catch(error){failure=error;report.failure=error.stack;process.exitCode=1;}
finally{
  await browser?.close().catch(error=>report.problems.push('Browser cleanup: '+error.message));if(gateway){gateway.realtime?.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}else service?.close();report.finishedAt=new Date().toISOString();const json=resolve(output,`${label}-report.json`);writeFileSync(json,JSON.stringify(report,null,2)+'\n');copyFileSync(json,resolve(runtime,'report.json'));console.log(JSON.stringify({files:report.files.map(f=>f.path),report:json,problems:report.problems,failure:report.failure??null},null,2));
}
if(failure)console.error(failure.stack);
