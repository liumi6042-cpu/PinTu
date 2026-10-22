import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const fixture=`
import {PuzzleBoard} from './mobile/puzzle-board';
import {PuzzleBoard as PreviousBoard} from 'previous-board';
import {createFittedPuzzle} from './lib/puzzle-engine';
const check=(v,m)=>{if(!v)throw Error(m);};
window.stress=async()=>{
 const reports=[];
 for(const Board of [PreviousBoard,PuzzleBoard]){
  const canvases=[],hide=[],largeAllocated=new Set(),dimensions={sets:0,largeSets:0},prototype=HTMLCanvasElement.prototype;
  const createCanvas=()=>{const canvas=document.createElement('canvas');canvases.push(canvas);
   for(const field of ['width','height']){const d=Object.getOwnPropertyDescriptor(prototype,field);Object.defineProperty(canvas,field,{get(){return d.get.call(canvas);},set(v){dimensions.sets++;d.set.call(canvas,v);if(canvas.width*canvas.height>100000){dimensions.largeSets++;largeAllocated.add(canvas);}}});}return canvas;};
  const main=createCanvas();main.width=1080;main.height=2379;const ctx=main.getContext('2d');
  const board=new Board({canvas:main,config:{id:'web'},createCanvas,createImage:()=>new Image(),onHide:fn=>(hide.push(fn),()=>{}),onShow:()=>()=>{},frame:()=>1,cancelFrame(){}},createFittedPuzzle('sample',10,10,41),()=>{});
  board.setRect({x:0,y:90,w:393,h:775});await board.setImage('/picture.webp');board.openMobileView({bottom:0});
  board.networkReady=true;board.network={acquire:async()=>true,move(){},drop:async()=>{},release(){}};
  const render=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,main.width,main.height);ctx.setTransform(1080/393,0,0,2379/865,0,0);board.draw(ctx);};
  render();const baseline=canvases.length,baselineLarge=largeAllocated.size,original={...board.camera},before=JSON.stringify(board.state);
  let warmAllocations=null;const samples=[];
  for(let n=0;n<150;n++){
   board.camera={...original};const p={id:1,x:150,y:420};board.input({type:'down',points:[p],changed:[p],pan:true});
   const begin=performance.now();render();
   for(const offset of [12,240,260]){const next={...p,x:p.x+offset};board.input({type:'move',points:[next],changed:[next]});render();}
   board.input({type:'up',points:[],changed:[p]});render();samples.push(performance.now()-begin);
   if(n===0)warmAllocations=board.performanceDetails().allocations;
   if(n%15===0)await new Promise(r=>setTimeout(r,0));
  }
  check(JSON.stringify(board.state)===before,'camera cannot modify player puzzle state');
  const afterPan=canvases.length;
  for(let n=0;n<50;n++){
   const g=board.state.groups.at(-1),id=g.pieces[0],b=board.board,w=b.width/10,h=b.height/10,wx=b.x+(id%10+.5)*w+g.dx,wy=b.y+(Math.floor(id/10)+.5)*h+g.dy;board.camera={z:original.z,x:196-wx*original.z,y:385-wy*original.z};const p={id:1,x:196,y:475};
   board.input({type:'down',points:[p],changed:[p]});await Promise.resolve();render();check(board.performanceDetails().gesture==='拖动碎片','repeated drags must remain acquireable');
   const m={...p,x:p.x+1};board.input({type:'move',points:[m],changed:[m]});render();board.input({type:'cancel',points:[],changed:[m]});render();
  }
  const info=board.performanceDetails(),largeCanvases=canvases.filter(c=>c.width*c.height>100000).length;
  if(Board===PuzzleBoard){check(info.allocations===warmAllocations,'rebuilds never resize the warmed backing store');check(afterPan-baseline===1,'150 gestures share exactly one snapshot canvas');check(canvases.slice(afterPan).every(c=>c.width*c.height<=400),'piece dragging reuses the large buffer; only tiny dot patterns may be created');check(info.bufferBytes<=24*1024*1024,'resident buffer bounded');
   board.setGestureCacheEnabled(false);board.camera={...original};const p={id:1,x:100,y:400};board.input({type:'down',points:[p],changed:[p],pan:true});render();check(!board.performanceDetails().cache,'diagnostic switch can compare uncached pan without another package');
  }
  for(const fn of hide)fn();check(!board.dragSurface&&!board.gestureSurface,'hide clears active caches');if(Board===PuzzleBoard)check(board.performanceDetails().bufferBytes===0,'hide releases pooled graphics memory');
  board.destroy();if(Board===PuzzleBoard)check(canvases.filter(c=>c!==main&&c.width*c.height>100000).length===0,'room destruction frees atlas picture and snapshots');
  reports.push({version:Board===PuzzleBoard?'buffer-reuse':'previous',panGestures:150,pieceGestures:50,snapshotCanvases:largeAllocated.size-baselineLarge,allNewCanvases:canvases.length-baseline,largeDimensionWrites:dimensions.largeSets,largeCanvasesBeforeDestroy:largeCanvases,info,medianCycleMs:[...samples].sort((a,b)=>a-b)[75],last10CycleMs:samples.slice(-10)});
 }
 return reports;
};`;
const old=readFileSync('work/taptap-buffer-reuse-20261019/puzzle-board.before.ts','utf8');
const bundle=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'previous-board',setup(api){api.onResolve({filter:/^previous-board$/},()=>({path:'previous-board',namespace:'previous'}));api.onLoad({filter:/.*/,namespace:'previous'},()=>({contents:old,loader:'ts',resolveDir:resolve('mobile')}));}}]});
const image=readFileSync('public/puzzles/painted-glasshouse-workbench-v1-play-239bfa06b10a.webp');
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else if(req.url==='/picture.webp'){res.setHeader('Content-Type','image/webp');res.end(image);}else res.end('<script src="/bundle.js"></script>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);const result=await page.evaluate(()=>window.stress());mkdirSync('work/taptap-buffer-reuse-20261019',{recursive:true});writeFileSync('work/taptap-buffer-reuse-20261019/stress-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
