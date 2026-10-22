import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.SHARED_WEB_TEST_BASE||'http://127.0.0.1:3223/',out=resolve('outputs/shared-web-preview-qa');
assert.equal(new URL(base).hostname,'127.0.0.1','This acceptance run is restricted to an isolated local preview.');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'zh-CN'}),page=await context.newPage();
const checks=[],errors=[],external=[],requests=[],screenshots=[];let roomId;
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.method()==='POST'){let body;try{body=request.postDataJSON();}catch{}requests.push({url:request.url(),body});}});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['data:','blob:'].includes(url.protocol)||url.hostname==='127.0.0.1')return route.continue();external.push(url.href);return route.abort('blockedbyclient');});

async function redraw(){await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.invalidate());await page.waitForTimeout(90);}
async function ready(route){await page.waitForFunction(route=>{const game=window.__JIGSAW_SHARED__;return game?.app.ready&&!game.app.busy&&game.app.route===route;},route,{timeout:20000});await redraw();}
async function capture(name){
 await redraw();const text=await page.evaluate(()=>window.__previewDrawnText.map(item=>item.text));
 assert.ok(!text.some(value=>/体力|广告领|看广告|观看广告/.test(value)),`${name} exposes a mobile-only energy or advertising action: ${text.filter(value=>/体力|广告/.test(value)).join(', ')}`);
 const bounds=await page.evaluate(()=>({w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth,hits:window.__JIGSAW_SHARED__.stage.hits.map(hit=>hit.r)}));
 assert.ok(bounds.scroll<=bounds.w+1,`${name} overflows the browser viewport`);
 assert.ok(bounds.hits.every(r=>r.w>0&&r.h>0&&r.x>=-1&&r.y>=-1&&r.x+r.w<=bounds.w+1&&r.y+r.h<=bounds.h+1),`${name} has a clickable target outside the canvas`);
 const file=resolve(out,name+'.png');await page.screenshot({path:file});screenshots.push(file);checks.push({name,text});
}
async function clickText(text,{exact=true}={}){
 await redraw();const point=await page.evaluate(({text,exact})=>{
  const game=window.__JIGSAW_SHARED__,items=window.__previewDrawnText.filter(item=>exact?item.text===text:item.text.includes(text));
  for(const item of items){const x=item.x+item.w/2,y=item.y+item.h/2,hit=[...game.stage.hits].reverse().find(hit=>x>=hit.r.x&&x<=hit.r.x+hit.r.w&&y>=hit.r.y&&y<=hit.r.y+hit.r.h);if(hit)return{x,y,hit:hit.r};}
  return null;
 },{text,exact});
 assert.ok(point,`No actual clickable Canvas label found for ${JSON.stringify(text)}`);await page.mouse.click(point.x,point.y);await page.waitForTimeout(100);return point;
}
const boardSnapshot=point=>page.evaluate(point=>{const board=window.__JIGSAW_SHARED__.app.board;return{camera:{...board.camera},world:{x:(point.x-board.rect.x-board.camera.x)/board.camera.z,y:(point.y-board.rect.y-board.camera.y)/board.camera.z},state:JSON.stringify(board.state.groups)};},point);
const closeEnough=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} vs ${b}`);

try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await ready('lobby');
 await page.evaluate(()=>{
  const game=window.__JIGSAW_SHARED__,stage=game.stage,ctx=stage.ctx,begin=stage.begin.bind(stage),fill=ctx.fillText.bind(ctx);window.__previewDrawnText=[];
  stage.begin=()=>{window.__previewDrawnText=[];begin();};
  ctx.fillText=(text,x,y,...rest)=>{
   const transform=ctx.getTransform(),scale=stage.platform.viewport().dpr||1,p=transform.transformPoint({x,y}),w=ctx.measureText(String(text)).width*transform.a/scale,h=(parseFloat(ctx.font.match(/([\d.]+)px/)?.[1])||14)*transform.d/scale,box={text:String(text),x:p.x/scale,y:p.y/scale,w,h};
   const cx=box.x+Math.min(w,12)/2,cy=box.y+h/2;
   if(cx>=0&&cy>=0&&cx<=innerWidth&&cy<=innerHeight&&stage.clips.every(clip=>cx>=clip.x&&cx<=clip.x+clip.w&&cy>=clip.y&&cy<=clip.y+clip.h))window.__previewDrawnText.push(box);
   return fill(text,x,y,...rest);
  };stage.invalidate();
 });
 const config=await page.evaluate(()=>({platform:window.__JIGSAW_SHARED__.client.platform.config.id,api:window.__JIGSAW_SHARED__.client.platform.config.apiBase,capabilities:window.__JIGSAW_SHARED__.client.config.capabilities}));
 assert.equal(config.platform,'web');assert.equal(new URL(config.api).hostname,'127.0.0.1');assert.equal(config.capabilities?.energy,false);
 await capture('desktop-lobby-1440x900');
 await clickText('创建房间');await ready('gallery');
 const list=await page.evaluate(()=>({...window.__JIGSAW_SHARED__.app.listArea,scroll:window.__JIGSAW_SHARED__.app.scroll}));
 await page.mouse.move(list.x+list.w*.65,list.y+list.h*.55);await page.mouse.wheel(0,430);await page.waitForTimeout(120);
 assert.ok(await page.evaluate(value=>window.__JIGSAW_SHARED__.app.scroll>value,list.scroll),'The actual wheel must scroll the gallery within its translated desktop pane.');
 await page.mouse.wheel(0,-10000);await page.waitForTimeout(120);await capture('desktop-gallery-1440x900');checks.push({name:'gallery-scroll-with-real-wheel'});
 await clickText('我的相册');await ready('collection');await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__.app.collection);await capture('desktop-albums-1440x900');
 await clickText('任务与礼包');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='tasks'&&!!window.__JIGSAW_SHARED__.app.tasks);assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.route),'collection');await capture('desktop-tasks-1440x900');await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal===null);
 await clickText('玩法与设置');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='settings');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modal),null);checks.push({name:'real-click-settings-and-Escape-close'});
 await clickText('挑选图片');await ready('gallery');await clickText('48');await clickText('随机公开房 · 免费');await ready('room');
 await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.imageReady&&window.__JIGSAW_SHARED__.app.board.networkReady,null,{timeout:25000});
 roomId=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.room.ticket.room.id);assert.match(roomId,/^[a-f0-9]{32}$/);assert.ok(requests.some(request=>request.url.endsWith('/api/rooms')&&request.body?.pieces===48));
 await capture('desktop-room-1440x900');
 const point=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,r=app.board.rect;for(const fx of [.42,.5,.3])for(const fy of [.44,.55,.32]){const p={id:-1,x:Math.round(r.x+r.w*fx),y:Math.round(r.y+r.h*fy)};if(!stage.hasHit(p.x,p.y))return p;}throw Error('No unobstructed puzzle surface');});
 const before=await boardSnapshot(point);await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-180);await page.waitForTimeout(120);const zoomed=await boardSnapshot(point);
 assert.ok(zoomed.camera.z>before.camera.z);closeEnough(zoomed.world.x,before.world.x,'wheel world anchor x');closeEnough(zoomed.world.y,before.world.y,'wheel world anchor y');assert.equal(zoomed.state,before.state);
 const claimsBefore=requests.filter(request=>request.body?.type==='claim').length;
 await page.mouse.down({button:'middle'});await page.mouse.move(point.x+74,point.y+43,{steps:5});await page.mouse.up({button:'middle'});await page.waitForTimeout(120);const panned=await boardSnapshot(point);
 closeEnough(panned.camera.x,zoomed.camera.x+74,'middle-button pan x');closeEnough(panned.camera.y,zoomed.camera.y+43,'middle-button pan y');assert.equal(panned.state,before.state);assert.equal(requests.filter(request=>request.body?.type==='claim').length,claimsBefore);
 checks.push({name:'real-wheel-anchor-and-middle-pan-without-piece-claim',before:before.camera,zoomed:zoomed.camera,panned:panned.camera});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);await page.evaluate(()=>window.__JIGSAW_SHARED__.app.navigate('gallery'));await ready('gallery');
 const card=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,hit=stage.hits.find(hit=>hit.r.y>=app.bodyTop&&hit.r.y<app.bodyBottom&&hit.r.w>100&&hit.r.h>50);return hit?{x:hit.r.x+hit.r.w/2,y:hit.r.y+hit.r.h/2}:null;});
 assert.ok(card,'A visible landscape image must remain clickable');await page.mouse.click(card.x,card.y);await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__.app.selected);await capture('landscape-gallery-844x390');checks.push({name:'landscape-image-hit-selects-real-photo'});
 await page.evaluate(()=>window.__JIGSAW_SHARED__.app.navigate('room'));await ready('room');
 const fitted=await page.evaluate(()=>{const board=window.__JIGSAW_SHARED__.app.board,b=board.board;return{rect:board.rect,camera:board.camera,topLeft:board.worldToScreen({x:b.x,y:b.y}),bottomRight:board.worldToScreen({x:b.x+b.width,y:b.y+b.height})};});
 assert.ok(fitted.topLeft.x>=fitted.rect.x-1&&fitted.topLeft.y>=fitted.rect.y-1&&fitted.bottomRight.x<=fitted.rect.x+fitted.rect.w+1&&fitted.bottomRight.y<=fitted.rect.y+fitted.rect.h-64,'Crossing into phone landscape must fit the full puzzle target above its floating tools.');
 await capture('landscape-room-844x390');checks.push({name:'desktop-to-phone-rotation-refits-full-target',...fitted});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await page.evaluate(()=>window.__JIGSAW_SHARED__.app.navigate('tasks'));await ready('tasks');await capture('portrait-tasks-390x844');
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(150);await page.evaluate(()=>window.__JIGSAW_SHARED__.app.navigate('lobby'));await ready('lobby');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.rooms.length>0);await capture('desktop-lobby-with-room-1440x900');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({passed:checks.length,roomId,screenshots},null,2));
}catch(error){
 await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});writeFileSync(resolve(out,'failure-text.json'),JSON.stringify(await page.evaluate(()=>({text:window.__previewDrawnText,route:window.__JIGSAW_SHARED__?.app.route,modal:window.__JIGSAW_SHARED__?.app.modal,message:window.__JIGSAW_SHARED__?.app.message})).catch(()=>null),null,2));throw error;
}finally{
 writeFileSync(resolve(out,'report.json'),JSON.stringify({base,roomId,checks,errors,external,screenshots,requests:requests.map(request=>({url:request.url,type:request.body?.type,mode:request.body?.mode,pieces:request.body?.pieces}))},null,2));await browser.close();
}
