import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleBoard,parsePuzzlePath,tracePuzzlePath,dropAssistOffset } from '../mobile/puzzle-board.ts';
import { createFittedPuzzle,piecesFor,pathFor,dropGroup,snapTolerance,raiseGroup } from '../lib/puzzle-engine.ts';
import { RoomClient } from '../lib/room-client.ts';
import { boardThemeColors } from '../mobile/theme.ts';

function platform(){
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),hideListeners=new Set(),showListeners=new Set();
 return {commands,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:fn=>(hideListeners.add(fn),()=>hideListeners.delete(fn)),hide:()=>hideListeners.forEach(fn=>fn()),onShow:fn=>(showListeners.add(fn),()=>showListeners.delete(fn)),show:()=>showListeners.forEach(fn=>fn({})),frame:()=>1,cancelFrame(){},config:{id:'wechat'},};
}
function setup(){const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{});board.setRect({x:10,y:80,w:390,h:600});return{p,state,board};}
function piecePoint(board,group){const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=group.pieces[0];return{id:1,x:board.rect.x+board.camera.x+(board.board.x+(id%board.state.cols+.5)*w+group.dx)*board.camera.z,y:board.rect.y+board.camera.y+(board.board.y+(Math.floor(id/board.state.cols)+.5)*h+group.dy)*board.camera.z};}

// Record the rendered paths after the real camera transform and Canvas state
// stack. This catches misplaced/canvas-fixed guides and leaked dash/opacity.
function gridRecorder(base,dashMode='native'){
 const events=[],stack=[];let style={x:0,y:0,z:1,globalAlpha:1,lineWidth:1,strokeStyle:'',dash:[]},path=[],point;
 const project=(x,y)=>({x:style.x+x*style.z,y:style.y+y*style.z});
 const methods={save(){stack.push({...style,dash:[...style.dash]});},restore(){style=stack.pop();},translate(x,y){style.x+=x*style.z;style.y+=y*style.z;},scale(x,y){assert.equal(x,y);style.z*=x;},beginPath(){path=[];point=undefined;},moveTo(x,y){point=project(x,y);},lineTo(x,y){const next=project(x,y);if(point)path.push({from:point,to:next});point=next;},stroke(){events.push({kind:'stroke',path:structuredClone(path),...style,screenWidth:style.lineWidth*style.z,screenDash:style.dash.map(n=>n*style.z)});},drawImage(source,...args){events.push({kind:'image',source,...style});base.drawImage(source,...args);},setLineDash:dashMode==='missing'?undefined:values=>{if(dashMode==='throw')throw Error('unsupported Canvas method');style.dash=[...values];}};
 const ctx=new Proxy(methods,{get:(target,name)=>name in target?target[name]:name in style?style[name]:base[name],set:(_target,name,value)=>{style[name]=value;return true;}});
 return{ctx,events};
}

test('shared geometry is replayed as native canvas commands without Path2D',()=>{
 const p=platform(),piece=piecesFor(8,6,12).find(v=>v.row===2&&v.col===2),commands=parsePuzzlePath(pathFor(piece,8,6));
 tracePuzzlePath(p.ctx,commands);
 assert.equal(p.commands.filter(v=>v[0]==='bezierCurveTo').length,16);
 assert.equal(p.commands[0][0],'beginPath');assert.equal(p.commands.at(-1)[0],'closePath');
 assert.throws(()=>parsePuzzlePath('M 1'),/Invalid/);
});

test('placement guides match every real row and column after pan/zoom, below pieces and above the optional underlay',async()=>{
 for(const [cols,rows]of [[8,6],[6,8],[25,20]])for(const theme of ['light','dark','wood']){
  const p=platform(),state=createFittedPuzzle('test',cols,rows,123),board=new PuzzleBoard(p,state,()=>{});await board.setImage('test.png');board.setTheme(theme);board.underlay=true;
  for(const zoom of [.2,1.35]){
   board.setRect({x:19,y:83,w:board.board.width*zoom+100,h:board.board.height*zoom+100});board.camera={x:30-board.board.x*zoom,y:40-board.board.y*zoom,z:zoom};
   const before=JSON.stringify(state),{ctx,events}=gridRecorder(p.ctx);board.draw(ctx);const grid=events.find(e=>e.kind==='stroke'&&e.strokeStyle===boardThemeColors(theme).targetGrid);
   assert.equal(grid.path.length,cols+rows-2,'one line per internal cell boundary');
   const expected=[];for(let col=1;col<cols;col++)expected.push({from:board.worldToScreen({x:board.board.x+col*board.board.width/cols,y:board.board.y}),to:board.worldToScreen({x:board.board.x+col*board.board.width/cols,y:board.board.y+board.board.height})});
   for(let row=1;row<rows;row++)expected.push({from:board.worldToScreen({x:board.board.x,y:board.board.y+row*board.board.height/rows}),to:board.worldToScreen({x:board.board.x+board.board.width,y:board.board.y+row*board.board.height/rows})});
   assert.deepEqual(grid.path,expected);assert.equal(grid.screenWidth,.6);assert.deepEqual(grid.screenDash,[4,7]);const opacity=parseInt(grid.strokeStyle.slice(-2),16)/255*grid.globalAlpha;assert.ok(opacity>=.27&&opacity<=.36,'guide is a little stronger but remains lower contrast than the target frame');
   const frame=events.find(e=>e.kind==='stroke'&&e.strokeStyle===boardThemeColors(theme).targetLine),points=frame.path.flatMap(segment=>[segment.from,segment.to]),frameLeft=Math.min(...points.map(p=>p.x)),frameRight=Math.max(...points.map(p=>p.x));assert.ok(Math.abs(frameLeft-board.worldToScreen({x:board.board.x-9,y:0}).x)<1e-8);assert.ok(Math.abs(frameRight-board.worldToScreen({x:board.board.x+board.board.width+9,y:0}).x)<1e-8);assert.equal(frame.screenWidth,1);
   const firstPiece=events.findIndex(e=>e.kind==='image'&&e.source===board.atlas);assert.ok(events.indexOf(grid)<firstPiece);assert.ok(events.findIndex(e=>e.source===board.picture)<events.indexOf(grid),'grid follows the optional reference image');assert.equal(events[firstPiece].globalAlpha,1,'guide opacity is restored for piece art');assert.equal(JSON.stringify(state),before,'guides cannot alter room state');
  }
  board.destroy();
 }
});

test('native Canvas fallback keeps dashed guides aligned and phase-stable while clipping work to the visible board',()=>{
 for(const mode of ['missing','throw']){
  const {p,state,board}=setup(),{ctx,events}=gridRecorder(p.ctx,mode);board.setRect({x:27,y:65,w:390,h:400});board.camera={x:-board.board.x*1.35-135,y:-board.board.y*1.35-87,z:1.35};board.draw(ctx);
  const grid=events.find(e=>e.kind==='stroke'&&e.strokeStyle===boardThemeColors(board.theme).targetGrid),target=board.worldToScreen({x:board.board.x,y:board.board.y}),cellW=board.board.width/state.cols*board.camera.z,cellH=board.board.height/state.rows*board.camera.z;
  assert.ok(grid.path.length>0);assert.ok(grid.path.length<300,'offscreen dashes are skipped on native devices');assert.equal(grid.screenWidth,.6);
  for(const {from,to}of grid.path){const vertical=Math.abs(from.x-to.x)<1e-8,position=vertical?(from.x-target.x)/cellW:(from.y-target.y)/cellH,start=vertical?from.y-target.y:from.x-target.x,length=vertical?to.y-from.y:to.x-from.x;
   assert.ok(Math.abs(position-Math.round(position))<1e-8);assert.ok(position>.5&&position<(vertical?state.cols:state.rows)-.5,'only internal row/column boundaries');assert.ok(Math.abs(start/11-Math.round(start/11))<1e-8,'dash phase follows the target even after panning');assert.ok(length>0&&length<=4.0000001,'manual dashes stay four screen pixels');
  }
  board.destroy();
 }
});

test('wechat-style board sends claim/move/drop but never awards or merges before server response',async()=>{
 const {board,state}=setup(),events=[];await board.setImage('local-test.png');board.networkReady=true;
 board.network={canAcquire:()=>true,acquire:async id=>(events.push(['claim',id]),true),move:(...args)=>events.push(['move',...args]),drop:async(...args)=>events.push(['drop',...args]),release:id=>events.push(['release',id])};
 const group=state.groups.at(-1),start=piecePoint(board,group),before=structuredClone(state),target={...start,x:start.x-group.dx*board.camera.z,y:start.y-group.dy*board.camera.z};
 assert.equal(board.input({type:'down',points:[start],changed:[start]}),true);
 await Promise.resolve();board.input({type:'move',points:[target],changed:[target]});board.input({type:'up',points:[],changed:[target]});
 assert.equal(events[0][0],'claim');assert.equal(events.at(-1)[0],'drop');
 assert.equal(state.groups.find(v=>v.id===group.id).locked,false,'dropping at the correct position is still pending server authority');
 assert.equal(state.groups.length,before.groups.length);
 const confirmed=structuredClone(state);dropGroup(confirmed,group.id,snapTolerance(confirmed));board.syncRemote(confirmed,{},new Set());
 assert.equal(state.groups.find(v=>v.id===group.id).locked,true);
 board.destroy();
});

test('a release within 3/8 of a piece is aligned before the drop is sent, at any zoom',async()=>{
 const drop=async(z,frac)=>{
  const {board}=setup(),state=board.state,events=[];await board.setImage('local-test.png');board.networkReady=true;
  board.network={canAcquire:()=>true,acquire:async()=>true,move(){},drop:async(...args)=>events.push(args),release(){}};
  const unit=Math.min(board.board.width/state.cols,board.board.height/state.rows),group=state.groups.at(-1),off=unit*frac;
  for(const other of state.groups)if(other!==group){other.dx=-2000;other.dy=-2000;}
  group.dx=0;group.dy=0;board.camera={x:0,y:0,z:1};const spot=piecePoint(board,group);
  board.camera={x:board.rect.w/2-(spot.x-board.rect.x)*z,y:board.rect.h/2-(spot.y-board.rect.y)*z,z};
  const start=piecePoint(board,group);
  if(frac<.375)assert.ok(off>snapTolerance(state),'the old server tolerance alone would miss this drop');
  const target={...start,x:start.x+off*z};
  board.input({type:'down',points:[start],changed:[start]});await Promise.resolve();board.input({type:'move',points:[target],changed:[target]});board.input({type:'up',points:[],changed:[target]});
  board.destroy();return {sent:events.at(-1),group,off};
 };
 for(const z of [.3,2]){
  const inside=await drop(z,.35);assert.deepEqual(inside.sent,[inside.group.id,0,0],`at zoom ${z}, a finger-covered drop lands exactly on its spot`);
  const outside=await drop(z,.45);assert.equal(outside.sent[0],outside.group.id);assert.ok(Math.abs(outside.sent[1]-outside.off)<1e-6&&Math.abs(outside.sent[2])<1e-6,`at zoom ${z}, a drop beyond 3/8 of a piece keeps its place`);
 }
});

test('drop assist aligns with a matching neighbour unless another player holds it',()=>{
 const state=createFittedPuzzle('test',8,6,123),unit=100,find=id=>state.groups.find(g=>g.pieces.includes(id));
 for(const group of state.groups){group.dx=-2000;group.dy=-2000;}
 const a=find(9),b=find(10);b.dx=200;b.dy=150;a.dx=200+unit*.5;a.dy=150;
 assert.deepEqual(dropAssistOffset(state,a.id,unit*.6),{dx:200,dy:150});
 assert.equal(dropAssistOffset(state,a.id,unit*.6,new Set([b.id])),null);
 assert.equal(dropAssistOffset(state,a.id,unit*.4),null);
 const aligned=structuredClone(state),moved=aligned.groups.find(g=>g.id===a.id);moved.dx=200;moved.dy=150;
 assert.equal(dropGroup(aligned,a.id,snapTolerance(aligned)).joined,1,'the server joins an aligned drop with its own tolerance');
});

test('pending drags keep their location during snapshots; server refusal restores it',()=>{
 const {board,state}=setup(),server=structuredClone(state),group=state.groups[0];group.dx=321;group.dy=456;
 board.syncRemote(server,{'1':{name:'好友',color:'#789',level:12}},new Set([group.id]),false);
 assert.equal(state.groups.find(v=>v.id===group.id).dx,321);
 board.syncRemote(server,{},new Set(),false);assert.equal(state.groups.find(v=>v.id===group.id).dx,server.groups[0].dx);
 board.destroy();
});

test('placed pieces render below all loose groups, including after a reordered server snapshot',async()=>{
 const p=platform(),state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(p,state,()=>{});
 state.groups=[{id:0,pieces:[0],dx:0,dy:0,locked:false},{id:1,pieces:[1],dx:0,dy:0,locked:true},{id:2,pieces:[2,3],dx:0,dy:0,locked:false},{id:4,pieces:[4,5,6,7,8,9,10,11],dx:0,dy:0,locked:true}];
 board.setRect({x:0,y:0,w:390,h:600});await board.setImage('test.png');
 // Placed pieces are one cached layer filled from the picture; loose pieces are atlas tiles.
 // paint:n is a layer repaint clipping n outlines: new pieces plus their placed neighbours.
 const drawn=()=>{const before=JSON.stringify(state);p.commands.length=0;board.draw(p.ctx);assert.equal(JSON.stringify(state),before,'drawing must not reorder shared room state');const t=board.tile,c=p.commands,order=[];
  for(const [i,command] of c.entries()){if(command[0]!=='drawImage')continue;if(command[1]===board.atlas)order.push(command[2]/t.w+command[3]/t.h*t.columns);
   else if(command[1]===board.placedSurface?.canvas)order.push('placed');
   else if(command[1]===board.picture&&c[i-1]?.[0]==='stroke'){const start=c.findLastIndex((d,k)=>k<i&&d[0]==='beginPath');order.push('paint:'+c.slice(start,i).filter(d=>d[0]==='moveTo').length);}}
  return order;};
 assert.deepEqual(drawn(),['paint:9','placed',0,2,3]);
 const next=structuredClone(state);next.groups=[next.groups[2],next.groups[3],next.groups[0],next.groups[1]];board.syncRemote(next,{},new Set(),false);
 assert.deepEqual(drawn(),['placed',2,3,0],'an unchanged placed set reuses the layer');
 const placed=structuredClone(state);placed.groups.find(g=>g.id===0).locked=true;board.syncRemote(placed,{},new Set(),false);
 assert.deepEqual(drawn(),['paint:3','placed',2,3],'a newly placed group joins the picture below remaining loose groups, repainted with its placed neighbours');
 const restarted=structuredClone(state);restarted.groups.find(g=>g.id===4).locked=false;board.syncRemote(restarted,{},new Set(),false);
 assert.deepEqual(drawn(),['paint:2','placed',2,3,4,5,6,7,8,9,10,11],'pieces leaving the placed set repaint the layer from scratch');
 board.destroy();assert.equal(board.placedSurface,null);
});

test('overlapping loose pieces remain draggable above placed pieces with native and browser hit tests',async()=>{
 for(const native of [false,true]){
  const p=platform();if(native)p.ctx.isPointInPath=undefined;
  const state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(p,state,()=>{}),w=board.board.width/state.cols;
  for(const group of state.groups){group.locked=true;group.dx=0;group.dy=0;}
  const lower=state.groups[0],upper=state.groups[2];lower.locked=false;lower.dx=w;upper.locked=false;upper.dx=-w;
  board.setRect({x:0,y:0,w:390,h:600});await board.setImage('test.png');const claims=[];
  board.networkReady=true;board.network={acquire:async id=>(claims.push(id),true),move(){},drop:async()=>{},release(){}};
  const tap=()=>{const point=piecePoint(board,lower);board.input({type:'down',points:[point],changed:[point]});board.input({type:'cancel',points:[],changed:[point]});};
  tap();assert.equal(claims.at(-1),upper.id,'last loose piece is on top even when placed pieces follow it');
  raiseGroup(state,lower.id);tap();assert.equal(claims.at(-1),lower.id,'raising a loose group keeps draw and hit order consistent');board.destroy();
 }
});

test('pinching releases the lease rather than submitting an accidental puzzle drop',async()=>{
 const {board,state}=setup(),events=[];await board.setImage('test.png');board.networkReady=true;
 board.network={acquire:async()=>true,move(){},drop:async()=>events.push('drop'),release:()=>events.push('release')};
 const p=piecePoint(board,state.groups.at(-1)),b={id:2,x:p.x+10,y:p.y+10};
 board.input({type:'down',points:[p],changed:[p]});board.input({type:'down',points:[p,b],changed:[b]});const zoom=board.camera.z;
 board.input({type:'move',points:[p,{...b,x:b.x+30,y:b.y+30}],changed:[b]});
 assert.ok(board.camera.z>zoom);assert.deepEqual(events,['release']);board.destroy();
});

test('RoomClient injectable runtime works without browser networking and includes teammate level and equipped decoration',async()=>{
 const decoration={id:'rose-butterfly',title:'玫瑰蝶影',artKey:'butterfly',color:'#bf748c'},state=createFittedPuzzle('test',8,6,123),room={id:'a'.repeat(32),puzzle:state,revision:0,serverTime:10000,startedAt:9000,completedAt:null,members:[{id:'friend',name:'朋友',color:'#678',level:17,decoration}],leases:{0:{playerId:'friend',expires:20000}}},requests=[],events=[];let clock=10000,id=0,owners;
 const client=new RoomClient({token:'token',playerId:'me',room},{fetch:async(url,init)=>{requests.push({url,init});return{ok:true,status:200,headers:{get:()=>null},json:async()=>({...room,profile:{energy:40}})};},randomId:()=>String(++id).padStart(32,'0'),emit:(...args)=>events.push(args),hidden:()=>false,now:()=>clock,performanceNow:()=>clock});
 const table={network:null,networkReady:false,syncRemote(next,value){owners=value;},cancelNetworkDrag(){return false;},playConnectionSound(){},fit(){}};
 const detach=client.attach(table);await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(owners[0].level,17);assert.deepEqual(owners[0].decoration,decoration);assert.equal(events[0][0],'mobile:profile');
 assert.match(JSON.parse(requests[0].init.body).requestId,/^[0-9]{32}$/);
 clock=12500;assert.equal(client.elapsedNow(),3);
 detach();client.leave();await Promise.resolve();assert.equal(JSON.parse(requests.at(-1).init.body).type,'leave');
});

test('unchanged layout does not keep requesting idle redraws',()=>{
 const p=platform();let invalidations=0;const board=new PuzzleBoard(p,createFittedPuzzle('test',8,6,123),()=>invalidations++),r={x:0,y:80,w:390,h:600};board.setRect(r);invalidations=0;
 for(let n=0;n<10;n++)board.setRect({...r});assert.equal(invalidations,0);board.destroy();
});

test('image load cancellation settles without leaking a delayed image handler',async()=>{
 const p=platform(),images=[];p.createImage=()=>{const image={width:800,height:600};images.push(image);return image;};
 const board=new PuzzleBoard(p,createFittedPuzzle('test',8,6,123),()=>{}),first=board.setImage('first.png');const rejected=assert.rejects(first,error=>error.code==='IMAGE_LOAD_CANCELLED');
 const second=board.setImage('second.png');await rejected;assert.equal(images[0].onload,null);images[1].onload();await second;
 const third=board.setImage('third.png'),rejectedOnDestroy=assert.rejects(third,error=>error.code==='IMAGE_LOAD_CANCELLED');board.destroy();await rejectedOnDestroy;
});

test('platform image cache participates in loading and cancels pending source changes when leaving a room',async()=>{
 const p=platform(),loads=[];
 p.createImage=()=>({width:800,height:600,set src(_value){assert.fail('the board must use the platform image loader');}});
 p.setImageSource=(image,src)=>{const load={src,image,cancelled:false};loads.push(load);return()=>{load.cancelled=true;};};
 const board=new PuzzleBoard(p,createFittedPuzzle('test',8,6,123),()=>{});
 const first=board.setImage('https://game.example/puzzles/first.webp');
 const firstCancelled=assert.rejects(first,error=>error.code==='IMAGE_LOAD_CANCELLED');
 const second=board.setImage('https://game.example/puzzles/second.webp');
 await firstCancelled;assert.equal(loads[0].cancelled,true);assert.equal(loads[0].image.onload,null);
 loads[1].image.onload();await second;assert.equal(loads[1].cancelled,true);
 assert.ok(p.commands.some(([op,image])=>op==='drawImage'&&image===loads[1].image),'the current image is drawn');
 assert.equal(p.commands.some(([op,image])=>op==='drawImage'&&image===loads[0].image),false,'the cancelled image cannot replace this room');
 const third=board.setImage('https://game.example/puzzles/third.webp');
 const thirdCancelled=assert.rejects(third,error=>error.code==='IMAGE_LOAD_CANCELLED');
 board.destroy();await thirdCancelled;assert.equal(loads[2].cancelled,true);assert.equal(loads[2].image.onload,null);
});

test('completion uses the already loaded puzzle crop without another image request',async()=>{
 for(const [cols,rows]of [[10,5],[5,10]]){
  const p=platform(),createImage=p.createImage;let requests=0;p.createImage=()=>{requests++;return createImage();};
  const board=new PuzzleBoard(p,createFittedPuzzle('test',cols,rows,123),()=>{}),rect={x:20,y:40,w:300,h:200};
  assert.equal(board.drawCompletedPicture(p.ctx,rect),false,'wait for the original image when reopening a completed room');
  await board.setImage('https://game.example/finished.png');const before=JSON.stringify(board.state);p.commands.length=0;
  p.createImage=()=>assert.fail('completion must still display when a new download or decode would fail');
  for(let frame=0;frame<3;frame++)assert.equal(board.drawCompletedPicture(p.ctx,rect),true);
  assert.equal(requests,1);assert.equal(JSON.stringify(board.state),before);
  const draws=p.commands.filter(c=>c[0]==='drawImage');assert.equal(draws.length,3);
  for(const [,source,x,y,w,h]of draws){assert.equal(source,board.picture,'reuse the actual cropped puzzle image');assert.equal(w/h,cols/rows);assert.ok(x>=rect.x&&y>=rect.y&&x+w<=rect.x+rect.w&&y+h<=rect.y+rect.h,'entire picture fits inside the result frame');assert.equal(x+w/2,rect.x+rect.w/2);assert.equal(y+h/2,rect.y+rect.h/2);}
  board.destroy();assert.equal(board.drawCompletedPicture(p.ctx,rect),false,'do not display a destroyed room image');
 }
});

test('native contexts without isPointInPath can still hit true shared puzzle geometry',async()=>{
 const p=platform();p.ctx.isPointInPath=undefined;const state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{});board.setRect({x:0,y:80,w:390,h:600});await board.setImage('test.png');let claimed=null;
 board.networkReady=true;board.network={acquire:async id=>(claimed=id,true),move(){},drop:async()=>{},release(){}};
 const group=state.groups.at(-1),point=piecePoint(board,group);assert.equal(board.input({type:'down',points:[point],changed:[point]}),true);assert.equal(claimed,group.id);board.destroy();
});

test('optional tray locates pieces without changing state or acquiring a lease',async()=>{
 const {board,state,p}=setup();await board.setImage('test.png');const before=JSON.stringify(state);board.network={acquire:async()=>assert.fail('finder must not claim'),move:()=>assert.fail('finder must not move'),drop:async()=>assert.fail('finder must not drop'),release(){}};
 assert.equal(board.trayOpen,false);board.trayOpen=true;board.draw(p.ctx);const tray=board.trayLayout(),point={id:1,x:tray.r.x+tray.cellW/2+8,y:tray.r.y+tray.top+tray.cellH/2};board.input({type:'down',points:[point],changed:[point]});board.input({type:'up',points:[],changed:[point]});
 assert.equal(JSON.stringify(state),before);assert.equal(board.focusedPiece,tray.groups[0].pieces[0]);assert.ok(board.camera.z*board.board.width/state.cols>=54);board.destroy();
});

test('opening camera shows the full target and all scattered pieces above floating controls',async()=>{
 for(const [cols,rows]of [[8,6],[10,5],[12,9],[20,15],[25,20]])for(const [width,height]of [[390,746],[844,290]]){
  const p=platform(),state=createFittedPuzzle('test',cols,rows,123),board=new PuzzleBoard(p,state,()=>{}),before=JSON.stringify(state);board.setRect({x:0,y:98,w:width,h:height});await board.setImage('test.png');board.openMobileView({bottom:72});
  const {x,y,z}=board.camera,target=board.board,pieceW=target.width/cols,pieceH=target.height/rows,pad=board.tile.pad,availableHeight=height-72;
  const visible=(left,top,right,bottom,label)=>{assert.ok(x+left*z>=11.99,label+' left');assert.ok(x+right*z<=width-11.99,label+' right');assert.ok(y+top*z>=10,label+' top');assert.ok(y+bottom*z<=availableHeight-10,label+' bottom');};
  visible(target.x,target.y,target.x+target.width,target.y+target.height,'complete target');
  for(const group of state.groups)for(const id of group.pieces){const left=target.x+(id%cols)*pieceW+group.dx,top=target.y+Math.floor(id/cols)*pieceH+group.dy;visible(left-pad,top-pad,left+pieceW+pad,top+pieceH+pad,'piece '+id);}
  assert.equal(JSON.stringify(state),before,'opening the camera never rearranges pieces');board.destroy();
 }
});

test('shared cursor projection respects the canvas offset and camera without moving pieces',()=>{
 const {board,state,p}=setup(),before=JSON.stringify(state),sent=[];board.onCursor=point=>sent.push(point);const world={x:640,y:490},screen=board.worldToScreen(world);
 assert.deepEqual(board.screenToWorld(screen),world);assert.equal(board.screenToWorld({x:-1,y:-1}),null);
 board.input({type:'move',points:[],changed:[{id:1,...screen}]});assert.deepEqual(sent.at(-1),world);
 board.input({type:'cancel',points:[],changed:[{id:1,...screen}]});assert.deepEqual(sent.at(-1),world);
 const decoration={id:'rose-butterfly',artKey:'butterfly',title:'蝶影',color:'#789'},drawn=[];board.drawDecoration=(value,r)=>drawn.push({value,r});
 board.setCursors([{playerId:'friend',name:'朋友',level:20,color:'#789',decoration,updatedAt:Date.now(),...world}]);board.draw(p.ctx);
 assert.ok(p.commands.some(c=>c[0]==='fillText'&&c[1]==='朋友 · Lv.20'));const teammate=drawn.find(d=>d.value.id===decoration.id);assert.ok(teammate);assert.equal(teammate.r.x+teammate.r.w/2,screen.x);assert.equal(teammate.r.y+teammate.r.h/2,screen.y);assert.equal(JSON.stringify(state),before);board.destroy();
});

test('own decoration persists at its room position through release, pointer exit, hiding, tools and camera changes',()=>{
 const {board,state,p}=setup(),before=JSON.stringify(state),sent=[],drawn=[];board.onCursor=point=>sent.push(point);board.selfDecoration={id:'rose-butterfly',artKey:'butterfly',title:'蝶影',color:'#789'};board.drawDecoration=(value,r)=>drawn.push({value,r});
 const world={x:640,y:490},point={id:1,...board.worldToScreen(world)},check=()=>{drawn.length=0;board.draw(p.ctx);assert.equal(drawn.length,1);const {r}=drawn[0],screen=board.worldToScreen(world);assert.ok(Math.abs(r.x+r.w/2-screen.x)<1e-8);assert.ok(Math.abs(r.y+r.h/2-screen.y)<1e-8);};
 board.input({type:'down',points:[point],changed:[point]});check();
 board.input({type:'up',points:[],changed:[point]});check();assert.deepEqual(sent.at(-1),world,'the final position stays available to teammates after a finger lifts');assert.equal(JSON.stringify(state),before);
 board.input({type:'cancel',points:[],changed:[]});check();
 board.input({type:'move',points:[],changed:[{...point,x:-1,y:-1}]});check();
 board.input({type:'down',points:[point],changed:[point]});board.input({type:'up',points:[],changed:[{...point,x:-1,y:-1}]});check();
 p.hide();check();board.edgeOnly=true;check();board.edgeOnly=false;board.trayOpen=true;check();board.trayOpen=false;check();
 board.zoom(1.2);check();board.camera.x+=17;board.camera.y-=9;check();
 const a={id:1,...board.worldToScreen(world)},b={id:2,x:a.x+25,y:a.y+25};board.input({type:'down',points:[a],changed:[a]});board.input({type:'down',points:[a,b],changed:[b]});check();
 const c={...b,x:b.x+10,y:b.y+10};board.input({type:'move',points:[a,c],changed:[c]});check();board.input({type:'cancel',points:[],changed:[]});check();
 assert.ok(sent.every(point=>point!==null),'temporary pointer loss never sends a room departure');assert.equal(JSON.stringify(state),before);
 board.destroy();drawn.length=0;board.draw(p.ctx);assert.equal(drawn.length,0);assert.equal(sent.at(-1),null,'only actual room destruction clears the decoration');assert.equal(sent.filter(point=>point===null).length,1);
});

test('teammate decorations do not expire while idle but disappear when the server removes the member',()=>{
 const {board,p}=setup(),drawn=[];let nextFrame;p.frame=fn=>(nextFrame=fn,1);board.drawDecoration=(value,r)=>drawn.push({value,r});
 const cursor={playerId:'friend',name:'朋友',level:20,color:'#789',decoration:{id:'rose-butterfly',artKey:'butterfly',title:'蝶影',color:'#789'},updatedAt:Date.now()-60000,x:640,y:490};
 board.setCursors([cursor]);board.draw(p.ctx);assert.equal(drawn.length,1,'an idle teammate remains after the former ten-second timeout');
 board.setCursors([{...cursor,x:cursor.x+20}]);assert.ok(nextFrame);nextFrame();drawn.length=0;board.draw(p.ctx);assert.equal(drawn.length,1,'cursor interpolation cannot discard an idle member');
 board.setCursors([]);drawn.length=0;board.draw(p.ctx);assert.equal(drawn.length,0,'authoritative room departure removes the decoration');board.destroy();
});

test('hiding or cancelling a drag releases its lease while retaining the last valid decoration position',async()=>{
 for(const action of ['hide','cancel']){
  const {board,state,p}=setup(),events=[],sent=[],drawn=[];await board.setImage('test.png');board.networkReady=true;
  board.network={acquire:async()=>true,move:()=>events.push('move'),drop:async()=>events.push('drop'),release:()=>events.push('release')};board.onCursor=point=>sent.push(point);board.selfDecoration={id:'rose-butterfly',artKey:'butterfly',title:'蝶影',color:'#789'};board.drawDecoration=(value,r)=>drawn.push({value,r});
  const point=piecePoint(board,state.groups.at(-1));board.input({type:'down',points:[point],changed:[point]});if(action==='hide')p.hide();else board.input({type:'cancel',points:[],changed:[]});
  assert.deepEqual(events,['release']);board.draw(p.ctx);assert.equal(drawn.length,1);assert.ok(sent.at(-1));
  board.input({type:'move',points:[point],changed:[point]});board.input({type:'up',points:[],changed:[point]});assert.deepEqual(events,['release'],'cancelled pieces cannot remain attached to the pointer');board.destroy();assert.equal(sent.at(-1),null);
 }
});

test('confirmed shared-canvas drops restore the original sparks and actual XP once, even when a poll wins',async()=>{
 const oldNow=Date.now;let now=10000;Date.now=()=>now;
 const {board,state,p}=setup();let resolveDrop,confirm;
 try{
  await board.setImage('test.png');board.networkReady=true;
  board.network={acquire:async()=>true,move(){},drop:async id=>{await new Promise(resolve=>{resolveDrop=resolve;});const next=structuredClone(state),group=next.groups.find(g=>g.id===id);group.dx=group.dy=0;dropGroup(next,id,snapTolerance(next));board.syncRemote(next,{},new Set());confirm={requestId:'actual-drop',groupId:id,creditedXp:3};},release(){}};
  const group=state.groups.at(-1),point=piecePoint(board,group);board.input({type:'down',points:[point],changed:[point]});await Promise.resolve();board.input({type:'up',points:[],changed:[point]});
  assert.equal(board.flashes.length,0,'pending or rejected positions cannot celebrate');resolveDrop();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(board.flashes.length,1);assert.equal(board.flashes[0].local,true,'drop stays local after RoomClient clears its active reservation');assert.equal(board.flashes[0].xp,undefined,'a successful topology change cannot invent XP');
  board.confirmMobileContribution(confirm);board.confirmMobileContribution(confirm);assert.equal(board.flashes.length,1);assert.equal(board.flashes[0].xp,3);assert.equal(board.pendingDrops.size,0);
  now+=100;const effects=[];let fillStyle='';const ctx=new Proxy(p.ctx,{get(target,key){if(key==='arc')return(...args)=>{if(fillStyle==='#fff2b0')effects.push(args);};return target[key];},set(target,key,value){if(key==='fillStyle')fillStyle=value;target[key]=value;return true;}});p.commands.length=0;board.draw(ctx);
  assert.equal(effects.length,4,'restore the original four small sparks');assert.equal(p.commands.filter(c=>c[0]==='fillText'&&c[1]==='+3 XP').length,1);
  board.syncRemote(structuredClone(state),{},new Set());assert.equal(board.flashes.length,1,'poll echoes cannot replay the burst');now+=501;p.commands.length=0;effects.length=0;board.draw(ctx);assert.equal(effects.length,0);assert.equal(p.commands.some(c=>c[0]==='fillText'&&c[1]==='+3 XP'),false);
 }finally{board.destroy();Date.now=oldNow;}
});

test('shared snap accents follow the merged group and camera while remaining screen-sized',()=>{
 const oldNow=Date.now;let now=10000;Date.now=()=>now;const {board,state,p}=setup();
 try{
  const next=structuredClone(state),first=next.groups[0];first.locked=true;first.dx=first.dy=0;board.syncRemote(next,{},new Set([first.id]));board.confirmMobileContribution({requestId:'anchor',groupId:first.id,creditedXp:2});now+=100;
  const draw=()=>{let style={x:0,y:0,z:1,fillStyle:''},stack=[];const stars=[],labels=[];const project=(x,y)=>({x:style.x+x*style.z,y:style.y+y*style.z});const methods={save(){stack.push({...style});},restore(){style=stack.pop();},translate(x,y){style.x+=x*style.z;style.y+=y*style.z;},scale(x,y){assert.equal(x,y);style.z*=x;},arc(x,y,r){if(style.fillStyle==='#fff2b0')stars.push({...project(x,y),radius:r*style.z});},fillText(text,x,y){if(text==='+2 XP')labels.push(project(x,y));}};const ctx=new Proxy(methods,{get:(target,key)=>key in target?target[key]:key in style?style[key]:p.ctx[key],set:(_target,key,value)=>(style[key]=value,true)});board.draw(ctx);return{stars,labels};};
  const before=draw();board.camera.x+=39;board.camera.y-=17;const moved=draw();assert.equal(before.stars.length,4);assert.equal(before.labels.length,1);
  for(let i=0;i<4;i++){assert.ok(Math.abs(moved.stars[i].x-before.stars[i].x-39)<1e-8);assert.ok(Math.abs(moved.stars[i].y-before.stars[i].y+17)<1e-8);}
  board.camera.z*=2;const zoomed=draw();assert.deepEqual(zoomed.stars.map(s=>s.radius),before.stars.map(s=>s.radius),'spark size does not grow with puzzle zoom');assert.ok(Math.abs((zoomed.stars[0].x-zoomed.stars[1].x)-(before.stars[0].x-before.stars[1].x))<1e-8);
 }finally{board.destroy();Date.now=oldNow;}
});

test('initial snapshots, teammate updates, hidden tabs and reduced motion cannot replay local snap rewards',()=>{
 const oldNow=Date.now,oldMedia=globalThis.matchMedia;let now=10000;Date.now=()=>now;globalThis.matchMedia=()=>({matches:true});const {board,state,p}=setup();
 try{
  const initial=structuredClone(state);initial.groups[0].locked=true;board.syncRemote(initial,{},new Set(),false);assert.equal(board.flashes.length,0);
  const remote=structuredClone(state);remote.groups[1].locked=true;board.syncRemote(remote,{},new Set());assert.equal(board.flashes.length,1);assert.equal(board.flashes[0].local,false);assert.equal(board.flashes[0].until-now,170);
  now+=40;p.commands.length=0;board.draw(p.ctx);assert.equal(p.commands.some(c=>c[0]==='fillText'&&String(c[1]).includes(' XP')),false);
  p.hide();assert.equal(board.flashes.length,0);const hidden={requestId:'hidden',groupId:1,creditedXp:2};board.confirmMobileContribution(hidden);p.show();board.confirmMobileContribution(hidden);assert.equal(board.flashes.length,0,'a hidden acknowledgement is consumed without later replay');
  board.confirmMobileContribution({requestId:'zero',groupId:1,creditedXp:0});assert.equal(board.flashes.length,0);
  board.confirmMobileContribution({requestId:'fresh',groupId:1,creditedXp:2});assert.equal(board.flashes[0].reduced,true);now+=40;const arcs=[];let color='';const ctx=new Proxy(p.ctx,{get:(target,key)=>key==='arc'?(...args)=>{if(color==='#fff2b0')arcs.push(args);}:target[key],set:(target,key,value)=>{if(key==='fillStyle')color=value;target[key]=value;return true;}});board.draw(ctx);assert.equal(arcs.length,0,'reduced motion retains a short static outline and XP without sparks');
 }finally{board.destroy();Date.now=oldNow;if(oldMedia===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=oldMedia;}
});

test('a locked view keeps one finger off the camera, forgives a near miss and still pans with a second finger',async()=>{
 const run=async locked=>{
  const {board,state}=setup(),events=[],notices=[];await board.setImage('test.png');board.networkReady=true;board.onNotice=m=>notices.push(m);board.viewLocked=locked;
  board.network={canAcquire:()=>true,acquire:async()=>true,move(){},drop:async(...args)=>events.push(['drop',...args]),release:()=>events.push(['release'])};
  const group=state.groups.at(-1);for(const other of state.groups)if(other!==group){other.dx=-4000;other.dy=-4000;}
  board.camera={x:0,y:0,z:.5};const spot=piecePoint(board,group);board.camera={x:board.rect.w/2-(spot.x-board.rect.x),y:board.rect.h/2-(spot.y-board.rect.y),z:.5};
  const start={...board.camera},w=board.board.width/state.cols*.5,center=piecePoint(board,group),near={id:1,x:center.x+w/2+w*.27+8,y:center.y};
  const before=group.dx;board.input({type:'down',points:[near],changed:[near]});await Promise.resolve();
  const moved={...near,x:near.x+40,y:near.y+30};board.input({type:'move',points:[moved],changed:[moved]});
  const camera={...board.camera},dragged={dx:group.dx-before};board.input({type:'up',points:[],changed:[moved]});
  board.destroy();return{camera:{x:camera.x-start.x,y:camera.y-start.y},dragged,events,notices};
 };
 const free=await run(false);assert.deepEqual([free.camera.x,free.camera.y],[40,30],'unlocked, a missed touch pans the table');assert.deepEqual(free.events,[]);
 const held=await run(true);assert.deepEqual([held.camera.x,held.camera.y],[0,0],'locked, the table stays put');assert.ok(held.events.some(e=>e[0]==='drop'),'the near miss picked up the piece');assert.ok(Math.abs(held.dragged.dx-80)<1e-6,'the piece follows the finger');assert.equal(free.dragged.dx,0);

 const {board}=setup();await board.setImage('test.png');board.viewLocked=true;const notices=[];board.onNotice=m=>notices.push(m);
 for(const other of board.state.groups){other.dx=-4000;other.dy=-4000;}board.camera={x:0,y:0,z:1};
 const a={id:1,x:200,y:300},b={id:2,x:260,y:300};board.input({type:'down',points:[a],changed:[a]});board.input({type:'move',points:[{...a,x:240}],changed:[{...a,x:240}]});
 assert.deepEqual([board.camera.x,board.camera.y],[0,0]);assert.ok(board.backgroundTouch,'a locked empty touch still counts as a background touch');assert.equal(notices.length,1,'the first swipe explains the lock');
 board.input({type:'down',points:[{...a,x:240},b],changed:[b]});board.input({type:'move',points:[{...a,x:280},{...b,x:300}],changed:[{...a,x:280},{...b,x:300}]});
 assert.ok(Math.abs(board.camera.x-40)<1e-6&&Math.abs(board.camera.z-1)<1e-9,'two fingers still move the view');board.destroy();
});

test('the reference thumbnail opens a large view that pinches, pans within bounds, double-tap zooms and closes on the backdrop',async()=>{
 const {p,board}=setup();await board.setImage('test.png');board.showPreview=true;board.draw(p.ctx);
 const thumb=board.previewThumb;assert.ok(thumb,'the thumbnail has a hit area');
 const t={id:1,x:thumb.x+thumb.w/2,y:thumb.y+thumb.h/2};assert.equal(board.input({type:'down',points:[t],changed:[t]}),true);board.input({type:'up',points:[],changed:[t]});
 assert.ok(board.previewZoomed);board.draw(p.ctx);assert.equal(board.previewThumb,null,'the thumbnail hides while the large view is open');
 const image=board.previewImageRect(),mid={x:image.x+image.w/2,y:image.y+image.h/2},a={id:1,x:mid.x-40,y:mid.y},b={id:2,x:mid.x+40,y:mid.y};
 board.input({type:'down',points:[a],changed:[a]});board.input({type:'down',points:[a,b],changed:[b]});
 board.input({type:'move',points:[{...a,x:mid.x-120},{...b,x:mid.x+120}],changed:[{...a,x:mid.x-120},{...b,x:mid.x+120}]});
 assert.ok(Math.abs(board.previewView.z-3)<1e-9,'pinching spreads the reference');assert.ok(Math.abs(board.previewView.x)<1e-9,'about the pinch centre');
 board.input({type:'up',points:[],changed:[{...a,x:mid.x-120},{...b,x:mid.x+120}]});assert.ok(board.previewZoomed,'a pinch never closes the view');
 const d={id:3,x:mid.x,y:mid.y};board.input({type:'down',points:[d],changed:[d]});board.input({type:'move',points:[{...d,x:mid.x+5000}],changed:[{...d,x:mid.x+5000}]});
 const {area,fit}=board.previewLayout();assert.ok(Math.abs(board.previewView.x-(fit.w*3-area.w)/2)<1e-6,'panning stops at the picture edge');board.input({type:'up',points:[],changed:[{...d,x:mid.x+5000}]});
 const tap=q=>{board.input({type:'down',points:[q],changed:[q]});board.input({type:'up',points:[],changed:[q]});};
 tap({id:4,x:mid.x,y:mid.y});tap({id:4,x:mid.x,y:mid.y});assert.deepEqual(board.previewView,{z:1,x:0,y:0},'double tap returns to the whole picture');
 tap({id:5,x:mid.x+10,y:mid.y});tap({id:5,x:mid.x+10,y:mid.y});assert.equal(board.previewView.z,3,'double tap zooms in');
 board.previewView={z:1,x:0,y:0};tap({id:6,x:board.rect.x+4,y:board.rect.y+board.rect.h-4});assert.equal(board.previewZoomed,false,'a tap on the backdrop closes it');assert.ok(board.showPreview,'the thumbnail stays on');
 board.openPreviewZoom();board.showPreview=false;assert.equal(board.previewZoomed,false);board.destroy();
});

test('a teammate holding a group shows one name and one pointer: the shared cursor when on screen, else the group label',()=>{
 const {board,state,p}=setup(),group=state.groups[0],owners={[group.id]:{playerId:'friend',name:'好友',color:'#789',level:12}};
 const labels=()=>p.commands.filter(c=>c[0]==='fillText').map(c=>c[1]),draw=()=>{p.commands.length=0;board.draw(p.ctx);return labels();};
 try{
  board.syncRemote(structuredClone(state),owners,new Set(),false);
  let text=draw();assert.ok(text.includes('好友 Lv.12'),'no cursor yet: the held group carries the name');assert.ok(!text.includes('好友 · Lv.12'));
  const onScreen=board.screenToWorld({x:board.rect.x+120,y:board.rect.y+160});
  board.setCursors([{playerId:'friend',name:'好友',level:12,color:'#789',updatedAt:Date.now(),...onScreen}]);
  text=draw();assert.ok(text.includes('好友 · Lv.12'),'the cursor names the player');assert.ok(!text.includes('好友 Lv.12'),'the held group drops its duplicate label');
  assert.ok(p.commands.some(c=>c[0]==='stroke'),'the group keeps its coloured outline');
  board.phoneLandscapeRoom=true;text=draw();assert.equal(text.filter(t=>String(t).startsWith('好友')).length,1,'landscape room: still one name');board.phoneLandscapeRoom=false;
  board.setCursors([]);board.setCursors([{playerId:'friend',name:'好友',level:12,color:'#789',updatedAt:Date.now(),x:onScreen.x+100000,y:onScreen.y}]);
  text=draw();assert.ok(text.includes('好友 Lv.12'),'cursor off screen: the group label returns');assert.ok(!text.includes('好友 · Lv.12'));
  board.setCursors([{playerId:'friend',name:'好友',level:12,color:'#789',updatedAt:Date.now(),...onScreen}]);
  board.syncRemote(structuredClone(state),{[group.id]:{name:'好友',color:'#789',level:12}},new Set(),false);
  text=draw();assert.ok(text.includes('好友 Lv.12'),'an owner without a player id (older room client) keeps its label');
  board.setCursors([]);board.syncRemote(structuredClone(state),owners,new Set(),false);
  text=draw();assert.equal(text.filter(t=>String(t).startsWith('好友')).length,1,'stale cursor removed: the label is the one name');
 }finally{board.destroy();}
});

test('默契拼合: a seam joined from two players\' holds plays one burst for everyone, respecting hidden and reduced motion',async()=>{
 const oldNow=Date.now,oldMatch=globalThis.matchMedia;let now=20000;Date.now=()=>now;
 try{
  const run=({hide=false,reduced=false}={})=>{
   globalThis.matchMedia=reduced?()=>({matches:true}):oldMatch;
   const {board,state,p}=setup(),sounds=[];p.playSound=url=>sounds.push(url);board.chimeUrl='chime.wav';
   const a=state.groups.find(g=>g.pieces[0]===0),b=state.groups.find(g=>g.pieces[0]===1);
   board.syncRemote(structuredClone(state),{[a.id]:{playerId:'pa',name:'小红',color:'#e06'},[b.id]:{playerId:'pb',name:'小蓝',color:'#06e'}},new Set());
   now+=600;const released=structuredClone(state);board.syncRemote(released,{[b.id]:{playerId:'pb',name:'小蓝',color:'#06e'}},new Set());
   if(hide)p.hide();
   now+=900;const merged=structuredClone(state),ga=merged.groups.find(g=>g.id===a.id),gb=merged.groups.find(g=>g.id===b.id);ga.pieces.push(...gb.pieces);gb.dx=ga.dx;merged.groups=merged.groups.filter(g=>g!==gb);
   board.syncRemote(merged,{},new Set());
   now+=300;p.commands.length=0;board.draw(p.ctx);const text=p.commands.filter(c=>c[0]==='fillText').map(c=>c[1]);
   const result={bursts:board.teamBursts.length,reduced:board.teamBursts[0]?.reduced,text,sounds:[...sounds],flashes:board.flashes.length};
   now+=1600;p.commands.length=0;board.draw(p.ctx);result.after=p.commands.some(c=>c[0]==='fillText'&&c[1]==='默契拼合！');board.destroy();return result;
  };
  const shown=run();
  assert.equal(shown.bursts,1);assert.ok(shown.text.includes('默契拼合！'));assert.ok(shown.text.includes('小红 × 小蓝'));assert.deepEqual(shown.sounds,['chime.wav']);
  assert.equal(shown.flashes,1,'the ordinary snap glow still plays');assert.equal(shown.after,false,'the burst ends after 1.5 s');
  const hidden=run({hide:true});assert.equal(hidden.bursts,0);assert.deepEqual(hidden.sounds,[]);
  const reduced=run({reduced:true});assert.equal(reduced.bursts,1);assert.equal(reduced.reduced,true);assert.ok(!reduced.text.includes('默契拼合！'),'reduced motion: glow only');
  // The same player on both sides, or a partner whose hold ended over 3 s ago, is an ordinary snap.
  globalThis.matchMedia=oldMatch;
  const {board,state}=setup(),a=state.groups.find(g=>g.pieces[0]===0),b=state.groups.find(g=>g.pieces[0]===1);
  board.syncRemote(structuredClone(state),{[a.id]:{playerId:'pa',name:'小红',color:'#e06'}},new Set());board.syncRemote(structuredClone(state),{[b.id]:{playerId:'pb',name:'小蓝',color:'#06e'}},new Set());
  now+=3200;const merged=structuredClone(state),ga=merged.groups.find(g=>g.id===a.id),gb=merged.groups.find(g=>g.id===b.id);ga.pieces.push(...gb.pieces);merged.groups=merged.groups.filter(g=>g!==gb);
  board.syncRemote(merged,{},new Set());assert.equal(board.teamBursts.length,0,'a released its hold 3.2 s before the merge');
  board.destroy();
 }finally{Date.now=oldNow;globalThis.matchMedia=oldMatch;}
});
