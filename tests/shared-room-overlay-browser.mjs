import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.SHARED_WEB_TEST_BASE||'http://127.0.0.1:3223/',out=resolve('outputs/shared-web-room-overlay-qa');
const appearanceOnly=process.argv.includes('--appearance-only');
const tableStyleOnly=process.argv.includes('--table-style-only');
const spacingInitialOnly=process.argv.includes('--spacing-initial-only');
const spacingOnly=process.argv.includes('--spacing-only')||spacingInitialOnly;
const iconsOnly=process.argv.includes('--icons-only');
const chatOnly=process.argv.includes('--chat-only'),reportPrefix=iconsOnly?'icons-':spacingInitialOnly?'spacing-initial-':spacingOnly?'spacing-':tableStyleOnly?'table-style-':chatOnly?'chat-':appearanceOnly?'appearance-':'';
assert.equal(new URL(base).hostname,'127.0.0.1','Room overlay acceptance must only target the isolated preview.');mkdirSync(out,{recursive:true});
const browserChannel=process.env.SHARED_WEB_TEST_BROWSER||'msedge',browser=await chromium.launch({channel:browserChannel,headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'zh-CN'}),page=await context.newPage();
const errors=[],external=[],checks=[],shots=[],requests=[];let roomId;
await context.route('**/*',route=>{const u=new URL(route.request().url());if(['data:','blob:'].includes(u.protocol)||u.hostname==='127.0.0.1')return route.continue();external.push(u.href);return route.abort('blockedbyclient');});
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'){let body;try{body=request.postDataJSON();}catch{}requests.push({url:request.url(),type:body?.type,groupId:body?.groupId});}});
const refresh=async()=>{await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.invalidate());await page.waitForTimeout(90);};
const state=()=>page.evaluate(()=>{const{app}=window.__JIGSAW_SHARED__;return{route:app.route,modal:app.modal,id:app.room?.ticket.room.id,camera:{...app.board?.camera},groups:JSON.stringify(app.board?.state.groups),modalScroll:app.modalScroll,scroll:app.scroll,taskTab:app.taskTab,toolsOpen:app.toolsOpen};});
async function sameRoom(before,label){const after=await state();assert.equal(after.route,'room',label+' must remain in the room');assert.equal(after.id,before.id,label+' must preserve the room');assert.deepEqual(after.camera,before.camera,label+' must preserve camera');assert.equal(after.groups,before.groups,label+' must preserve puzzle groups');return after;}
const claims=()=>requests.filter(request=>request.type==='claim').length;
async function clickText(text,{prefix=false}={}){await refresh();const point=await page.evaluate(({text,prefix})=>{const{stage}=window.__JIGSAW_SHARED__;for(const label of window.__overlayTexts.filter(label=>prefix?label.text.startsWith(text):label.text===text)){const x=label.x+label.w/2,y=label.y+label.h/2;if([...stage.hits].reverse().some(hit=>x>=hit.r.x&&x<=hit.r.x+hit.r.w&&y>=hit.r.y&&y<=hit.r.y+hit.r.h))return{x,y};}return null;},{text,prefix});assert.ok(point,'No clickable Canvas text: '+text);await page.mouse.click(point.x,point.y);await page.waitForTimeout(90);}
async function screenshot(name){await refresh();const text=await page.evaluate(()=>window.__overlayTexts.map(label=>label.text));assert.ok(!text.includes('参考图片'),'The fixed reference sidebar must be absent');assert.ok(!text.some(label=>/体力|广告领|看广告/.test(label)),'Web shows an unavailable energy/advertising action');const file=resolve(out,name+'.png');await page.screenshot({path:file});shots.push(file);}
async function openTasks(){await clickText('任务 ',{prefix:true});await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='tasks'&&!!window.__JIGSAW_SHARED__.app.tasks);await refresh();}
async function toggleReference(label){await clickText('更多');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='tools');if(page.viewportSize().height<600){const area=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modalArea);await page.mouse.move(area.x+area.w/2,area.y+area.h/2);await page.mouse.wheel(0,1000);await page.waitForTimeout(100);}await clickText(label);}
async function clickClose(){const point=await page.evaluate(()=>{const{stage}=window.__JIGSAW_SHARED__,title=window.__overlayTexts.find(label=>label.text==='任务与礼包');if(!title)return null;const hits=stage.hits.filter(hit=>hit.r.w<=55&&hit.r.h<=55&&hit.r.y<=title.y+25&&hit.r.y+hit.r.h>=title.y-5&&hit.r.x>title.x+100);const r=hits.at(-1)?.r;return r?{x:r.x+r.w/2,y:r.y+r.h/2}:null;});assert.ok(point,'Visible floating-panel close button must have a real hit target');await page.mouse.click(point.x,point.y);await page.waitForTimeout(90);}
const nearly=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} vs ${b}`);
async function outsideControls(expectedModal,expectedTools){
 const before=await state(),claimsBefore=claims(),point=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,board=app.board,r=board.rect;for(const fx of [.72,.82,.6,.5])for(const fy of [.4,.2,.6]){const p={id:88,x:Math.round(r.x+r.w*fx),y:Math.round(r.y+r.h*fy)};if(!stage.hasHit(p.x,p.y)&&!board.groupAt(p))return p;}return null;});assert.ok(point,'An unobstructed empty board region must remain available');
 await page.mouse.click(point.x,point.y);await page.waitForTimeout(50);let after=await sameRoom(before,'Outside click');assert.equal(after.modal,expectedModal);assert.equal(after.toolsOpen,expectedTools);
 await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-100);await page.waitForTimeout(90);const zoomed=await state();assert.ok(zoomed.camera.z>before.camera.z,'Wheel outside floating controls must zoom the board');assert.equal(zoomed.modal,expectedModal);assert.equal(zoomed.toolsOpen,expectedTools);assert.equal(zoomed.groups,before.groups);
 await page.mouse.down({button:'middle'});await page.mouse.move(point.x+32,point.y-18,{steps:5});await page.mouse.up({button:'middle'});await page.waitForTimeout(90);after=await state();nearly(after.camera.x,zoomed.camera.x+32,'Outside pan x');nearly(after.camera.y,zoomed.camera.y-18,'Outside pan y');assert.equal(after.modal,expectedModal);assert.equal(after.toolsOpen,expectedTools);assert.equal(after.id,before.id);assert.equal(after.groups,before.groups);assert.equal(claims(),claimsBefore,'Empty-board navigation must not acquire a puzzle piece');
 return{zoom:true,pan:true,emptyClickKeepsPanel:true};
}
async function dragVisiblePiece(expectedModal,expectedTools){
 const target=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,board=app.board,b=board.board,state=board.state,r=board.rect;for(const group of [...state.groups].reverse()){if(group.locked)continue;for(const id of group.pieces){const world={x:b.x+(id%state.cols+.5)*b.width/state.cols+group.dx,y:b.y+(Math.floor(id/state.cols)+.5)*b.height/state.rows+group.dy},start={id:55,...board.worldToScreen(world)},end={x:start.x+13,y:start.y+9};const visible=p=>p.x>r.x+4&&p.x<r.x+r.w-20&&p.y>r.y+4&&p.y<r.y+r.h-20&&!stage.hasHit(p.x,p.y);if(visible(start)&&visible(end)&&board.groupAt(start)?.id===group.id)return{groupId:group.id,start,end};}}return null;});assert.ok(target,'At least one loose piece outside the floating controls must be draggable');
 const before=await state(),claimReply=page.waitForResponse(response=>{try{return response.request().method()==='POST'&&response.request().postDataJSON()?.type==='claim';}catch{return false;}},{timeout:10000});
 await page.mouse.move(target.start.x,target.start.y);await page.mouse.down();const claimed=await claimReply;assert.equal(claimed.status(),200);await page.mouse.move(target.end.x,target.end.y,{steps:5});
 const dropReply=page.waitForResponse(response=>{try{return response.request().method()==='POST'&&response.request().postDataJSON()?.type==='drop';}catch{return false;}},{timeout:10000});await page.mouse.up();assert.equal((await dropReply).status(),200);await page.waitForTimeout(140);const after=await state();assert.equal(after.modal,expectedModal);assert.equal(after.toolsOpen,expectedTools);assert.equal(after.id,before.id);assert.deepEqual(after.camera,before.camera,'Dragging a piece must not move the camera');
 return{groupId:target.groupId,claimed:true,dropped:true};
}
async function checkAppearance(){
 await page.evaluate(()=>{
  const {stage}=window.__JIGSAW_SHARED__,ctx=stage.ctx,begin=stage.begin.bind(stage),icon=stage.icon.bind(stage),button=stage.button.bind(stage),fill=ctx.fillRect.bind(ctx),radial=ctx.createRadialGradient.bind(ctx),gradients=new WeakMap();
  window.__appearanceDraws=[];stage.begin=()=>{window.__appearanceDraws=[];begin();};
  const rect=r=>{const m=ctx.getTransform(),dpr=stage.platform.viewport().dpr||1,p=m.transformPoint({x:r.x,y:r.y});return{x:p.x/dpr,y:p.y/dpr,w:r.w*m.a/dpr,h:r.h*m.d/dpr};};
  stage.icon=(kind,r,...rest)=>{if(kind==='xpChest')window.__appearanceDraws.push({kind:'icon',name:kind,...rect(r)});return icon(kind,r,...rest);};
  stage.button=(r,label,...rest)=>{if(label==='继续拼图')window.__appearanceDraws.push({kind:'button',name:label,...rect(r)});return button(r,label,...rest);};
  ctx.createRadialGradient=(...args)=>{const gradient=radial(...args),stops=[],add=gradient.addColorStop.bind(gradient);gradient.addColorStop=(offset,color)=>{stops.push({offset,color});add(offset,color);};gradients.set(gradient,stops);return gradient;};
  ctx.fillRect=(x,y,w,h)=>{const r=rect({x,y,w,h});if(r.w>500&&r.h>500)window.__appearanceDraws.push({kind:'background',fill:typeof ctx.fillStyle==='string'?ctx.fillStyle:gradients.get(ctx.fillStyle),...r});return fill(x,y,w,h);};
 });
 for(const [width,height] of [[390,844],[660,820]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>{const {app}=window.__JIGSAW_SHARED__;app.setTheme('dark');app.navigate('tasks');});
  await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='tasks'&&!!window.__JIGSAW_SHARED__.app.tasks);await clickText('我的礼包');await refresh();
  const layout=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__,art=window.__appearanceDraws.find(d=>d.kind==='icon'),button=window.__appearanceDraws.find(d=>d.kind==='button'),copy=window.__overlayTexts.find(d=>d.text==='继续拼图，收下下一份小礼');return{theme:stage.theme,inventoryCount:app.tasks.inventory.reduce((sum,gift)=>sum+gift.count,0),art,button,copy};});
  assert.equal(layout.theme,'dark');assert.equal(layout.inventoryCount,0,'Use the actual empty gift inventory');assert.ok(layout.art&&layout.button&&layout.copy,'Empty gift illustration, copy, and continue button must all be drawn');
  const artCenter=layout.art.x+layout.art.w/2,buttonCenter=layout.button.x+layout.button.w/2;assert.ok(Math.abs(artCenter-buttonCenter)<=1,'The continue button must align with the empty illustration');assert.ok(layout.button.x>=0&&layout.button.x+layout.button.w<=width&&layout.button.y+layout.button.h<=height,'Continue button must remain visible');
  await screenshot(`gifts-centered-dark-${width}x${height}`);checks.push({type:'gift-alignment',viewport:{width,height},...layout,artCenter,buttonCenter});
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.__JIGSAW_SHARED__.app.navigate('gallery'));await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await clickText('48');await clickText('随机公开房 · 免费');
 await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>window.__JIGSAW_SHARED__.app.setTheme(theme),theme);await refresh();
  const background=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__,r=app.roomArea,draw=window.__appearanceDraws.find(d=>d.kind==='background'&&Math.abs(d.x-r.x)<1&&Math.abs(d.y-r.y)<1&&Math.abs(d.w-r.w)<1&&Math.abs(d.h-r.h)<1),samples=[];for(const fx of [.08,.25,.75,.92])for(const fy of [.15,.4,.7]){const p={id:99,x:Math.round(r.x+r.w*fx),y:Math.round(r.y+r.h*fy)};if(stage.hasHit(p.x,p.y)||app.board.groupAt(p))continue;const rgba=[...stage.ctx.getImageData(p.x,p.y,1,1).data];samples.push({x:p.x,y:p.y,hex:'#'+rgba.slice(0,3).map(c=>c.toString(16).padStart(2,'0')).join('')});}return{theme:stage.theme,boardTheme:app.board.theme,draw,samples};});
  assert.equal(background.theme,theme);assert.equal(background.boardTheme,theme);assert.ok(background.draw,'Record the actual full puzzle background fill');assert.ok(background.samples.length,'Read actual empty-board pixels');
  const expected=process.env[theme==='light'?'EXPECTED_LIGHT_BOARD':'EXPECTED_DARK_BOARD'];if(expected){const colors=Array.isArray(background.draw.fill)?background.draw.fill.map(stop=>stop.color):[background.draw.fill];assert.ok(colors.includes(expected),`The ${theme} background must use ${expected}`);}
  await screenshot(`room-background-${theme}-1440x900`);checks.push({type:'board-background',...background});
 }
}
async function checkChat(){
 await page.evaluate(()=>{
  const {stage}=window.__JIGSAW_SHARED__,ctx=stage.ctx,begin=stage.begin.bind(stage),icon=stage.icon.bind(stage),meter=stage.meter.bind(stage),button=stage.button.bind(stage);
  window.__chatDraws=[];stage.begin=()=>{window.__chatDraws=[];begin();};
  const rect=r=>{const m=ctx.getTransform(),dpr=stage.platform.viewport().dpr||1,p=m.transformPoint({x:r.x,y:r.y});return{x:p.x/dpr,y:p.y/dpr,w:r.w*m.a/dpr,h:r.h*m.d/dpr};};
  stage.icon=(name,r,...rest)=>{window.__chatDraws.push({kind:'icon',name,...rect(r)});return icon(name,r,...rest);};
  stage.meter=(r,...rest)=>{window.__chatDraws.push({kind:'meter',...rect(r)});return meter(r,...rest);};
  stage.button=(r,label,fn,opts)=>{if(opts?.icon==='close')window.__chatDraws.push({kind:'close',...rect(r)});return button(r,label,fn,opts);};
 });
 await clickText('挑选图片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await clickText('48');await clickText('随机公开房 · 免费');
 await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 for(const [width,height] of [[1440,900],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await refresh();
  const header=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__,total=app.room.state.cols*app.room.state.rows,count=window.__overlayTexts.find(t=>t.text==='0/'+total&&t.y<app.roomArea.y),piece=window.__chatDraws.filter(d=>d.kind==='icon'&&d.name==='piece'&&d.y<app.roomArea.y).sort((a,b)=>Math.abs(a.x-(count?.x??0))-Math.abs(b.x-(count?.x??0)))[0],bar=window.__chatDraws.find(d=>d.kind==='meter'&&d.w>100&&d.y<app.roomArea.y),entry=app.chatEntryArea;return{count,piece,bar,entry,roomArea:app.roomArea,entryHasHit:!!entry&&stage.hasHit(entry.x+entry.w/2,entry.y+entry.h/2)};});
  assert.ok(header.count&&header.piece&&header.bar,'The progress number, adjacent piece icon, and separate long bar must be drawn');
  const gap=header.count.x-header.piece.x-header.piece.w;assert.ok(gap>=0&&gap<=10,'The piece icon must sit immediately left of the count');assert.ok(Math.abs(header.piece.y+header.piece.h/2-header.count.y-header.count.h/2)<=8,'Piece icon and count must be on the same row');assert.ok(header.bar.y>=Math.max(header.count.y+header.count.h,header.piece.y+header.piece.h),'The progress bar must be below the icon/count');assert.ok(Math.abs(header.count.x+header.count.w/2-header.bar.x-header.bar.w/2)<=20,'The count must be centered over the long bar');
  assert.ok(header.entry&&header.entryHasHit,'A real clickable people entry must exist');assert.ok(Math.abs(width-header.entry.x-header.entry.w-16)<=2&&Math.abs(header.entry.y-header.roomArea.y-16)<=2,'People entry must float sixteen pixels from the board top/right');assert.ok(header.entry.w<=95&&header.entry.h<=48);
  await screenshot(`chat-entry-${width}x${height}`);const before=await state(),claimsBefore=claims(),pixelBefore=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__;return [...stage.ctx.getImageData(20,app.roomArea.y+32,1,1).data];});
  await page.mouse.click(header.entry.x+header.entry.w/2,header.entry.y+header.entry.h/2);await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='chat');await sameRoom(before,'Opening chat');
  // UI-only messages make the real list scrollable; no message is sent to any room.
  await page.evaluate(()=>{const {app}=window.__JIGSAW_SHARED__;app.messages=Array.from({length:24},(_,i)=>({id:10000+i,name:'验收同桌 '+(i+1),text:'只在本地界面显示的滚动验收消息 '+(i+1),playerId:'local-ui-test-'+i,code:'',level:1,sentAt:Date.now()}));app.modalScroll=0;app.invalidate();});await refresh();
  const panel=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__;return{window:app.chatWindowArea,list:app.modalArea,pixel:[...stage.ctx.getImageData(20,app.roomArea.y+32,1,1).data]};});assert.ok(panel.window&&panel.list,'Chat window and list areas must be observable');assert.deepEqual(panel.pixel,pixelBefore,'Opening chat must not dim the board outside the window');
  const r=panel.list;await page.mouse.move(r.x+r.w*.4,r.y+r.h*.5);await page.mouse.wheel(0,180);await page.waitForTimeout(100);const wheel=await sameRoom(before,'Wheel inside chat');assert.ok(wheel.modalScroll>0,'The message list must consume wheel input');
  await page.mouse.move(r.x+r.w*.4,r.y+r.h*.76);await page.mouse.down();await page.mouse.move(r.x+r.w*.4,r.y+r.h*.25,{steps:8});await page.mouse.up();await page.waitForTimeout(90);const dragged=await sameRoom(before,'Drag inside chat');assert.ok(dragged.modalScroll>wheel.modalScroll,'Dragging inside chat must scroll messages');assert.equal(claims(),claimsBefore,'Chat interactions must not acquire underlying pieces');
  await screenshot(`chat-scrolled-${width}x${height}`);const navigation=await outsideControls('chat',false),pieceDrag=await dragVisiblePiece('chat',false);await screenshot(`chat-board-interactive-${width}x${height}`);const afterPlay=await state();
  const close=await page.evaluate(()=>window.__chatDraws.find(d=>d.kind==='close'));assert.ok(close,'Chat close button must have a visible real control');await page.mouse.click(close.x+close.w/2,close.y+close.h/2);await page.waitForTimeout(90);assert.equal((await state()).modal,null);await sameRoom(afterPlay,'Closing chat');
  await page.mouse.click(header.entry.x+header.entry.w/2,header.entry.y+header.entry.h/2);await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='chat');await page.keyboard.press('Escape');await page.waitForTimeout(90);assert.equal((await state()).modal,null);await sameRoom(afterPlay,'Escape from chat');
  checks.push({viewport:{width,height},roomId,header,chatWindow:panel.window,chatList:panel.list,insidePanelClaims:0,wheelScroll:wheel.modalScroll,dragScroll:dragged.modalScroll,navigation,pieceDrag});
 }
 assert.ok(!requests.some(request=>/\/chat(?:\?|$)/.test(request.url)),'UI-only chat fixtures must never be sent as messages');
}

async function checkTableStyles(){
 assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.theme),'light','A fresh local guest must begin in the original light appearance');
 await page.evaluate(()=>{
  const{stage}=window.__JIGSAW_SHARED__,ctx=stage.ctx,begin=stage.begin.bind(stage),icon=stage.icon.bind(stage),start=ctx.beginPath.bind(ctx),move=ctx.moveTo.bind(ctx),line=ctx.lineTo.bind(ctx),curve=ctx.quadraticCurveTo.bind(ctx),fill=ctx.fill.bind(ctx),stroke=ctx.stroke.bind(ctx),rectangle=ctx.fillRect.bind(ctx),radial=ctx.createRadialGradient.bind(ctx),pattern=ctx.createPattern.bind(ctx),gradients=new WeakMap();let path=[];
  window.__tableDraws=[];window.__tablePatterns=[];stage.begin=()=>{window.__tableDraws=[];begin();};
  const transform=()=>{const m=ctx.getTransform(),d=stage.platform.viewport().dpr||1;return{a:m.a/d,d:m.d/d,e:m.e/d,f:m.f/d};};
  stage.icon=(name,r,...rest)=>{if(name==='avatar')window.__tableDraws.push({kind:'avatar',...r});return icon(name,r,...rest);};
  ctx.beginPath=()=>{path=[];return start();};ctx.moveTo=(x,y)=>{path.push(['M',x,y]);return move(x,y);};ctx.lineTo=(x,y)=>{path.push(['L',x,y]);return line(x,y);};ctx.quadraticCurveTo=(...args)=>{path.push(['Q',...args]);return curve(...args);};
  ctx.fill=(...args)=>{if(path.filter(p=>p[0]==='Q').length===4)window.__tableDraws.push({kind:'rounded-fill',path:path.map(p=>[...p]),color:ctx.fillStyle,transform:transform()});return fill(...args);};
  ctx.stroke=(...args)=>{const dash=ctx.getLineDash();if(dash.length)window.__tableDraws.push({kind:'grid',path:path.map(p=>[...p]),dash,color:ctx.strokeStyle,lineWidth:ctx.lineWidth,transform:transform()});return stroke(...args);};
  ctx.createRadialGradient=(...args)=>{const g=radial(...args),stops=[],add=g.addColorStop.bind(g);g.addColorStop=(offset,color)=>{stops.push({offset,color});return add(offset,color);};gradients.set(g,stops);return g;};
  ctx.fillRect=(x,y,w,h)=>{if(w>500&&h>200)window.__tableDraws.push({kind:'background',x,y,w,h,fill:typeof ctx.fillStyle==='string'?ctx.fillStyle:gradients.get(ctx.fillStyle),pattern:ctx.fillStyle instanceof CanvasPattern});return rectangle(x,y,w,h);};
  ctx.createPattern=(canvas,repeat)=>{window.__tablePatterns.push({width:canvas.width,height:canvas.height,repeat});return pattern(canvas,repeat);};
 });
 await clickText('挑选图片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await clickText('48');await clickText('随机公开房 · 免费');
 await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 const stable=()=>page.evaluate(()=>{const{app}=window.__JIGSAW_SHARED__,b=app.board;return{id:app.room.ticket.room.id,groups:JSON.stringify(b.state.groups),imageId:b.state.imageId,imageSerial:b.imageSerial,pictureSize:[b.picture.width,b.picture.height],imageSample:[...b.picture.getContext('2d').getImageData(Math.floor(b.picture.width/2),Math.floor(b.picture.height/2),1,1).data],board:{...b.board}};});
 const initial=await stable();
 async function openSettings(){await refresh();const r=await page.evaluate(()=>window.__tableDraws.find(d=>d.kind==='avatar'));assert.ok(r,'The player avatar must be a visible settings entry');await page.mouse.click(r.x+r.w/2,r.y+r.h/2);await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.modal==='settings');await refresh();}
 async function selectTheme(id,label){await openSettings();await clickText(label);assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.theme),id);assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.theme),id);assert.deepEqual(await stable(),initial,'Appearance changes must preserve the room, image and loose-piece positions');await screenshot(`table-settings-${id}-${page.viewportSize().width}x${page.viewportSize().height}`);await page.keyboard.press('Escape');await refresh();}
 async function inspectTheme(id,width,height){
  await refresh();const draw=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,b=app.board;return{theme:stage.theme,rect:b.rect,board:b.board,camera:b.camera,frame:window.__tableDraws.find(d=>d.kind==='rounded-fill'&&d.path[0]?.[1]===b.board.x-1&&d.path[0]?.[2]===b.board.y-9),grid:window.__tableDraws.find(d=>d.kind==='grid'),background:window.__tableDraws.find(d=>d.kind==='background'&&Array.isArray(d.fill)),patternFill:window.__tableDraws.find(d=>d.kind==='background'&&d.pattern),patterns:window.__tablePatterns,entry:app.chatEntryArea};});
  assert.equal(draw.theme,id);assert.equal(draw.rect.w,width);assert.ok(draw.rect.y>=0&&draw.rect.y+draw.rect.h<=height);assert.ok(draw.entry.x>=0&&draw.entry.y>=0&&draw.entry.x+draw.entry.w<=width&&draw.entry.y+draw.entry.h<=height);
  assert.ok(draw.background&&draw.frame&&draw.grid&&draw.patternFill,'Actual Canvas drawing must include tabletop gradient, dots, enlarged frame and dashed grid');
  const expected=id==='wood'?['#e0d5bf','#e0d5bf']:id==='light'?['#fdf6ed','#fff9f0']:['#212327','#212327'];assert.deepEqual(draw.background.fill.map(s=>s.color),expected);assert.ok(draw.patterns.some(p=>p.width===20&&p.height===20&&p.repeat==='repeat'),'Table dots must use a fixed 20px tile');
  const b=draw.board,p=draw.frame.path;assert.deepEqual(p[0],['M',b.x-1,b.y-9]);assert.deepEqual(p[1],['L',b.x+b.width+1,b.y-9]);assert.deepEqual(p[2],['Q',b.x+b.width+9,b.y-9,b.x+b.width+9,b.y-1]);assert.deepEqual(p[4],['Q',b.x+b.width+9,b.y+b.height+9,b.x+b.width+1,b.y+b.height+9]);
  const gridPath=draw.grid.path;assert.ok(gridPath.some(p=>p[0]==='M'&&p[2]===b.y)&&gridPath.some(p=>p[0]==='L'&&p[2]===b.y+b.height),'The grid must remain at the exact original image bounds');assert.deepEqual(await stable(),initial);
  await screenshot(`table-${id}-${width}x${height}`);checks.push({type:'table-style',viewport:{width,height},...draw});
 }
 for(const[width,height]of[[1440,900],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await refresh();
  if(await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.theme)!=='light')await selectTheme('light','浅色');await inspectTheme('light',width,height);
  await selectTheme('wood','仿木');await inspectTheme('wood',width,height);
  await selectTheme('dark','深色');await inspectTheme('dark',width,height);
  await selectTheme('light','浅色');
 }
 await selectTheme('wood','仿木');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__JIGSAW_SHARED__?.app.ready&&!window.__JIGSAW_SHARED__.app.busy);assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.stage.theme),'wood','The selected wood appearance must survive a real reload');checks.push({type:'table-style-persistence',theme:'wood',reload:true});
 assert.ok(!requests.some(r=>['claim','drop'].includes(r.type)),'Changing appearance must not claim or move pieces');
}

async function checkSpacing(){
 await clickText('挑选图片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await refresh();
 const count=await page.evaluate(()=>window.__overlayTexts.some(t=>t.text==='48')?'48':'108');await clickText(count);await clickText('随机公开房 · 免费');
 await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 const initial=await page.evaluate(async()=>{
  const {app}=window.__JIGSAW_SHARED__,b=app.board,p=b.state,w=b.board.width/p.cols,h=b.board.height/p.rows,pad=Math.min(w,h)*.23;
  const boxes=p.groups.map(g=>{const id=g.pieces[0],x=b.board.x+(id%p.cols)*w+g.dx,y=b.board.y+Math.floor(id/p.cols)*h+g.dy;return{id:g.id,left:x-pad,top:y-pad,right:x+w+pad,bottom:y+h+pad};});let minimumGap=Infinity,overlaps=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],z=boxes[j],dx=Math.max(a.left-z.right,z.left-a.right),dy=Math.max(a.top-z.bottom,z.top-a.bottom);if(dx<=0&&dy<=0)overlaps.push([a.id,z.id]);minimumGap=Math.min(minimumGap,Math.hypot(Math.max(0,dx),Math.max(0,dy)));}
  const server=await app.client.json('/api/rooms/'+app.room.ticket.room.id,'GET',undefined,{Authorization:'Bearer '+app.room.ticket.token});
  return{count:p.cols*p.rows,cols:p.cols,rows:p.rows,board:b.board,camera:b.camera,minimumGap,overlaps,boxes,clientGroups:p.groups,serverGroups:server.puzzle.groups,seed:p.seed,serverSeed:server.puzzle.seed};
 });
 assert.ok(initial.count>=12,'The selected target count must create a real aspect-fitted puzzle');assert.deepEqual(initial.overlaps,[],'Full convex-tab bounds must have no initial overlap');assert.ok(initial.minimumGap>0,'All initial full-tab envelopes must have a positive gap');assert.deepEqual(initial.clientGroups,initial.serverGroups,'Compact client seed expansion must match the actual server snapshot');assert.equal(initial.seed,initial.serverSeed);
 await screenshot('spacing-initial-1440x900');checks.push({type:'initial-spacing',viewport:{width:1440,height:900},roomId,...initial});
 if(spacingInitialOnly)return;
 const target=await page.evaluate(()=>{const {app,stage}=window.__JIGSAW_SHARED__,b=app.board,p=b.state,w=b.board.width/p.cols,h=b.board.height/p.rows,r=b.rect;const endWorld={x:-45+w/2,y:140+h/2},end=b.worldToScreen(endWorld);for(const g of p.groups){if(g.locked||g.pieces.length!==1)continue;const id=g.pieces[0],startWorld={x:b.board.x+(id%p.cols+.5)*w+g.dx,y:b.board.y+(Math.floor(id/p.cols)+.5)*h+g.dy},start=b.worldToScreen(startWorld);if(start.x>r.x+4&&start.x<r.x+r.w-4&&start.y>r.y+4&&start.y<r.y+r.h-4&&!stage.hasHit(start.x,start.y)&&!stage.hasHit(end.x,end.y)&&b.groupAt({id:55,...start})?.id===g.id)return{groupId:g.id,pieceId:id,start,end,desiredDx:g.dx+endWorld.x-startWorld.x,desiredDy:g.dy+endWorld.y-startWorld.y,endWorld};}return null;});assert.ok(target,'A real loose piece must be available for an expanded-table drag');
 const before=await state(),claimReply=page.waitForResponse(r=>{try{return r.request().method()==='POST'&&r.request().postDataJSON()?.type==='claim';}catch{return false;}},{timeout:10000});
 await page.mouse.move(target.start.x,target.start.y);await page.mouse.down();assert.equal((await claimReply).status(),200);await page.mouse.move(target.end.x,target.end.y,{steps:12});
 const dropReply=page.waitForResponse(r=>{try{return r.request().method()==='POST'&&r.request().postDataJSON()?.type==='drop';}catch{return false;}},{timeout:10000});await page.mouse.up();assert.equal((await dropReply).status(),200);await page.waitForTimeout(140);
 const accepted=await page.evaluate(async id=>{const{app}=window.__JIGSAW_SHARED__,b=app.board,server=await app.client.json('/api/rooms/'+app.room.ticket.room.id,'GET',undefined,{Authorization:'Bearer '+app.room.ticket.token}),group=server.puzzle.groups.find(g=>g.id===id),local=b.state.groups.find(g=>g.id===id),piece=group.pieces[0],w=b.board.width/b.state.cols,h=b.board.height/b.state.rows;return{group,local,body:{x:b.board.x+(piece%b.state.cols)*w+group.dx,y:b.board.y+Math.floor(piece/b.state.cols)*h+group.dy,w,h},camera:b.camera};},target.groupId);
 assert.equal(accepted.group.locked,false);assert.equal(accepted.group.pieces.length,1);assert.ok(Math.abs(accepted.group.dx-target.desiredDx)<.001,'Server accepted expanded x');assert.ok(Math.abs(accepted.group.dy-target.desiredDy)<.001,'Server accepted expanded y');assert.ok(accepted.body.x<0&&accepted.body.x>=-82,'Piece body must remain beyond the old table but within the new server margin');assert.deepEqual(accepted.local,accepted.group);assert.deepEqual(accepted.camera,before.camera,'A real piece drag must not pan the camera');await screenshot('spacing-expanded-drag-1440x900');checks.push({type:'expanded-table-drag',roomId,target,accepted,claimed:true,dropped:true});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.fit());await refresh();await screenshot('spacing-fit-844x390');checks.push({type:'landscape-fit',viewport:{width:844,height:390},roomId,camera:(await state()).camera});
}

async function checkIcons(){
 await page.evaluate(()=>{
  const{stage}=window.__JIGSAW_SHARED__,c=stage.ctx,begin=stage.begin.bind(stage),icon=stage.icon.bind(stage);let active=null;
  const matrix=()=>{const m=c.getTransform();return{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f};};
  window.__iconDraws=[];stage.begin=()=>{window.__iconDraws=[];begin();};
  stage.icon=(name,r,...args)=>{const m=c.getTransform(),p=m.transformPoint({x:r.x,y:r.y}),previous=active;active={name,box:{x:p.x,y:p.y,w:r.w*Math.hypot(m.a,m.b),h:r.h*Math.hypot(m.c,m.d)},draws:[],hitsBefore:stage.hits.length};window.__iconDraws.push(active);try{return icon(name,r,...args);}finally{active.hitsAfter=stage.hits.length;active=previous;}};
  for(const method of['fill','stroke','fillRect','strokeRect']){const original=c[method].bind(c);c[method]=(...args)=>{if(active)active.draws.push({kind:'vector',method,matrix:matrix()});return original(...args);};}
  const drawImage=c.drawImage.bind(c);c.drawImage=(...args)=>{if(active){const image=args[0],source=args.length===9?{w:args[3],h:args[4]}:{w:image.naturalWidth||image.width,h:image.naturalHeight||image.height},dest=args.length===9?{x:args[5],y:args[6],w:args[7],h:args[8]}:args.length===5?{x:args[1],y:args[2],w:args[3],h:args[4]}:{x:args[1],y:args[2],...source};active.draws.push({kind:'bitmap',source,dest,matrix:matrix()});}return drawImage(...args);};
 });
 const validate=icons=>{assert.ok(icons.length,'The target icons must be drawn');for(const icon of icons){assert.equal(icon.hitsBefore,icon.hitsAfter,'Drawing an icon must not create or shrink hit targets');assert.ok(icon.draws.length,icon.name+' must have actual Canvas drawing');for(const draw of icon.draws){const m=draw.matrix,sx=Math.hypot(m.a,m.b),sy=Math.hypot(m.c,m.d);if(draw.kind==='vector')nearly(sx,sy,icon.name+' must use equal x/y vector scale');else nearly(draw.dest.w*sx/draw.source.w,draw.dest.h*sy/draw.source.h,icon.name+' must preserve its bitmap source ratio');}}};
 await clickText('挑选图片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await clickText('48');await clickText('随机公开房 · 免费');await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 for(const width of[390,475]){
 await page.setViewportSize({width,height:844});await page.waitForTimeout(150);await refresh();
 const header=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__;return{roomArea:app.roomArea,icons:window.__iconDraws.filter(icon=>icon.box.y<app.roomArea.y),entry:app.chatEntryArea,entryHasHit:stage.hasHit(app.chatEntryArea.x+app.chatEntryArea.w/2,app.chatEntryArea.y+app.chatEntryArea.h/2)};});
 validate(header.icons);assert.ok(header.icons.filter(icon=>icon.name==='piece').length>=(width===390?1:2),'All icons enabled by the existing responsive portrait header must be drawn');assert.ok(header.entryHasHit,'The people icon must retain the existing chat hit target');await screenshot(`icons-room-${width}x844`);checks.push({type:'portrait-header-icons',viewport:{width,height:844},...header});
 }
 await clickText('任务 ',{prefix:true});await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return(app.route==='tasks'||app.modal==='tasks')&&!!app.tasks&&!app.busy;});
 for(const[width,height]of[[390,844],[1440,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);if(width===1440)await page.evaluate(()=>{const{app}=window.__JIGSAW_SHARED__;app.navigate('room');app.modal='tasks';app.invalidate();});
  await page.waitForFunction(()=>!!window.__JIGSAW_SHARED__.app.tasks);await page.evaluate(()=>{const{app}=window.__JIGSAW_SHARED__;app.tasks.giftProgress=9;app.taskTab='tasks';app.modalScroll=0;app.scroll=0;app.invalidate();});await refresh();
  const tasks=await page.evaluate(()=>{const{app,stage}=window.__JIGSAW_SHARED__,title=window.__overlayTexts.find(text=>text.text==='十格小礼'),count=window.__overlayTexts.find(text=>text.text==='9/10'),icons=window.__iconDraws.filter(icon=>icon.name==='piece'&&title&&icon.box.y>=title.y-12&&icon.box.y<=title.y+30),hit=title&&stage.hits.find(hit=>hit.r.w>250&&hit.r.h===85&&title.x>=hit.r.x&&title.y>=hit.r.y&&title.y<hit.r.y+hit.r.h);return{title,count,icons,hit:hit?.r,modal:app.modal,taskWindow:app.taskWindowArea};});
  assert.ok(tasks.title&&tasks.count&&tasks.hit,'Ten-gift label, progress and original full-card hit target must remain present');assert.equal(tasks.icons.length,10,'Ten full-size progress icons must fit');validate(tasks.icons);for(let i=0;i<tasks.icons.length;i++){const r=tasks.icons[i].box;assert.ok(r.x>=tasks.title.x+tasks.title.w&&r.x+r.w<=tasks.count.x,'Progress icons must fit between label and count');if(i)assert.ok(r.x>=tasks.icons[i-1].box.x+tasks.icons[i-1].box.w,'Neighboring icon boxes must not overlap');}
  if(width===1440)assert.equal(tasks.modal,'tasks','Desktop task screen must remain a floating window');await screenshot(`icons-ten-gift-${width}x${height}`);checks.push({type:'ten-gift-icons',viewport:{width,height},...tasks});
 }
 assert.ok(!requests.some(request=>/\/(tasks|gifts)\//.test(request.url)),'UI-only gift progress must never send rewards or task mutations');
}

try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__JIGSAW_SHARED__?.app.ready&&!window.__JIGSAW_SHARED__.app.busy);
 await page.evaluate(()=>{const{stage}=window.__JIGSAW_SHARED__,ctx=stage.ctx,begin=stage.begin.bind(stage),fill=ctx.fillText.bind(ctx);window.__overlayTexts=[];stage.begin=()=>{window.__overlayTexts=[];begin();};ctx.fillText=(text,x,y,...rest)=>{const m=ctx.getTransform(),dpr=stage.platform.viewport().dpr||1,p=m.transformPoint({x,y}),label={text:String(text),x:p.x/dpr,y:p.y/dpr,w:ctx.measureText(String(text)).width*m.a/dpr,h:(Number(ctx.font.match(/([\d.]+)px/)?.[1])||14)*m.d/dpr},px=label.x+Math.min(12,label.w)/2,py=label.y+label.h/2;if(px>=0&&py>=0&&px<=innerWidth&&py<=innerHeight&&stage.clips.every(r=>px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h))window.__overlayTexts.push(label);return fill(text,x,y,...rest);};stage.invalidate();});
 if(iconsOnly)await checkIcons();else if(spacingOnly)await checkSpacing();else if(tableStyleOnly)await checkTableStyles();else if(chatOnly)await checkChat();else if(appearanceOnly)await checkAppearance();else{
 await clickText('挑选图片');await page.waitForFunction(()=>window.__JIGSAW_SHARED__.app.route==='gallery');await clickText('48');await clickText('随机公开房 · 免费');await page.waitForFunction(()=>{const app=window.__JIGSAW_SHARED__.app;return app.route==='room'&&app.imageReady&&app.board.networkReady&&!app.busy;},null,{timeout:25000});roomId=(await state()).id;
 for(const [width,height]of [[1440,900],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await refresh();
  const rect=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.roomArea);assert.equal(rect.x,0);assert.equal(rect.w,width,'The puzzle must use the entire horizontal surface');assert.ok(rect.h>height*.65);
  assert.equal((await state()).toolsOpen,false,'Room tools should begin collapsed');await screenshot(`room-collapsed-${width}x${height}`);
  const toggle=await page.evaluate(()=>{const{stage}=window.__JIGSAW_SHARED__,hit=[...stage.hits].reverse().find(hit=>hit.r.x>=innerWidth-90&&hit.r.y>=innerHeight-90&&hit.r.w>=40&&hit.r.w<=65&&hit.r.h>=40&&hit.r.h<=65);return hit?{x:hit.r.x+hit.r.w/2,y:hit.r.y+hit.r.h/2}:null;});assert.ok(toggle,'Collapsed tools need a bottom-right mouse target');
  await page.mouse.click(toggle.x,toggle.y);await page.waitForTimeout(90);assert.equal((await state()).toolsOpen,true);const toolsNavigation=await outsideControls(null,true),toolsPiece=await dragVisiblePiece(null,true);await screenshot(`room-tools-${width}x${height}`);
  await toggleReference('查看原图');assert.equal(await page.evaluate(()=>window.__JIGSAW_SHARED__.app.board.showPreview),true);
  await page.keyboard.press('Escape');await page.waitForTimeout(90);assert.equal((await state()).toolsOpen,false);await screenshot(`room-reference-${width}x${height}`);
  // Return the optional preview to its prior state using the same visible controls.
  await page.mouse.click(toggle.x,toggle.y);await toggleReference('关闭原图');await page.keyboard.press('Escape');await page.waitForTimeout(90);
  const before=await state(),claimsBefore=claims();await openTasks();await sameRoom(before,'Opening tasks');
  const area=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.modalArea),windowRect=await page.evaluate(()=>window.__JIGSAW_SHARED__.app.taskWindowArea);
  assert.ok(windowRect,'Tasks must have a narrow lower-left panel');assert.ok(windowRect.w<=400&&windowRect.x<=16);assert.ok(Math.abs(height-windowRect.y-windowRect.h-12)<=2,'Task panel must align twelve pixels above the bottom edge');
  await page.mouse.move(area.x+area.w/2,area.y+area.h*.76);await page.mouse.down();await page.mouse.move(area.x+area.w/2,area.y+area.h*.32,{steps:8});await page.mouse.up();await page.waitForTimeout(90);const dragged=await sameRoom(before,'Dragging the task list');assert.ok(dragged.modalScroll>0,'The shared pointer drag path must scroll the floating task list');
  await page.mouse.move(area.x+area.w*.6,area.y+area.h*.55);await page.mouse.wheel(0,380);await page.waitForTimeout(120);const scrolled=await sameRoom(before,'Scrolling tasks');assert.ok(scrolled.modalScroll>0||scrolled.scroll>before.scroll,'The task overlay must consume actual wheel input');if(width===844)await screenshot(`tasks-scrolled-${width}x${height}`);
  await page.mouse.wheel(0,-10000);await page.waitForTimeout(120);await clickText('我的礼包');assert.equal((await state()).taskTab,'gifts');assert.equal((await state()).modal,'tasks');await screenshot(`gifts-floating-${width}x${height}`);await clickText('每日任务');assert.equal((await state()).taskTab,'tasks');await screenshot(`tasks-floating-${width}x${height}`);
  assert.equal(claims(),claimsBefore,'Interactions inside the task window must not acquire underlying pieces');const taskNavigation=await outsideControls('tasks',false),taskPiece=await dragVisiblePiece('tasks',false);await screenshot(`tasks-board-interactive-${width}x${height}`);
  await page.mouse.click(toggle.x,toggle.y);await page.waitForTimeout(90);assert.equal((await state()).toolsOpen,true);const bothNavigation=await outsideControls('tasks',true);await screenshot(`tasks-and-tools-${width}x${height}`);await page.mouse.click(toggle.x,toggle.y);await page.waitForTimeout(90);assert.equal((await state()).toolsOpen,false);
  const afterPlay=await state();await clickClose();assert.equal((await state()).modal,null);await sameRoom(afterPlay,'Close button');
  await openTasks();await page.keyboard.press('Escape');await page.waitForTimeout(90);assert.equal((await state()).modal,null);await sameRoom(afterPlay,'Escape');
  checks.push({viewport:{width,height},roomArea:rect,taskWindow:windowRect,taskModalArea:area,roomId,toolsNavigation,toolsPiece,taskNavigation,taskPiece,bothNavigation,insidePanelClaims:0});
 }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({passed:checks.length,checks,shots},null,2));
}catch(error){await page.screenshot({path:resolve(out,reportPrefix+'failure.png')}).catch(()=>{});writeFileSync(resolve(out,reportPrefix+'failure.json'),JSON.stringify({error:String(error),state:await state().catch(()=>null),texts:await page.evaluate(()=>window.__overlayTexts).catch(()=>[])},null,2));throw error;
}finally{writeFileSync(resolve(out,reportPrefix+'report.json'),JSON.stringify({base,browserChannel,roomId,checks,errors,external,shots,requests},null,2));await browser.close();}
