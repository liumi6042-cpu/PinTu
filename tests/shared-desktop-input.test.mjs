import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createWebPlatform} from '../mobile/platform-web.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

function boardFixture(){
 const context=new Proxy({isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const canvas=()=>({width:1,height:1,getContext:()=>context}),platform={createCanvas:canvas,onHide:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'web'}};
 const state=createFittedPuzzle('test',25,20,123),board=new PuzzleBoard(platform,state,()=>{});
 board.setRect({x:125,y:80,w:1100,h:720});board.camera={x:240,y:180,z:.8};
 return {board,state};
}
const nearly=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≈ ${expected}`);

test('desktop wheel preserves the world position beneath its pointer and leaves puzzle state unchanged',()=>{
 const {board,state}=boardFixture(),point={id:-1,x:645,y:420},before=structuredClone(state),anchor=board.screenToWorld(point),zoom=board.camera.z;
 assert.equal(board.input({type:'wheel',points:[],changed:[point],deltaY:-120}),true);
 assert.ok(board.camera.z>zoom);nearly(board.screenToWorld(point).x,anchor.x);nearly(board.screenToWorld(point).y,anchor.y);
 board.input({type:'wheel',points:[],changed:[point],deltaY:120});nearly(board.camera.z,zoom);
 const camera={...board.camera};assert.equal(board.input({type:'wheel',points:[],changed:[{...point,x:5}],deltaY:120}),false);assert.deepEqual(board.camera,camera);
 assert.deepEqual(state,before);board.destroy();
});

test('explicit desktop panning never acquires a piece; Escape cancels movement and wheel cannot shift an active drag',()=>{
 const {board,state}=boardFixture(),calls=[],group=state.groups.at(-1);board.ready=true;board.networkReady=true;
 board.network={acquire:async id=>(calls.push(['acquire',id]),true),move:(...args)=>calls.push(['move',...args]),drop:async(...args)=>calls.push(['drop',...args]),release:id=>calls.push(['release',id])};
 const w=board.board.width/state.cols,h=board.board.height/state.rows,id=group.pieces[0],world={x:board.board.x+(id%state.cols+.5)*w+group.dx,y:board.board.y+(Math.floor(id/state.cols)+.5)*h+group.dy};
 board.camera={x:550-world.x,y:350-world.y,z:1};const start={id:1,...board.worldToScreen(world)},moved={...start,x:start.x+70,y:start.y+45},camera={...board.camera},before=structuredClone(state);
 board.input({type:'down',points:[start],changed:[start],pan:true});board.input({type:'move',points:[moved],changed:[moved],pan:true});
 assert.deepEqual(calls,[]);nearly(board.camera.x,camera.x+70);nearly(board.camera.y,camera.y+45);assert.deepEqual(state,before);
 const panned={...board.camera};board.input({type:'wheel',points:[],changed:[start],deltaY:-100});assert.deepEqual(board.camera,panned);
 assert.equal(board.input({type:'key',points:[],changed:[],key:'Escape',keyDown:true}),true);
 board.input({type:'move',points:[start],changed:[start],pan:true});assert.deepEqual(board.camera,panned);board.input({type:'up',points:[],changed:[start],pan:true});assert.deepEqual(calls,[]);
 // An ordinary left-button gesture still uses the room's authoritative lease.
 const piece={id:2,...board.worldToScreen(world)};board.input({type:'down',points:[piece],changed:[piece]});assert.equal(calls[0][0],'acquire');
 board.input({type:'key',points:[],changed:[],key:'Escape',keyDown:true});assert.equal(calls.at(-1)[0],'release');assert.ok(!calls.some(call=>call[0]==='drop'));board.destroy();
});

function browserFixture(t){
 const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget(),attrs=new Map(),captured=new Set();
 Object.assign(document,{baseURI:'https://game.example/preview/',body:{},hidden:false});document.activeElement=document.body;
 Object.assign(canvas,{style:{touchAction:'auto'},getAttribute:name=>attrs.get(name)??null,setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),getBoundingClientRect:()=>({left:20,top:30,width:1000,height:650}),focus(){document.activeElement=canvas;},setPointerCapture:id=>captured.add(id),releasePointerCapture:id=>captured.delete(id)});
 Object.defineProperty(canvas,'tabIndex',{get:()=>Number(attrs.get('tabindex')??-1),set:value=>attrs.set('tabindex',String(value))});
 const restore=[];
 for(const [name,value]of Object.entries({window,document,location:{href:'https://game.example/preview/'}})){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});restore.push(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 }
 const events=[],platform=createWebPlatform({id:'web',apiBase:'/api-game',assetBase:'/assets',gameName:'test'},canvas),stop=platform.onInput(event=>events.push(event));t.after(()=>{stop();restore.forEach(fn=>fn());});
 const dispatch=(target,type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,values);target.dispatchEvent(event);return event;};
 const pointer=(type,values={})=>dispatch(canvas,type,{pointerId:1,pointerType:'mouse',button:0,clientX:220,clientY:330,...values});
 const key=(type,values={})=>dispatch(window,type,{key:' ',code:'Space',repeat:false,ctrlKey:false,metaKey:false,altKey:false,...values});
 return {window,document,canvas,events,dispatch,pointer,key,stop,captured};
}

test('web adapter normalizes wheel distances, retains middle/Space pan gestures, and releases capture on blur',t=>{
 const b=browserFixture(t),wheel=b.dispatch(b.canvas,'wheel',{clientX:220,clientY:330,deltaX:2,deltaY:3,deltaMode:1});
 assert.equal(wheel.defaultPrevented,true);assert.deepEqual(b.events.at(-1),{type:'wheel',points:[],changed:[{id:-1,x:200,y:300}],deltaX:32,deltaY:48});
 b.pointer('pointerdown',{button:1});assert.equal(b.events.at(-1).pan,true);b.pointer('pointermove');assert.equal(b.events.at(-1).pan,true);b.pointer('pointerup',{button:1});assert.equal(b.events.at(-1).pan,true);
 b.key('keydown');b.pointer('pointerdown');assert.equal(b.events.at(-1).pan,true);b.key('keyup');b.pointer('pointermove');assert.equal(b.events.at(-1).pan,true,'release Space does not turn a pan into a piece drag');
 b.dispatch(b.window,'blur');assert.equal(b.events.at(-1).type,'cancel');assert.equal(b.captured.size,0);
 b.pointer('pointerdown');assert.equal(b.events.at(-1).pan,undefined,'blur resets keyboard state');b.pointer('pointerup');
 const count=b.events.length;b.pointer('pointerdown',{button:2});assert.equal(b.events.length,count,'right click stays available to the browser');
 b.stop();assert.equal(b.canvas.style.touchAction,'auto');assert.equal(b.canvas.getAttribute('tabindex'),null);
});

test('web keyboard shortcuts leave text entry and other focused browser controls alone',t=>{
 const b=browserFixture(t);b.document.activeElement={tagName:'TEXTAREA'};
 const blocked=b.key('keydown',{key:'Escape',code:'Escape'});assert.equal(blocked.defaultPrevented,false);assert.equal(b.events.length,0);
 b.key('keydown');b.document.activeElement=b.canvas;b.pointer('pointerdown');assert.equal(b.events.at(-1).pan,undefined);b.pointer('pointerup');
 const escape=b.key('keydown',{key:'Escape',code:'Escape'});assert.equal(escape.defaultPrevented,true);assert.deepEqual(b.events.at(-1),{type:'key',points:[],changed:[],key:'Escape',keyDown:true,repeat:false});
});

test('lost touch capture cancels all held touches and a fresh drag has no stale pinch points',t=>{
 const b=browserFixture(t);b.pointer('pointerdown',{pointerType:'touch',pointerId:7});b.pointer('pointerdown',{pointerType:'touch',pointerId:8});
 b.pointer('lostpointercapture',{pointerId:7,pointerType:'touch'});
 assert.equal(b.events.at(-1).type,'cancel');assert.equal(b.events.at(-1).changed.length,2);assert.equal(b.captured.size,0);
 b.pointer('pointerdown',{pointerType:'touch',pointerId:9});assert.deepEqual(b.events.at(-1).points.map(p=>p.id),[9]);
 b.pointer('pointerup',{pointerType:'touch',pointerId:9});const count=b.events.length;
 b.pointer('lostpointercapture',{pointerId:9,pointerType:'touch'});assert.equal(b.events.length,count,'normal capture release cannot cancel the next gesture');
});

test('native touch diagnostic path forwards both fingers once and switching modes cancels held input',t=>{
 const b=browserFixture(t),platform=createWebPlatform({id:'taptap',apiBase:'/api-game',assetBase:'/assets',gameName:'test'},b.canvas),events=[];
 const stop=platform.onInput(input=>events.push(input));platform.setTouchInputMode(true);
 const a={identifier:4,clientX:70,clientY:100},c={identifier:5,clientX:170,clientY:200};
 b.dispatch(b.canvas,'touchstart',{changedTouches:[a],touches:[a]});b.dispatch(b.canvas,'touchstart',{changedTouches:[c],touches:[a,c]});
 assert.deepEqual(events.at(-1).points.map(p=>p.id),[-5,-6]);const count=events.length;
 b.pointer('pointerdown',{pointerType:'touch'});assert.equal(events.length,count,'the same finger must never feed both paths');
 const moved={...a,clientX:90};b.dispatch(b.canvas,'touchmove',{changedTouches:[moved],touches:[moved,c]});assert.equal(events.at(-1).points[0].x,70);
 b.dispatch(b.canvas,'touchend',{changedTouches:[c],touches:[moved]});assert.deepEqual(events.at(-1).points.map(p=>p.id),[-5]);
 platform.setTouchInputMode(false);assert.equal(events.at(-1).type,'cancel');assert.equal(platform.inputDiagnostics().touchMoves,1);
 b.pointer('pointerdown',{pointerType:'touch'});assert.deepEqual(events.at(-1).points.map(p=>p.id),[1]);stop();
});
