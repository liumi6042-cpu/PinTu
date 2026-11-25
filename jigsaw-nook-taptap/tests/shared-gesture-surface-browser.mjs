import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const fixture=`
import {PuzzleBoard} from './mobile/puzzle-board';
import {createFittedPuzzle} from './lib/puzzle-engine';
const check=(v,message)=>{if(!v)throw Error(message);};
window.runChecks=async()=>{
 const reports=[];
 for(const dpr of [1,2.625,3])for(const count of [100,500]){
  const logs=[],boards=[],contexts=[],events=[];
  for(let i=0;i<2;i++){
   const canvas=document.createElement('canvas');canvas.width=Math.round(393*dpr);canvas.height=Math.round(865*dpr);if(i===1)document.body.append(canvas);
   const all=[];const observe=c=>{const ctx=c.getContext('2d',{willReadFrequently:true}),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{all.push(args[0]);return draw(...args);};return ctx;};
   const ctx=observe(canvas),event=[];
   const platform={canvas,config:{id:'web'},createCanvas(){const c=document.createElement('canvas');observe(c);return c;},createImage:()=>new Image(),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){}};
   const board=new PuzzleBoard(platform,createFittedPuzzle('sample',count===100?10:25,count===100?10:20,41),()=>{});
   board.setRect({x:7,y:70,w:379,h:780});await board.setImage('/picture.webp');board.openMobileView({bottom:0});
   board.networkReady=true;board.network={acquire:async()=>true,move:(...a)=>event.push(['move',...a]),drop:async(...a)=>event.push(['drop',...a]),release:(...a)=>event.push(['release',...a])};
   if(i===0)board.cachedGestureSurface=()=>null;
   boards.push(board);contexts.push(ctx);logs.push(all);events.push(event);
  }
  const render=()=>{for(let i=0;i<2;i++){const c=contexts[i];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.setTransform(c.canvas.width/393,0,0,c.canvas.height/865,0,0);boards[i].draw(c);}};
  const compare=(label,exact=false)=>{
   render();const a=contexts[0].getImageData(0,0,contexts[0].canvas.width,contexts[0].canvas.height).data,b=contexts[1].getImageData(0,0,contexts[1].canvas.width,contexts[1].canvas.height).data;let total=0,diff=0;
   for(let n=0;n<a.length;n++){const delta=Math.abs(a[n]-b[n]);total+=delta;if(delta)diff++;}
   const mean=total/a.length;check(exact?diff===0:mean<2,label+' mean error '+mean+' changed channels '+diff);reports.push({dpr,count,label,mean,exact});
  };
  const start={id:1,x:140,y:410},down={type:'down',points:[start],changed:[start],pan:true};
  for(const b of boards)b.input(down);
  compare('pan begins');let frame=boards[1].gestureSurface;check(frame,'pan cache exists');check(frame.canvas.width*frame.canvas.height*4<=24*1024*1024,'24 MiB memory budget');
  const snapshot=JSON.stringify(boards[1].state);
  for(const log of logs)log.length=0;
  for(let n=1;n<=12;n++){
   const p={...start,x:start.x+n*.5,y:start.y-n*.25};for(const b of boards)b.input({type:'move',points:[p],changed:[p]});render();
  }
  const originalAtlas=logs[0].filter(source=>source===boards[0].atlas).length,cachedAtlas=logs[1].filter(source=>source===boards[1].atlas).length;
  check(originalAtlas>0,'reference must draw actual pieces');check(cachedAtlas===0,'warm camera frames never redraw the piece atlas');check(boards[1].gestureSurface===frame,'short pan reuses the same cache');
  check(JSON.stringify(boards[1].state)===snapshot,'camera gestures cannot change puzzle state');compare('short subpixel pan');
  const moved={...start,x:start.x+310,y:start.y+180};for(const b of boards)b.input({type:'move',points:[moved],changed:[moved]});compare('long pan rebuilds before revealing new edges');check(boards[1].gestureSurface!==frame,'exhausted overscan is rebased');frame=boards[1].gestureSurface;
  // A real remote move must replace the cached bitmap while the finger stays down.
  for(const b of boards){const next=structuredClone(b.state);next.groups[0].dx+=25;b.syncRemote(next,{},new Set(),false);}
  compare('remote piece move');check(boards[1].gestureSurface!==frame,'remote moves invalidate cache');
  const a={id:1,x:155,y:420},b={id:2,x:235,y:420};for(const board of boards)board.input({type:'down',points:[a,b],changed:[b]});
  for(const zoom of [1.1,1.3,.85]){
   const pa={...a,x:195-40*zoom},pb={...b,x:195+40*zoom};for(const board of boards)board.input({type:'move',points:[pa,pb],changed:[pa,pb]});compare('pinch '+zoom);
  }
  for(const board of boards){board.setTheme('dark');board.underlay=true;board.setHints([3],Date.now()+60000);}
  compare('theme underlay and live hint');
  if(dpr===2.625&&count===100)window.panScreenshot=contexts[1].canvas.toDataURL('image/png');
  const cached=boards[1].gestureSurface;
  for(const board of boards)board.input({type:'up',points:[],changed:[a,b]});compare('release restores direct pixels',true);
  check(boards[1].gestureSurface===null&&boards[1].surfaceBuffer===cached.canvas,'release invalidates content while retaining one reusable buffer');
  check(events[0].length===0&&events[1].length===0,'pan and pinch never claim move drop or release a piece');
  for(const board of boards){board.input(down);}render();const hidden=boards[1].gestureSurface;for(const board of boards)board.input({type:'cancel',points:[],changed:[start]});check(boards[1].gestureSurface===null&&boards[1].surfaceBuffer===hidden.canvas,'cancellation retains only the shared buffer');
  for(const board of boards){board.input(down);}render();const resized=boards[1].gestureSurface;for(const board of boards)board.setRect({x:0,y:0,w:380,h:760});check(boards[1].gestureSurface===null&&resized.canvas.width===1,'layout changes discard the old cache');
  for(const board of boards)board.draw(contexts[boards.indexOf(board)]);const resizedCache=boards[1].gestureSurface;
  for(let i=0;i<2;i++){contexts[i].setTransform(8,0,0,8,0,0);boards[i].draw(contexts[i]);}check(boards[1].gestureSurface===null&&resizedCache.canvas.width===1,'oversized cache releases pixels and falls back safely');
  render();const last=boards[1].gestureSurface;check(last,'normal backing scale can rebuild after memory fallback');for(const board of boards)board.destroy();check(boards[1].gestureSurface===null&&last.canvas.width===1,'destroy frees cache');
  reports.push({dpr,count,label:'warm draw counts',frames:12,originalAtlas,cachedAtlas});
  contexts[1].canvas.remove();
 }
 return reports;
};`;
const compiled=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const picture=readFileSync('public/puzzles/painted-glasshouse-workbench-v1-play-239bfa06b10a.webp');
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(compiled.outputFiles[0].contents);}else if(req.url==='/picture.webp'){res.setHeader('Content-Type','image/webp');res.end(picture);}else res.end('<html><style>body{margin:0}canvas{width:393px;height:865px}</style><script src="/bundle.js"></script></html>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:393,height:865}});
 await page.goto('http://127.0.0.1:'+server.address().port);const reports=await page.evaluate(()=>window.runChecks());assert.equal(reports.length,60);
 mkdirSync('work/taptap-pan-cache-20261019',{recursive:true});writeFileSync('work/taptap-pan-cache-20261019/gesture-report.json',JSON.stringify(reports,null,2));
 writeFileSync('work/taptap-pan-cache-20261019/gesture-preview.png',Buffer.from((await page.evaluate(()=>window.panScreenshot)).split(',')[1],'base64'));
 console.log(JSON.stringify({checks:reports.length,drawCounts:reports.filter(r=>r.label==='warm draw counts'),maxMean:Math.max(...reports.filter(r=>r.mean!==undefined).map(r=>r.mean))},null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
