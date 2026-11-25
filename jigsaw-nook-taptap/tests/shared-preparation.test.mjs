import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';
import {pictureCrop} from '../lib/puzzle-picture.ts';

const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(cols=25,rows=20){
 const canvases=[],images=[],frames=new Map(),hide=new Set(),show=new Set();let frameId=0,invalidations=0;
 const createCanvas=()=>{const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8}),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>key in target?target[key]:(...args)=>commands.push([key,...args]),set:(target,key,value)=>{commands.push(['set',key,value]);target[key]=value;return true;}}),canvas={width:1,height:1,commands,getContext:()=>ctx};canvases.push(canvas);return canvas;};
 const platform={config:{id:'wechat'},createCanvas,createImage:()=>{const image={naturalWidth:800,naturalHeight:600};images.push(image);return image;},onHide:fn=>(hide.add(fn),()=>hide.delete(fn)),onShow:fn=>(show.add(fn),()=>show.delete(fn)),frame:fn=>(frames.set(++frameId,fn),frameId),cancelFrame:id=>frames.delete(id)};
 const state=createFittedPuzzle('preparation',cols,rows,123),board=new PuzzleBoard(platform,state,()=>invalidations++);
 return{board,state,platform,canvases,images,frames,invalidations:()=>invalidations,hide:()=>hide.forEach(fn=>fn()),show:()=>show.forEach(fn=>fn({})),listeners:()=>hide.size+show.size,frame:()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();}};
}
async function advance(t){t.mock.timers.tick(0);await settle();}
async function finish(t,board){for(let i=0;i<510&&board.imagePreparation.phase!=='ready';i++)await advance(t);assert.equal(board.imagePreparation.phase,'ready');}

test('500 pieces yield in bounded batches and publish only a complete atlas with unchanged crop and tile geometry',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const p=setup(),{board,state}=p;t.after(()=>board.destroy());
 board.setRect({x:0,y:0,w:1000,h:1000});board.camera={x:-board.board.x,y:-board.board.y,z:1};state.groups[0].dx=state.groups[0].dy=0;
 let claims=0;board.networkReady=true;board.network={acquire:async()=>{claims++;return true;},move(){},drop:async()=>{},release(){}};
 const loading=board.setImage('first.png');assert.deepEqual(board.imagePreparation,{phase:'loading',completed:0,total:500});p.images[0].onload();await settle();
 assert.deepEqual(board.imagePreparation,{phase:'preparing',completed:0,total:500});assert.equal(board.atlas,null);
 const point={id:1,x:board.board.width/state.cols/2,y:board.board.height/state.rows/2};board.input({type:'down',points:[point],changed:[point]});board.input({type:'cancel',points:[],changed:[]});assert.equal(claims,0,'unfinished pieces cannot be acquired');
 const progress=[];let inputTurns=0;
 while(board.imagePreparation.phase!=='ready'){
  setTimeout(()=>inputTurns++,0);await advance(t);const {completed}=board.imagePreparation;progress.push(completed);
  assert.ok(completed-(progress.at(-2)??0)<=16,'each event-loop turn draws at most sixteen pieces');
  if(completed<500){assert.equal(board.atlas,null);assert.equal(board.ready,false);}
 }
 await loading;assert.ok(inputTurns>=32,'other event-loop work runs between preparation batches');assert.deepEqual(board.imagePreparation,{phase:'ready',completed:500,total:500});
 const w=board.board.width/25,h=board.board.height/20,unit=Math.min(w,h),edge=Math.max(.45,Math.min(1.25,unit*.012)),blur=Math.max(2,Math.min(5,unit*.055)),offsetY=Math.max(1,Math.min(3,unit*.028)),pad=unit*.26+1+Math.ceil(blur*3+offsetY+edge*2),scale=Math.min(1.5,Math.sqrt(7_500_000/(500*(w+2*pad)*(h+2*pad)))),tileW=Math.ceil((w+2*pad)*scale),tileH=Math.ceil((h+2*pad)*scale),columns=Math.ceil(Math.sqrt(500));
 assert.deepEqual(board.tile,{w:tileW,h:tileH,pad,columns,scale});assert.equal(board.atlas.width,tileW*columns);assert.equal(board.atlas.height,tileH*Math.ceil(500/columns));
 const commands=board.atlas.commands,draws=commands.filter(c=>c[0]==='drawImage'),translations=commands.filter(c=>c[0]==='translate');assert.equal(draws.length,500);assert.ok(draws.every(c=>c[1]===board.picture));assert.equal(commands.filter(c=>c[0]==='fill').length,500);assert.equal(commands.filter(c=>c[0]==='stroke').length,1000);assert.equal(commands.filter(c=>c[0]==='clip').length,1000);
 for(let id=0;id<500;id++){assert.deepEqual(translations[id*2],['translate',id%columns*tileW,Math.floor(id/columns)*tileH]);assert.deepEqual(translations[id*2+1],['translate',pad,pad]);}
 assert.equal(commands.find(c=>c[0]==='set'&&c[1]==='shadowBlur')[2],blur*scale);assert.equal(commands.find(c=>c[0]==='set'&&c[1]==='lineWidth')[2],edge*2.4);
 const crop=pictureCrop(800,600,board.board.width,board.board.height);assert.deepEqual(board.picture.commands.find(c=>c[0]==='drawImage'),['drawImage',p.images[0],crop.x,crop.y,crop.width,crop.height,0,0,Math.round(crop.width),Math.round(crop.height)]);
});

test('the time budget yields before the piece cap on a slow canvas',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const p=setup();t.after(()=>p.board.destroy());
 const create=p.platform.createCanvas;p.platform.createCanvas=()=>{const canvas=create(),ctx=canvas.getContext('2d');ctx.drawImage=(...args)=>{canvas.commands.push(['drawImage',...args]);t.mock.timers.setTime(Date.now()+7);};return canvas;};
 const pending=p.board.setImage('slow.png'),cancelled=assert.rejects(pending,error=>error.code==='IMAGE_LOAD_CANCELLED');p.images[0].onload();await settle();await advance(t);
 assert.equal(p.board.imagePreparation.completed,1,'one expensive piece exhausts the six millisecond budget');p.board.destroy();await cancelled;
});

test('switching images cancels pending batches and the old atlas never replaces the new picture',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const p=setup();t.after(()=>p.board.destroy());
 const old=p.board.setImage('old.png'),cancelled=assert.rejects(old,error=>error.code==='IMAGE_LOAD_CANCELLED');p.images[0].onload();await settle();await advance(t);const oldAtlas=p.canvases.at(-1);
 assert.ok(p.board.imagePreparation.completed>0);const current=p.board.setImage('current.png');await cancelled;assert.deepEqual(p.board.imagePreparation,{phase:'loading',completed:0,total:500});assert.equal(oldAtlas.width,1,'cancelled scratch atlas is released');
 p.images[1].onload();await settle();await finish(t,p.board);await current;const picture=p.board.picture,atlas=p.board.atlas;await advance(t);
 assert.equal(p.board.picture,picture);assert.equal(p.board.atlas,atlas);assert.equal(picture.commands.find(c=>c[0]==='drawImage')[1],p.images[1]);
});

test('hidden preparation finishes without frames, and destroying any stage settles and stops work',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const p=setup();t.after(()=>p.board.destroy());
 const pending=p.board.setImage('hidden.png');p.images[0].onload();await settle();p.hide();await finish(t,p.board);await pending;assert.equal(p.frames.size,0,'preparation does not wait for a visible frame');p.show();assert.equal(p.board.imagePreparation.phase,'ready');
 const preparing=p.board.setImage('destroy.png'),cancelled=assert.rejects(preparing,error=>error.code==='IMAGE_LOAD_CANCELLED');p.images[1].onload();await settle();await advance(t);p.board.destroy();await cancelled;const count=p.canvases.flatMap(c=>c.commands).length;await advance(t);assert.equal(p.canvases.flatMap(c=>c.commands).length,count);assert.equal(p.board.atlas,null);assert.equal(p.listeners(),0);
 const loading=setup(),load=loading.board.setImage('never-loaded.png'),loadCancelled=assert.rejects(load,error=>error.code==='IMAGE_LOAD_CANCELLED');loading.board.destroy();await loadCancelled;assert.equal(loading.images[0].onload,null);assert.equal(loading.listeners(),0);
});

test('failed image loads and failed preparation can each be retried',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});const p=setup(8,6);t.after(()=>p.board.destroy());
 const failed=p.board.setImage('failed.png'),rejected=assert.rejects(failed,/图片暂时无法加载/);p.images[0].onerror();await rejected;
 const create=p.platform.createCanvas;p.platform.createCanvas=()=>{const canvas=create();if(p.canvases.length===4)canvas.getContext('2d').drawImage=()=>{throw Error('canvas failed');};return canvas;};
 const failedPreparation=p.board.setImage('bad-canvas.png'),canvasRejected=assert.rejects(failedPreparation,/canvas failed/);p.images[1].onload();await settle();await advance(t);await canvasRejected;assert.equal(p.board.ready,false);assert.equal(p.canvases.at(-1).width,1,'failed scratch atlas is released');
 p.platform.createCanvas=create;const retry=p.board.setImage('retry.png');p.images[2].onload();await settle();await finish(t,p.board);await retry;assert.equal(p.board.ready,true);
});

test('empty and semantically identical cursor polls stay idle while fresh timestamps are retained',()=>{
 const p=setup(8,6);try{
  p.board.setCursors([]);assert.equal(p.invalidations(),0);assert.equal(p.frames.size,0);
  const cursor={playerId:'friend',x:10,y:20,name:'朋友',color:'#abc',level:20,badge:'star',cursorStyle:'arrow',decoration:{id:'bow',title:'蝴蝶结',artKey:'bow',color:'#abc',kind:'cursor'},updatedAt:1};
  p.board.setCursors([cursor]);const invalidations=p.invalidations(),entry=p.board.cursors.get('friend');
  p.board.setCursors([{...cursor,decoration:{...cursor.decoration},updatedAt:999999}]);assert.equal(p.invalidations(),invalidations);assert.equal(p.frames.size,0);assert.equal(p.board.cursors.get('friend'),entry);assert.equal(entry.value.updatedAt,999999,'fresh metadata still replaces the previous snapshot');
  for(const patch of [{name:'新名字'},{color:'#def'},{level:21},{badge:'new'},{cursorStyle:'hand'},{decoration:{...cursor.decoration,title:'新装饰'}}]){const before=p.invalidations();p.board.setCursors([{...cursor,...patch}]);assert.equal(p.invalidations(),before+1);}
  p.board.setCursors([]);const removed=p.invalidations();assert.equal(p.board.cursors.size,0);p.board.setCursors([]);assert.equal(p.invalidations(),removed,'repeated departures remain idle');
  p.board.setCursors([{...cursor,level:undefined,badge:undefined,cursorStyle:undefined,decoration:undefined}]);const defaulted=p.invalidations();p.board.setCursors([{...cursor,level:0,badge:null,cursorStyle:null,decoration:null}]);assert.equal(p.invalidations(),defaulted,'equivalent absent/default display fields stay idle');
 }finally{p.board.destroy();}
});

test('identical cursor polls preserve interpolation, its final repaint, and hide/show recovery',()=>{
 const p=setup(8,6);try{
  const cursor={playerId:'friend',x:10,y:20,name:'朋友',color:'#abc',updatedAt:1};p.board.setCursors([cursor]);p.board.setCursors([{...cursor,x:40}]);const invalidations=p.invalidations(),frame=[...p.frames.keys()][0],entry=p.board.cursors.get('friend');
  p.board.setCursors([{...cursor,x:40,updatedAt:2}]);assert.equal(p.invalidations(),invalidations);assert.deepEqual([...p.frames.keys()],[frame]);assert.equal(entry.x,10);
  p.frame();assert.ok(entry.x>10&&entry.x<40);p.hide();assert.equal(p.frames.size,0);const held=entry.x;p.board.setCursors([{...cursor,x:40,updatedAt:600000}]);assert.equal(entry.x,held,'timestamps do not expire a retained room member');p.show();assert.equal(p.frames.size,1);
  let beforeFinal=0;for(let i=0;i<100&&p.frames.size;i++){beforeFinal=p.invalidations();p.frame();}assert.equal(p.frames.size,0);assert.equal(entry.x,40);assert.equal(entry.y,20);assert.equal(p.invalidations(),beforeFinal+1,'the final interpolation tick repaints the exact target');
  const idle=p.invalidations();p.board.setCursors([{...cursor,x:40,updatedAt:999999}]);assert.equal(p.invalidations(),idle);assert.equal(p.frames.size,0);p.board.setCursors([]);assert.equal(p.board.cursors.size,0);
 }finally{p.board.destroy();}
});
