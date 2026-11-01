import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleBoard,PINCH_GRACE_MS,GRIP_MS,GRIP_EDGE_PX } from '../mobile/puzzle-board.ts';
import { createFittedPuzzle } from '../lib/puzzle-engine.ts';

function platform(){
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {commands,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
// Date.now drives the pinch grace and the grip timers; every test moves it by hand.
let clock=1_800_000_000_000;const realNow=Date.now;
test.beforeEach(()=>{clock=1_800_000_000_000;Date.now=()=>clock;});
test.afterEach(()=>{Date.now=realNow;});
async function setup(){
 const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{}),events=[];
 board.setRect({x:10,y:80,w:390,h:600});await board.setImage('test.png');board.networkReady=true;
 board.network={canAcquire:()=>true,acquire:async id=>(events.push(['claim',id]),true),move:()=>{},drop:async(id)=>events.push(['drop',id]),release:id=>events.push(['release',id])};
 return {p,state,board,events};
}
function piecePoint(board,group,id=1){const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,piece=group.pieces[0];return{id,x:board.rect.x+board.camera.x+(board.board.x+(piece%board.state.cols+.5)*w+group.dx)*board.camera.z,y:board.rect.y+board.camera.y+(board.board.y+(Math.floor(piece/board.state.cols)+.5)*h+group.dy)*board.camera.z};}
/** A point on bare table, away from the edges unless asked. */
function emptyPoint(board,id,{edge=false}={}){
 const r=board.rect,xs=edge?[r.x+4]:Array.from({length:30},(_,n)=>r.x+40+n*10),ys=Array.from({length:50},(_,n)=>r.y+40+n*10);
 for(const y of ys)for(const x of xs){const p={id,x,y};if(!board.groupAt(p))return p;}
 throw Error('no empty point');
}
const down=(board,points,changed)=>board.input({type:'down',points,changed});
const move=(board,points,changed=points)=>board.input({type:'move',points,changed});
const up=(board,points,changed)=>board.input({type:'up',points,changed});
const groupOf=(state,id)=>state.groups.find(g=>g.id===id);

test('a second finger within the pinch grace of grabbing a piece zooms and leaves the piece where it was',async()=>{
 const {board,state,events}=await setup(),group=state.groups.at(-1),before={dx:group.dx,dy:group.dy},p=piecePoint(board,group),b={id:2,x:p.x+40,y:p.y+40};
 down(board,[p],[p]);await Promise.resolve();clock+=PINCH_GRACE_MS-50;down(board,[p,b],[b]);
 const zoom=board.camera.z;move(board,[p,{...b,x:b.x+60,y:b.y+60}],[{...b,x:b.x+60,y:b.y+60}]);
 assert.ok(board.camera.z>zoom,'the two fingers zoom');
 up(board,[],[p,b]);
 assert.deepEqual(events.filter(([kind])=>kind!=='claim'),[['release',group.id]],'the piece is released, never dropped');
 assert.deepEqual({dx:groupOf(state,group.id).dx,dy:groupOf(state,group.id).dy},before,'the piece stays where it was');
 board.destroy();
});

test('after the grace, or once the piece has moved, a second finger pans while the piece stays held',async()=>{
 for(const variant of ['late','moved']){
  const {board,state,events}=await setup(),group=state.groups.at(-1),p=piecePoint(board,group),b={id:2,x:p.x+60,y:p.y+90};
  down(board,[p],[p]);await Promise.resolve();
  let finger=p;
  if(variant==='late')clock+=PINCH_GRACE_MS+50;
  else{clock+=60;finger={...p,x:p.x+20,y:p.y+12};move(board,[finger]);clock+=40;}
  down(board,[finger,b],[b]);const zoom=board.camera.z,camera={...board.camera};
  move(board,[finger,{...b,x:b.x+50,y:b.y-30}],[{...b,x:b.x+50,y:b.y-30}]);
  assert.equal(board.camera.z,zoom,variant+': no zoom');assert.notDeepEqual({x:board.camera.x,y:board.camera.y},{x:camera.x,y:camera.y},variant+': the second finger pans');
  up(board,[{...b,x:b.x+50,y:b.y-30}],[finger]);await Promise.resolve();
  assert.ok(events.some(([kind,id])=>kind==='drop'&&id===group.id),variant+': lifting the holding finger drops the piece');
  board.destroy();
 }
});

test('a finger held still for the grip time does not turn the next touch into a pinch',async()=>{
 const {board,state,events}=await setup(),grip=emptyPoint(board,7),group=state.groups.at(-1),p=piecePoint(board,group,8);
 down(board,[grip],[grip]);clock+=GRIP_MS+50;
 down(board,[grip,p],[p]);await Promise.resolve();
 assert.deepEqual(events[0],['claim',group.id],'the new finger picks up the piece');
 const zoom=board.camera.z,target={...p,x:p.x+30,y:p.y+30};
 move(board,[grip,target],[target]);assert.equal(board.camera.z,zoom,'no zoom');
 up(board,[grip],[target]);await Promise.resolve();
 assert.ok(events.some(([kind,id])=>kind==='drop'&&id===group.id),'the piece is dropped where the finger lifted');
 // The resting finger stays ignored until it lifts; afterwards the table behaves normally.
 move(board,[{...grip,x:grip.x+40}],[{...grip,x:grip.x+40}]);up(board,[],[grip]);
 const camera={...board.camera},a=emptyPoint(board,9);down(board,[a],[a]);move(board,[{...a,x:a.x+25}]);up(board,[],[{...a,x:a.x+25}]);
 assert.notEqual(board.camera.x,camera.x,'a fresh finger pans again');
 board.destroy();
});

test('a finger that landed on the board edge is a grip even right away',async()=>{
 const {board,state,events}=await setup(),edge=emptyPoint(board,3,{edge:true}),group=state.groups.at(-1),p=piecePoint(board,group,4);
 assert.ok(edge.x-board.rect.x<=GRIP_EDGE_PX);
 down(board,[edge],[edge]);clock+=50;down(board,[edge,p],[p]);await Promise.resolve();
 const zoom=board.camera.z,target={...p,x:p.x-25,y:p.y+20};move(board,[edge,target],[target]);
 assert.equal(board.camera.z,zoom);assert.deepEqual(events[0],['claim',group.id]);
 up(board,[edge],[target]);await Promise.resolve();assert.ok(events.some(([kind])=>kind==='drop'));
 board.destroy();
});

test('two quick fingers on bare table still pinch-zoom',async()=>{
 const {board}=await setup(),a=emptyPoint(board,1),b={...emptyPoint(board,2),x:a.x+30};
 down(board,[a],[a]);clock+=30;down(board,[a,b],[b]);const zoom=board.camera.z;
 move(board,[{...a,x:a.x-30},{...b,x:b.x+30}]);assert.ok(board.camera.z>zoom);
 up(board,[],[a,b]);board.destroy();
});

test('the 原图 thumbnail opens on lift; a drag that starts on it reaches the table',async()=>{
 const {p,board}=await setup();board.showPreview=true;board.draw(p.ctx);
 const r=board.previewThumb;assert.ok(r,'thumbnail drawn');const t={id:1,x:r.x+r.w/2,y:r.y+r.h/2};
 assert.equal(down(board,[t],[t]),true);assert.equal(board.previewZoomed,false,'nothing opens on touch-down');
 up(board,[],[t]);assert.equal(board.previewZoomed,true,'a tap opens the large view on lift');
 board.showPreview=false;board.showPreview=true;board.draw(p.ctx);
 const camera={...board.camera};down(board,[t],[t]);move(board,[{...t,x:t.x-40,y:t.y+30}]);
 assert.equal(board.previewZoomed,false,'a drag never opens the large view');
 assert.ok(board.pan||board.drag,'the table took over the finger');
 move(board,[{...t,x:t.x-70,y:t.y+50}]);up(board,[],[{...t,x:t.x-70,y:t.y+50}]);
 if(!board.drag)assert.notDeepEqual({x:board.camera.x,y:board.camera.y},{x:camera.x,y:camera.y},'the view panned');
 board.destroy();
});
