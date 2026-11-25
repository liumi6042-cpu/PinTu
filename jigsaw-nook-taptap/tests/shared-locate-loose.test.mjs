import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleBoard } from '../mobile/puzzle-board.ts';
import { createFittedPuzzle } from '../lib/puzzle-engine.ts';

function platform(){
 const commands=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{if(name==='strokeStyle')commands.push(['strokeStyle',value]);target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),frames=[];
 return {commands,ctx,frames,createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:fn=>(frames.push(fn),frames.length),cancelFrame(){},config:{id:'taptap'}};
}
function setup(){const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{});board.setRect({x:0,y:0,w:800,h:600});return{p,state,board};}
const pieceCount=board=>board.state.groups.filter(g=>!g.locked).reduce((n,g)=>n+g.pieces.length,0);

test('locate marks every loose piece and leaves the camera alone when they are all in view',()=>{
 const {board,p}=setup();board.fit();const camera={...board.camera};
 board.state.groups[0].locked=true;board.state.groups[0].dx=board.state.groups[0].dy=0;
 const count=board.locateLoose();
 assert.equal(count,pieceCount(board));assert.equal(count,47);assert.deepEqual(board.camera,camera);assert.equal(board.locating,true);
 assert.ok(p.frames.length>0,'the glow animates');
 p.commands.length=0;board.draw(p.ctx);
 assert.ok(p.commands.some(c=>c[0]==='strokeStyle'&&c[1]==='#ffd447'),'the bright locate line is drawn');
});

test('locate pans and zooms out only as far as needed to show loose pieces outside the view',()=>{
 const {board}=setup();for(const g of board.state.groups){g.locked=true;g.dx=g.dy=0;}
 const far=board.state.groups[5];far.locked=false;far.dx=4000;far.dy=-3000;
 board.camera={x:0,y:0,z:2};assert.equal(board.locateLoose({top:50,bottom:20}),1);
 assert.ok(board.camera.z<=2);
 const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,id=far.pieces[0],cx=board.board.x+(id%8+.5)*w+far.dx,cy=board.board.y+(Math.floor(id/8)+.5)*h+far.dy,z=board.camera.z;
 const sx=board.camera.x+cx*z,sy=board.camera.y+cy*z;assert.ok(sx>0&&sx<800&&sy>50&&sy<580,'the far piece is now on screen');
 const before={...board.camera};board.locateLoose({top:50,bottom:20});assert.deepEqual(board.camera,before,'already in view: no second move');
});

test('locate with nothing loose reports zero and draws no glow',()=>{
 const {board,p}=setup();for(const g of board.state.groups){g.locked=true;g.dx=g.dy=0;}
 assert.equal(board.locateLoose(),0);assert.equal(board.locating,false);
 p.commands.length=0;board.draw(p.ctx);assert.ok(!p.commands.some(c=>c[0]==='strokeStyle'&&c[1]==='#ffd447'));
});

test('the glow expires on its own',async()=>{
 const {board}=setup();board.fit();const realNow=Date.now;let now=realNow();Date.now=()=>now;
 try{board.locateLoose();assert.equal(board.locating,true);now+=3700;assert.equal(board.locating,false);}finally{Date.now=realNow;}
});
