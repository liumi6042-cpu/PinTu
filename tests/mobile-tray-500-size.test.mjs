import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,TRAY_SIZE_FLOORS,TRAY_FLOOR_ZOOM_MAX,TRAY_SOURCE_ZOOM} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// 11-09 player feedback: 500-piece tray pieces are too small. A size floor raises them in big rooms only.
function platform(dpr,iw,ih){const cmds=[],ctx=new Proxy({isPointInPath:()=>true,measureText:t=>({width:String(t).length*8}),getTransform:()=>({a:dpr,e:0,f:0})},{get:(t,n)=>n in t?t[n]:(...a)=>cmds.push([n,...a]),set:(t,n,v)=>{t[n]=v;return true;}}),canvas=()=>({width:1,height:1,getContext:()=>ctx});return {cmds,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:iw,naturalHeight:ih,set src(v){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};}
async function measure({size,variant,w=390,h=844,dpr=3,iw=1536,ih=1024}){
 const cols=size[0],rows=size[1],p=platform(dpr,iw,ih),b=new PuzzleBoard(p,createFittedPuzzle('test',cols,rows,123),()=>{});b.traySize=variant;b.setRect({x:0,y:0,w,h});await b.setImage('t.png');b.trayOpen=true;b.draw(p.ctx);p.cmds.length=0;b.draw(p.ctx);
 const v=b.trayLayout(),tiles=new Set(b.trayTiles.values()),image=p.cmds.find(([n,...a])=>n==='drawImage'&&a.length===9&&tiles.has(a[0])),out={columns:v.columns,rows:v.rows,cellW:v.cellW,cellH:v.cellH,trayH:v.r.h,pageSize:v.pageSize,piece:image?.[8]??0,zoom:b.trayZoom()};b.destroy();return out;
}
const lowRes500={size:[27,18]},lowRes108={size:[12,9]};

test('A is v53.20 and every portrait variant keeps the 5x4 page', async()=>{
 const a=await measure({...lowRes500,variant:'A'});assert.equal(a.zoom,TRAY_SOURCE_ZOOM);assert.ok(Math.abs(a.piece-32.8)<1.5,'A piece '+a.piece);
 for(const [variant,floor] of Object.entries(TRAY_SIZE_FLOORS).slice(1)){const v=await measure({...lowRes500,variant});assert.deepEqual([v.columns,v.rows,v.cellW,v.cellH],[a.columns,a.rows,a.cellW,a.cellH],variant);assert.ok(Math.abs(v.piece-floor)<1.5,variant+' piece '+v.piece);}
});

test('rooms under about 300 pieces do not change under any variant', async()=>{
 for(const [w,h] of [[390,844],[844,390]]){const a=await measure({...lowRes108,variant:'A',w,h});for(const variant of ['B','C','D'])assert.deepEqual(await measure({...lowRes108,variant,w,h}),a,variant+' '+w);}
});

test('a 500-piece picture that already reaches the floor does not change', async()=>{
 const hires={size:[22,22],iw:2560,ih:2560};for(const [w,h] of [[390,844],[844,390]]){const a=await measure({...hires,variant:'A',w,h});for(const variant of ['B','C'])assert.deepEqual(await measure({...hires,variant,w,h}),a,variant+' '+w);}
});

test('landscape: B and C keep two rows, D takes one row, and the tray never grows past the 2-row limit', async()=>{
 const land={...lowRes500,w:844,h:390},a=await measure({...land,variant:'A'}),b=await measure({...land,variant:'B'}),c=await measure({...land,variant:'C'}),d=await measure({...land,variant:'D'});
 assert.deepEqual([a.rows,b.rows,c.rows,d.rows],[2,2,2,1]);assert.ok(a.columns>b.columns&&b.columns>c.columns&&c.columns>d.columns,JSON.stringify([a.columns,b.columns,c.columns,d.columns]));
 assert.ok(Math.abs(b.piece-TRAY_SIZE_FLOORS.B)<1.5,'B '+b.piece);assert.ok(c.piece>=49,'C '+c.piece);assert.ok(Math.abs(d.piece-TRAY_SIZE_FLOORS.D)<1.5,'D '+d.piece);
 for(const v of [a,b,c,d])assert.ok(v.trayH<=390*.31+.5,'tray '+v.trayH);
});

test('a very small source never stretches past the zoom ceiling', async()=>{
 const v=await measure({size:[27,18],iw:810,ih:540,variant:'D'});assert.equal(v.zoom,TRAY_FLOOR_ZOOM_MAX);
});
