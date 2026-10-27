import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,DRAG_SLOP} from '../mobile/puzzle-board.ts';
import {boardThemeColors} from '../mobile/theme.ts';
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

function threeFingers(t){
 const f=boardFixture(t),{board,first,empty}=f,third={id:3,x:board.rect.x+80,y:board.rect.y+80};
 down(board,[first]);down(board,[first,empty]);down(board,[first,empty,third]);return{...f,third};
}
const middle=(a,b)=>({id:-1,x:(a.x+b.x)/2,y:(a.y+b.y)/2});

test('a third finger turns the pan into a pinch of fingers two and three while finger one keeps the piece',t=>{
 const {board,group,calls,cursors,first,empty,third}=threeFingers(t),camera={...board.camera};
 assert.equal(board.pointers.size,3);assert.equal(board.pan,null);assert.equal(board.drag.id,group.id);assert.equal(board.pinch.a,empty.id);assert.equal(board.pinch.b,third.id);assert.equal(board.pinch.held,true);assert.deepEqual(board.camera,camera);assert.deepEqual(calls,[['acquire',group.id]]);
 const anchor=board.world(middle(empty,third)),spread={...third,x:third.x+55,y:third.y+55},cursorCount=cursors.length;
 move(board,[first,empty,spread],[spread]);nearly(board.camera.z,camera.z*2);const centre=board.world(middle(empty,spread));nearly(centre.x,anchor.x);nearly(centre.y,anchor.y);heldAt(board,group,first);
 assert.deepEqual(calls.at(-1),['move',group.id,group.dx,group.dy]);assert.equal(cursors.length,cursorCount+1);assert.deepEqual(cursors.at(-1),board.screenToWorld(first));
 const zoomed={...board.camera},pan={...empty,x:empty.x+30,y:empty.y-20},slide={...spread,x:spread.x+30,y:spread.y-20};
 move(board,[first,pan,slide],[pan,slide]);nearly(board.camera.z,zoomed.z);nearly(board.camera.x,zoomed.x+30);nearly(board.camera.y,zoomed.y-20);heldAt(board,group,first);
 assert.ok(!calls.some(call=>call[0]==='drop'||call[0]==='release'));
});

test('all three fingers moving in one event zooms before the drag, so the piece stays under finger one',t=>{
 const {board,group,calls,first,empty,third}=threeFingers(t),camera={...board.camera};
 const held={...first,x:first.x+40,y:first.y-30},pinchA={...empty,x:empty.x-10,y:empty.y-10},pinchB={...third,x:third.x+45,y:third.y+45};
 move(board,[held,pinchA,pinchB]);nearly(board.camera.z,camera.z*2);heldAt(board,group,held);assert.deepEqual(calls.map(call=>call[0]),['acquire','move']);
});

test('pinch zoom while holding stays inside the board zoom limits',t=>{
 const {board,group,first,empty,third}=threeFingers(t);
 const under=()=>{const screen=board.worldToScreen(pieceWorld(board,group));nearly(screen.x,first.x);nearly(screen.y,first.y);};
 move(board,[first,empty,{...third,x:third.x+2000,y:third.y+2000}]);assert.equal(board.camera.z,5);under();
 move(board,[first,empty,{...third,x:empty.x+1,y:empty.y}]);assert.equal(board.camera.z,.08);under();
});

test('a fourth finger is ignored during a held pinch',t=>{
 const {board,group,calls,first,empty,third}=threeFingers(t),pinch=board.pinch,fourth={id:4,x:board.rect.x+300,y:board.rect.y+300};
 down(board,[first,empty,third,fourth]);assert.equal(board.pinch,pinch);assert.equal(board.pan,null);const camera={...board.camera},moved={...fourth,x:fourth.x+90,y:fourth.y+40};
 const before={dx:group.dx,dy:group.dy};move(board,[first,empty,third,moved],[moved]);assert.deepEqual(board.camera,camera);heldAt(board,group,first);nearly(group.dx,before.dx);nearly(group.dy,before.dy);assert.ok(!calls.some(call=>call[0]==='drop'||call[0]==='release'));
});

for(const lifted of ['second','third'])test(`lifting the ${lifted} finger returns to a one-finger pan without a jump`,t=>{
 const f=threeFingers(t),{board,group,calls,first}=f,spread={...f.third,x:f.third.x+55,y:f.third.y+55};move(board,[first,f.empty,spread],[spread]);
 const gone=lifted==='second'?f.empty:spread,kept=lifted==='second'?spread:f.empty,camera={...board.camera},before={dx:group.dx,dy:group.dy};
 up(board,[first,kept],gone);assert.equal(board.pinch,null);assert.equal(board.pan.pointer,kept.id);assert.equal(board.drag.id,group.id);assert.deepEqual(board.camera,camera);
 move(board,[first,kept],[kept]);assert.deepEqual(board.camera,camera);assert.equal(group.dx,before.dx);assert.equal(group.dy,before.dy);
 const next={...kept,x:kept.x+24,y:kept.y+16};move(board,[first,next],[next]);nearly(board.camera.x,camera.x+24);nearly(board.camera.y,camera.y+16);nearly(board.camera.z,camera.z);heldAt(board,group,first);
 up(board,[first],next);assert.equal(board.pan,null);assert.equal(board.drag.id,group.id);const held={...first,x:first.x+12,y:first.y+8};move(board,[held]);heldAt(board,group,held);
 assert.ok(!calls.some(call=>call[0]==='drop'||call[0]==='release'));
});

test('lifting the held finger mid-pinch drops once and the two fingers keep zooming without a jump',t=>{
 const {board,group,calls,first,empty,third}=threeFingers(t),spread={...third,x:third.x+55,y:third.y+55};move(board,[first,empty,spread],[spread]);const camera={...board.camera};
 up(board,[empty,spread],first);assert.equal(board.drag,null);assert.deepEqual(calls.filter(call=>call[0]==='drop'),[['drop',group.id,group.dx,group.dy]]);
 assert.equal(board.pinch.a,empty.id);assert.equal(board.pinch.b,spread.id);assert.equal(board.pinch.held,false);assert.deepEqual(board.camera,camera);
 move(board,[empty,spread]);assert.deepEqual(board.camera,camera);move(board,[empty,{...spread,x:spread.x+110,y:spread.y+110}]);nearly(board.camera.z,camera.z*2);
 up(board,[empty],spread);assert.equal(board.pinch,null);assert.equal(board.pan.pointer,empty.id);assert.equal(calls.filter(call=>call[0]==='drop').length,1);assert.ok(!calls.some(call=>call[0]==='release'));
});

test('without a held piece a third finger keeps the old two-finger pinch and lifting one leaves a pan',t=>{
 const {board,calls,state,empty}=boardFixture(t),before=structuredClone(state),second={...empty,id:3,x:empty.x+100},third={...empty,id:4,x:empty.x+50,y:empty.y+120};
 down(board,[empty]);down(board,[empty,second]);down(board,[empty,second,third]);assert.equal(board.drag,null);assert.equal(board.pinch.a,empty.id);assert.equal(board.pinch.b,second.id);assert.equal(board.pinch.held,false);
 const camera={...board.camera},moved={...third,x:third.x+200};move(board,[empty,second,moved],[moved]);assert.deepEqual(board.camera,camera);
 up(board,[empty,second],moved);assert.equal(board.pinch,null);assert.equal(board.pan.pointer,empty.id);assert.deepEqual(calls,[]);assert.deepEqual(state,before);
});

test('a refused acquire during a held pinch keeps the zoom going',async t=>{
 const f=boardFixture(t),{board,group,calls,first,empty}=f,third={id:3,x:board.rect.x+80,y:board.rect.y+80};let resolve;const acquired=new Promise(yes=>{resolve=yes;});
 board.network.acquire=id=>(calls.push(['acquire',id]),acquired);down(board,[first]);down(board,[first,empty]);down(board,[first,empty,third]);const pinch=board.pinch,camera={...board.camera};
 resolve(false);await acquired;await Promise.resolve();assert.equal(board.drag,null);assert.equal(board.pinch,pinch);
 move(board,[first,empty,{...third,x:third.x+55,y:third.y+55}]);nearly(board.camera.z,camera.z*2);assert.deepEqual(calls,[['acquire',group.id]]);
});

test('a held pinch never builds the cached drag surface',t=>{
 const {board,context,first,empty}=boardFixture(t),third={id:3,x:board.rect.x+80,y:board.rect.y+80};board.atlas={};Object.assign(context,{canvas:{width:1100,height:720},globalAlpha:1,globalCompositeOperation:'source-over',shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',filter:'none',getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),getLineDash:()=>[]});
 down(board,[first]);assert.ok(board.cachedDragSurface(context,Date.now()));assert.equal(board.surfaceBuilds,1);
 down(board,[first,empty]);down(board,[first,empty,third]);board.draw(context);assert.equal(board.dragSurface,null);assert.equal(board.gestureSurface,null);
 move(board,[first,empty,{...third,x:third.x+55,y:third.y+55}]);board.draw(context);assert.equal(board.surfaceBuilds,1);
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

for(const fingers of [2,3])for(const cancel of ['Escape','cancel','cancelInput'])test(`${cancel} still releases a drag and clears all held input with ${fingers} fingers`,t=>{
 const {board,group,calls,first,empty}=boardFixture(t),third={id:3,x:board.rect.x+80,y:board.rect.y+80};down(board,[first]);down(board,[first,empty]);if(fingers===3){down(board,[first,empty,third]);assert.ok(board.pinch);}
 if(cancel==='Escape')board.input({type:'key',points:[],changed:[],key:'Escape',keyDown:true});else if(cancel==='cancel')board.input({type:'cancel',points:[],changed:[first,empty]});else board.cancelInput(true);
 assert.equal(board.drag,null);assert.equal(board.pan,null);assert.equal(board.pinch,null);assert.equal(board.pointers.size,0);assert.deepEqual(calls,[['acquire',group.id],['release',group.id]]);
});

test('a held finger that stays inside the drag slop never nudges the piece and drops it where it was',t=>{
 const {board,group,calls,first}=boardFixture(t),before={dx:group.dx,dy:group.dy};
 down(board,[first]);const jitter={...first,x:first.x+5,y:first.y-5};move(board,[jitter]);assert.equal(board.drag.live,false);assert.equal(group.dx,before.dx);assert.equal(group.dy,before.dy);
 up(board,[],jitter);assert.deepEqual(calls,[['acquire',group.id],['drop',group.id,before.dx,before.dy]]);
});

test('passing the drag slop moves the piece with the finger from the spot where it was grabbed',t=>{
 const {board,group,calls,first}=boardFixture(t);down(board,[first]);
 move(board,[{...first,x:first.x+DRAG_SLOP-1}]);assert.equal(board.drag.live,false);assert.deepEqual(calls,[['acquire',group.id]]);
 const past={...first,x:first.x+DRAG_SLOP,y:first.y+1};move(board,[past]);assert.equal(board.drag.live,true);heldAt(board,group,past);assert.deepEqual(calls.at(-1),['move',group.id,group.dx,group.dy]);
 const back={...first,x:first.x+2,y:first.y};move(board,[back]);heldAt(board,group,back);
});

test('a second finger makes a still-held piece follow its finger at once',t=>{
 const {board,group,first,empty}=boardFixture(t);down(board,[first]);const shifted={...first,x:first.x+3,y:first.y+2};move(board,[shifted]);assert.equal(board.drag.live,false);
 down(board,[shifted,empty]);assert.equal(board.drag.live,true);const pan={...empty,x:empty.x+60,y:empty.y+30};move(board,[shifted,pan],[pan]);heldAt(board,group,shifted);
});

test('the held group is drawn lifted around the finger with a shadow, bounded for large groups',t=>{
 const {board,state,group,context,first}=boardFixture(t);assert.equal(board.dragLift(group),null);
 down(board,[first]);const lift=board.dragLift(group),anchor=board.world(first);nearly(lift.x,anchor.x);nearly(lift.y,anchor.y);assert.ok(lift.s>1&&lift.s<=1.08+1e-9,String(lift.s));
 const w=board.board.width/state.cols,h=board.board.height/state.rows,large={...group,pieces:state.groups.flatMap(g=>g.pieces)},big=board.dragLift(large);
 let far=0;for(const id of large.pieces){const x=board.board.x+(id%state.cols)*w+group.dx,y=board.board.y+Math.floor(id/state.cols)*h+group.dy;far=Math.max(far,Math.hypot(Math.max(Math.abs(x-anchor.x),Math.abs(x+w-anchor.x)),Math.max(Math.abs(y-anchor.y),Math.abs(y+h-anchor.y))));}
 assert.ok(big.s<lift.s);assert.ok((big.s-1)*far*board.camera.z<=6+1e-9);
 const fills=[];context.fill=()=>fills.push(context.fillStyle);board.draw(context);assert.equal(fills.filter(color=>color===boardThemeColors('light').dragShadow).length,1);
 up(board,[],first);assert.equal(board.dragLift(group),null);fills.length=0;board.draw(context);assert.ok(!fills.includes(boardThemeColors('light').dragShadow));
});
