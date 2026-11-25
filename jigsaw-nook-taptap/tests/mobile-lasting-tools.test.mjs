import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// 11-03: 「把提示和底图这两个功能的等待秒数去掉」. v53.10 asks for lasting grants: 底图 stays for the room, 提示 until its pieces are placed.
function platform(){
 const ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
async function setup(){
 const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{});
 board.setRect({x:0,y:77,w:390,h:767});await board.setImage('test.png');board.networkReady=true;board.fit();board.draw(p.ctx);
 return {board,state};
}
const LASTING=400*86400000;

test('a lasting hint arms no overflowing timer and ends once its pieces are placed',async t=>{
 const {board,state}=await setup(),delays=[],realTimeout=globalThis.setTimeout;
 t.after(()=>{globalThis.setTimeout=realTimeout;board.destroy?.();});
 globalThis.setTimeout=(fn,ms,...rest)=>{delays.push(ms);return realTimeout(()=>{},0);};
 const ids=state.groups.filter(g=>!g.locked).slice(0,3).flatMap(g=>g.pieces);
 assert.equal(board.setHints(ids,Date.now()+LASTING,'grant-1'),true);
 assert.equal(board.hintsShowing,true);
 assert.ok(delays.every(ms=>ms>1000&&ms<2147483647),'no expiry timer fires at once (setTimeout past 24.8 days would)');
 for(const g of state.groups)if(g.pieces.some(id=>ids.includes(id)))g.locked=true;
 assert.equal(board.hintsShowing,false,'placed pieces end the hint');
});

test('a 30-second hint still counts down as before',async t=>{
 const {board,state}=await setup();t.after(()=>board.destroy?.());
 const ids=state.groups.slice(0,3).flatMap(g=>g.pieces);
 assert.equal(board.setHints(ids,Date.now()+30000,'grant-2'),true);assert.equal(board.hintsShowing,true);
 assert.equal(board.setHints(ids,Date.now()-1,'grant-2'),false);assert.equal(board.hintsShowing,false);
});

test('hints stay lasting while room underlay always expires after 30 seconds',async t=>{
 const {board}=await setup(),realNow=Date.now;
 let now=1800000000000;
 Date.now=()=>now;
 t.after(()=>{Date.now=realNow;board.destroy?.();});
 board.setUnderlay(now+30000);
 assert.equal(board.underlay,true);
 now+=29999;
 assert.equal(board.underlay,true);
 now+=1;
 assert.equal(board.underlay,false,'underlay stops showing once 30 seconds elapse');

 const source=readFileSync(new URL('../mobile/app.ts',import.meta.url),'utf8');
 assert.match(source,/\/assistance\?lasting=1'/);
 assert.match(source,/wantLasting=kind==='hint'/);
 assert.match(source,/wantLasting\?\{kind,requestId,lasting:true\}:\{kind,requestId\}/);
 assert.match(source,/normalizeAssistance/);
 assert.match(source,/kind==='hint'&&grant\.lasting\?'已开启'/);
 assert.match(source,/if\(kind==='hint'&&grant\?\.lasting\)this\.useLastingAid\(kind\)/,'only lasting hints reuse without paying again');
});
