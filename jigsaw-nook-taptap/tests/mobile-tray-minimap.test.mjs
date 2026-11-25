import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,DRAG_SLOP,TRAY_STRIP_PX,TRAY_PIECE_FILL,TRAY_TILE_CACHE,TRAY_TILE_BYTES,TRAY_SOURCE_ZOOM,TRAY_ROW_POKE,TRAY_MIN_PIECE_PT,TRAY_FLOOR_ZOOM_MAX,TRAY_BIG_ROOM_PIECES} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// Players asked (11-03) for the corner map while the tray is open, and for bigger tray pieces.
function platform(){
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {commands,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:4000,naturalHeight:3000,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
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
function cell(board,index=0,id=1){const v=board.trayLayout();return{group:v.groups[board.trayPage*v.pageSize+index],point:{id,x:v.r.x+8+(index%v.columns+.5)*v.cellW,y:v.r.y+v.top+(Math.floor(index/v.columns)+.5)*v.cellH}};}
const tap=(board,point)=>{board.input({type:'down',points:[point],changed:[point]});board.input({type:'up',points:[],changed:[point]});};

for(const layout of ['portrait','landscape'])test(`${layout}: the corner map stays with the tray open and nothing overlaps`,async()=>{
 const {board}=await setup(layout),map=board.minimapFrame,thumb=board.previewThumb,tray=board.trayLayout().r,r=board.rect;
 assert.ok(map,'the map is shown while zoomed in with the tray open');assert.ok(thumb,'the 原图 thumbnail stays too');
 for(const [name,rect]of [['map',map],['thumbnail',thumb],['tray',tray]])assert.ok(within(rect,r),name+' inside the table');
 assert.equal(overlap(map,tray),false,'map clear of the tray');assert.equal(overlap(thumb,tray),false,'thumbnail clear of the tray');assert.equal(overlap(map,thumb),false,'map clear of the thumbnail');
 assert.ok(map.y>=r.y+LAYOUTS[layout].topInset-.01&&thumb.y>=r.y+LAYOUTS[layout].topInset-.01,'both below the room header');
 if(layout==='landscape')assert.equal(overlap(thumb,{x:r.x+r.w-48,y:57,w:36,h:36}),false,'the thumbnail leaves the corner tool toggle free');
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
 assert.equal(v.columns,layout==='portrait'?5:14);assert.equal(v.rows,layout==='portrait'?4:2);
 assert.ok(layout==='portrait'?v.cellW-5>=44&&v.cellH-5>=44:v.cellW>=44&&v.cellH>=40,'cells big enough to hit (landscape rows at least 40 pt)');
 assert.ok(v.r.h<=board.rect.h*(layout==='portrait'?.37:.31)+.01&&v.r.y-board.rect.y>=board.rect.h*.35,'the tray keeps its height cap and leaves the table above it');
 if(layout==='portrait')assert.ok(v.r.h>=board.rect.h*.34&&v.cellW>v.cellH,'a short portrait tray with rows wider than tall');
 // Tray pictures are painted once per size; the second draw shows only the tray itself.
 p.ctx.getTransform=()=>({a:3});board.draw(p.ctx);p.commands.length=0;board.draw(p.ctx);
 const cells=p.commands.filter(([name,...a])=>name==='drawImage'&&a.length===9&&a[6]>=v.r.y&&a[6]<=v.r.y+v.r.h);
 assert.equal(cells.length,Math.min(v.pageSize,v.groups.length));
 for(const [,source,,,sw,,dx,dy,dw,dh]of cells){
  // Width up to the cell (5 pt gap between columns); height up to the row plus TRAY_ROW_POKE above and below.
  const room={w:v.cellW-5,h:Math.max(v.cellH-5,v.cellH+2*TRAY_ROW_POKE)},fill=Math.max(dw/room.w,dh/room.h);assert.ok(Math.abs(fill-TRAY_PIECE_FILL)<.01,'fills '+TRAY_PIECE_FILL+' of its room, got '+fill.toFixed(3));
  assert.ok(dh<=v.cellH+2*TRAY_ROW_POKE+.34,'reaches at most '+TRAY_ROW_POKE+' pt (and one screen pixel) into the next row');
  assert.notEqual(source,board.atlas,'drawn from its own picture, not the atlas');assert.ok(Math.abs(dw*3-sw)<1e-9,'drawn at its own pixel size (dpr 3)');assert.ok(Math.abs(dx*3-Math.round(dx*3))<1e-6&&Math.abs(dy*3-Math.round(dy*3))<1e-6,'on whole screen pixels');
 }
 const grid={x:v.r.x+8,y:v.r.y+v.top,w:v.columns*v.cellW,h:v.rows*v.cellH},frames=p.commands.filter(([name,x,y,w,h])=>name==='fillRect'&&x>=grid.x-.01&&y>=grid.y-.01&&x+w<=grid.x+grid.w+.01&&y+h<=grid.y+grid.h+.01);
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

test('sharp tray pictures stay within a few pages and 8 MB, keep the page on screen, and go with the board',async()=>{
 for(const rect of [{x:0,y:77,w:390,h:767},{x:0,y:90,w:1024,h:1276}]){
  const p=platform(),board=new PuzzleBoard(p,createFittedPuzzle('test',25,20,123),()=>{});board.setRect(rect);await board.setImage('test.png');
  p.ctx.getTransform=()=>({a:3});board.trayOpen=true;board.draw(p.ctx);
  const tiles=()=>[...board.trayTiles.values()],sum=()=>tiles().reduce((n,t)=>n+t.width*t.height*4,0),released=[];let made=0;
  const create=p.createCanvas;p.createCanvas=()=>{made++;const canvas=create();released.push(canvas);return canvas;};
  for(let page=0;page<40;page++){
   const v=board.trayLayout();board.draw(p.ctx);
   assert.ok(board.trayTiles.size<=TRAY_TILE_CACHE,'at most '+TRAY_TILE_CACHE+' pictures');const page=v.groups.slice(v.start,v.start+v.pageSize).reduce((n,g)=>{const t=[...board.trayTiles.entries()].find(([k])=>Number(k.split(':')[0])===g.pieces[0]);return n+(t?t[1].width*t[1].height*4:0);},0);
   assert.ok(board.trayTileBytes<=Math.max(TRAY_TILE_BYTES,page),'at most 8 MB, or one page when a page alone is bigger');assert.equal(board.trayTileBytes,sum(),'the byte count matches the kept pictures');
   const shown=v.groups.slice(v.start,v.start+v.pageSize).map(g=>g.pieces[0]),keys=[...board.trayTiles.keys()].map(k=>Number(k.split(':')[0]));
   for(const id of shown)assert.ok(keys.includes(id),'the page on screen is kept');
   if(v.page>=v.pages-1)break;const n=v.next,at={id:7,x:v.r.x+n.x+n.w/2,y:v.r.y+n.y+n.h/2};board.input({type:'down',points:[at],changed:[at]});board.input({type:'up',points:[],changed:[at]});
  }
  assert.ok(made>TRAY_TILE_CACHE,'paging through every page made more pictures than are kept');
  assert.ok(released.filter(c=>c.width===1&&c.height===1).length>=made-board.trayTiles.size,'dropped pictures give their memory back');
  board.destroy();assert.equal(board.trayTiles.size,0);assert.equal(board.trayTileBytes,0);
 }
});

test('a tray piece stays within 1.15 screen pixels per picture pixel; a 300+ room goes past it only as far as the minimum size needs',async()=>{
 for(const [width,cols,rows]of [[800,8,6],[2144,22,22],[4000,8,6]]){
  const p=platform(),board=new PuzzleBoard({...p,createImage:()=>({naturalWidth:width,naturalHeight:width*.75,set src(value){queueMicrotask(()=>this.onload());}})},createFittedPuzzle('test',cols,rows,123),()=>{});
  board.setRect({x:0,y:77,w:360,h:702});await board.setImage('t.png');p.ctx.getTransform=()=>({a:3});board.trayOpen=true;board.draw(p.ctx);p.commands.length=0;board.draw(p.ctx);
  const v=board.trayLayout(),zoom=board.picture.width/board.board.width,pw=board.board.width/board.state.cols,ph=board.board.height/board.state.rows,m=Math.min(pw,ph)*.25;
  const cells=p.commands.filter(([name,...a])=>name==='drawImage'&&a.length===9&&a[6]>=v.r.y&&a[6]<=v.r.y+v.r.h);assert.ok(cells.length);
  for(const [,,,,,,,,dw,dh]of cells){
   const limit=cols*rows>=TRAY_BIG_ROOM_PIECES?Math.max(TRAY_SOURCE_ZOOM,Math.min(TRAY_FLOOR_ZOOM_MAX,TRAY_MIN_PIECE_PT*3/((Math.max(pw,ph)+2*m)*zoom))):TRAY_SOURCE_ZOOM;
   const perPicture=dw*3/((pw+2*m)*zoom);assert.ok(perPicture<=limit+.02,`${width}px picture: ${perPicture.toFixed(2)} screen px per picture px`);
   const full=Math.min((v.cellW-5)/(pw+2*m),Math.max(v.cellH-5,v.cellH+2*TRAY_ROW_POKE)/(ph+2*m))*(pw+2*m);assert.ok(dw<=full+.34,'never past its cell (bar the last screen pixel)');
   if(width===4000)assert.ok(Math.abs(dw-full)<.34,'a large picture fills the cell');
  }
  board.destroy();
 }
});

for(const layout of ['portrait','landscape'])test(`${layout}: one control row — pager left, hint and × right — and no title or footer text`,async()=>{
 const {p,board}=await setup(layout,{cols:25,rows:20}),v=board.trayLayout();
 p.commands.length=0;board.draw(p.ctx);const texts=p.commands.filter(([name])=>name==='fillText').map(([,text,x,y])=>({text,x,y}));
 assert.ok(!texts.some(t=>/碎片托盘|散片保持原位/.test(t.text)),'the title and footer words are gone');
 const hint=texts.find(t=>t.text==='点选定位 · 拖出放置'),page=texts.find(t=>t.text===`1/${v.pages}`);assert.ok(hint&&page);
 assert.ok(page.y<v.r.y+v.top&&hint.y<v.r.y+v.top,'pager and hint share the top row');assert.ok(page.x<v.r.x+v.next.x&&page.x>v.r.x+v.prev.x,'page number between the arrows');
 assert.ok(v.next.x+v.next.w<hint.x-v.r.x-8,'the pager stays clear of the hint');assert.ok(hint.x-v.r.x+8*hint.text.length<=v.close.x,'and the hint of ×');
 assert.equal(v.r.h,v.top+v.rows*v.cellH+(layout==='portrait'?6:4),'no footer row');
 if(layout==='portrait')assert.ok(v.r.h/board.rect.h>=.34&&v.r.h/board.rect.h<=.371,'portrait tray about 37% of the table');
 // The arrows answer 44 pt tall: a tap 10 pt above the tray still turns the page.
 const tap=pt=>{board.input({type:'down',points:[pt],changed:[pt]});board.input({type:'up',points:[],changed:[pt]});};
 tap({id:5,x:v.r.x+v.next.x+v.next.w/2,y:v.r.y-10});assert.equal(board.trayPage,1);
 assert.ok(v.next.h+v.reach>=44&&v.prev.w>=44&&v.next.w>=44,'arrow targets at least 44 pt');
 tap({id:6,x:v.r.x+v.prev.x+v.prev.w/2,y:v.r.y+v.top/2});assert.equal(board.trayPage,0);
 board.destroy();
});

test('on a dpr 3.5 screen tray pictures are painted at 3.5x and land on whole screen pixels',async()=>{
 const {p,board}=await setup('portrait');p.ctx.getTransform=()=>({a:3.5,e:0,f:0});board.draw(p.ctx);p.commands.length=0;board.draw(p.ctx);
 const tiles=new Set(board.trayTiles.values()),cells=p.commands.filter(([name,...a])=>name==='drawImage'&&a.length===9&&tiles.has(a[0]));assert.ok(cells.length);
 for(const [,,,,sw,sh,dx,dy,dw,dh]of cells){assert.ok(Math.abs(dw*3.5-sw)<1e-9&&Math.abs(dh*3.5-sh)<1e-9,'one picture pixel per screen pixel');assert.ok(Math.abs(dx*3.5-Math.round(dx*3.5))<1e-6&&Math.abs(dy*3.5-Math.round(dy*3.5))<1e-6);}
 board.destroy();
});

test('landscape: a compact tray — slim control row, 2 short rows, ~31% of the table, pager still easy to hit',async()=>{
 for(const [w,h,dpr] of [[844,390,2],[915,412,2.6]]){
  const p=platform(),board=new PuzzleBoard(p,createFittedPuzzle('test',10,10,123),()=>{});board.setRect({x:0,y:0,w,h});await board.setImage('t.png');board.trayOpen=true;p.ctx.getTransform=()=>({a:dpr,e:0,f:0});board.draw(p.ctx);
  const v=board.trayLayout();assert.equal(v.top,24,'a 24 pt control row');assert.equal(v.rows,2);assert.ok(v.r.h/h<=.32,`tray ${(v.r.h/h*100).toFixed(1)}% of the table`);
  assert.ok(v.cellH>=36&&v.cellW>=40,'cells stay tappable');assert.ok(v.prev.w>=44&&v.next.w>=44,'pager arrows 44 pt wide');
  p.commands.length=0;board.draw(p.ctx);const tiles=new Set(board.trayTiles.values()),cells=p.commands.filter(([name,...a])=>name==='drawImage'&&a.length===9&&tiles.has(a[0]));
  for(const [,,,,,,dx,dy,dw,dh]of cells){assert.ok(dw<=56&&dw>=48,`landscape pieces about a quarter smaller than v53.18's 69 pt, got ${dw.toFixed(1)}`);assert.ok(dy>=v.r.y+v.top-TRAY_ROW_POKE-.5,'the first row starts right under the control row');}
  board.destroy();
 }
});

test('landscape: pieces kept small by a low-resolution picture get narrower cells, so a page holds more of them',async()=>{
 const run=async(w,h,dpr,iw,ih,cols,rows)=>{const p=platform(),board=new PuzzleBoard({...p,createImage:()=>({naturalWidth:iw,naturalHeight:ih,set src(value){queueMicrotask(()=>this.onload());}})},createFittedPuzzle('test',cols,rows,123),()=>{});
  board.setRect({x:0,y:0,w,h});await board.setImage('t.png');board.trayOpen=true;p.ctx.getTransform=()=>({a:dpr,e:0,f:0});board.draw(p.ctx);board.draw(p.ctx);const v=board.trayLayout();board.destroy();return v;};
 // Under about 300 pieces, where the minimum tray piece size does not apply.
 const low844=await run(844,390,3,800,533,16,12),high844=await run(844,390,3,2560,2560,16,12),low915=await run(915,412,2.6,800,533,16,12),high915=await run(915,412,2.6,2560,2560,16,12);
 assert.ok(low844.columns>=18,`844x390: ${low844.columns} columns`);assert.equal(high844.columns,14,'a sharp picture keeps the standard cells');
 assert.ok(low915.columns>=18,`915x412 dpr 2.6: ${low915.columns} columns`);assert.ok(low915.pages<high915.pages,'fewer pages for the same piece count');
 assert.ok(low915.cellH>=36&&low915.cellW>=40,'small cells stay tappable');assert.ok(low915.r.h<=high915.r.h,'and the tray is no taller');
 // A low-resolution 500-piece room is raised to the minimum size: standard-width cells, still two rows.
 const big915=await run(915,412,2.6,1536,1024,27,18);assert.equal(big915.columns,15,'915x412 big room');assert.equal(big915.rows,2,'two rows');assert.ok(big915.r.h<=412*.31+.5,'tray '+big915.r.h);
});
