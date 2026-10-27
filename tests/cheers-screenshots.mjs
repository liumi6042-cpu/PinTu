// Manual, strictly local capture: node tests/cheers-screenshots.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,copyFileSync,existsSync,readdirSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const output=resolve(process.env.CHEERS_SHOTS_DIR||'D:/chat/拼图/ui-revamp-shots/cheers');
mkdirSync(output,{recursive:true});
mkdirSync(resolve('work/cheers-shots-tmp'),{recursive:true});
const runtime=mkdtempSync(resolve('work/cheers-shots-tmp/run-'));
const report={script:'tests/cheers-screenshots.mjs',command:'node tests/cheers-screenshots.mjs',
  startedAt:new Date().toISOString(),runtime,output,completionMethod:'real HTTP claim/drop; no database patches',
  builds:[],rooms:[],captures:[],files:[],consoleErrors:[],pageErrors:[],networkErrors:[],blockedExternalRequests:[],problems:[]};
const rid=()=>randomBytes(16).toString('hex');
let gateway,browser,service,failure;

async function runNode(args){
  await new Promise((done,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',code=>code===0?done():reject(Error(args.join(' ')+' exited '+code)));
  });
}
async function saveVideo(recording,file){
  const raw=resolve(runtime,'cheers-8p-full.webm');await recording.saveAs(raw);
  const cache=resolve(process.env.LOCALAPPDATA||'C:/Users/Administrator/AppData/Local','ms-playwright');
  const ffmpeg=process.env.FFMPEG_PATH||(existsSync(cache)?readdirSync(cache).filter(name=>name.startsWith('ffmpeg-'))
    .map(name=>resolve(cache,name,'ffmpeg-win64.exe')).find(existsSync):undefined);
  if(!ffmpeg){copyFileSync(raw,file);report.problems.push('FFmpeg unavailable: optional video includes startup before the 6-second cheers sequence.');return;}
  await new Promise((done,reject)=>{
    const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-sseof','-6.4','-i',raw,'-t','6.4',
      '-c:v','libvpx','-deadline','realtime','-cpu-used','8','-an','-y',file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.on('data',chunk=>{error+=chunk.toString();});child.once('error',reject);
    child.once('exit',code=>code===0?done():reject(Error('Video trimming failed: '+error)));
  });
  report.video={path:file,durationSeconds:6.4,raw,method:'Playwright recordVideo, last 6.4 seconds encoded with local Playwright FFmpeg'};
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
  await runNode(['scripts/build-mobile-server.mjs']);
  report.builds.push('node scripts/build-mobile-server.mjs');
  const port=await freePort(),base='http://127.0.0.1:'+port,api=base+'/h5';
  const {buildMobileShared}=await import('../scripts/build-mobile-shared.mjs');
  const [built]=await buildMobileShared({outputRoot:resolve(runtime,'client'),prepareAssets:false,platforms:['taptap'],
    env:{JIGSAW_SHARED_API_BASE:api,JIGSAW_SHARED_ASSET_BASE:api+'/assets',JIGSAW_SHARED_GAME_BASE:base}});
  report.builds.push('buildMobileShared: isolated taptap, prepareAssets=false, all URLs loopback');
  const {createMobileService}=await import('../server/mobile-service.mjs');
  const {createH5Gateway}=await import('../server/h5-gateway.mjs');
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
  async function makeRoom(count){
    const players=[];
    for(let i=0;i<count;i++)players.push({session:(await call(null,'/session',{})).token});
    const owner=players[0];owner.ticket=await call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
    const path='/api/rooms/'+owner.ticket.room.id;
    for(const actor of players.slice(1))actor.ticket=await call(actor,path+'/join',{});
    let snap=await call(owner,path,undefined,owner.ticket.token),drops=0;
    while(!snap.completedAt){
      assert.ok(drops<100,'Completion did not converge');
      // Every seat contributes, including the seat that subsequently leaves; player 1 leads.
      const actor=drops<count?players[drops]:owner,group=snap.puzzle.groups.find(group=>!group.locked);
      assert.ok(group,'No movable group in incomplete room');
      await call(actor,path,{type:'claim',groupId:group.id,requestId:rid()},actor.ticket.token);
      snap=await call(actor,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},actor.ticket.token);drops++;
    }
    if(count>1){const actor=players.at(-1);await call(actor,path,{type:'leave',requestId:rid()},actor.ticket.token);}
    snap=await call(owner,path,undefined,owner.ticket.token);
    assert.ok(snap.completedAt&&snap.mobileResult,'Real completion and settlement required');
    const summary={players:count,roomId:snap.id,pieces:snap.puzzle.cols*snap.puzzle.rows,drops,completedAt:snap.completedAt,
      departed:count>1,ranking:snap.mobileResult.ranking};report.rooms.push(summary);
    console.log(`Completed ${count}-player room through HTTP (${drops} drops).`);
    return {players,path,snap};
  }
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const privacySource=readFileSync('mobile/privacy-policy.ts','utf8'),privacyVersion=privacySource.match(/MOBILE_PRIVACY_VERSION='([^']+)'/)[1];
  for(const count of [1,4,8]){
    const room=await makeRoom(count),owner=room.players[0];
    for(const [width,height] of [[844,390],[390,844],[1920,1080]]){
      const video=count===8&&width===844,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,
        isMobile:width<1000,hasTouch:width<1000,...(video?{recordVideo:{dir:resolve(runtime,'video'),size:{width,height}}}:{})});
      let page,recording;
      try{
        // Prevent all external HTTP requests, including an accidental CDN configuration.
        await context.route('**/*',route=>{
          const url=new URL(route.request().url());
          if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();
          report.blockedExternalRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');
        });
        await context.addInitScript(({api,session,ticket,privacyVersion})=>{
          localStorage.setItem('jigsaw:h5-session:'+api,session);
          localStorage.setItem('jigsaw:shared-room:'+api+':'+ticket.room.id,JSON.stringify({token:ticket.token,playerId:ticket.playerId}));
          localStorage.setItem('jigsaw:mobile-privacy:'+privacyVersion,JSON.stringify({version:privacyVersion,necessary:true,hongKongStorage:true}));
        },{api,session:owner.session,ticket:owner.ticket,privacyVersion});
        page=await context.newPage();recording=page.video();
        const tag=`${count}p-${width}x${height}`;
        page.on('pageerror',error=>report.pageErrors.push({capture:tag,message:error.message}));
        page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({capture:tag,message:message.text()});});
        page.on('response',response=>{if(response.status()>=400)report.networkErrors.push({capture:tag,status:response.status(),path:new URL(response.url()).pathname});});
        await page.goto(base+'/?room='+room.snap.id,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>{const game=window.__JIGSAW_SHARED__;return game?.app.route==='room'&&game.app.imageReady&&game.client.ticket?.playerId;},null,{timeout:20000});
        await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.realtime?.connected,null,{timeout:10000});
        // Already-completed initial snapshots do not notify RoomClient subscribers.
        // A temporary, zero-contribution API spectator creates a genuine roster update.
        // It leaves before capture and is absent from the completion ranking and seats.
        if(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modal!=='completion')){
          if(!report.problems.some(problem=>problem.code==='COMPLETED_REENTRY'))report.problems.push({code:'COMPLETED_REENTRY',
            source:'mobile/app.ts:420; lib/room-client.ts:81,90-93',
            message:'Entering an already-completed room does not open completion until a later metadata change; a heartbeat alone is deduped. Harness temporarily joins/leaves a zero-contribution spectator through HTTP to trigger the real popup.',
            evidence:resolve(runtime,'completed-reentry.png')});
          if(count===1&&width===844)await page.screenshot({path:resolve(runtime,'completed-reentry.png')});
          const spectator={session:(await call(null,'/session',{})).token};
          spectator.ticket=await call(spectator,room.path+'/join',{});
          await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion',null,{timeout:10000});
          await call(spectator,room.path,{type:'leave',requestId:rid()},spectator.ticket.token);
        }
        await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='completion'&&window.__JIGSAW_SHARED__.app.completionBar?.w>0,null,{timeout:12000});
        await page.evaluate(()=>document.fonts.ready);
        await page.waitForFunction(()=>window.__JIGSAW_SHARED__.stage.font.includes('Jigsaw'),null,{timeout:15000});
        // Read existing runtime diagnostics only; UI and effects are never patched.
        const before=await page.evaluate(()=>{
          const {app,client,stage}=window.__JIGSAW_SHARED__;
          return {layout:app.layout,platform:client.platform.config.id,playerId:client.ticket.playerId,finePointer:matchMedia('(pointer:fine)').matches,
            stage:{w:stage.w,h:stage.h},bar:app.completionBar,font:stage.font};
        });
        assert.equal(before.playerId,owner.ticket.playerId);
        assert.equal(before.layout,width===1920?'desktop':width>height?'phoneLandscape':'phonePortrait');
        if(width===1920)assert.equal(before.finePointer,true);
        // Let the reconnect notice clear and finish subscribing before the live burst.
        await page.waitForTimeout(3400);
        // API-only players need real heartbeats, just like an open browser client.
        // Refresh before each burst so only the explicitly departed seat is grey.
        if(count>1){
          await Promise.all(room.players.slice(1,-1).map(actor=>call(actor,room.path,{type:'heartbeat',requestId:rid()},actor.ticket.token)));
          await page.waitForFunction(present=>window.__JIGSAW_SHARED__.app.completionSeats().filter(seat=>seat.present).length===present,count-1,{timeout:10000});
        }
        const bar=before.bar,scaleX=width/before.stage.w,scaleY=height/before.stage.h;
        assert.ok((bar.y+bar.h/2)*scaleY<height,'Cheer buttons are outside the initial viewport');
        const started=Date.now();
        await page.mouse.click((bar.x+bar.w/12)*scaleX,(bar.y+bar.h/2)*scaleY);
        const others=room.players.slice(1,count>1?-1:undefined);
        const emotes=['popper','heart','tea','tea','star','cat','clap'];
        const sent=[];
        if(others.length)for(let i=0;i<emotes.length;i++){
          const actor=others[i%others.length],emote=emotes[i];
          await call(actor,room.path+'/cheers',{id:rid(),emote},actor.ticket.token);sent.push({playerId:actor.ticket.playerId,emote});
        }
        else{
          await page.waitForTimeout(320);
          await page.mouse.click((bar.x+bar.w/6+bar.w/12)*scaleX,(bar.y+bar.h/2)*scaleY);
        }
        const burstEnd=Date.now();
        await page.waitForFunction(expected=>window.__JIGSAW_SHARED__.app.cheerEffects.bubbles.length>=expected,count>1?new Set(sent.map(item=>item.playerId)).size:1,{timeout:10000});
        await page.waitForTimeout(Math.max(0,550-(Date.now()-burstEnd)));
        const capture=await page.evaluate(()=>{
          const {app,stage,diagnostics}=window.__JIGSAW_SHARED__,fx=app.cheerEffects;
          return {layout:app.layout,stage:{w:stage.w,h:stage.h},modal:app.modalArea,picture:app.completionPicture,bar:app.completionBar,
            seats:[...app.completionSeatRects].map(([id,rect])=>({id,...rect})),members:app.completionSeats(),
            avatars:[...app.completionAvatarRects].map(([id,rect])=>({id,...rect})),
            bubbles:[...app.completionBubbleRects].map(([id,rect])=>({id,...rect,emote:fx.bubbles.find(b=>b.playerId===id)?.emote,count:fx.bubbles.find(b=>b.playerId===id)?.count})),particles:fx.particles.length,
            combo:fx.combo?.count??0,tea:!!fx.tea,diagnostics:diagnostics()};
        });
        assert.equal(capture.seats.length,count===1?0:count);
        if(count>1){assert.equal(capture.members.filter(seat=>!seat.present).length,1,'Exactly one departed seat required');assert.ok(capture.combo>=3,'Missing combo banner');}
        assert.ok(capture.seats.every(seat=>seat.x>=0&&seat.y>=0&&seat.x+seat.w<=capture.stage.w+1&&seat.y+seat.h<=capture.stage.h+1),'Seat outside viewport');
        for(const bubble of capture.bubbles){
          if(bubble.x<0||bubble.y<0||bubble.x+bubble.w>capture.stage.w||bubble.y+bubble.h>capture.stage.h)report.problems.push({capture:tag,code:'BUBBLE_OUTSIDE_STAGE',bubble});
          const panel=capture.modal;if(capture.layout!=='phonePortrait'&&bubble.x<panel.x+panel.w&&bubble.x+bubble.w>panel.x&&bubble.y<panel.y+panel.h&&bubble.y+bubble.h>panel.y)report.problems.push({capture:tag,code:'BUBBLE_INTERSECTS_PANEL',bubble,panel});
        }
        const png=resolve(output,`cheers-${tag}.png`);
        const screenshotStarted=Date.now();
        await page.screenshot({path:png,timeout:10000});
        const bytes=readFileSync(png);assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
        report.files.push(inventory(png));
        report.captures.push({file:png,width,height,players:count,burstMs:burstEnd-started,screenshotAfterBurstMs:screenshotStarted-burstEnd,sent,...before,...capture});
        console.log(`Saved ${tag}: ${capture.bubbles.length} bubbles, combo ${capture.combo}, ${capture.particles} particles.`);
        if(video)await page.waitForTimeout(Math.max(0,6100-(Date.now()-started)));
      }catch(error){
        if(page){
          report.problems.push({capture:`${count}p-${width}x${height}`,message:error.message,
            state:await page.evaluate(()=>{const g=window.__JIGSAW_SHARED__;return g?{ready:g.app.ready,modal:g.app.modal,route:g.app.route,
              message:g.app.message,startupError:g.app.startupError,imageReady:g.app.imageReady,imageError:g.app.imageError,
              privacy:g.app.needsPrivacyChoice,login:g.app.loginDialogActive,bar:g.app.completionBar,diagnostics:g.diagnostics()}:null;}).catch(()=>null)});
          await page.screenshot({path:resolve(runtime,`failure-${count}p-${width}x${height}.png`)}).catch(()=>{});
        }
        throw error;
      }finally{
        await context.close();
        if(video&&recording){const file=resolve(output,'cheers-8p-844x390.webm');await saveVideo(recording,file);report.files.push(inventory(file));}
      }
    }
  }
  assert.equal(report.captures.length,9);
  for(const file of report.files)assert.ok(statSync(file.path).size>0);
}catch(error){failure=error;report.failure=error.stack;process.exitCode=1;}
finally{
  await browser?.close().catch(error=>report.problems.push('Browser cleanup: '+error.message));
  if(gateway){gateway.realtime?.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));}
  else service?.close();
  report.finishedAt=new Date().toISOString();
  const json=resolve(output,'cheers-report.json');writeFileSync(json,JSON.stringify(report,null,2)+'\n');
  copyFileSync(json,resolve(runtime,'cheers-report.json'));
  console.log(JSON.stringify({script:report.script,command:report.command,files:report.files.map(file=>file.path),report:json,
    screenshots:report.captures.length,completionMethod:report.completionMethod,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors,
    networkErrors:report.networkErrors,blockedExternalRequests:report.blockedExternalRequests,problems:report.problems,failure:report.failure??null},null,2));
}
if(failure)console.error(failure.stack);
