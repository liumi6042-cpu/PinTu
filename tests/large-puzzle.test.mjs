import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle, LEVELS, snapTolerance, moveGroup, dropGroup, restorePuzzle, boardFor } from '../lib/puzzle-engine.ts';
import { makeRoom, addMember, applyAction } from '../lib/room-engine.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';

test('supported grids stop at exactly 5000 and the save fits in a local database row',()=>{
  assert.equal(Math.max(...LEVELS.map(l=>l.count)),5000);
  for(const level of LEVELS)assert.equal(level.cols*level.rows,level.count);
  assert.throws(()=>createPuzzle('seaside',100,60));assert.throws(()=>makeRoom('unsupported','seaside',6000,Date.now()));
  const state=createPuzzle('seaside',100,50,31);
  const saved=JSON.stringify(state);assert.ok(Buffer.byteLength(saved)<900_000);
  assert.deepEqual(restorePuzzle(saved,['seaside']),state);
});

test('slightly imperfect placement snaps in both singleplayer and multiplayer at every difficulty',()=>{
  for(const level of LEVELS){
    const state=createPuzzle('seaside',level.cols,level.rows,34),near=Math.min(800/level.cols,600/level.rows)*.22;
    assert.ok(near>Math.min(800/level.cols,600/level.rows)*.18);
    moveGroup(state,0,near,0);assert.ok(dropGroup(state,0,snapTolerance(state)).placed>=1);
    const room=makeRoom('snap','seaside',level.count,1000),member=addMember(room,'a','玩家','digest',1000);
    applyAction(room,member,{type:'claim',groupId:0},1001);
    applyAction(room,member,{type:'drop',groupId:0,dx:near,dy:0,seq:1},1002);
    assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));
  }
});

test('the increased snap radius joins nearby correct neighbors and still rejects distant positions',()=>{
  const state=createPuzzle('seaside',100,50,9),tolerance=snapTolerance(state);
  state.groups.forEach(g=>{g.dx=4000;g.dy=4000;});
  moveGroup(state,0,150,150);moveGroup(state,1,150+tolerance*.9,150);
  assert.equal(dropGroup(state,0,tolerance).joined,1);
  moveGroup(state,0,tolerance*1.2,0);assert.equal(dropGroup(state,0,tolerance).snapped,false);
});

function fakeCanvas(){
  const stats={images:[],clips:0,hits:0};
  const context=new Proxy({drawImage(image){stats.images.push(image);},clip(){stats.clips++;},isPointInPath(){stats.hits++;return true;}},{get(target,key){return key in target?target[key]:()=>{};}});
  return {stats,context,width:1500,height:1100,style:{},getContext:()=>context,addEventListener(){},focus(){},setPointerCapture(){}};
}
test('5000 piece dragging reuses the stationary scene, culls offscreen pieces and limits exact hit tests',()=>{
  const original={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  globalThis.document={createElement:()=>fakeCanvas(),addEventListener(){}};globalThis.Path2D=class{};
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  let table;
  try{
    const state=createPuzzle('seaside',100,50,2),canvas=fakeCanvas(),board=boardFor(100,50);
    table=new PuzzleTable(canvas,state,{naturalWidth:8000,naturalHeight:6000},()=>{},()=>{});
    assert.equal(table.picture.width,8000);assert.equal(table.picture.height,4000,'native image detail must survive the 2:1 crop');
    table.width=1500;table.height=1100;table.camera={x:0,y:0,z:1};
    const group=state.groups[0];moveGroup(state,group.id,0,0);table.drag={id:group.id,x:0,y:0,dx:0,dy:0};
    assert.ok(table.sprites.canvas.width*table.sprites.canvas.height<8_300_000);
    table.render();const backgroundDraws=table.background.stats.images.length;assert.ok(backgroundDraws>4000);
    canvas.stats.images=[];moveGroup(state,group.id,1,1);table.render();
    assert.equal(table.background.stats.images.length,backgroundDraws,'a pointer move repainted all stationary pieces');
    assert.equal(canvas.stats.images.length,2,'a drag frame should draw the cached scene and the held tile');
    table.drag=null;table.camera={x:-board.x*12,y:-board.y*12,z:12};canvas.stats.images=[];table.render();
    assert.ok(canvas.stats.images.length<200,'zoomed rendering still drew thousands of invisible tiles');
    assert.ok(canvas.stats.images.length>0);assert.ok(canvas.stats.images.every(image=>image===table.picture),'zoomed pieces must sample native pixels instead of magnifying the atlas');
    assert.equal(table.groupAt(-10000,-10000),undefined);
    const hitContext=table.hit;let exactHits=0;hitContext.isPointInPath=()=>{exactHits++;return true;};
    table.groupAt(-10000,-10000);assert.equal(exactHits,0);
    assert.equal(table.groupAt(board.x+5,board.y+5)?.id,0);assert.ok(exactHits<10);
    table.zoom(100);assert.equal(table.camera.z,12);
  }finally{table?.destroy();Object.assign(globalThis,original);}
});
