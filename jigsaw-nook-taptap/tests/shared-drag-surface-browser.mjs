import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

// An isolated real-Canvas comparison: the reference executes the unchanged
// immediate draw path, while the candidate can reuse its static drag surface.
const fixture=`
import {PuzzleBoard} from './mobile/puzzle-board';
import {PuzzleBoard as ReferenceBoard} from 'board-baseline';
import {createPuzzle,raiseGroup} from './lib/puzzle-engine';
const check=(value,message)=>{if(!value)throw Error(message);};
const point=(board,group)=>{const id=group.pieces[0],b=board.board,w=b.width/board.state.cols,h=b.height/board.state.rows;return{id:1,x:board.rect.x+board.camera.x+(b.x+(id%board.state.cols+.5)*w+group.dx)*board.camera.z,y:board.rect.y+board.camera.y+(b.y+(Math.floor(id/board.state.cols)+.5)*h+group.dy)*board.camera.z};};
async function setup(dpr,large,readback=true){
 const boards=[],contexts=[],events=[],canvases=[];
 const state=createPuzzle('test',25,20,20261017);
 if(large){state.groups=state.groups.filter(g=>g.id>=100);state.groups.push({id:0,pieces:Array.from({length:100},(_,i)=>i),dx:0,dy:0,locked:false});}
 for(let i=0;i<2;i++){
  // Keep both surfaces on the same backend. Repeated getImageData otherwise
  // moves only the reference to CPU rasterization during the comparison.
  const canvas=document.createElement('canvas');canvas.width=Math.round(421*dpr);canvas.height=Math.round(881*dpr);const ctx=canvas.getContext('2d',{willReadFrequently:readback}),log=[];events.push(log);contexts.push(ctx);
  const platform={canvas,config:{id:'web'},createCanvas(){const c=document.createElement('canvas');c.getContext('2d',{willReadFrequently:readback});canvases.push(c);return c;},createImage:()=>new Image(),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){}};
  const Board=i===0?ReferenceBoard:PuzzleBoard,board=new Board(platform,structuredClone(state),()=>{});board.setRect({x:10,y:13,w:390,h:844});await board.setImage('/picture.webp');board.openMobileView({bottom:0});
  board.networkReady=true;board.network={acquire:async id=>(log.push(['claim',id]),true),move:(...args)=>log.push(['move',...args]),drop:async(...args)=>log.push(['drop',...args]),release:id=>log.push(['release',id])};
  board.drawDecoration=(value,r)=>{ctx.fillStyle=value.color;ctx.fillRect(r.x,r.y,r.w,r.h);};
  if(i===0)board.cachedDragSurface=()=>null;
  const target=large?board.state.groups.find(g=>g.id===0):board.state.groups.find(g=>g.id===250);raiseGroup(board.state,target.id);const p=point(board,target);board.input({type:'down',points:[p],changed:[p]});await Promise.resolve();check(board.drag?.id===target.id,'the real hit test must acquire the intended group');boards.push(board);
 }
 const compare=label=>{
  for(let i=0;i<2;i++){const ctx=contexts[i];ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.setTransform(ctx.canvas.width/421,0,0,ctx.canvas.height/881,0,0);boards[i].draw(ctx);}
  const a=contexts[0].getImageData(0,0,contexts[0].canvas.width,contexts[0].canvas.height).data,b=contexts[1].getImageData(0,0,contexts[1].canvas.width,contexts[1].canvas.height).data;let differences=0,maxDelta=0;for(let j=0;j<a.length;j++)if(a[j]!==b[j]){differences++;maxDelta=Math.max(maxDelta,Math.abs(a[j]-b[j]));}
  const sample=[];for(let j=0;j<a.length&&sample.length<8;j+=4)if(a[j]!==b[j]||a[j+1]!==b[j+1]||a[j+2]!==b[j+2]||a[j+3]!==b[j+3])sample.push({x:(j/4)%contexts[0].canvas.width,y:Math.floor(j/4/contexts[0].canvas.width),a:[...a.slice(j,j+4)],b:[...b.slice(j,j+4)]});
  check(differences===0,label+': '+differences+' channel differences, max '+maxDelta+' '+JSON.stringify(sample));return label;
 };
 return{boards,contexts,events,canvases,compare};
}
window.dragSurfaceChecks=async()=>{
 const results=[];
 for(const dpr of [1,2.625,3])for(const large of [false,true]){
  const t=await setup(dpr,large),[reference,candidate]=t.boards,run=label=>results.push({dpr,large,check:t.compare(label)});
  run('first frame');check(candidate.dragSurface,'a supported topmost local drag gets a cache');let surface=candidate.dragSurface,key=surface.key;check(surface.canvas.width*surface.canvas.height*4<=24*1024*1024,'extra cache is within 24 MiB');
  for(const board of t.boards){const p=point(board,board.state.groups.find(g=>g.id===board.drag.id)),m={...p,x:p.x+5.375,y:p.y-2.125};board.input({type:'move',points:[m],changed:[m]});}
  run('fractional drag preserves pixels');check(candidate.dragSurface===surface&&candidate.dragSurface.key===key,'moving the drag does not rebuild the static surface');
  for(const board of t.boards){board.underlay=true;board.showPreview=true;board.setHints([2,122],Date.now()+60000);board.setTheme('dark');board.setCursors([{playerId:'friend',x:board.board.x+300,y:board.board.y+300,updatedAt:Date.now(),name:'Friend',color:'#49b',level:7,decoration:{id:'test',title:'test',artKey:'test',color:'#f70'}}]);board.selfDecoration={id:'self',title:'self',artKey:'self',color:'#0bf'};board.owners={120:{name:'Owner',color:'#fa0',level:8,decoration:{id:'owner',title:'owner',artKey:'owner',color:'#98f'}}};}
  run('theme underlay hints preview cursor and decorations');check(candidate.dragSurface.key!==key,'visual changes invalidate the surface');key=candidate.dragSurface.key;
  for(const board of t.boards){const remote=structuredClone(board.state);remote.groups.find(g=>g.id===120).dx+=19.25;remote.groups.find(g=>g.id===120).dy-=6.5;const local=remote.groups.find(g=>g.id===board.drag.id);local.dx=999;board.syncRemote(remote,{120:{name:'New owner',color:'#19f',level:9}},new Set([board.drag.id]),false);}
  run('remote move owner changes and protected local lease');check(candidate.dragSurface.key!==key,'remote state invalidates');check(candidate.state.groups.find(g=>g.id===candidate.drag.id).dx!==999,'snapshot cannot move a protected local drag');
  for(const board of t.boards){board.focusedPiece=121;board.camera={x:board.camera.x+.375,y:board.camera.y-1.125,z:board.camera.z*1.07};board.setRect({x:10.25,y:13.5,w:387.25,h:840.5});}
  run('viewport fractional clip pan and zoom invalidation');
  const cancelledBuffer=candidate.dragSurface.canvas;for(const board of t.boards){board.hintUntil=0;board.underlay=false;board.edgeOnly=true;}
  run('edge filter cancels the drag');check(candidate.dragSurface===null,'tool cancellation releases the active cache');check(candidate.surfaceBuffer===cancelledBuffer,'tool cancellation retains one reusable buffer');
  check(JSON.stringify(t.events[0])===JSON.stringify(t.events[1]),'cache cannot alter claim move drop or lease release events');
  for(const board of t.boards)board.destroy();
 }
 // Order, allocation and lifecycle fallbacks use real Canvas contexts too.
 const t=await setup(3,true),[reference,candidate]=t.boards;t.compare('warm lifecycle');let old=candidate.dragSurface;
 for(const board of t.boards){const other=board.state.groups.find(g=>g.id===101);raiseGroup(board.state,other.id);}
 t.compare('drag no longer topmost');check(candidate.dragSurface===null&&candidate.surfaceBuffer===old.canvas,'changed z order invalidates contents and uses the immediate draw path');
 for(const board of t.boards)raiseGroup(board.state,board.drag.id);
 t.compare('topmost restored');old=candidate.dragSurface;
 for(const ctx of t.contexts){ctx.canvas.width=2400;ctx.canvas.height=2640;ctx.setTransform(8,0,0,8,0,0);}
 for(let i=0;i<2;i++)t.boards[i].draw(t.contexts[i]);check(candidate.dragSurface===null&&old.canvas.width===1,'DPR over 24 MiB falls back without allocating');
 for(const ctx of t.contexts){ctx.canvas.width=1260;ctx.canvas.height=2640;}
 t.compare('normal DPR restored');old=candidate.dragSurface;candidate.cancelNetworkDrag(candidate.drag.id);check(candidate.dragSurface===null&&candidate.surfaceBuffer===old.canvas,'server refusal invalidates its cache');reference.cancelNetworkDrag(reference.drag.id);
 for(const board of t.boards){const group=board.state.groups.find(g=>g.id===0),p=point(board,group);board.input({type:'cancel',points:[],changed:[]});board.input({type:'down',points:[p],changed:[p]});}await Promise.resolve();t.compare('new drag after refusal');old=candidate.dragSurface;
 const loading=t.boards.map(board=>board.setImage('/picture.webp'));check(candidate.dragSurface===null&&old.canvas.width===1,'image replacement releases cached pixels immediately');await Promise.all(loading);
 for(const board of t.boards){const group=board.state.groups.find(g=>g.id===0),p=point(board,group);board.input({type:'down',points:[p],changed:[p]});}await Promise.resolve();t.compare('replacement image ready');old=candidate.dragSurface;check(old,'replacement image can prepare a new cache');
 for(const board of t.boards)board.destroy();check(candidate.dragSurface===null&&old.canvas.width===1,'destroy releases cached pixels');
 results.push({check:'z order, protected leases, budget fallback, image replacement and destroy'});
 const gpu=await setup(3,true,false);for(const board of gpu.boards){board.setTheme('dark');board.underlay=true;board.setHints([2,120],Date.now()+60000);board.showPreview=true;board.owners={120:{name:'GPU owner',color:'#49f',level:7}};}results.push({check:gpu.compare('GPU first frame with full visual overlays')});for(const board of gpu.boards)board.destroy();return results;
};
`;
const root=resolve('.'),baseline=process.argv[2]?resolve(process.argv[2]):null,referenceSource=baseline?await readFile(baseline,'utf8'):await readFile(resolve(root,'mobile/puzzle-board.ts'),'utf8');
const bundle=await build({stdin:{contents:fixture,sourcefile:'drag-surface-fixture.ts',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',plugins:[{name:'board-baseline',setup(api){api.onResolve({filter:/^board-baseline$/},()=>({path:'board-baseline',namespace:'board-baseline'}));api.onLoad({filter:/.*/,namespace:'board-baseline'},()=>({contents:referenceSource,loader:'ts',resolveDir:resolve(root,'mobile')}));}}]});
const picture=await readFile(resolve(root,'public/puzzles/painted-glasshouse-workbench-v1-play-239bfa06b10a.webp'));
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}else if(req.url==='/picture.webp'){res.setHeader('Content-Type','image/webp');res.end(picture);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script>');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto('http://127.0.0.1:'+server.address().port);
 const result=await page.evaluate(()=>window.dragSurfaceChecks());assert.equal(result.length,38);console.log(JSON.stringify({checks:result.length,pixelDifferenceChannels:0,reference:baseline??'immediate draw path',results:result},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
