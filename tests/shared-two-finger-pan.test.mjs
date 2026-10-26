import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

function pieceWorld(board,group){
 const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=group.pieces[0];
 return{x:board.board.x+(id%board.state.cols+.5)*w+group.dx,y:board.board.y+(Math.floor(id/board.state.cols)+.5)*h+group.dy};
}
function boardFixture(t){
 const context=new Proxy({isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const canvas=()=>({width:1,height:1,getContext:()=>context}),platform={createCanvas:canvas,onHide:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'web'}};
 const state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(platform,state,()=>{}),calls=[],cursors=[],group=state.groups.at(-1),other=state.groups.at(-2);
 for(const g of state.groups)g.locked=g!==group&&g!==other;
 const center=pieceWorld(board,group);group.dx+=Math.round(center.x*10)/10-center.x;group.dy+=Math.round(center.y*10)/10-center.y;
 const world=pieceWorld(board,group),otherWorld=pieceWorld(board,other);other.dx+=world.x+500-otherWorld.x;other.dy+=world.y+100-otherWorld.y;
 board.setRect({x:125,y:80,w:1100,h:720});board.camera={x:400-world.x*.8,y:350-world.y*.8,z:.8};board.ready=true;board.networkReady=true;
 board.network={acquire:async id=>(calls.push(['acquire',id]),true),move:(...args)=>calls.push(['move',...args]),drop:async(...args)=>calls.push(['drop',...args]),release:id=>calls.push(['release',id])};
 board.onCursor=point=>cursors.push(point);t.after(()=>board.destroy());
 const first={id:1,...board.worldToScreen(world)},empty={id:2,x:board.rect.x+25,y:board.rect.y+25},piece={id:2,...board.worldToScreen(pieceWorld(board,other))};
 return{board,state,group,other,calls,cursors,context,first,empty,piece};
}
const nearly=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ~= ${expected}`);
const down=(board,points,changed=points.at(-1))=>board.input({type:'down',points,changed:[changed]});
const move=(board,points,changed=points)=>board.input({type:'move',points,changed});
const up=(board,points,changed)=>board.input({type:'up',points,changed:[changed]});
function heldAt(board,group,point){
 const world=pieceWorld(board,group),screen=board.worldToScreen(world),cursor=board.screenToWorld(point);
 nearly(screen.x,point.x);nearly(screen.y,point.y);assert.ok(cursor);nearly(cursor.x,Math.round(world.x*10)/10);nearly(cursor.y,Math.round(world.y*10)/10);
}

for(const target of ['empty','piece'])test(`second finger on ${target} pans without releasing or acquiring another piece`,t=>{
 const f=boardFixture(t),{board,group,calls,cursors,first}=f,second=f[target],camera={...board.camera},before={dx:group.dx,dy:group.dy};
 assert.equal(down(board,[first]),true);assert.deepEqual(calls,[['acquire',group.id]]);
 assert.equal(down(board,[first,second]),true);assert.deepEqual(calls,[['acquire',group.id]]);assert.equal(board.pinch,null);assert.equal(board.pan.pointer,second.id);nearly(board.camera.z,camera.z);
 if(target==='piece')assert.equal(board.groupAt(second).id,f.other.id);
 const moved={...second,x:second.x+80,y:second.y+50},cursorCount=cursors.length;
 move(board,[first,moved],[moved]);nearly(board.camera.x,camera.x+80);nearly(board.camera.y,camera.y+50);nearly(board.camera.z,camera.z);
 nearly(group.dx,before.dx-80/camera.z);nearly(group.dy,before.dy-50/camera.z);heldAt(board,group,first);
 assert.deepEqual(calls.at(-1),['move',group.id,group.dx,group.dy]);assert.equal(cursors.length,cursorCount+1);assert.deepEqual(cursors.at(-1),board.screenToWorld(first));
});

test('both fingers moving in one event applies camera movement before the drag',t=>{
 const {board,group,calls,first,empty}=boardFixture(t),camera={...board.camera},before={dx:group.dx,dy:group.dy};
 down(board,[first]);down(board,[first,empty]);const held={...first,x:first.x+32,y:first.y+24},pan={...empty,x:empty.x+80,y:empty.y+50};
 move(board,[held,pan]);nearly(board.camera.x,camera.x+80);nearly(board.camera.y,camera.y+50);nearly(group.dx,before.dx+(32-80)/camera.z);nearly(group.dy,before.dy+(24-50)/camera.z);heldAt(board,group,held);
 assert.deepEqual(calls.map(call=>call[0]),['acquire','move']);
});

test('lifting the pan finger keeps a piece drag without moving the camera, then drops once',t=>{
 const {board,group,calls,first,empty}=boardFixture(t);down(board,[first]);down(board,[first,empty]);
 const pan={...empty,x:empty.x+80,y:empty.y+50};move(board,[first,pan],[pan]);const camera={...board.camera},before={dx:group.dx,dy:group.dy};
 up(board,[first],pan);assert.equal(board.drag.id,group.id);assert.equal(board.pan,null);assert.ok(!calls.some(call=>call[0]==='drop'||call[0]==='release'));
 const held={...first,x:first.x+40,y:first.y+24};move(board,[held]);assert.deepEqual(board.camera,camera);nearly(group.dx,before.dx+40/camera.z);nearly(group.dy,before.dy+24/camera.z);heldAt(board,group,held);
 up(board,[],held);assert.equal(board.drag,null);assert.deepEqual(calls.filter(call=>call[0]==='drop'),[['drop',group.id,group.dx,group.dy]]);assert.ok(!calls.some(call=>call[0]==='release'));
});

test('lifting the drag finger drops once and the remaining finger pans without a jump',t=>{
 const {board,group,calls,first,empty}=boardFixture(t);down(board,[first]);down(board,[first,empty]);
 const pan={...empty,x:empty.x+80,y:empty.y+50};move(board,[first,pan],[pan]);const camera={...board.camera};
 up(board,[pan],first);assert.equal(board.drag,null);assert.equal(board.pan.pointer,pan.id);assert.deepEqual(board.camera,camera);assert.deepEqual(calls.filter(call=>call[0]==='drop'),[['drop',group.id,group.dx,group.dy]]);
 move(board,[pan]);assert.deepEqual(board.camera,camera);const next={...pan,x:pan.x+24,y:pan.y-16};move(board,[next]);nearly(board.camera.x,camera.x+24);nearly(board.camera.y,camera.y-16);
 up(board,[],next);assert.equal(calls.filter(call=>call[0]==='drop').length,1);assert.ok(!calls.some(call=>call[0]==='release'));
});

test('extra fingers are ignored until the pan finger lifts and a remaining finger is rebased',t=>{
 const {board,group,calls,first,empty}=boardFixture(t),third={id:3,x:board.rect.x+80,y:board.rect.y+80};down(board,[first]);down(board,[first,empty]);down(board,[first,empty,third]);
 assert.equal(board.pointers.size,3);assert.equal(board.pan.pointer,empty.id);assert.equal(board.pinch,null);assert.deepEqual(calls,[['acquire',group.id]]);
 const camera={...board.camera},extra={...third,x:third.x+120,y:third.y+60};move(board,[first,empty,extra],[extra]);assert.deepEqual(board.camera,camera);heldAt(board,group,first);
 const pan={...empty,x:empty.x+40,y:empty.y+24};move(board,[first,pan,extra],[pan]);const panned={...board.camera};
 up(board,[first,extra],pan);assert.equal(board.pan.pointer,extra.id);move(board,[first,extra]);assert.deepEqual(board.camera,panned);
 const next={...extra,x:extra.x+24,y:extra.y+16};move(board,[first,next],[next]);nearly(board.camera.x,panned.x+24);nearly(board.camera.y,panned.y+16);heldAt(board,group,first);assert.ok(!calls.some(call=>call[0]==='drop'||call[0]==='release'));
});

test('empty-board single-finger pan and two-finger pinch zoom still work',t=>{
 const {board,calls,empty,state}=boardFixture(t),before=structuredClone(state),camera={...board.camera},pan={...empty,x:empty.x+40,y:empty.y+24};
 assert.equal(board.groupAt(empty),null);down(board,[empty]);move(board,[pan]);nearly(board.camera.x,camera.x+40);nearly(board.camera.y,camera.y+24);nearly(board.camera.z,camera.z);up(board,[],pan);
 const second={...empty,id:3,x:empty.x+100};down(board,[empty]);down(board,[empty,second]);assert.ok(board.pinch);assert.equal(board.drag,null);
 move(board,[empty,{...second,x:second.x+100}]);assert.ok(board.camera.z>camera.z);assert.deepEqual(calls,[]);assert.deepEqual(state,before);
});

for(const failure of ['refused','failed'])test(`a ${failure} network acquire preserves the other finger's pan`,async t=>{
 const {board,group,calls,first,empty}=boardFixture(t);let resolve,reject;const acquired=new Promise((yes,no)=>{resolve=yes;reject=no;});
 board.network.acquire=id=>(calls.push(['acquire',id]),acquired);down(board,[first]);down(board,[first,empty]);const camera={...board.camera},pan=board.pan;
 if(failure==='refused')resolve(false);else reject(Error('offline'));await acquired.catch(()=>{});await Promise.resolve();
 assert.equal(board.drag,null);assert.equal(board.pan,pan);assert.equal(board.pan.pointer,empty.id);const next={...empty,x:empty.x+32,y:empty.y+24};move(board,[first,next],[next]);nearly(board.camera.x,camera.x+32);nearly(board.camera.y,camera.y+24);assert.deepEqual(calls,[['acquire',group.id]]);
});

test('drag plus pan releases the cached drag surface and draws directly without rebuilding it',t=>{
 const {board,context,first,empty}=boardFixture(t);board.atlas={};Object.assign(context,{canvas:{width:1100,height:720},globalAlpha:1,globalCompositeOperation:'source-over',shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',filter:'none',getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),getLineDash:()=>[]});
 down(board,[first]);assert.ok(board.cachedDragSurface(context,Date.now()));assert.equal(board.surfaceBuilds,1);
 down(board,[first,empty]);board.draw(context);assert.equal(board.dragSurface,null);assert.equal(board.gestureSurface,null);assert.equal(board.surfaceBuilds,1);
 move(board,[first,{...empty,x:empty.x+80,y:empty.y+50}]);board.draw(context);assert.equal(board.surfaceBuilds,1);
});

for(const cancel of ['Escape','cancel','cancelInput'])test(`${cancel} still releases a drag and clears all held input`,t=>{
 const {board,group,calls,first,empty}=boardFixture(t);down(board,[first]);down(board,[first,empty]);
 if(cancel==='Escape')board.input({type:'key',points:[],changed:[],key:'Escape',keyDown:true});else if(cancel==='cancel')board.input({type:'cancel',points:[],changed:[first,empty]});else board.cancelInput(true);
 assert.equal(board.drag,null);assert.equal(board.pan,null);assert.equal(board.pinch,null);assert.equal(board.pointers.size,0);assert.deepEqual(calls,[['acquire',group.id],['release',group.id]]);
});
