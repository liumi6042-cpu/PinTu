import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import { PuzzleBoard } from '../mobile/puzzle-board.ts';
import { createFittedPuzzle } from '../lib/puzzle-engine.ts';

// TapTap players lost their place after 定位 + zoom; the opt-in corner map shows the whole table while zoomed in.
function platform(){
 const ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx});
 return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
async function setup({enabled=true}={}){
 const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{}),events=[];board.setRect({x:10,y:80,w:390,h:600});await board.setImage('test.png');board.networkReady=true;
 board.network={canAcquire:()=>true,acquire:async id=>(events.push(['acquire',id]),true),move(){},drop:async(...args)=>{events.push(['drop',...args]);},release:id=>events.push(['release',id])};
 board.minimapEnabled=enabled;board.fit();
 return {p,state,board,events,draw:()=>board.draw(p.ctx)};
}
/** Zoom in around the board centre so only part of the table is on screen. */
function zoomIn(board,factor=3){
 const z=board.camera.z*factor,cx=board.board.x+board.board.width/2,cy=board.board.y+board.board.height/2;
 board.camera={x:board.rect.w/2-cx*z,y:board.rect.h/2-cy*z,z};
}
function center(board,group){const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=group.pieces[0];return{x:board.board.x+(id%board.state.cols+.5)*w+group.dx,y:board.board.y+(Math.floor(id/board.state.cols)+.5)*h+group.dy};}
function screen(board,group){const c=center(board,group);return{id:1,x:board.rect.x+board.camera.x+c.x*board.camera.z,y:board.rect.y+board.camera.y+c.y*board.camera.z};}
/** Move a loose group so its first piece sits under the given screen point. */
function placeUnder(board,group,point){const c=center(board,group),cam=board.camera;group.dx+=(point.x-board.rect.x-cam.x)/cam.z-c.x;group.dy+=(point.y-board.rect.y-cam.y)/cam.z-c.y;}
const tap=(board,point,type='down')=>board.input({type,points:type==='up'?[]:[point],changed:[point]});

test('the corner map stays hidden while it is switched off, even zoomed in',async()=>{
 const {board,draw}=await setup({enabled:false});zoomIn(board);draw();
 assert.equal(board.minimapFrame,null);
 board.destroy();
});

test('switched on, it shows top-left only while the view no longer holds the whole table',async()=>{
 const {board,draw}=await setup();draw();
 assert.equal(board.minimapFrame,null,'the fitted view already shows the whole table');
 zoomIn(board);draw();const frame=board.minimapFrame;
 assert.ok(frame,'zoomed in, the map appears');
 assert.equal(frame.x,board.rect.x+12);assert.ok(frame.y>=board.rect.y+6);assert.ok(frame.w<=126&&frame.h<=106,'portrait map is at most about 120pt wide');
 board.fit();draw();assert.equal(board.minimapFrame,null,'zoomed back out to the whole table, it hides again');
 zoomIn(board);board.phoneLandscapeRoom=true;draw();assert.ok(board.minimapFrame.w<=140,'landscape map is at most about 134pt wide');
 board.minimapEnabled=false;draw();assert.equal(board.minimapFrame,null);
 board.destroy();
});

test('the map hides while the large reference is open or every piece is placed',async()=>{
 const {state,board,draw}=await setup();zoomIn(board);draw();assert.ok(board.minimapFrame);
 board.showPreview=true;board.openPreviewZoom();draw();assert.equal(board.minimapFrame,null);
 board.closePreviewZoom();draw();assert.ok(board.minimapFrame);
 for(const group of state.groups)group.locked=true;draw();assert.equal(board.minimapFrame,null);
 board.destroy();
});

test('a finger on the map moves the view there at the same zoom and never picks up the piece underneath',async()=>{
 const {state,board,events,draw}=await setup();zoomIn(board);draw();
 const frame=board.minimapFrame,point={id:1,x:frame.x+16,y:frame.y+16},group=state.groups.find(g=>!g.locked);
 placeUnder(board,group,point);draw();assert.deepEqual(board.minimapFrame,frame,'moving one piece keeps the map in place');
 const map=board.minimap,z=board.camera.z,worldAt=p=>({x:map.x+(p.x-map.inner.x)/map.scale,y:map.y+(p.y-map.inner.y)/map.scale});
 tap(board,point);await Promise.resolve();
 assert.equal(events.length,0,'the piece under the map is not acquired');assert.equal(board.drag,null);
 let world=worldAt(point);
 assert.equal(board.camera.z,z);assert.ok(Math.abs(board.camera.x-(board.rect.w/2-world.x*z))<1e-6);assert.ok(Math.abs(board.camera.y-(board.rect.h/2-world.y*z))<1e-6);
 // Dragging on the map keeps following the finger, also once it slides past the map's edge (clamped).
 const along={id:1,x:map.inner.x+map.inner.w/2,y:map.inner.y+map.inner.h/2};tap(board,along,'move');world=worldAt(along);
 assert.ok(Math.abs(board.camera.x-(board.rect.w/2-world.x*z))<1e-6);assert.ok(Math.abs(board.camera.y-(board.rect.h/2-world.y*z))<1e-6);
 const outside={id:1,x:map.inner.x+map.inner.w+80,y:map.inner.y+map.inner.h+80};tap(board,outside,'move');world=worldAt({x:map.inner.x+map.inner.w,y:map.inner.y+map.inner.h});
 assert.ok(Math.abs(board.camera.x-(board.rect.w/2-world.x*z))<1e-6&&Math.abs(board.camera.y-(board.rect.h/2-world.y*z))<1e-6,'past the edge the view stays at the map corner');
 tap(board,outside,'up');assert.equal(board.minimapTouch,null);assert.equal(events.length,0);assert.equal(board.camera.z,z);
 board.destroy();
});

test('control: with the map off the same spot picks up the piece; a piece dragged over the map is not hijacked',async()=>{
 const {state,board,events,draw}=await setup();zoomIn(board);draw();
 const frame=board.minimapFrame,point={id:1,x:frame.x+16,y:frame.y+16},group=state.groups.find(g=>!g.locked);placeUnder(board,group,point);
 board.minimapEnabled=false;draw();tap(board,point);await Promise.resolve();
 assert.equal(events[0]?.[0],'acquire','without the map a piece there is picked up');tap(board,point,'up');await Promise.resolve();
 board.minimapEnabled=true;zoomIn(board,1);draw();assert.ok(board.minimapFrame);events.length=0;
 const other=state.groups.find(g=>!g.locked&&g.id!==group.id);placeUnder(board,other,{x:board.rect.x+board.rect.w/2,y:board.rect.y+board.rect.h/2});draw();
 const from={...screen(board,other),id:2},camera={...board.camera};tap(board,from);await Promise.resolve();
 assert.deepEqual(events[0],['acquire',other.id]);
 const over={id:2,x:board.minimapFrame.x+20,y:board.minimapFrame.y+20};tap(board,over,'move');
 assert.deepEqual(board.camera,camera,'the view does not jump while a piece passes over the map');assert.equal(board.drag?.id,other.id);
 board.destroy();
});

test('定位 marks stay on the map after the flash until each piece is picked up or placed',async()=>{
 const {state,board,draw}=await setup();
 const loose=state.groups.filter(g=>!g.locked&&g.pieces.length);const count=board.locateLoose();assert.ok(count>0);
 assert.equal(board.locatedMarks.ids.length,loose.length);
 zoomIn(board,4);draw();assert.ok(board.minimapFrame);
 // The main flash lasts 3.6 s; the map ring is still there afterwards.
 board.locateUntil=0;draw();assert.equal(board.locatedMarks.ids.length,loose.length);
 const [picked,placed]=loose;
 placeUnder(board,picked,{x:board.rect.x+board.rect.w/2,y:board.rect.y+board.rect.h/2});draw();
 tap(board,screen(board,picked));await Promise.resolve();draw();
 assert.ok(!board.locatedMarks.ids.includes(picked.pieces[0]),'a piece picked up loses its mark');
 tap(board,screen(board,picked),'up');await Promise.resolve();
 placed.locked=true;draw();assert.ok(!board.locatedMarks.ids.includes(placed.pieces[0]),'a placed piece loses its mark');
 assert.equal(board.locatedMarks.ids.length,loose.length-2,'the others keep theirs');
 board.locatedMarks.until=Date.now()-1;draw();assert.equal(board.locatedMarks,null,'marks expire after a minute');
 board.destroy();
});

test('previewThumbInset moves the 原图 thumbnail down; null keeps previewTopInset',async()=>{
 const {board,draw}=await setup();board.previewTopInset=6;board.showPreview=true;draw();
 assert.equal(board.previewThumb.y,board.rect.y+6);
 board.previewThumbInset=130;draw();assert.equal(board.previewThumb.y,board.rect.y+130);
 board.previewThumbInset=null;draw();assert.equal(board.previewThumb.y,board.rect.y+6);
 board.destroy();
});

// App side: the 更多 switch persists, the board only gets the map on phones, and the closed landscape toggle pushes the thumbnail down.
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function app({id='taptap',saved}={}){
 const storage=new Map([['jigsaw:room-guide:v1','done']]);if(saved!==undefined)storage.set('jigsaw:room-minimap:v1',saved);
 const viewport={width:390,height:844,top:20,bottom:0,dpr:1};
 const ctx=new Proxy({measureText:value=>({width:String(value).length*6})},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const platform={config:{id,apiBase:'/api'},createImage:()=>({}),createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const stage=new Stage(platform,value=>value),client={config:{capabilities:{}},profile:{collection:{}},asset:value=>value};
 const game=new GameApp(platform,client,stage),board={camera:{x:0,y:0,z:1},setRect(r){this.rect={...r};},draw(){}};
 game.note=()=>{};game.roomViewPending=false;
 // Phone portrait/landscape follow the viewport; desktop needs a fine pointer on TapTap PC.
 const layout=name=>{Object.assign(viewport,name==='phonePortrait'?{width:390,height:844}:name==='phoneLandscape'?{width:844,height:390}:{width:1280,height:720});globalThis.matchMedia=()=>({matches:name==='desktop'});assert.equal(game.layout,name);};
 return {game,board,storage,layout};
}

test('the 更多 switch is off by default, remembered, and reaches the board only on phones',()=>{
 const {game,board,storage,layout}=app();assert.equal(game.minimapEnabled,false);
 layout('phonePortrait');game.placeBoard(board,6,()=>{});assert.equal(board.minimapEnabled,false);
 game.setMinimapEnabled(true);assert.equal(storage.get('jigsaw:room-minimap:v1'),'1');game.placeBoard(board,6,()=>{});assert.equal(board.minimapEnabled,true);
 layout('desktop');game.placeBoard(board,6,()=>{});assert.equal(board.minimapEnabled,false,'desktop has no corner map yet');
 game.setMinimapEnabled(false);assert.equal(storage.get('jigsaw:room-minimap:v1'),'0');
 assert.equal(app({saved:'1'}).game.minimapEnabled,true);assert.equal(app({saved:'0'}).game.minimapEnabled,false);
});

test('landscape thumbnail starts below the closed tool toggle; open tools or portrait keep previewTopInset',()=>{
 const {game,board,layout}=app();layout('phoneLandscape');game.landscapeToolsOpen=false;game.placeBoard(board,6,()=>{});
 assert.equal(board.phoneLandscapeRoom,true);assert.equal(board.previewThumbInset,game.roomHeaderTop()+101);
 game.landscapeToolsOpen=true;game.placeBoard(board,6,()=>{});assert.equal(board.previewThumbInset,null);
 layout('phonePortrait');game.landscapeToolsOpen=false;game.placeBoard(board,6,()=>{});assert.equal(board.previewThumbInset,null);
 const web=app({id:'web'});web.layout('phoneLandscape');web.game.placeBoard(web.board,6,()=>{});assert.equal(web.board.previewThumbInset,null);
});
