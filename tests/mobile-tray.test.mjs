import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleTable} from '../lib/puzzle-table.ts';

test('mobile tray focuses a loose piece without moving shared pieces or acquiring ownership',()=>{
 const state={cols:2,rows:2,groups:[{id:7,pieces:[0,1],dx:120,dy:80,locked:false}]};
 const before=JSON.stringify(state);let draws=0,updates=0;
 const table={mobileFeedback:true,paused:false,state,pieces:[{col:0,row:0}],board:{x:360,y:260,width:800,height:600},camera:{x:0,y:0,z:.2},width:390,height:720,selected:null,clamp:value=>value,draw:()=>draws++,update:()=>updates++,network:{acquire:()=>assert.fail('tray must not acquire a room piece')}};
 assert.equal(PuzzleTable.prototype.focusMobilePiece.call(table,0,210),true);
 assert.equal(JSON.stringify(state),before);
 assert.equal(table.selected,7);
 assert.equal(table.camera.x+(360+200+120)*table.camera.z,195);
 assert.equal(table.camera.y+(260+150+80)*table.camera.z,255);
 assert.equal(draws,1);assert.equal(updates,1);
});

test('tray cannot select a completed piece, act through a modal, or change the PC table',()=>{
 const table={mobileFeedback:true,paused:false,state:{groups:[{id:0,pieces:[0],locked:true}]},pieces:[{col:0,row:0}]};
 assert.equal(PuzzleTable.prototype.focusMobilePiece.call(table,0),false);
 table.paused=true;assert.equal(PuzzleTable.prototype.focusMobilePiece.call(table,0),false);
 table.mobileFeedback=false;table.paused=false;assert.equal(PuzzleTable.prototype.focusMobilePiece.call(table,0),false);
});

test('phone and landscape opening views keep 48–500 piece rooms touch-sized without rearranging them',async()=>{
 const {createFittedPuzzle,boardFor,piecesFor}=await import('../lib/puzzle-engine.ts');
 for(const [cols,rows] of [[8,6],[5,10],[12,9],[20,15],[25,20]])for(const [width,height] of [[390,736],[844,326]]){
  const state=createFittedPuzzle('camera-check',cols,rows,123),before=JSON.stringify(state);
  const table={mobileFeedback:true,state,pieces:piecesFor(cols,rows,state.seed),board:boardFor(cols,rows),camera:{x:0,y:0,z:.2},width,height,canvas:{dataset:{}},clamp:value=>Math.max(.15,Math.min(16,value)),draw:()=>{},update:()=>{}};
  PuzzleTable.prototype.openMobileView.call(table,{bottom:72});
  assert.equal(JSON.stringify(state),before,'shared state changed');
  const unit=Math.min(table.board.width/cols,table.board.height/rows);
  assert.ok(unit*table.camera.z>=43.99,'piece is not touch-sized');
  const visible=state.groups.filter(group=>{
   const piece=table.pieces[group.pieces[0]],x=table.camera.x+(table.board.x+(piece.col+.5)*unit+group.dx)*table.camera.z,y=table.camera.y+(table.board.y+(piece.row+.5)*unit+group.dy)*table.camera.z;
   return x>=0&&x<=width&&y>=0&&y<=height-72;
  }).length;
  assert.ok(visible>=6,'opening view has too few pieces: '+cols+'x'+rows+' '+width+'x'+height+' visible='+visible);
 }
});

