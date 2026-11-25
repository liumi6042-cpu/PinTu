import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,TRAY_MIN_PIECE_PT,TRAY_FLOOR_ZOOM_MAX,TRAY_SOURCE_ZOOM} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// 11-09 player feedback: 500-piece tray pieces are too small. Big rooms get a minimum on-screen piece size; small rooms do not change.
function platform(dpr,iw,ih){const cmds=[],ctx=new Proxy({isPointInPath:()=>true,measureText:t=>({width:String(t).length*8}),getTransform:()=>({a:dpr,e:0,f:0})},{get:(t,n)=>n in t?t[n]:(...a)=>cmds.push([n,...a]),set:(t,n,v)=>{t[n]=v;return true;}}),canvas=()=>({width:1,height:1,getContext:()=>ctx});return {cmds,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:iw,naturalHeight:ih,set src(v){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};}
async function measure({size,w=390,h=844,dpr=3,iw=1536,ih=1024}){
 const p=platform(dpr,iw,ih),b=new PuzzleBoard(p,createFittedPuzzle('test',size[0],size[1],123),()=>{});b.setRect({x:0,y:0,w,h});await b.setImage('t.png');b.trayOpen=true;b.draw(p.ctx);p.cmds.length=0;b.draw(p.ctx);
 const v=b.trayLayout(),tiles=new Set(b.trayTiles.values()),image=p.cmds.find(([n,...a])=>n==='drawImage'&&a.length===9&&tiles.has(a[0])),out={columns:v.columns,rows:v.rows,trayH:v.r.h,piece:image?.[8]??0,zoom:b.trayZoom()};b.destroy();return out;
}
const lowRes500={size:[27,18]};

test('a low-resolution 500-piece room reaches the minimum size and keeps the 5x4 portrait page', async()=>{
 const v=await measure(lowRes500);assert.deepEqual([v.columns,v.rows],[5,4]);assert.ok(Math.abs(v.piece-TRAY_MIN_PIECE_PT)<1.5,'piece '+v.piece);
});

test('landscape stays at two rows and no taller than 31% of the screen', async()=>{
 for(const [w,h,columns] of [[844,390,14],[780,360,13]]){const v=await measure({...lowRes500,w,h});assert.equal(v.rows,2,w+' rows');assert.equal(v.columns,columns,w+' columns');assert.ok(v.trayH<=h*.31+.5,w+' tray '+v.trayH);assert.ok(v.piece>=45,w+' piece '+v.piece);}
});

test('rooms under about 300 pieces keep the plain sharpness cap', async()=>{
 for(const [w,h] of [[390,844],[844,390]])assert.equal((await measure({size:[12,9],w,h})).zoom,TRAY_SOURCE_ZOOM,w+'');
});

test('a 500-piece picture that already reaches the size keeps the plain cap', async()=>{
 assert.equal((await measure({size:[22,22],iw:2560,ih:2560})).zoom,TRAY_SOURCE_ZOOM);
});

test('a very small source never stretches past the zoom ceiling', async()=>{
 assert.equal((await measure({size:[27,18],iw:810,ih:540})).zoom,TRAY_FLOOR_ZOOM_MAX);
});
