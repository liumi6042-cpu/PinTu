import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,DRAG_SLOP,TRAY_STRIP_PX,TRAY_PIECE_FILL} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// Players asked (11-03) for the corner map while the tray is open, and for bigger tray pieces.
function platform(){
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {commands,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
/** The room areas mobile/app.ts gives the board on a 390x844 portrait and an 844x390 landscape phone. */
const LAYOUTS={
 portrait:{rect:{x:0,y:77,w:390,h:767},topInset:6,thumbInset:null,landscape:false},
 landscape:{rect:{x:0,y:0,w:844,h:390},topInset:58,thumbInset:101,landscape:true},
};
async function setup(layout,{cols=8,rows=6}={}){
 const p=platform(),state=createFittedPuzzle('test',cols,rows,123),board=new PuzzleBoard(p,state,()=>{}),events=[],l=LAYOUTS[layout];
 board.setRect(l.rect);await board.setImage('test.png');board.networkReady=true;board.phoneLandscapeRoom=l.landscape;board.previewTopInset=l.topInset;board.previewThumbInset=l.thumbInset;
 board.network={canAcquire:()=>true,acquire:async id=>(events.push(['claim',id]),true),move(){},drop:async(id)=>events.push(['drop',id]),release(){}};
 board.minimapEnabled=true;board.showPreview=true;board.fit();
 const z=board.camera.z*3,cx=board.board.x+board.board.width/2,cy=board.board.y+board.board.height/2;board.camera={x:board.rect.w/2-cx*z,y:board.rect.h/3-cy*z,z};
 board.trayOpen=true;board.draw(p.ctx);
 return {p,board,state,events};
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const within=(a,r)=>a.x>=r.x-.01&&a.y>=r.y-.01&&a.x+a.w<=r.x+r.w+.01&&a.y+a.h<=r.y+r.h+.01;
function cell(board,index=0,id=1){const v=board.trayLayout();return{group:v.groups[board.trayPage*v.pageSize+index],point:{id,x:v.r.x+8+(index%v.columns+.5)*v.cellW,y:v.r.y+28+(Math.floor(index/v.columns)+.5)*v.cellH}};}
const tap=(board,point)=>{board.input({type:'down',points:[point],changed:[point]});board.input({type:'up',points:[],changed:[point]});};

for(const layout of ['portrait','landscape'])test(`${layout}: the corner map stays with the tray open and nothing overlaps`,async()=>{
 const {board}=await setup(layout),map=board.minimapFrame,thumb=board.previewThumb,tray=board.trayLayout().r,r=board.rect;
 assert.ok(map,'the map is shown while zoomed in with the tray open');assert.ok(thumb,'the 原图 thumbnail stays too');
 for(const [name,rect]of [['map',map],['thumbnail',thumb],['tray',tray]])assert.ok(within(rect,r),name+' inside the table');
 assert.equal(overlap(map,tray),false,'map clear of the tray');assert.equal(overlap(thumb,tray),false,'thumbnail clear of the tray');assert.equal(overlap(map,thumb),false,'map clear of the thumbnail');
 assert.ok(map.y>=r.y+LAYOUTS[layout].topInset-.01&&thumb.y>=r.y+LAYOUTS[layout].topInset-.01,'both below the room header');
 if(layout==='landscape')assert.ok(thumb.x+thumb.w<=r.x+r.w-50,'the thumbnail leaves the corner tool toggle free');
 assert.ok(map.h>=40,'the map keeps a usable size');
 board.destroy();
});

test('the map keeps its place through a tray drag-out, a map tap pans the view above the tray, and a tray tap rings the piece on the map',async()=>{
 const {board,events}=await setup('landscape'),map={...board.minimapFrame},{point}=cell(board,0);
 board.input({type:'down',points:[point],changed:[point]});const lifted={...point,y:point.y-DRAG_SLOP-30};board.input({type:'move',points:[lifted],changed:[lifted]});board.draw(board.platform.ctx??undefined);
 assert.equal(board.trayLayout().r.h,TRAY_STRIP_PX);assert.deepEqual(board.minimapFrame,map,'the map does not jump while the tray is a strip');
 board.input({type:'up',points:[],changed:[lifted]});await Promise.resolve();assert.ok(events.some(([kind])=>kind==='drop'));
 board.draw(board.platform.ctx??undefined);const camera={...board.camera},m=board.minimapFrame,spot={id:3,x:m.x+m.w*.8,y:m.y+m.h*.8};
 assert.equal(board.input({type:'down',points:[spot],changed:[spot]}),true);board.input({type:'up',points:[],changed:[spot]});
 assert.notDeepEqual([board.camera.x,board.camera.y],[camera.x,camera.y],'the map moves the view');
 const second=cell(board,2);tap(board,second.point);assert.deepEqual(board.locatedMarks?.ids,[second.group.pieces[0]],'located on the map');
 board.destroy();
});

for(const layout of ['portrait','landscape'])test(`${layout}: a 5 x 4 portrait page, landscape cells as wide, pieces straight on the tray and sharp`,async()=>{
 const {p,board}=await setup(layout),v=board.trayLayout();
 assert.equal(v.columns,layout==='portrait'?5:11);assert.equal(v.rows,layout==='portrait'?4:2);
 assert.ok(v.cellW-5>=44&&v.cellH-5>=44,'each cell at least 44 pt');
 assert.ok(v.r.h<=board.rect.h*(layout==='portrait'?.42:.45)+.01&&v.r.y-board.rect.y>=board.rect.h*.35,'the tray keeps its height cap and leaves the table above it');
 // Tray pictures are painted once per size; the second draw shows only the tray itself.
 p.ctx.getTransform=()=>({a:3});board.draw(p.ctx);p.commands.length=0;board.draw(p.ctx);
 const cells=p.commands.filter(([name,...a])=>name==='drawImage'&&a.length===9&&a[6]>=v.r.y&&a[6]<=v.r.y+v.r.h);
 assert.equal(cells.length,Math.min(v.pageSize,v.groups.length));
 for(const [,source,,,sw,,dx,dy,dw,dh]of cells){
  const fill=Math.max(dw/(v.cellW-5),dh/(v.cellH-5));assert.ok(Math.abs(fill-TRAY_PIECE_FILL)<.001,'fills '+TRAY_PIECE_FILL+' of the cell, got '+fill.toFixed(3));
  assert.notEqual(source,board.atlas,'drawn from its own picture, not the atlas');assert.equal(sw,Math.ceil(dw*3),'at the screen pixel size (dpr 3)');
 }
 const grid={x:v.r.x+8,y:v.r.y+28,w:v.columns*v.cellW,h:v.rows*v.cellH},frames=p.commands.filter(([name,x,y,w,h])=>name==='fillRect'&&x>=grid.x-.01&&y>=grid.y-.01&&x+w<=grid.x+grid.w+.01&&y+h<=grid.y+grid.h+.01);
 assert.deepEqual(frames,[],'no cell frames under the pieces');
 board.destroy();
});

test('a 500-piece room pages through the tray with the arrows in both layouts and the strip still works',async()=>{
 for(const layout of ['portrait','landscape']){
  const {board,events}=await setup(layout,{cols:25,rows:20}),v=board.trayLayout();
  assert.equal(v.pages,Math.ceil(500/v.pageSize));assert.equal(v.compact,layout==='landscape');
  const next={id:4,x:v.r.x+v.next.x+v.next.w/2,y:v.r.y+v.next.y+v.next.h/2},prev={id:5,x:v.r.x+v.prev.x+v.prev.w/2,y:v.r.y+v.prev.y+v.prev.h/2};
  tap(board,next);tap(board,next);assert.equal(board.trayPage,2);tap(board,prev);assert.equal(board.trayPage,1);
  const {group,point}=cell(board,4);board.input({type:'down',points:[point],changed:[point]});const out={...point,y:point.y-60};board.input({type:'move',points:[out],changed:[out]});
  assert.deepEqual(events[0],['claim',group.id]);assert.equal(board.trayLayout().r.h,TRAY_STRIP_PX);
  board.input({type:'up',points:[],changed:[out]});await Promise.resolve();
  assert.equal(board.trayPage,1,'same page after the drop');assert.equal(board.trayLayout().r.h,v.r.h);
  board.destroy();
 }
});
