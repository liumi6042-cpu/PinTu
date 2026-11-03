import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// Portrait players saw the opt-in 锁定 button cover the tray's page arrows, then the table above the tray (11-03): portrait now
// keeps it in the bottom bar between 任务 and ⊞, whatever the tray does; landscape keeps it in the gap below the tray.
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui"; export {PuzzleBoard} from "./mobile/puzzle-board";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,Stage,PuzzleBoard}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const proxy=()=>new Proxy({measureText:value=>({width:String(value).length*6}),isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
function boardPlatform(){const ctx=proxy(),canvas=()=>({width:1,height:1,getContext:()=>ctx});return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};}
/** The room areas and quick-tool anchors mobile/app.ts uses (drawRoom: portrait portraitQuickSlot; landscape roomArea right-58, safeBottom-4). */
const LAYOUTS=[
 {name:'portrait 360x780',layout:'phonePortrait',w:360,h:780,area:{x:0,y:77,w:360,h:702},anchor:(game,w,h)=>{const slot=game.portraitQuickSlot(w,h);return [slot.x,slot.bottom];}},
 {name:'portrait 390x844',layout:'phonePortrait',w:390,h:844,area:{x:0,y:77,w:390,h:766},anchor:(game,w,h)=>{const slot=game.portraitQuickSlot(w,h);return [slot.x,slot.bottom];}},
 {name:'landscape 844x390',layout:'phoneLandscape',w:844,h:390,area:{x:0,y:0,w:844,h:390},anchor:(game,w,h)=>[w-58,h-4]},
];
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
async function room(l){
 const storage=new Map([['jigsaw:room-guide:v1','done']]),viewport={width:l.w,height:l.h,top:0,bottom:0,dpr:1},ctx=proxy();
 const platform={config:{id:'taptap',apiBase:'/api'},createImage:()=>({}),createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const stage=new Stage(platform,value=>value),game=new GameApp(platform,{config:{capabilities:{}},profile:{collection:{}},asset:value=>value},stage);
 globalThis.matchMedia=()=>({matches:false});
 const bp=boardPlatform(),board=new PuzzleBoard(bp,createFittedPuzzle('test',10,10,123),()=>{});board.setRect(l.area);await board.setImage('t.png');board.networkReady=true;
 board.network={canAcquire:()=>true,acquire:async()=>true,move(){},drop:async()=>{},release(){}};
 Object.assign(game.client.profile,{giftProgress:10,giftCount:3});Object.assign(game,{board,room:{snapshot:{completedAt:null}},imageReady:true,lockButtonEnabled:true,roomArea:l.area,ready:true,route:'room'});
 const hits=[],hit=stage.hit.bind(stage);stage.hit=(r,f)=>{hits.push({...r});return hit(r,f);};
 const lock=()=>{hits.length=0;stage.begin?.();const [x,bottom]=l.anchor(game,l.w,l.h);game.drawBoardQuickTools(x,bottom);return hits.find(r=>r.w===46&&r.h===46);};
 const gift=()=>{hits.length=0;game.drawRoomGift(10,l.h-62,true);return hits[0];};
 return {game,stage,board,lock,gift,bp};
}

for(const l of LAYOUTS)test(`${l.name}: the 锁定 button keeps one place clear of the tray, its strip, 任务 and ⊞`,async()=>{
 const {stage,board,lock,gift,bp}=await room(l),portrait=l.layout==='phonePortrait';
 board.trayOpen=false;const closed=lock();assert.ok(closed,'the button is drawn');
 board.trayOpen=true;board.draw(bp.ctx);const open=lock(),tray=board.trayFrame,v=board.trayLayout();
 assert.deepEqual(open,closed,'the tray does not move it');assert.equal(overlap(open,tray),false,'clear of the tray');assert.ok(open.y>=tray.y+tray.h,'below the tray');
 if(portrait){
  const tasks=gift(),tools={x:l.w-63,y:l.h-65,w:50,h:50};
  assert.equal(overlap(open,tasks),false,'clear of 任务 10/10 and its gift');assert.equal(overlap(open,tools),false,'clear of ⊞');
  assert.ok(open.x>=tasks.x+tasks.w+10&&open.x+open.w<=tools.x-10,'spaced between them');
  assert.ok(Math.abs(open.y+open.h/2-(tools.y+tools.h/2))<=1,'level with ⊞');assert.ok(Math.abs(open.x+open.w/2-l.w*.57)<=12,'about 57% across');
 }
 // Taps on the pager reach the tray, not the button.
 for(const b of [v.next,v.prev]){const x=tray.x+b.x+b.w/2,y=tray.y+b.y+b.h/2;assert.equal(stage.hasHit?.(x,y)??false,false,'the pager is free');}
 // During a drag-out the tray is a strip at the same bottom; the button stays where it was.
 const cell={id:1,x:tray.x+8+v.cellW/2,y:tray.y+v.top+v.cellH/2};board.input({type:'down',points:[cell],changed:[cell]});const out={...cell,y:cell.y-40};board.input({type:'move',points:[out],changed:[out]});
 const strip=board.trayFrame;assert.equal(strip.h,28);const during=lock();assert.deepEqual(during,closed);assert.equal(overlap(during,strip),false,'clear of the strip');
 board.input({type:'up',points:[],changed:[out]});board.destroy();
});
