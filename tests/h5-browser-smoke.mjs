import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createH5Gateway} from '../server/h5-gateway.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
mkdirSync('work/h5-browser',{recursive:true});
const preview={gatewayUrl:""};
const staticServer=createServer((req,res)=>{
 res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 if(req.url==='/games/jigsaw/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.JIGSAW_H5_CONFIG='+JSON.stringify({apiBase:preview.gatewayUrl+'/h5'})+';');return;}
 const path=new URL(req.url,'http://test.invalid').pathname,filename=path==='/games/jigsaw/'?'index.html':path.replace(/^\/games\/jigsaw\//,''),file=resolve('outputs/h5',filename);
 if(!file.startsWith(resolve('outputs/h5')+'\\')){res.writeHead(404);res.end();return;}
 try{const contents=readFileSync(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(contents);}catch{res.writeHead(404);res.end();}
});
const clientOrigin=await listen(staticServer),clientBase=clientOrigin+'/games/jigsaw/';
const gateway=createH5Gateway({upstream:'http://127.0.0.1:3220',allowedOrigins:[clientOrigin],adAssistanceEnabled:true,rewardedAdUnitId:'isolated-test-unit',assetPaths:JSON.parse(readFileSync('h5/asset-manifest.json','utf8'))});
preview.gatewayUrl=await listen(gateway);
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
try{
 const ctx=await browser.newContext({viewport:{width:1280,height:850}});
 await ctx.route(preview.gatewayUrl+'/h5/assets/puzzles/*-thumbnail-*',route=>route.abort('blockedbyclient'));
 for(const path of ['api/**','session','config','rewarded/**','media-ticket'])await ctx.route(preview.gatewayUrl+'/h5/'+path,route=>route.abort('blockedbyclient'));
 await ctx.exposeBinding('__nativeGatewayRequest',async(_source,payload)=>{assert.ok(payload.url.startsWith(preview.gatewayUrl+'/h5/'));const r=await fetch(payload.url,{method:payload.method,headers:{...payload.header,Origin:clientOrigin},body:payload.data});return {statusCode:r.status,data:await r.text(),header:Object.fromEntries(r.headers)};});
 await ctx.addInitScript(()=>{window.tap={request(options){let aborted=false;window.__nativeGatewayRequest({url:options.url,method:options.method,header:options.header,data:options.data}).then(result=>{if(!aborted)options.success(result);},error=>{if(!aborted)options.fail({errMsg:error.message});});return {abort(){aborted=true;}};}};});
 const page=await ctx.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(clientBase+'#/zh/lobby');
 await page.getByRole('button',{name:'每日拼图 108片',exact:true}).waitFor();
 await page.getByRole('button',{name:'广告福利',exact:true}).click();
 await page.getByRole('dialog').getByText(/使用提示或底图前/).waitFor();
 await page.getByRole('button',{name:'继续拼图',exact:true}).click();checks.push('广告入口未配置时可关闭，不影响正常游玩');
 await page.screenshot({path:'work/h5-browser/lobby-desktop.png',fullPage:true});
 assert.equal(await page.locator('.daily-puzzle,.lobby-heading,.public-retention-note').count(),0);checks.push('H5大厅移除日拼大卡和重复介绍，保留一键108片入口');await page.getByRole('link',{name:'图库',exact:true}).click();
 await page.waitForURL('**/#/zh/gallery');
 await page.waitForTimeout(1200);
 assert.ok((await page.locator('body').innerText()).includes('图库'));checks.push('子目录安全的 H5 路由与图库正常');
 try{await page.waitForFunction(()=>[...document.images].length>0&&[...document.images].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:15000});}catch(error){console.log(JSON.stringify(await page.locator('img').evaluateAll(images=>images.filter(img=>!img.complete||!img.naturalWidth).map(img=>({src:img.src,loading:img.loading,complete:img.complete}))),null,2));throw error;}
 const galleryImages=await page.locator('img').evaluateAll(images=>images.map(img=>({src:img.src,ok:img.complete&&img.naturalWidth>0})));
 assert.ok(galleryImages.length>0);assert.ok(galleryImages.every(img=>img.ok));assert.equal(await page.evaluate(()=>crossOriginIsolated),true);assert.ok(await page.locator('img').evaluateAll(images=>images.every(img=>img.crossOrigin==='anonymous')));assert.ok(galleryImages.every(img=>new URL(img.src).origin===clientOrigin));checks.push('远程缩略图被阻断时，严格隔离下图库仍从包内加载');
 const cookie='puzzle_guest='+randomBytes(32).toString('hex');
 const response=await fetch('http://127.0.0.1:3220/api/rooms',{method:'POST',headers:{Origin:'http://127.0.0.1:3220','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({imageId:'lemon-still-life-native-v2',pieces:108,visibility:'public',title:'浏览器双端验收'})});
 assert.equal(response.status,201);const ticket=await response.json();
 await page.goto(clientBase+'#/room/'+ticket.room.id);
 await page.locator('canvas').waitFor();
 await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);
 const webCtx=await browser.newContext({viewport:{width:1280,height:850}});
 await webCtx.addCookies([{name:'puzzle_guest',value:cookie.split('=')[1],url:'http://127.0.0.1:3220'}]);
 const webPage=await webCtx.newPage();webPage.on('pageerror',error=>errors.push(error.message));
 await webPage.goto('http://127.0.0.1:3220/room/'+ticket.room.id);
 await webPage.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);
 await page.waitForTimeout(1600);
 assert.ok((await page.locator('body').innerText()).includes('2/8')||(await page.locator('body').innerText()).includes('2 / 8'));checks.push('浏览器请求被阻断时，TapTap官方请求适配完成入座与双端同房');
 const pixel=await page.locator('canvas').first().evaluate(canvas=>[...canvas.getContext('2d').getImageData(10,10,1,1).data]);
 assert.equal(pixel.length,4);checks.push('跨来源拼图图片可绘制并读取 Canvas');
 const hint=page.getByRole('button',{name:/^提示 · 看广告/}),underlay=page.getByRole('button',{name:/^底图 · 看广告/});
 await hint.click();await page.getByRole('alert').getByText('广告暂未开放，请继续正常拼图',{exact:true}).waitFor();
 assert.equal(await hint.isEnabled(),true);checks.push('普通浏览器无平台 SDK 时，提示保持锁定并说明原因');
 await page.evaluate(()=>{window.__adMode='closed';window.__watchCount=0;window.tap={...window.tap,createRewardedVideoAd:()=>{let close,error;return {load:async()=>{},show:async()=>{window.__watchCount++;setTimeout(()=>{if(window.__adMode==='failed')error(new Error('isolated failure'));else close({isEnded:window.__adMode==='completed'});},0);},onClose:fn=>{close=fn;},onError:fn=>{error=fn;},offClose:()=>{},offError:()=>{},destroy:()=>{}};}};});
 await hint.click();await page.getByRole('alert').getByText(/需要完整观看广告/).waitFor();
 assert.equal(await hint.isEnabled(),true);checks.push('模拟提前关闭广告，提示不解锁');
 await page.evaluate(()=>{window.__adMode='failed';});await underlay.click();await page.getByRole('alert').getByText('广告暂时无法播放，请稍后再试',{exact:true}).waitFor();
 assert.equal(await underlay.isEnabled(),true);checks.push('模拟广告播放失败，底图不解锁');
 await page.evaluate(()=>{window.__adMode='completed';});await hint.click();
 await page.getByRole('button',{name:/^提示 · \d+s/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/^提示 · \d+s/}).isDisabled(),true);
 await underlay.click();await page.getByRole('button',{name:/^底图 · \d+s/}).waitFor();
 assert.equal(await page.evaluate(()=>window.__watchCount),4);checks.push('模拟完整广告分别解锁一次提示和一次底图，显示30秒使用倒计时');
 await webPage.getByRole('button',{name:/^提示 · \d+\/\d+/}).click();await webPage.getByRole('button',{name:/^提示 · \d+s/}).waitFor();checks.push('原 Web 同房玩家继续使用原有免费提示规则');
 await page.screenshot({path:'work/h5-browser/room-desktop.png'});
 await page.reload();
 await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);checks.push('刷新后持久 H5 会话正常重新入座');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),mobilePage=await mobile.newPage();
 await mobile.addInitScript(()=>{window.tap={setDeviceOrientation(options){options.success();},onAccelerometerChange(){},offAccelerometerChange(){}};});mobilePage.on('pageerror',error=>errors.push(error.message));
 const lobbyFixture=await (await fetch('http://127.0.0.1:3220/api/lobby')).json();
 const resumeRoom=lobbyFixture.rooms.find(room=>room.id===ticket.room.id);assert.ok(resumeRoom);
 await mobilePage.route('**/h5/api/my-rooms',route=>route.fulfill({json:{rooms:[{...resumeRoom,placed:1,lastPlayedAt:Date.now()}]}}));
 await mobilePage.goto(clientBase+'#/zh/lobby');
 await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).waitFor();
 const resume=mobilePage.getByRole('link',{name:/^接着拼 · /});await resume.waitFor();assert.equal(await resume.getAttribute('href'),'/room/'+ticket.room.id);assert.ok((await resume.boundingBox()).height<=50);
 await mobilePage.waitForTimeout(1800);
 const widths=await mobilePage.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
 await mobilePage.screenshot({path:'work/h5-browser/lobby-mobile.png',fullPage:true});
if(widths.scroll>widths.client+1)console.log(JSON.stringify(await mobilePage.locator('body *').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,cls:n.className,rect:n.getBoundingClientRect().toJSON()})).filter(n=>n.rect.right>391&&n.rect.width>5).slice(0,20)),null,2));
assert.ok(widths.scroll<=widths.client+1,JSON.stringify(widths));checks.push('390px 手机大厅无横向溢出');
 await mobilePage.screenshot({path:'work/h5-browser/lobby-mobile.png',fullPage:true});
 for(const size of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
  await mobilePage.setViewportSize(size);await mobilePage.waitForTimeout(150);
  const layout=await mobilePage.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,actions:[...document.querySelectorAll('.h5-quick-action')].map(el=>el.getBoundingClientRect().toJSON()),roomsTop:document.querySelector('.public-grid')?.getBoundingClientRect().top}));
  assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));assert.ok(layout.actions.every(r=>r.height>=44&&r.height<=50&&r.left>=0&&r.right<=layout.width),JSON.stringify(layout));assert.ok(layout.roomsTop<500,JSON.stringify(layout));
  await mobilePage.screenshot({path:'work/h5-browser/compact-lobby-'+size.width+'x'+size.height+'.png'});
 }
 checks.push('带续拼入口的320/390竖屏和844横屏大厅：按钮44px以上、无溢出，房间列表位于500px以内');
 await mobilePage.setViewportSize({width:390,height:844});
 const lobbyPattern='**/h5/api/lobby';
 // An empty public list deterministically exercises creation, even when the isolated DB has older rooms.
 await mobilePage.route(lobbyPattern,route=>route.fulfill({json:{rooms:[],serverTime:Date.now()}}));
 let creates=0;mobilePage.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/h5/api/rooms')creates++;});
 const createdResponse=mobilePage.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/h5/api/rooms');
 await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).evaluate(button=>{button.click();button.click();});
 const created=await createdResponse;assert.equal(created.status(),201);assert.equal(created.request().postDataJSON().pieces,108);const dailyTicket=await created.json();
 // The shared engine fits square pieces to the artwork; the public room card records the requested count band.
 await mobilePage.waitForURL('**/#/room/'+dailyTicket.room.id);
 await mobilePage.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);assert.equal(creates,1);
 checks.push('每日按钮连续点击只创建一个108片公开房间，保存入座凭据并进入H5拼图');
 await mobilePage.unroute(lobbyPattern);
 const updatedLobby=await (await fetch('http://127.0.0.1:3220/api/lobby')).json();
 const dailyRoom=updatedLobby.rooms.find(room=>room.id===dailyTicket.room.id);assert.ok(dailyRoom);assert.equal(dailyRoom.pieces,108);
 await mobilePage.route(lobbyPattern,route=>route.fulfill({json:{rooms:[{...dailyRoom,id:'full-room',players:8},{...dailyRoom,id:'different-piece-count',pieces:300},{...dailyRoom,id:'completed-room',completed:true},{...dailyRoom,id:'closed-room',acceptingNew:false},dailyRoom],serverTime:Date.now()}}));
 await mobilePage.goto(clientBase+'#/zh/lobby');await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).click();
 await mobilePage.waitForURL('**/#/room/'+dailyTicket.room.id);await mobilePage.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);assert.equal(creates,1);
 checks.push('已有今日108片可加入房间时直接复用，跳过满员、完成、暂停加入和300片房间');
 await mobilePage.unroute(lobbyPattern);
 await mobilePage.route(lobbyPattern,route=>route.fulfill({json:{rooms:[],serverTime:Date.now()}}));
 const createPattern='**/h5/api/rooms';await mobilePage.route(createPattern,route=>route.fulfill({status:503,json:{error:'日拼测试：暂时无法进入'}}));
 await mobilePage.goto(clientBase+'#/zh/lobby');await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).click();
 await mobilePage.getByRole('alert').filter({hasText:'日拼测试：暂时无法进入'}).waitFor();assert.equal(await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).isEnabled(),true);
 await mobilePage.unroute(createPattern);await mobilePage.getByRole('button',{name:'每日拼图 108片',exact:true}).click();
 await mobilePage.waitForURL('**/#/room/*');await mobilePage.waitForFunction(()=>JSON.parse(document.documentElement.dataset.puzzleGameStatus||'{}').ready===true);
 checks.push('每日拼图创建失败显示错误并恢复按钮，手动重试成功进入房间');
 await mobilePage.unroute(lobbyPattern);
 for(const size of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
  await mobilePage.setViewportSize(size);await mobilePage.waitForTimeout(400);
  const bounds=await mobilePage.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),tools:document.querySelector('.table-tools').getBoundingClientRect().toJSON(),zoom:document.querySelector('.zoom-controls').getBoundingClientRect().toJSON()}));
  assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.canvas.width>0&&Math.abs(bounds.canvas.height-bounds.height)<=1,JSON.stringify(bounds));assert.ok(bounds.zoom.bottom<=bounds.height&&bounds.zoom.right<=bounds.width&&bounds.zoom.left>=0,JSON.stringify(bounds));assert.equal(await mobilePage.getByRole('button',{name:'返回大厅',exact:true}).isVisible(),true);assert.ok(bounds.tools.left>=-1&&bounds.tools.right<=bounds.width+1&&bounds.tools.top>=0&&bounds.tools.bottom<=bounds.height);assert.ok(bounds.zoom.top>=bounds.tools.bottom||bounds.zoom.left>=bounds.tools.right,JSON.stringify(bounds));
  await mobilePage.screenshot({path:`work/h5-browser/room-${size.width}x${size.height}.png`});
 }
 checks.push('320px、390px竖屏与844px横屏中画布重排、工具与缩放区不重叠');
 assert.deepEqual(errors,[]);
 const report={testedAt:new Date().toISOString(),isolated:true,crossOrigin:true,checks,passed:checks.length,errors};
 writeFileSync('work/h5-browser/results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await close(gateway);await close(staticServer);}
