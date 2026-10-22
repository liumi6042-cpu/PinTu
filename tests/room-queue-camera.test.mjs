import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

function boardFixture(){
 const context=new Proxy({isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const canvas=()=>({width:1,height:1,getContext:()=>context});
 const platform={createCanvas:canvas,onHide:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'web'}};
 const state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(platform,state,()=>{});
 board.setRect({x:125,y:80,w:1100,h:720});
 const group=state.groups.at(-1);
 for(const other of state.groups)other.locked=other!==group;
 const width=board.board.width/state.cols,height=board.board.height/state.rows,id=group.pieces[0];
 const center={x:board.board.x+(id%state.cols+.5)*width+group.dx,y:board.board.y+(Math.floor(id/state.cols)+.5)*height+group.dy};
 board.camera={x:550-center.x,y:350-center.y,z:1};
 board.ready=true;board.networkReady=true;
 return{board,state,group,center};
}

test('a full drag queue preserves submitted drops while empty-board pan and pinch remain available',async()=>{
 const {board,state,group,center}=boardFixture(),calls=[];
 let queueFull=false,confirmDrop;
 const confirmation=new Promise(resolve=>{confirmDrop=resolve;});
 board.network={
  canAcquire:()=>!queueFull,
  acquire:async id=>(calls.push(['claim',id]),true),
  move:(...args)=>calls.push(['move',...args]),
  drop:(...args)=>(calls.push(['drop',...args]),confirmation),
  release:id=>calls.push(['release',id]),
 };
 try{
  const start={id:1,...board.worldToScreen(center)},end={...start,x:start.x+30,y:start.y+20};
  board.input({type:'down',points:[start],changed:[start]});
  board.input({type:'move',points:[end],changed:[end]});
  board.input({type:'up',points:[],changed:[end]});
  assert.deepEqual(calls.map(call=>call[0]),['claim','move','drop']);
  const submitted=calls.at(-1),before=structuredClone(state),pending=[...board.pendingDrops],serial=board.serial;
  assert.deepEqual(submitted.slice(1),[group.id,group.dx,group.dy]);
  assert.equal(pending.length,1,'the accepted drop is still awaiting server confirmation');

  queueFull=true;
  const denied={...end,id:2},deniedMove={...denied,x:denied.x+90,y:denied.y+55};
  board.input({type:'down',points:[denied],changed:[denied]});
  assert.equal(board.drag,null,'a full queue cannot start another optimistic piece drag');
  board.input({type:'move',points:[deniedMove],changed:[deniedMove]});
  board.input({type:'up',points:[],changed:[deniedMove]});
  assert.equal(board.serial,serial,'a refused gesture cannot replace the accepted drop serial');
  assert.deepEqual([...board.pendingDrops],pending);
  assert.deepEqual(state,before,'a refused gesture cannot move the submitted piece');
  assert.deepEqual(calls.map(call=>call[0]),['claim','move','drop'],'the accepted drop cannot be canceled or replaced');

  const empty={id:3,x:board.rect.x+30,y:board.rect.y+30},panned={...empty,x:empty.x+60,y:empty.y+35},camera={...board.camera};
  board.input({type:'down',points:[empty],changed:[empty]});
  board.input({type:'move',points:[panned],changed:[panned]});
  board.input({type:'up',points:[],changed:[panned]});
  assert.equal(board.camera.x,camera.x+60);assert.equal(board.camera.y,camera.y+35);
  assert.equal(board.camera.z,camera.z);

  const first={id:4,x:board.rect.x+40,y:board.rect.y+40},second={id:5,x:first.x+80,y:first.y+30},spread={...second,x:second.x+80,y:second.y+40},zoom=board.camera.z;
  board.input({type:'down',points:[first],changed:[first]});
  board.input({type:'down',points:[first,second],changed:[second]});
  board.input({type:'move',points:[first,spread],changed:[spread]});
  assert.ok(board.camera.z>zoom,'a full queue must not block two-finger zoom');
  board.input({type:'up',points:[],changed:[first,spread]});
  assert.deepEqual(state,before,'camera gestures cannot change the submitted final position');
  assert.deepEqual([...board.pendingDrops],pending);
  assert.deepEqual(calls.map(call=>call[0]),['claim','move','drop']);

  confirmDrop();await confirmation;await Promise.resolve();await Promise.resolve();
  assert.equal(board.pendingDrops.size,0,'the original confirmation still clears its own pending drop');
 }finally{confirmDrop();board.destroy();}
});
