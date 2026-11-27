import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

const bundle=await build({
 stdin:{contents:'export {Stage} from "./mobile/ui"; export {GameApp} from "./mobile/app"; export {PuzzleBoard} from "./mobile/puzzle-board"; export {createWebPlatform} from "./mobile/platform-web";',resolveDir:process.cwd(),loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'node',target:'es2020',
});
const {Stage,GameApp,PuzzleBoard,createWebPlatform}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=mobile-fps-opt-test-bundle.mjs').toString('base64'));

function mockCtx(){
 const calls=[],stack=[];
 const state={
  globalAlpha:1,globalCompositeOperation:'source-over',shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',filter:'none',
  imageSmoothingEnabled:true,imageSmoothingQuality:'low',textBaseline:'alphabetic',textAlign:'start',
 };
 const ctx=new Proxy({
  ...state,
  save(){stack.push({...Object.fromEntries(Object.keys(state).map(k=>[k,ctx[k]]))});},
  restore(){const prev=stack.pop();if(prev)Object.assign(ctx,prev);},
  getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),
  getLineDash:()=>[],
  isPointInPath:()=>true,
  measureText:t=>({width:String(t).length*8,actualBoundingBoxAscent:10,actualBoundingBoxDescent:2}),
  createLinearGradient:()=>({addColorStop(){}}),
  createRadialGradient:(...args)=>{calls.push(['radial',args]);return{addColorStop(){}};},
  drawImage:(...args)=>calls.push(['drawImage',args]),
  fillRect:(...args)=>calls.push(['fillRect',args]),
  clearRect:(...args)=>calls.push(['clearRect',args]),
 },{get:(target,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)});
 return {ctx,calls};
}

function mockCanvas(ctx){
 const canvas={width:1,height:1,style:{},getContextCalls:[],getContext(kind,opts){canvas.getContextCalls.push([kind,opts]);return ctx;}};
 ctx.canvas=canvas;
 return canvas;
}

test('Stage caps TapTap mobile backing DPR at 2, uses opaque context, and caches background gradient',()=>{
 const make=(id,tapPc,dpr)=>{
  const main=mockCtx(),canvas=mockCanvas(main.ctx),offscreens=[];
  const platform={
   config:{id},canvas,
   viewport:()=>({width:400,height:800,dpr,top:0,bottom:0}),
   tapPcHost:()=>tapPc,
   createCanvas:()=>{const m=mockCtx(),c=mockCanvas(m.ctx);offscreens.push({c,calls:m.calls});return c;},
   createImage:()=>({}),
  };
  const stage=new Stage(platform,p=>p);
  return {stage,canvas,main,offscreens};
 };

 // TapTap phone at 3.5x DPR caps backing buffer to 2x (800x1600 instead of 1400x2800).
 const phone=make('taptap',false,3.5);
 assert.equal(phone.canvas.width,800);
 assert.equal(phone.canvas.height,1600);
 assert.deepEqual(phone.canvas.getContextCalls[0],['2d',{alpha:false}]);

 // TapTap PC and Web keep native DPR.
 const pc=make('taptap',true,3);
 assert.equal(pc.canvas.width,1200);
 assert.equal(pc.canvas.height,2400);
 const web=make('web',false,3);
 assert.equal(web.canvas.width,1200);
 assert.equal(web.canvas.height,2400);

 // Stage.begin skips redundant clearRect; Stage.background caches the radial gradient offscreen.
 phone.main.calls.length=0;
 phone.stage.begin();
 assert.equal(phone.main.calls.filter(c=>c[0]==='clearRect').length,0,'begin() skips redundant clearRect');
 phone.stage.background();
 phone.stage.background();
 phone.stage.background();
 assert.equal(phone.offscreens.length,1,'background allocates one reusable offscreen cache');
 assert.equal(phone.offscreens[0].calls.filter(c=>c[0]==='radial').length,1,'radial gradient is rasterized once');
 assert.equal(phone.main.calls.filter(c=>c[0]==='drawImage').length,3,'subsequent frames blit cached background');
 phone.stage.destroy();
 assert.equal(phone.offscreens[0].c.width,1,'destroy releases background cache');
});

test('GameApp.draw queries platform.viewport() once per frame and avoids redundant canvas.style.cursor writes',()=>{
 let viewportCalls=0,cursorWrites=0,cursorValue='';
 const style={get cursor(){return cursorValue;},set cursor(v){cursorWrites++;cursorValue=v;}};
 const main=mockCtx(),canvas=mockCanvas(main.ctx);canvas.style=style;
 const platform={
  config:{id:'taptap',apiBase:'https://example.test'},
  canvas,
  viewport:()=>{viewportCalls++;return{width:390,height:844,dpr:2,top:20,bottom:16,menu:{x:288,y:8,w:94,h:32}};},
  storage:{get:()=>null,set(){},remove(){}},
  createCanvas:()=>mockCanvas(mockCtx().ctx),
  createImage:()=>({}),
  onHide:()=>()=>{},onShow:()=>()=>{},
 };
 const client={asset:p=>p,config:{capabilities:{}},profile:{code:'p1',name:'测试',level:5,xp:10,xpToNext:100,energy:20,energyCap:60,supply:{create:1},collection:{coins:0,fragments:0,ownedImageIds:[]}},cookieIdentity:false};
 const stage=new Stage(platform,p=>p);
 const app=new GameApp(platform,client,stage);
 app.ready=true;app.privacyAccepted=true;app.route='lobby';
 viewportCalls=0;
 app.draw();
 assert.equal(viewportCalls,1,'entire lobby frame queries platform.viewport() exactly once');

 // Consecutive pointer moves over empty area write style.cursor only on change.
 const p={id:1,x:10,y:400};
 app.input({type:'move',points:[],changed:[p]});
 app.input({type:'move',points:[],changed:[{...p,x:12}]});
 app.input({type:'move',points:[],changed:[{...p,x:14}]});
 assert.equal(cursorWrites,1,'identical cursor values do not mutate canvas.style.cursor');
});

test('PuzzleBoard caches static board in idleSurface during multiplayer cursor/remote-drag animations',t=>{
 const main=mockCtx(),canvas=mockCanvas(main.ctx);canvas.width=800;canvas.height=1600;
 const platform={
  config:{id:'taptap'},canvas,
  createCanvas:()=>mockCanvas(mockCtx().ctx),
  onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},
 };
 const state=createFittedPuzzle('test',6,4,77); // 24 loose groups >= 12
 const board=new PuzzleBoard(platform,state,()=>{});
 t.after(()=>board.destroy());
 board.setRect({x:0,y:80,w:400,h:720});
 board.openMobileView({bottom:0});
 board.ready=true;
 board.atlas={width:512,height:512};
 board.tile={w:64,h:64,pad:8,columns:5,scale:1};

 // Quiet idle frame without active animation does not allocate idleSurface.
 board.draw(main.ctx);
 assert.equal(board.idleSurface,null);
 assert.equal(board.performanceDetails().builds,0);

 // Teammate cursor animating triggers idleSurface once and reuses it on subsequent frames.
 board.setCursors([{playerId:'p2',x:board.board.x+100,y:board.board.y+100,updatedAt:Date.now(),name:'队友',color:'#49b',level:5}]);
 main.calls.length=0;
 board.draw(main.ctx);
 assert.ok(board.idleSurface,'idleSurface activates when teammate cursor animates over >=12 loose groups');
 assert.equal(board.performanceDetails().builds,1);
 assert.equal(board.performanceDetails().cache,true);

 // Next frame with moved cursor reuses cached idleSurface without rebuilding.
 board.setCursors([{playerId:'p2',x:board.board.x+160,y:board.board.y+140,updatedAt:Date.now(),name:'队友',color:'#49b',level:5}]);
 main.calls.length=0;
 board.draw(main.ctx);
 assert.equal(board.performanceDetails().builds,1,'moving teammate cursor reuses idleSurface without rebuilding');
 assert.equal(main.calls.filter(c=>c[0]==='drawImage'&&c[1][0]===board.atlas).length,0,'static pieces are blitted from idleSurface instead of redrawing atlas tiles');

 // Teammate holding a piece draws only that teammate piece live on top without rebuilding on remote offset interpolation.
 const remoteGroup=state.groups[0];
 board.owners={[remoteGroup.id]:{playerId:'p2',name:'队友',color:'#49b',level:5}};
 board.remoteOffsets.set(remoteGroup.id,{x:remoteGroup.dx,y:remoteGroup.dy});
 board.draw(main.ctx);
 const buildsWithOwner=board.performanceDetails().builds;
 board.remoteOffsets.set(remoteGroup.id,{x:remoteGroup.dx+25,y:remoteGroup.dy+12});
 main.calls.length=0;
 board.draw(main.ctx);
 assert.equal(board.performanceDetails().builds,buildsWithOwner,'teammate drag interpolation reuses idleSurface');
 assert.equal(main.calls.filter(c=>c[0]==='drawImage'&&c[1][0]===board.atlas).length,1,'only the teammate-held piece is drawn live on top');

 // Fewer than 12 loose groups skips idleSurface (keeps endgame cheap and preserves direct-draw tests).
 for(let i=0;i<15;i++)state.groups[i].locked=true;
 board.draw(main.ctx);
 assert.equal(board.idleSurface,null,'endgame with <12 loose groups uses direct draw');
});

test('createWebPlatform caches canvas.getBoundingClientRect() during pointermove bursts',t=>{
 const listeners=new Map(),docListeners=new Map(),winListeners=new Map();
 const add=(map)=>(type,fn)=>{const set=map.get(type)??new Set();set.add(fn);map.set(type,set);};
 const remove=(map)=>(type,fn)=>{map.get(type)?.delete(fn);};
 let rectReads=0;
 const canvas={
  style:{touchAction:''},
  getAttribute:()=>'0',setAttribute(){},removeAttribute(){},focus(){},
  setPointerCapture(){},releasePointerCapture(){},
  addEventListener:add(listeners),removeEventListener:remove(listeners),
  getBoundingClientRect:()=>{rectReads++;return{left:10,top:20,width:400,height:800};},
 };
 const saved={};
 for(const [key,value]of Object.entries({
  window:{innerWidth:400,innerHeight:800,devicePixelRatio:2,addEventListener:add(winListeners),removeEventListener:remove(winListeners)},
  document:{baseURI:'https://game.test/',hidden:false,scripts:[],body:{},activeElement:canvas,addEventListener:add(docListeners),removeEventListener:remove(docListeners)},
  location:{href:'https://game.test/',origin:'https://game.test'},
 })){
  saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 let off=null;
 t.after(()=>{off?.();for(const [key,desc]of Object.entries(saved))if(desc)Object.defineProperty(globalThis,key,desc);else delete globalThis[key];});

 const platform=createWebPlatform({id:'web',gameName:'拼图',apiBase:'https://game.test/api',assetBase:'https://game.test/assets'},canvas);
 const received=[];
 off=platform.onInput(ev=>received.push(ev));

 const fire=(type,ev)=>{for(const fn of listeners.get(type)??[])fn({preventDefault(){},...ev});};
 fire('pointerdown',{pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:110,clientY:220});
 assert.equal(rectReads,1,'pointerdown refreshes canvas rect once');
 for(let i=0;i<20;i++)fire('pointermove',{pointerId:1,pointerType:'touch',buttons:1,clientX:110+i*2,clientY:220+i});
 fire('pointerup',{pointerId:1,pointerType:'touch',clientX:150,clientY:240});
 assert.equal(rectReads,1,'20 pointermove events + pointerup trigger zero getBoundingClientRect() reflows');
 assert.equal(received.at(-1).changed[0].x,140);
 assert.equal(received.at(-1).changed[0].y,220);
});
