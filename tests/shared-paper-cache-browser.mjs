import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const fixture=`
import {PuzzleBoard} from './mobile/puzzle-board';
import {createFittedPuzzle} from './lib/puzzle-engine';
window.runChecks=async()=>{
 const checks=[];let closed=0;
 for(const dpr of [1,2.625,3]){
  const boards=[],contexts=[],pending=[],hides=[];
  for(const enabled of [false,true]){
   const canvas=document.createElement('canvas');canvas.width=Math.round(360*dpr);canvas.height=Math.round(793*dpr);
   const c=canvas.getContext('2d',{willReadFrequently:true});contexts.push(c);
   const platform={canvas,config:{id:'taptap'},createCanvas:()=>document.createElement('canvas'),createImage:()=>new Image(),onHide(fn){hides.push(fn);return()=>{};},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},snapshotCanvas(source){const p=createImageBitmap(source).then(image=>({image,close(){closed++;image.close();}}));pending.push(p);return p;}};
   const board=new PuzzleBoard(platform,createFittedPuzzle('sample',10,10,41),()=>{});board.paperCacheEnabled=enabled;board.setRect({x:7.25,y:93.5,w:345,h:687.25});await board.setImage('/picture.webp');board.openMobileView({bottom:0});boards.push(board);
  }
  const render=()=>{for(let i=0;i<2;i++){const c=contexts[i];c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.fillStyle='#fdf6ed';c.fillRect(0,0,c.canvas.width,c.canvas.height);c.setTransform(c.canvas.width/360,0,0,c.canvas.height/793,0,0);boards[i].draw(c);}};
  const compare=label=>{const a=contexts[0].getImageData(0,0,contexts[0].canvas.width,contexts[0].canvas.height).data,b=contexts[1].getImageData(0,0,contexts[1].canvas.width,contexts[1].canvas.height).data;let delta=0,peak=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);delta+=d;peak=Math.max(peak,d);}// Native bitmap compositing can differ by sub-channel rounding and edge coverage.
   const mean=delta/a.length;if(mean>.5){window.pixelDebug={label,dpr,mean,peak,a:contexts[0].canvas.toDataURL(),b:contexts[1].canvas.toDataURL()};throw Error(label+' pixel mean '+mean+' peak '+peak);}checks.push({dpr,label,mean,peak});};
  for(const theme of ['light','dark','wood']){
   for(const b of boards)b.setTheme(theme);render();compare(theme+' canvas paper');await Promise.all(pending);await Promise.resolve();render();compare(theme+' frozen paper');
   const paper=boards[1].paperSurface;if(!paper?.image||paper.bytes>12*1024*1024||paper.canvas.width!==1)throw Error('materialized native paper and released temporary canvas');
   for(const b of boards){b.camera.x+=13.3;b.camera.y-=8.7;b.camera.z*=1.13;}render();compare(theme+' pan and zoom');if(boards[1].paperSurface!==paper)throw Error('camera movement rebuilt fixed-screen background');
  }
  const paper=boards[1].paperSurface,before=closed;hides.forEach(fn=>fn());if(boards[1].paperSurface!==null||closed<=before)throw Error('hide must close bitmap');
  render();await Promise.all(pending);await Promise.resolve();const next=boards[1].paperSurface;boards.forEach(b=>b.setRect({x:5,y:95,w:346,h:687}));if(boards[1].paperSurface!==null||next.canvas.width!==1)throw Error('resize release');
  render();for(const c of contexts)c.setTransform(8,0,0,8,0,0);boards[1].draw(contexts[1]);if(boards[1].paperSurface!==null)throw Error('oversized paper must fall back without changing DPR');
  boards.forEach(b=>b.destroy());await Promise.all(pending);await Promise.resolve();checks.push({dpr,label:'hide resize oversized destroy and pending snapshots released'});
 }
 // A snapshot resolving after hide cannot reattach a stale native resource.
 let finish,lateClosed=0;const hides=[],p={config:{id:'taptap'},createCanvas:()=>document.createElement('canvas'),onHide:fn=>(hides.push(fn),()=>{}),onShow:()=>()=>{},frame:()=>1,cancelFrame(){},snapshotCanvas:()=>new Promise(resolve=>{finish=resolve;})};
 const b=new PuzzleBoard(p,createFittedPuzzle('late',4,3,1),()=>{});b.setRect({x:0,y:0,w:300,h:500});const c=document.createElement('canvas').getContext('2d');b.draw(c);hides.forEach(fn=>fn());finish({image:document.createElement('canvas'),close(){lateClosed++;}});await Promise.resolve();if(lateClosed!==1||b.paperSurface!==null)throw Error('stale snapshot leak');b.destroy();
 checks.push({label:'stale snapshot closes after hide'});return checks;
};`;
const bundle=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const picture=readFileSync('public/puzzles/painted-glasshouse-workbench-v1-play-239bfa06b10a.webp');
const server=createServer((req,res)=>{if(req.url==='/game.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else if(req.url==='/picture.webp'){res.setHeader('Content-Type','image/webp');res.end(picture);}else res.end('<html><script src="/game.js"></script></html>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);let checks;try{checks=await page.evaluate(()=>window.runChecks());}catch(e){const d=await page.evaluate(()=>window.pixelDebug);if(d){writeFileSync('work/taptap-layer-investigation-20261019/direct.png',Buffer.from(d.a.split(',')[1],'base64'));writeFileSync('work/taptap-layer-investigation-20261019/cached.png',Buffer.from(d.b.split(',')[1],'base64'));console.log({label:d.label,dpr:d.dpr,mean:d.mean,peak:d.peak});}throw e;}assert.deepEqual(errors,[]);assert.equal(checks.length,31);
 mkdirSync('work/taptap-layer-investigation-20261019',{recursive:true});writeFileSync('work/taptap-layer-investigation-20261019/paper-pixel-report.json',JSON.stringify(checks,null,2));console.log(JSON.stringify({checks:checks.length,maxMean:Math.max(...checks.filter(c=>c.mean!==undefined).map(c=>c.mean)),closedSafely:true}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
