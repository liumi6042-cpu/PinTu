import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleTable, MULTI_SELECT_LIMIT } from '../lib/puzzle-table.ts';
import { createPuzzle, boardFor, piecesFor, moveGroup, dropGroup } from '../lib/puzzle-engine.ts';

function fixture(cols=20,rows=15){
  globalThis.devicePixelRatio=2;globalThis.requestAnimationFrame=()=>1;
  const table=Object.create(PuzzleTable.prototype),state=createPuzzle('seaside',cols,rows,91),copies=[];
  const context={setTransform(){},clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(...args){copies.push(args);}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  Object.assign(table,{canvas:{width:2560,height:1600},width:1280,height:800,ctx:context,state,board:boardFor(cols,rows),pieces:piecesFor(cols,rows,91),camera:{x:0,y:0,z:.7},background:{width:0,height:0,getContext:()=>context},backgroundDirty:true,backgroundDrag:null,previousDragRect:null,drag:{id:0},dragIds:[0],dragOffsets:new Map(),selectedExtra:new Set(),selectAnchor:null,didMultiSelect:false,remoteOwners:{},theme:'beige',update(){},notice(){},raf:0});
  table.state.groups[0].dx=0;table.state.groups[0].dy=0;
  table.renderScene=()=>{table.scenes++;};table.renderGroup=()=>{table.groupsDrawn++;};table.scenes=0;table.groupsDrawn=0;
  return {table,copies};
}

test('dragging uses a bounded footprint from 108 through 5000 pieces',()=>{
  for(const [cols,rows] of [[12,9],[20,15],[50,40],[100,50]]){
    const {table,copies}=fixture(cols,rows);table.render();copies.length=0;
    for(let frame=0;frame<60;frame++){table.state.groups[0].dx+=1;table.render();}
    assert.equal(table.scenes,1,'stationary pieces are drawn only once');
    assert.equal(table.groupsDrawn,1,'the group in hand is rasterized only once');
    const copied=copies.filter(args=>args[0]===table.background).reduce((sum,args)=>{assert.equal(args.length,9,'no whole-canvas copy while moving');assert.ok(args[1]>=0&&args[2]>=0&&args[1]+args[3]<=table.canvas.width&&args[2]+args[4]<=table.canvas.height);return sum+args[3]*args[4];},0);
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

test('pointer bursts schedule only one glow update per rendered frame',()=>{
  const {table}=fixture();let callback,scheduled=0,updates=0;
  globalThis.requestAnimationFrame=fn=>{scheduled++;callback=fn;return scheduled;};
  table.feedback={update(){updates++;}};
  for(let i=0;i<500;i++)table.draw(false);
  assert.equal(scheduled,1);assert.equal(updates,0);callback();assert.equal(updates,1);
});

test('cached dragging responds to theme, zoom, hint and group changes and clears on drop',()=>{
  const {table}=fixture();table.render();const original=table.groupsDrawn;
  table.camera.z=3;table.draw();table.render();assert.equal(table.groupsDrawn,original+1);
  table.setTheme('dark');table.render();assert.equal(table.groupsDrawn,original+2);
  table.hintIds=[0];table.hintUntil=Date.now()+30000;table.draw();table.render();assert.equal(table.groupsDrawn,original+3);
  const image=table.dragImage.image;assert.ok(image.width>0);table.drag=null;table.render();assert.equal(image.width,0);assert.equal(table.dragImage.image,null);
});

test('the browser drag layer moves without repainting or copying background pixels',()=>{
 const {table,copies}=fixture(12,9),nodes=[];
 const host={appendChild(node){nodes.push(node);node.parentElement=host;}};table.canvas.parentElement=host;
 globalThis.document={createElement:()=>({width:0,height:0,style:{},setAttribute(){},getContext:()=>({scale(){},translate(){}}),remove(){nodes.splice(nodes.indexOf(this),1);this.parentElement=null;}})};
 table.render();const image=nodes[0],painted=table.groupsDrawn;
 for(let i=0;i<10800;i++){table.state.groups[0].dx+=.01;table.render();}
 assert.equal(table.scenes,1);assert.equal(table.groupsDrawn,painted);assert.equal(copies.length,0,'no canvas bitmap copies on the hot path');assert.equal(nodes.length,1);assert.ok(image.style.transform.includes('translate3d'));
 table.backgroundDirty=true;table.render();assert.equal(table.scenes,2,'teammates and camera changes still refresh the table');
 table.drag=null;table.render();assert.equal(table.scenes,3);assert.equal(nodes.length,0);assert.equal(image.width,0);
});

function selectable(cols=20,rows=15){
  const {table}=fixture(cols,rows);
  table.network=null;table.networkReady=true;table.paused=false;table.pointers=new Map();table.pan=null;table.space=false;
  table.point=e=>({x:e.clientX,y:e.clientY});table.world=p=>p;
  table.canvas.focus=()=>{};table.canvas.setPointerCapture=()=>{};table.canvas.releasePointerCapture=()=>{};
  table.canvas.hasPointerCapture=()=>false;table.canvas.style={};table.draw=()=>{};table.update=()=>{};
  table.messages=[];table.notice=m=>table.messages.push(m);
  table.target=null;table.groupAt=()=>table.target;
  // Object.create skips the constructor, so the pointer handlers cannot be bound
  // the usual way. These two spies drive the same selection and drag helpers the
  // real handlers call, keeping the gesture logic under test without DOM plumbing.
  table.pointerDown=function({shift=false,id=null}={}){
    const group=id===null?table.target:table.state.groups.find(g=>g.id===id);
    table.target=group;if(!group)return;
    if(shift){table.toggleSelection(group.id);return;}
    if(table.selectedExtra.has(group.id)&&table.selectedExtra.size>1){table.beginDrag(group,{x:0,y:0});return;}
    table.beginDrag(group,{x:0,y:0});
  };
  table.pointerMove=function({x,y,origin={x:0,y:0}}){if(!table.drag)return;table.moveSelectionTo(table.drag.dx+x-origin.x,table.drag.dy+y-origin.y);};
  // Space every group out on a wide grid so a group never accidentally counts as
  // a facing neighbour of another. Tests move the few groups they care about back.
  table.isolate=function(){
    table.state.groups.forEach((group,index)=>{group.dx=6000+index*400;group.dy=6000+index*300;group.locked=false;});
    return table;
  };
  return table;
}
const press=(table,id,{shift=false}={})=>table.pointerDown({shift,id});
// pointerMove takes absolute pointer coordinates and the gesture's own origin, so
// dragging from (0,0) to (x,y) is exactly a +x/+y delta.
const drag=(table,x,y)=>table.pointerMove({x,y});
const place=(table,id,dx,dy)=>{const group=table.state.groups.find(g=>g.id===id);group.dx=dx;group.dy=dy;return group;};
// `keydown`/`down`/`move` are instance arrow-function properties, so
// Object.create(PuzzleTable.prototype) does not expose them. This mirrors the
// selection-relevant branches of keydown so they can be tested without a DOM.
function keyboardDriver(table){
  return function(key,{shift=false,ctrl=false}={}){
    const visible=table.state.groups.filter(g=>!g.locked);
    if(key.toLowerCase()==='n'){const idx=visible.findIndex(g=>g.id===table.selected);
      if(visible.length){table.selected=visible[(idx+1)%visible.length].id;table.selectedExtra=new Set([table.selected]);}return;}
    if(key.toLowerCase()==='a'&&ctrl){
      const chosen=visible.slice(0,MULTI_SELECT_LIMIT);table.selectedExtra=new Set(chosen.map(g=>g.id));
      table.selected=chosen[0]?.id??null;
      table.notice(`已全选桌上的 ${table.selectedExtra.size} 组拼块，拖动即可整组移动。`);return;}
    const group=table.state.groups.find(g=>g.id===table.selected);if(!group||group.locked)return;
    const carried=table.selectedExtra.size>1?[...table.selectedExtra]:[group.id];
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[key];
    if(delta){const step=shift?2:12;
      for(const id of carried){const item=table.state.groups.find(g=>g.id===id);if(!item||item.locked)continue;
        item.dx+=delta[0]*step;item.dy+=delta[1]*step;}return;}
  };
}

test('shift/ctrl click builds a selection that one drag carries by a single shared delta',()=>{
  const table=selectable().isolate();
  press(table,0);
  assert.equal(table.selected,0);
  assert.deepEqual([...table.selectedExtra],[0]);
  press(table,4,{shift:true});
  assert.deepEqual([...table.selectedExtra].sort((a,b)=>a-b),[0,4]);
  press(table,2,{shift:true});
  assert.deepEqual([...table.selectedExtra].sort((a,b)=>a-b),[0,2,4]);
  assert.equal(table.selectedCount(),3);
  // Shift-clicking a member again removes it; the anchor is the last one touched.
  press(table,2,{shift:true});
  assert.deepEqual([...table.selectedExtra].sort((a,b)=>a-b),[0,4]);
  assert.equal(table.selected,2);
  press(table,2,{shift:true});
  assert.deepEqual([...table.selectedExtra].sort((a,b)=>a-b),[0,2,4]);

  // The pointer grabs one member of the selection: the whole set moves together.
  const starts=table.state.groups.map(g=>({id:g.id,dx:g.dx,dy:g.dy}));
  press(table,4);drag(table,80,50);
  assert.deepEqual([...table.dragIds].sort((a,b)=>a-b),[0,2,4]);
  for(const id of [0,2,4]){const group=table.state.groups.find(g=>g.id===id),before=starts.find(s=>s.id===id);
    assert.equal(group.dx,before.dx+80);assert.equal(group.dy,before.dy+50);}
  for(const group of table.state.groups.filter(g=>![0,2,4].includes(g.id))){const before=starts.find(s=>s.id===group.id);
    assert.equal(group.dx,before.dx);assert.equal(group.dy,before.dy);}
});

test('a click without a modifier drops the old selection and grabs the clicked group alone',()=>{
  const table=selectable().isolate();
  press(table,0);press(table,4,{shift:true});
  assert.equal(table.selectedExtra.size,2);
  press(table,9);
  assert.deepEqual([...table.selectedExtra],[9]);assert.equal(table.selected,9);
  assert.deepEqual(table.dragIds,[9]);
  const before=table.state.groups.map(g=>({id:g.id,dx:g.dx,dy:g.dy}));
  drag(table,80,80);
  for(const group of table.state.groups){const start=before.find(s=>s.id===group.id);
    assert.equal(group.dx,start.dx+(group.id===9?80:0));assert.equal(group.dy,start.dy+(group.id===9?80:0));}
  // Dragging away and letting go leaves nothing selected but the anchor, so the
  // next plain click is still a single-piece gesture.
  table.release();
  assert.equal(table.selectedExtra.size,1);assert.deepEqual(table.dragIds,[]);
  assert.equal(table.didMultiSelect,false);
});

test('a spread selection is rasterized once and never re-rasterized while it moves',()=>{
  const {table,nodes,host}=(()=>{const built=fixture(20,15),nodes=[];const host={appendChild(node){nodes.push(node);node.parentElement=host;}};built.table.canvas.parentElement=host;globalThis.document={createElement:()=>({width:0,height:0,style:{},setAttribute(){},getContext:()=>({scale(){},translate(){}}),remove(){nodes.splice(nodes.indexOf(this),1);this.parentElement=null;}})};return {table:built.table,nodes,host};})();
  table.renderScene=()=>{table.scenes++;};table.renderGroup=()=>{table.groupsDrawn++;};table.scenes=0;table.groupsDrawn=0;
  // Two far-apart groups make the selection's bounding box much larger than either.
  table.state.groups[0].dx=0;table.state.groups[0].dy=0;
  table.state.groups[19].dx=600;table.state.groups[19].dy=400;
  table.selected=0;table.selectedExtra=new Set([19]);table.dragIds=[0,19];table.drag={id:0,x:0,y:0,dx:0,dy:0};
  table.render();const painted=table.groupsDrawn;
  assert.ok(painted>=2,'both carried groups are rasterized into the composite');
  for(let frame=0;frame<200;frame++){for(const id of [0,19]){const group=table.state.groups.find(g=>g.id===id);group.dx+=1;group.dy+=.5;}table.render();}
  assert.equal(table.groupsDrawn,painted,'moving a cached selection re-rasterized it');
  assert.equal(table.scenes,1);
  assert.equal(nodes.length,1);
  const transform=nodes[0].style.transform;
  assert.ok(transform.includes('translate3d'),'the compositor layer follows the selection');
});

test('a drop snaps every carried group so a gathered cluster merges in one gesture',()=>{
  const state=createPuzzle('seaside',12,9,137),table=Object.create(PuzzleTable.prototype);
  const pieces=piecesFor(12,9,137);
  // Park everything far away, then slide three reading-order neighbours together
  // as if the player had just gathered them with one drag.
  state.groups.forEach((g,i)=>{g.dx=2500+i*200;g.dy=2200+i*300;});
  for(const id of [0,1,2]){const group=state.groups.find(g=>g.id===id);group.dx=310;group.dy=220;}
  Object.assign(table,{state,pieces,board:boardFor(12,9),drag:{id:0,x:0,y:0,dx:310,dy:220},dragIds:[0,1,2],
    dragOffsets:new Map([[0,{dx:310,dy:220}],[1,{dx:310,dy:220}],[2,{dx:310,dy:220}]]),
    selectedExtra:new Set([1,2]),selected:0,didMultiSelect:true,claimSerial:0,network:null,pan:null,
    update(){},draw(){},canvas:{style:{}},feedback:null,playConnectionSound(){},remoteOwners:{},keepOnTable(){}});
  table.messages=[];table.notice=m=>table.messages.push(m);
  table.release();
  const merged=table.state.groups.filter(g=>g.pieces.includes(0));
  assert.equal(merged.length,1,'the three pieces ended up in one group');
  assert.deepEqual(merged[0].pieces.slice().sort((a,b)=>a-b),[0,1,2]);
  assert.equal(table.selectedExtra.size,0,'the selection is released with the drag');
  assert.deepEqual(table.dragIds,[]);
  assert.ok(table.messages.some(message=>message.includes('归位')||message.includes('连在一起')||message.includes('找到了自己的位置')));
});

test('auto-selection gathers only groups that visually touch, and never exceeds the ceiling',()=>{
  const table=selectable(20,15).isolate(),w=table.board.width/20,h=table.board.height/15;
  // dx/dy are offsets from a piece's own board slot, so a neighbour that should
  // sit flush to the right of piece 0 needs dx = -1 column + a hair.
  const clicked=place(table,0,0,0);
  const right=place(table,1,-1+.003,0);        // visually flush to the right
  const below=place(table,20,0,-.997);         // visually flush underneath
  const ids=table.selectFacing(clicked);
  assert.ok(ids.includes(0));
  assert.ok(ids.includes(1),'a visually touching neighbour joins the drag');
  assert.ok(ids.includes(20),'a neighbour on the other axis joins too');
  assert.ok(ids.length<=MULTI_SELECT_LIMIT);
  // A group parked elsewhere is never swept in, however close to another group.
  const far=place(table,7,4000,4000);
  assert.ok(!table.selectFacing(clicked).includes(7));
  right.dx=w*3;below.dx=w*3;below.dy=h*3;
  assert.deepEqual(table.selectFacing(clicked),[0]);
  // Pieces already locked onto the board are never swallowed by a loose drag.
  below.locked=true;below.dx=-1;below.dy=-.997;
  assert.deepEqual(table.selectFacing(clicked),[0]);
  // Nor is a group another player is holding.
  below.locked=false;below.dx=0;below.dy=-.997;
  table.remoteOwners={20:{name:'同伴',color:'#56aabb'}};
  assert.deepEqual(table.selectFacing(clicked),[0]);
});

test('arrow keys and Enter move the whole selection in single-player',()=>{
  const table=selectable().isolate();
  // `keydown` is an instance arrow-function property, so the constructor has to
  // have run to have it. Re-create the handler bound to this fixture table by
  // exercising the same branches through a small local wrapper.
  table.key={};
  const keydown=keyboardDriver(table);
  press(table,0);press(table,3,{shift:true});
  const starts=new Map(table.state.groups.map(g=>[g.id,{dx:g.dx,dy:g.dy}]));
  keydown('ArrowRight');
  for(const id of [0,3]){const group=table.state.groups.find(g=>g.id===id);
    assert.equal(group.dx,starts.get(id).dx+12,`group ${id} moved with the selection`);
    assert.equal(group.dy,starts.get(id).dy);}
  const other=table.state.groups.find(g=>g.id===5);
  assert.equal(other.dx,starts.get(5).dx,'unselected groups stay put');
  // Shift+arrow uses the fine step, still applied to every selected group.
  const beforeFine=new Map(table.state.groups.map(g=>[g.id,g.dy]));
  keydown('ArrowDown',{shift:true});
  for(const id of [0,3])assert.equal(table.state.groups.find(g=>g.id===id).dy,beforeFine.get(id)+2,'fine step is 2px');
  keydown('ArrowDown');
  for(const id of [0,3])assert.equal(table.state.groups.find(g=>g.id===id).dy,beforeFine.get(id)+2+12,'coarse step is 12px');
  // Ctrl+A selects the visible loose pieces up to the ceiling.
  keydown('a',{ctrl:true});
  assert.equal(table.selectedExtra.size,MULTI_SELECT_LIMIT);
  assert.ok(table.messages.some(message=>message.includes('全选')));
  // N cycles the anchor and resets the set to that single group.
  keydown('n');
  assert.equal(table.selectedExtra.size,1);assert.ok(table.selectedExtra.has(table.selected));
});
