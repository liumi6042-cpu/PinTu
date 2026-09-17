import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleTable } from '../lib/puzzle-table.ts';
import { createPuzzle, boardFor, piecesFor } from '../lib/puzzle-engine.ts';

function fixture(cols=20,rows=15){
  globalThis.devicePixelRatio=2;globalThis.requestAnimationFrame=()=>1;
  const table=Object.create(PuzzleTable.prototype),state=createPuzzle('seaside',cols,rows,91),copies=[];
  const context={setTransform(){},clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(...args){copies.push(args);}};
  Object.assign(table,{canvas:{width:2560,height:1600},width:1280,height:800,ctx:context,state,board:boardFor(cols,rows),pieces:piecesFor(cols,rows,91),camera:{x:0,y:0,z:.7},background:{width:0,height:0,getContext:()=>context},backgroundDirty:true,backgroundDrag:null,previousDragRect:null,drag:{id:0},remoteOwners:{},theme:'beige',update(){},notice(){},raf:0});
  table.state.groups[0].dx=0;table.state.groups[0].dy=0;
  table.renderScene=()=>{table.scenes++;};table.renderGroup=()=>{table.groupsDrawn++;};table.scenes=0;table.groupsDrawn=0;
  return {table,copies};
}

test('dragging uses a bounded footprint from 108 through 5000 pieces',()=>{
  for(const [cols,rows] of [[12,9],[20,15],[50,40],[100,50]]){
    const {table,copies}=fixture(cols,rows);table.render();copies.length=0;
    for(let frame=0;frame<60;frame++){table.state.groups[0].dx+=1;table.render();}
    assert.equal(table.scenes,1,'stationary pieces are drawn only once');
    assert.equal(table.groupsDrawn,61);
    const copied=copies.reduce((sum,args)=>{assert.equal(args.length,9,'no whole-canvas copy while moving');assert.ok(args[1]>=0&&args[2]>=0&&args[1]+args[3]<=table.canvas.width&&args[2]+args[4]<=table.canvas.height);return sum+args[3]*args[4];},0);
    assert.ok(copied<60*table.canvas.width*table.canvas.height*.1);
  }
});

test('offscreen motion, camera/theme changes, and drop invalidate or restore the correct area',()=>{
  const {table,copies}=fixture();table.render();copies.length=0;
  table.state.groups[0].dx=-5000;table.render();assert.equal(table.previousDragRect,null);assert.equal(copies.length,1,'old footprint erased on leaving viewport');
  table.camera.z=3;table.draw();table.render();assert.equal(table.scenes,2);
  table.setTheme('dark');table.render();assert.equal(table.scenes,3);
  table.drag=null;table.render();assert.equal(table.scenes,4);assert.equal(table.previousDragRect,null);
  table.drag={id:1};table.render();assert.equal(table.scenes,5);
});

test('teammate updates refresh the background; local movement echoes do not disturb it',()=>{
  const {table}=fixture();table.render();
  const remote=structuredClone(table.state);remote.groups[1].dx+=50;
  table.syncRemote(remote,{},new Set());table.render();assert.equal(table.scenes,2);
  const echo=structuredClone(table.state);echo.groups[0].dx-=20;
  table.syncRemote(echo,{},new Set([0]));table.render(); // protected drag is raised once
  const scenes=table.scenes;table.syncRemote(echo,{},new Set([0]));table.render();
  assert.equal(table.scenes,scenes);assert.equal(table.state.groups.find(g=>g.id===0).dx,0);
});
