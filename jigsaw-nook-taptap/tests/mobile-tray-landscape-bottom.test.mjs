import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// 11-05 landscape feedback: the tray covered the middle of the table. It now lies along the bottom; the gift moves up under
// the corner map and 锁定 under the corner tool toggle (「把这两个移到上面的两边放，然后把托盘整个下移到底部」).
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui"; export {PuzzleBoard,TRAY_LANDSCAPE_BOTTOM} from "./mobile/puzzle-board";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,Stage,PuzzleBoard,TRAY_LANDSCAPE_BOTTOM}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const proxy=()=>new Proxy({measureText:value=>({width:String(value).length*7}),isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
function boardPlatform(){const ctx=proxy(),canvas=()=>({width:1,height:1,getContext:()=>ctx});return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:4000,naturalHeight:3000,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
async function room({w,h,toolsOpen,lock=true}){
 const storage=new Map([['jigsaw:room-guide:v1','done']]),viewport={width:w,height:h,top:0,bottom:0,dpr:1},ctx=proxy();
 const platform={config:{id:'taptap',apiBase:'/api'},createImage:()=>({}),createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const stage=new Stage(platform,value=>value),game=new GameApp(platform,{config:{capabilities:{}},profile:{collection:{},giftProgress:9,giftCount:2},asset:value=>value},stage);
 globalThis.matchMedia=()=>({matches:false});
 const column=toolsOpen?72:0,area={x:0,y:0,w:w-column,h},bp=boardPlatform(),board=new PuzzleBoard(bp,createFittedPuzzle('test',20,15,123),()=>{});
 Object.assign(game,{board,room:{snapshot:{completedAt:null,members:[]}},imageReady:true,lockButtonEnabled:lock,minimapEnabled:true,landscapeToolsOpen:toolsOpen,roomArea:area,ready:true,route:'room',roomViewPending:false});
 board.networkReady=true;board.network={canAcquire:()=>true,acquire:async()=>true,move(){},drop:async()=>{},release(){}};board.setRect(area);await board.setImage('t.png');board.showPreview=true;
 const headerTop=game.roomHeaderTop(),hits=[],hit=stage.hit.bind(stage);stage.hit=(r,f)=>{hits.push({...r});return hit(r,f);};
 const zoom=()=>{const z=board.camera.z*3,cx=board.board.x+board.board.width/2,cy=board.board.y+board.board.height/2;board.camera={x:area.w/2-cx*z,y:area.h/3-cy*z,z};};
 /** One frame of the landscape room: board, tool column, then the floating controls; returns what was drawn where. */
 const frame=()=>{
  stage.begin?.();game.placeBoard(board,headerTop+58,()=>{});hits.length=0;game.drawToolColumn({x:w-72,y:0,w:72,h});
  const toggle={...game.landscapeToggle};hits.length=0;game.chatBubble={message:{id:1,name:'小满',text:'一起拼吧',playerId:'p',code:'c'},until:Date.now()+4000};
  game.drawLandscapeRoomControls(board,headerTop,h);
  const gift=hits.find(r=>r.w===44&&r.h===52),lock=hits.find(r=>r.w===46&&r.h===46),chat=hits.find(r=>r.h===20);
  return {gift,lock,chat,toggle,tray:board.trayFrame,map:board.minimapFrame,thumb:board.previewThumb,header:{x:0,y:headerTop,w:area.w,h:52},column:toolsOpen?{x:w-72,y:0,w:72,h}:null};
 };
 return {game,board,frame,zoom,area,headerTop};
}
function clear(f,label){
 const movers={gift:f.gift,lock:f.lock,chat:f.chat},fixed={tray:f.tray,map:f.map,thumb:f.thumb,header:f.header,toggle:f.toggle,column:f.column};
 assert.ok(f.gift&&f.lock,label+': gift and 锁定 drawn');
 for(const [a,ra]of Object.entries(movers))for(const [b,rb]of Object.entries(fixed))if(ra&&rb)assert.equal(overlap(ra,rb),false,`${label}: ${a} clear of ${b}`);
 assert.equal(overlap(f.gift,f.lock),false,label+': gift clear of 锁定');if(f.chat){assert.equal(overlap(f.chat,f.gift),false,label+': chat clear of gift');assert.equal(overlap(f.chat,f.lock),false,label+': chat clear of 锁定');}
 for(const [a,r]of Object.entries(movers))if(r)assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=f.header.w+.01,`${label}: ${a} on the table`);
}

for(const [w,h]of [[844,390],[915,412]])for(const toolsOpen of [false,true])test(`landscape ${w}x${h}${toolsOpen?' with the tool column open':''}: tray at the bottom, gift and 锁定 up the sides, nothing overlaps`,async()=>{
 const {board,frame,zoom,area}=await room({w,h,toolsOpen});zoom();
 board.trayOpen=true;let f=frame();
 assert.ok(Math.abs(f.tray.y+f.tray.h-(area.y+area.h-TRAY_LANDSCAPE_BOTTOM))<.01,'the tray sits on the bottom edge');
 assert.ok(f.map,'the corner map shows');assert.ok(Math.abs(f.gift.y-(f.map.y+f.map.h+8))<.01&&f.gift.x<20,'the gift sits under the corner map on the left');
 assert.ok(Math.abs(f.lock.y-(f.toggle.y+f.toggle.h+8))<.01&&Math.abs(f.lock.x+f.lock.w/2-(f.toggle.x+f.toggle.w/2))<.01,'锁定 sits under the tool toggle');
 assert.ok(f.chat&&f.chat.y+f.chat.h<=f.tray.y,'the chat bubble sits above the open tray');
 clear(f,'tray open');
 // Drag-out: the tray is a strip on the same bottom edge.
 const v=board.trayLayout(),cell={id:1,x:f.tray.x+8+v.cellW/2,y:f.tray.y+v.top+v.cellH/2};board.input({type:'down',points:[cell],changed:[cell]});const out={...cell,y:cell.y-60};board.input({type:'move',points:[out],changed:[out]});
 f=frame();assert.equal(f.tray.h,28);assert.ok(Math.abs(f.tray.y+f.tray.h-(area.y+area.h-TRAY_LANDSCAPE_BOTTOM))<.01);clear(f,'drag-out strip');
 board.input({type:'up',points:[],changed:[out]});
 board.trayOpen=false;f=frame();clear(f,'tray closed');
 board.destroy();
});

test('landscape with the corner map off: the gift sits under the back button; locating keeps pieces above the bottom tray',async()=>{
 const {game,board,frame,headerTop,area}=await room({w:844,h:390,toolsOpen:false});game.minimapEnabled=false;
 board.trayOpen=true;const f=frame();assert.equal(f.map,null,'corner map off');assert.ok(Math.abs(f.gift.y-(headerTop+58))<.01);clear(f,'no map');
 board.locateLoose({top:headerTop+56,bottom:8});const v=board.trayLayout(),cam=board.camera,w=board.board.width/board.state.cols,h=board.board.height/board.state.rows;
 for(const g of board.state.groups)if(!g.locked)for(const id of g.pieces){const p=board.pieces[id],y=area.y+cam.y+(board.board.y+(p.row+1)*h+g.dy)*cam.z;assert.ok(y<=v.r.y+h*cam.z*.6,'located pieces stay above the tray');}
 board.destroy();
});

test('portrait keeps its tray 75 pt above the bottom bar',async()=>{
 const p=boardPlatform(),board=new PuzzleBoard(p,createFittedPuzzle('test',10,10,123),()=>{});board.setRect({x:0,y:77,w:360,h:702});await board.setImage('t.png');board.trayOpen=true;
 const r=board.trayFrame;assert.ok(Math.abs(r.y+r.h-(77+702-75))<.01);board.destroy();
});
