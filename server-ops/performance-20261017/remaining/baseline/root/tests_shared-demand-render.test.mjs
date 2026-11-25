import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {boot} from "./mobile/boot"; export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui"; export {PuzzleBoard} from "./mobile/puzzle-board"; export {createFittedPuzzle} from "./lib/puzzle-engine";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {boot,GameApp,Stage,PuzzleBoard,createFittedPuzzle}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function platform(){
 const frames=new Map(),events=Object.fromEntries(['input','resize','hide','show'].map(name=>[name,new Set()]));let serial=0;
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>(target[name]=value,true)});
 const createCanvas=()=>({width:1,height:1,style:{},getContext:()=>ctx}),listen=name=>fn=>(events[name].add(fn),()=>events[name].delete(fn));
 return{ctx,commands,frames,events,canvas:createCanvas(),createCanvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload?.());}}),config:{id:'web',apiBase:'https://example.test',assetBase:'https://example.test',gameName:'测试'},viewport:()=>({width:900,height:600,dpr:1,top:0,bottom:0}),storage:{get:()=>null,set(){},remove(){}},frame:fn=>(frames.set(++serial,fn),serial),cancelFrame:id=>frames.delete(id),onInput:listen('input'),onResize:listen('resize'),onHide:listen('hide'),onShow:listen('show'),alert:message=>assert.fail(message),emit(name,value){for(const fn of [...events[name]])fn(value);},step(){const pending=[...frames];for(const [id,fn] of pending)if(frames.delete(id))fn(Date.now());}};
}
function fixture(t){
 // Exercise the real boot/stage/board while removing network startup and the
 // unrelated scene graph. Each test still drives the actual input and RAF APIs.
 const oldStart=GameApp.prototype.start,oldDraw=GameApp.prototype.draw;
 GameApp.prototype.start=async()=>{};GameApp.prototype.draw=()=>{};
 const p=platform(),runtime=boot(p);runtime.app.route='room';
 t.after(()=>{runtime.destroy();GameApp.prototype.start=oldStart;GameApp.prototype.draw=oldDraw;});
 return{p,runtime};
}
function room(t){
 const f=fixture(t),state=createFittedPuzzle('test',4,3,91),board=new PuzzleBoard(f.p,state,()=>f.runtime.stage.invalidate());board.setRect({x:0,y:0,w:900,h:600});
 f.runtime.app.draw=()=>board.draw(f.p.ctx);f.runtime.app.input=input=>board.input(input);
 t.after(()=>board.destroy());return{...f,state,board};
}
function piecePoint(board,group){const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=group.pieces[0];return{id:1,x:board.rect.x+board.camera.x+(board.board.x+(id%board.state.cols+.5)*w+group.dx)*board.camera.z,y:board.rect.y+board.camera.y+(board.board.y+(Math.floor(id/board.state.cols)+.5)*h+group.dy)*board.camera.z};}
const cursor=(x,y,updatedAt=Date.now())=>({playerId:'friend',x,y,name:'朋友',color:'#789',updatedAt});

test('idle rooms paint once, dirty events repaint once, and hidden boot stops scheduling',t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});const {p,runtime}=fixture(t);let completed=0,destroyed=0;
 const end=runtime.stage.endFrame.bind(runtime.stage),destroy=runtime.stage.destroy.bind(runtime.stage);
 runtime.stage.endFrame=()=>{completed++;end();};runtime.stage.destroy=()=>{destroyed++;destroy();};
 p.step();const baseline=runtime.diagnostics().drawCount;
 for(let i=0;i<600;i++){t.mock.timers.tick(16);p.step();}
 assert.equal(baseline,1);assert.equal(runtime.diagnostics().drawCount,1,'600 idle RAF ticks must not repaint an open room');
 runtime.stage.invalidate();p.step();p.step();assert.equal(runtime.diagnostics().drawCount,2);assert.equal(completed,2);
 p.emit('resize');p.step();assert.equal(runtime.diagnostics().drawCount,3);
 p.emit('hide');assert.equal(p.frames.size,0);runtime.stage.invalidate();p.step();assert.equal(runtime.diagnostics().drawCount,3);
 p.emit('show',{});p.emit('show',{});assert.equal(p.frames.size,1,'repeated show events cannot fork the render loop');p.step();assert.equal(runtime.diagnostics().drawCount,4);
 runtime.destroy();assert.equal(p.frames.size,0);assert.equal(destroyed,1);assert.ok(Object.values(p.events).every(listeners=>listeners.size===0));
 t.diagnostic('Canvas draw count: initial + 600 idle RAF ticks = 1; dirty = +1; resize = +1; hide = +0; show = +1.');
});

test('cursor interpolation requests continuing paints, settles exactly, and retains the last cursor',t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});const {p,runtime,board}=room(t);board.setCursors([cursor(10,20)]);p.step();
 const initial=runtime.diagnostics().drawCount;board.setCursors([cursor(110,220)]);assert.equal(p.frames.size,2,'boot and one feedback loop only');
 for(let i=0;i<70;i++){t.mock.timers.tick(16);p.step();}
 const settled=runtime.diagnostics().drawCount;assert.ok(settled>initial+10,'the cursor keeps painting while interpolating');assert.equal(p.frames.size,1,'feedback RAF stops when the cursor reaches its target');
 const position=board.cursors.get('friend');assert.equal(position.x,110);assert.equal(position.y,220);
 for(let i=0;i<300;i++){t.mock.timers.tick(16);p.step();}assert.equal(runtime.diagnostics().drawCount,settled);assert.equal(board.cursors.size,1,'idle time cannot hide another player');
 board.setCursors([]);p.step();assert.equal(board.cursors.size,0);assert.equal(runtime.diagnostics().drawCount,settled+1,'authoritative departure still repaints');
 t.diagnostic(`Cursor: ${settled-initial} paints to settle; 300 subsequent idle RAF ticks = 0 paints.`);
});

test('snap effects animate through their final clearing frame and do not replay after hide',t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});const {p,runtime,board,state}=room(t);p.step();const before=runtime.diagnostics().drawCount;
 const next=structuredClone(state);Object.assign(next.groups[0],{locked:true,dx:0,dy:0});board.syncRemote(next,{},new Set([0]));board.confirmMobileContribution({requestId:'once',groupId:0,creditedXp:2});
 for(let i=0;i<60;i++){t.mock.timers.tick(16);p.step();}
 const settled=runtime.diagnostics().drawCount;assert.ok(settled>before+10);assert.equal(board.flashes.length,0);assert.equal(p.frames.size,1);assert.equal(runtime.stage.dirty,false,'the expired effect is cleared on canvas before sleeping');
 for(let i=0;i<60;i++){t.mock.timers.tick(16);p.step();}assert.equal(runtime.diagnostics().drawCount,settled);
 board.confirmMobileContribution({requestId:'hidden-soon',groupId:0,creditedXp:1});assert.equal(board.flashes.length,1);p.emit('hide');assert.equal(board.flashes.length,0);assert.equal(p.frames.size,0);t.mock.timers.tick(5000);p.emit('show',{});p.step();board.confirmMobileContribution({requestId:'hidden-soon',groupId:0,creditedXp:1});assert.equal(board.flashes.length,0,'already acknowledged feedback is never replayed');
});

test('hiding suspends cursor animation; showing resumes to the newest retained target',t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});const {p,runtime,board}=room(t);board.setCursors([cursor(10,20)]);p.step();board.setCursors([cursor(110,220)]);t.mock.timers.tick(16);p.step();p.emit('hide');
 const before=runtime.diagnostics().drawCount;board.setCursors([cursor(310,420)]);assert.equal(p.frames.size,0,'updates received while hidden do not restart feedback');t.mock.timers.tick(5000);p.step();assert.equal(runtime.diagnostics().drawCount,before);
 p.emit('show',{});for(let i=0;i<80;i++){t.mock.timers.tick(16);p.step();}assert.equal(board.cursors.get('friend').x,310);assert.equal(board.cursors.get('friend').y,420);assert.equal(p.frames.size,1);
});

test('drag, release, pan and zoom all invalidate without continuous room repainting',async t=>{
 // Preparation now deliberately yields through real timers. This test only
 // advances animation time; hint/underlay timer behavior is covered below.
 t.mock.timers.enable({apis:['Date'],now:10000});const {p,runtime,board,state}=room(t);await board.setImage('test.webp');board.networkReady=true;
 const calls=[];board.network={canAcquire:()=>true,acquire:async id=>(calls.push(['acquire',id]),true),move:(...args)=>calls.push(['move',...args]),drop:async(...args)=>calls.push(['drop',...args]),release:id=>calls.push(['release',id])};
 p.step();const before=runtime.diagnostics().drawCount,point=piecePoint(board,state.groups.at(-1)),moved={...point,x:point.x+12,y:point.y+15};
 const input=value=>{p.emit('input',value);p.step();};input({type:'down',points:[point],changed:[point]});await Promise.resolve();input({type:'move',points:[moved],changed:[moved]});input({type:'up',points:[],changed:[moved]});
 assert.equal(runtime.diagnostics().drawCount,before+3);assert.deepEqual(calls.map(call=>call[0]),['acquire','move','drop']);
 const panStart={id:2,x:500,y:300},panEnd={...panStart,x:520,y:315},camera={...board.camera};input({type:'down',points:[panStart],changed:[panStart],pan:true});input({type:'move',points:[panEnd],changed:[panEnd],pan:true});input({type:'up',points:[],changed:[panEnd],pan:true});assert.ok(Math.abs(board.camera.x-camera.x-20)<1e-8);assert.ok(Math.abs(board.camera.y-camera.y-15)<1e-8);
 const z=board.camera.z;input({type:'wheel',points:[],changed:[panStart],deltaY:-20});assert.ok(board.camera.z>z);const settled=runtime.diagnostics().drawCount;
 for(let i=0;i<60;i++){t.mock.timers.tick(16);p.step();}assert.equal(runtime.diagnostics().drawCount,settled);
});

test('hint and underlay expiry each paint once at expiration without a permanent animation loop',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const {p,runtime,board}=room(t);p.step();board.setHints([0],10100);board.setUnderlay(10200);p.step();const active=runtime.diagnostics().drawCount;assert.equal(board.underlay,true);assert.equal(p.frames.size,1);
 t.mock.timers.tick(101);p.step();assert.equal(runtime.diagnostics().drawCount,active+1);assert.equal(board.underlay,true);
 t.mock.timers.tick(100);p.step();assert.equal(runtime.diagnostics().drawCount,active+2);assert.equal(board.underlay,false);assert.equal(p.frames.size,1);
 t.mock.timers.tick(10000);p.step();assert.equal(runtime.diagnostics().drawCount,active+2);
});
