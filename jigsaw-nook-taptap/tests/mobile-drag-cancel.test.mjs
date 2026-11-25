import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PuzzleBoard } from '../mobile/puzzle-board.ts';
import { createFittedPuzzle } from '../lib/puzzle-engine.ts';

// Story ch1-1 「拼完不跳转」: drags that the WebView ended with pointercancel were only released, so in
// solo-local play the pieces stayed drawn on their spots while the room never placed them (0 / 12).
function platform(){
 const ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx});
 return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
async function setup(){
 const state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(platform(),state,()=>{}),events=[];board.setRect({x:10,y:80,w:390,h:600});await board.setImage('test.png');board.networkReady=true;
 board.network={canAcquire:()=>true,acquire:async id=>(events.push(['acquire',id]),true),move(){},drop:async(...args)=>{events.push(['drop',...args]);},release:id=>events.push(['release',id])};
 return {state,board,events};
}
function screen(board,group,dx=group.dx,dy=group.dy){const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=group.pieces[0];return{id:1,x:board.rect.x+board.camera.x+(board.board.x+(id%board.state.cols+.5)*w+dx)*board.camera.z,y:board.rect.y+board.camera.y+(board.board.y+(Math.floor(id/board.state.cols)+.5)*h+dy)*board.camera.z};}

test('a moved piece whose touch is cancelled is dropped where it lies, not released',async()=>{
 const {state,board,events}=await setup(),group=state.groups[5],start=screen(board,group),home=screen(board,group,0,0);
 board.input({type:'down',points:[start],changed:[start]});await Promise.resolve();
 board.input({type:'move',points:[home],changed:[home]});board.input({type:'cancel',points:[],changed:[home]});
 await Promise.resolve();
 assert.deepEqual(events.filter(e=>e[0]!=='acquire'),[['drop',group.id,0,0]]);
 board.destroy();
});

test('an unmoved held piece is only released on cancel; app cancels (modal, pinch) also drop moved pieces',async()=>{
 const {state,board,events}=await setup(),group=state.groups[2],start=screen(board,group);
 board.input({type:'down',points:[start],changed:[start]});await Promise.resolve();board.input({type:'cancel',points:[],changed:[]});
 assert.deepEqual(events.at(-1),['release',group.id]);
 const other=state.groups[7],from=screen(board,other),to={...from,x:from.x+40,y:from.y+30};
 board.input({type:'down',points:[from],changed:[from]});await Promise.resolve();board.input({type:'move',points:[to],changed:[to]});
 board.fit();await Promise.resolve();
 assert.equal(events.at(-1)[0],'drop');assert.equal(events.at(-1)[1],other.id);
 board.destroy();
});

test('loose groups left on their spots are dropped there again, all of them, at most twice each',async()=>{
 const {state,board,events}=await setup();for(const g of state.groups.slice(0,3)){g.dx=0;g.dy=0;}
 // A room reply after the first drop redraws the others from its own state; they are still settled.
 board.network.drop=async(...args)=>{events.push(['drop',...args]);for(const g of state.groups.slice(1,3)){g.dx=500;g.dy=500;}};
 board.queueStrandedCheck(0);await delay(30);
 assert.deepEqual(events.filter(e=>e[0]==='drop').map(e=>e.slice(1)),state.groups.slice(0,3).map(g=>[g.id,0,0]));
 events.length=0;for(const g of state.groups.slice(0,3)){g.dx=0;g.dy=0;}
 board.queueStrandedCheck(0);await delay(30);board.queueStrandedCheck(0);await delay(30);
 assert.equal(events.filter(e=>e[0]==='drop').length,3,'one more try each, then it stops');
 board.destroy();
});
