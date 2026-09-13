import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle, restartPuzzle, LEVELS, snapTolerance, moveGroup, dropGroup, restorePuzzle, boardFor, shuffleLoose } from '../lib/puzzle-engine.ts';
import { makeRoom, addMember, applyAction } from '../lib/room-engine.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';
import { parseTableTheme } from '../lib/table-theme.ts';

test('new grids range from 108 to exactly 5000 and the save fits in a local database row',()=>{
  assert.equal(Math.max(...LEVELS.map(l=>l.count)),5000);
  assert.deepEqual(LEVELS.map(l=>l.count),[108,300,500,1000,1500,2000,3000,4000,5000]);
  for(const level of LEVELS)assert.equal(level.cols*level.rows,level.count);
  assert.throws(()=>createPuzzle('seaside',100,60));assert.throws(()=>makeRoom('unsupported','seaside-native-v2',6000,Date.now()));
  for(const [cols,rows] of [[4,3],[8,6]]){
    assert.throws(()=>createPuzzle('seaside',cols,rows),/不支持的拼图片数/);
    assert.throws(()=>makeRoom('retired','seaside-native-v2',cols*rows,Date.now()),/请选择有效图片与片数/);
  }
  const state=createPuzzle('seaside',100,50,31);
  const saved=JSON.stringify(state);assert.ok(Buffer.byteLength(saved)<900_000);
  assert.deepEqual(restorePuzzle(saved,['seaside']),state);
});

test('retired large saves and existing-room shuffles preserve every piece, lock and elapsed time',()=>{
  for(const [cols,rows] of [[4,3],[8,6],[60,50],[80,50],[100,50]]){
    const legacy={version:1,layout:'square',imageId:'seaside',cols,rows,seed:91,elapsed:173,groups:Array.from({length:cols*rows},(_,id)=>({id,pieces:[id],dx:id===0?0:100,dy:id===0?0:150,locked:id===0}))};
    legacy.groups[1].pieces.push(2);legacy.groups.splice(2,1);
    const restored=restorePuzzle(JSON.stringify(legacy),['seaside']);assert.deepEqual(restored,legacy);
    assert.equal(shuffleLoose(restored,45),cols*rows-3);
    assert.equal(restored.elapsed,173);assert.deepEqual(restored.groups.slice(0,2),legacy.groups.slice(0,2));
    assert.equal(new Set(restored.groups.flatMap(g=>g.pieces)).size,cols*rows);
    assert.deepEqual(restorePuzzle(JSON.stringify(restored),['seaside']),restored);
    const before=JSON.stringify(restored),restarted=restartPuzzle(restored,92);
    assert.equal(JSON.stringify(restored),before);assert.equal(restarted.groups.length,cols*rows);
    assert.equal(restarted.elapsed,0);assert.equal(restarted.imageId,restored.imageId);
  }
});

test('slightly imperfect placement snaps in both singleplayer and multiplayer at every difficulty',()=>{
  for(const level of LEVELS){
    const state=createPuzzle('seaside',level.cols,level.rows,34),near=Math.min(800/level.cols,600/level.rows)*.22;
    assert.ok(near>Math.min(800/level.cols,600/level.rows)*.18);
    moveGroup(state,0,near,0);assert.ok(dropGroup(state,0,snapTolerance(state)).placed>=1);
    const room=makeRoom('snap','seaside-native-v2',level.count,1000),member=addMember(room,'a','玩家','digest',1000);
    applyAction(room,member,{type:'claim',groupId:0},1001);
    applyAction(room,member,{type:'drop',groupId:0,dx:near,dy:0,seq:1},1002);
    assert.ok(room.puzzle.groups.some(g=>g.locked&&g.pieces.includes(0)));
  }
});

test('the increased snap radius joins nearby correct neighbors and still rejects distant positions',()=>{
  const state=createPuzzle('seaside',50,40,9),tolerance=snapTolerance(state);
  state.groups.forEach(g=>{g.dx=4000;g.dy=4000;});
  moveGroup(state,0,150,150);moveGroup(state,1,150+tolerance*.9,150);
  assert.equal(dropGroup(state,0,tolerance).joined,1);
  moveGroup(state,0,tolerance*1.2,0);assert.equal(dropGroup(state,0,tolerance).snapped,false);
});

function fakeCanvas(){
  const stats={images:[],clips:0,hits:0,fills:[],texts:[]};
  const context=new Proxy({fill(){stats.fills.push(this.fillStyle);},fillText(text){stats.texts.push({text,color:this.fillStyle});},drawImage(image){stats.images.push(image);},clip(){stats.clips++;},isPointInPath(){stats.hits++;return true;}},{get(target,key){return key in target?target[key]:()=>{};}});
  return {stats,context,width:1500,height:1100,style:{},getContext:()=>context,addEventListener(){},focus(){},setPointerCapture(){}};
}
test('2000 piece dragging reuses the stationary scene, culls offscreen pieces and limits exact hit tests',()=>{
  const original={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  globalThis.document={createElement:()=>fakeCanvas(),addEventListener(){}};globalThis.Path2D=class{};
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  let table;
  try{
    const state=createPuzzle('seaside',50,40,2),canvas=fakeCanvas(),board=boardFor(state.cols,state.rows);
    table=new PuzzleTable(canvas,state,{naturalWidth:8000,naturalHeight:6000},()=>{},()=>{});
    assert.equal(table.picture.width,7500);assert.equal(table.picture.height,6000,'native image detail must survive the 5:4 crop');
    table.width=1500;table.height=1100;table.camera={x:0,y:0,z:1};
    const group=state.groups[0];moveGroup(state,group.id,0,0);table.drag={id:group.id,x:0,y:0,dx:0,dy:0};
    assert.ok(table.sprites.canvas.width*table.sprites.canvas.height<8_300_000);
    table.render();const backgroundDraws=table.background.stats.images.length;assert.ok(backgroundDraws>1900);
    canvas.stats.images=[];moveGroup(state,group.id,1,1);table.render();
    assert.equal(table.background.stats.images.length,backgroundDraws,'a pointer move repainted all stationary pieces');
    assert.equal(canvas.stats.images.length,3,'fallback drag restores the old and new footprints, then draws the cached held tile');
    globalThis.devicePixelRatio=2;table.drag=null;
    table.camera={x:-board.x*2,y:-board.y*2,z:2};canvas.stats.images=[];table.render();
    assert.ok(canvas.stats.images.length>0);
    assert.ok(canvas.stats.images.every(image=>image===table.picture),'a high-density display must sample native pixels as soon as the atlas would be enlarged');
    globalThis.devicePixelRatio=1;table.camera={x:-board.x,y:-board.y,z:1};canvas.stats.images=[];table.render();
    assert.ok(canvas.stats.images.length>0);
    assert.ok(canvas.stats.images.every(image=>image===table.sprites.canvas),'ordinary zoom should retain the fast atlas renderer');
    table.drag=null;table.camera={x:-board.x*12,y:-board.y*12,z:12};canvas.stats.images=[];table.render();
    assert.ok(canvas.stats.images.length<200,'zoomed rendering still drew thousands of invisible tiles');
    assert.ok(canvas.stats.images.length>0);assert.ok(canvas.stats.images.every(image=>image===table.picture),'zoomed pieces must sample native pixels instead of magnifying the atlas');
    assert.equal(table.groupAt(-10000,-10000),undefined);
    const hitContext=table.hit;let exactHits=0;hitContext.isPointInPath=()=>{exactHits++;return true;};
    table.groupAt(-10000,-10000);assert.equal(exactHits,0);
    assert.equal(table.groupAt(board.x+5,board.y+5)?.id,0);assert.ok(exactHits<10);
    table.zoom(100);assert.equal(table.camera.z,6.4);
  }finally{table?.destroy();Object.assign(globalThis,original);}
});


test('background switching preserves a live 2000-piece drag and refreshes its cached scene once',()=>{
  const original={document:globalThis.document,Path2D:globalThis.Path2D,ResizeObserver:globalThis.ResizeObserver,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  globalThis.document={createElement:()=>fakeCanvas(),addEventListener(){}};globalThis.Path2D=class{};
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  let table,updates=0,networkCalls=0;
  try{
    const state=createPuzzle('seaside',50,40,2),canvas=fakeCanvas();
    table=new PuzzleTable(canvas,state,{naturalWidth:1402,naturalHeight:1122},()=>updates++,()=>{});
    table.width=1500;table.height=1100;table.camera={x:17,y:23,z:1};
    table.selected=0;table.drag={id:0,x:0,y:0,dx:state.groups[0].dx,dy:state.groups[0].dy};
    table.remoteOwners={1:{name:'同伴',color:'#56aabb'}};
    table.network={acquire:async()=>{networkCalls++;return true;},move:()=>networkCalls++,drop:async()=>{networkCalls++;},release:()=>networkCalls++};
    table.render();const before=JSON.stringify(state),camera=table.camera,drag=table.drag,sprites=table.sprites,picture=table.picture;
    const firstCount=table.background.stats.images.length;
    table.setTheme('dark');table.render();const darkCount=table.background.stats.images.length;
    assert.ok(darkCount>firstCount,'theme must repaint the stationary scene during a drag');
    assert.ok(table.background.stats.fills.includes('#303338'));
    assert.ok(table.background.stats.texts.some(v=>v.text==='同伴'&&v.color==='#f2e8d8'));
    table.render();assert.equal(table.background.stats.images.length,darkCount,'drag caching must resume after the theme change');
    table.setTheme('dark');assert.equal(table.backgroundDirty,false,'same theme must not invalidate a clean cache');
    table.setTheme('beige');table.background.stats.fills=[];table.render();assert.equal(table.background.stats.fills[0],'#cabc9f');
    assert.equal(JSON.stringify(state),before);assert.equal(table.camera,camera);assert.equal(table.drag,drag);assert.equal(table.selected,0);assert.equal(table.sprites,sprites);assert.equal(table.picture,picture);
    assert.equal(updates,0);assert.equal(networkCalls,0);
    assert.equal(parseTableTheme('dark'),'dark');for(const value of [null,'beige','bad-value'])assert.equal(parseTableTheme(value),'beige');
  }finally{if(table)table.drag=null;table?.destroy();Object.assign(globalThis,original);}
});
