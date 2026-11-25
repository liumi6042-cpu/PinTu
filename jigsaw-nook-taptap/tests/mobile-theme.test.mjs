import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {boardThemeColors,isThemeId,themeColors,themeUiColor,themeFrameColor,themeTextColor} from '../mobile/theme.ts';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const bundled=await build({absWorkingDir:decodeURIComponent(root),stdin:{contents:'export {Stage,palette} from "./mobile/ui";',resolveDir:decodeURIComponent(root),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {Stage,palette}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const frames=JSON.parse(readFileSync(new URL('../mobile/pixel-frame-data.json',import.meta.url),'utf8'));
function contrast(a,b){const luminance=hex=>{const channels=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}

function platform(dpr=2.625){
 const commands=[];
 function context(){const target={fillStyle:'',strokeStyle:'',filter:'none',globalAlpha:1,measureText:text=>({width:String(text).length*8}),isPointInPath:()=>true,createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})};return new Proxy(target,{get:(target,name)=>name in target?target[name]:(...args)=>commands.push({op:name,args,color:target.fillStyle,filter:target.filter}),set:(target,name,value)=>{target[name]=value;return true;}});}
 const createCanvas=()=>{const ctx=context();return{width:1,height:1,getContext:()=>ctx};};
 const canvas=createCanvas();
 return{commands,canvas,ctx:canvas.getContext('2d'),createCanvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){this.url=value;queueMicrotask(()=>this.onload());}}),viewport:()=>({width:379,height:601,dpr}),config:{id:'wechat'},onHide:()=>()=>{},frame:()=>1,cancelFrame(){}};
}

test('themes belong to each Stage and preserve the original light palette',()=>{
 const a=new Stage(platform(),x=>x),b=new Stage(platform(),x=>x);
 assert.equal(palette.paper,'#fdf6ed');assert.equal(a.palette.ink,'#642238');
 a.begin();assert.equal(a.dirty,false);a.setTheme('dark');assert.equal(a.dirty,true);
 assert.equal(a.theme,'dark');assert.deepEqual(a.palette,themeColors('dark'));
 assert.equal(b.theme,'light');assert.equal(b.palette,palette);assert.equal(palette.paper,'#fdf6ed');
 a.setTheme('wood');assert.equal(a.theme,'wood');assert.equal(isThemeId('wood'),true);assert.deepEqual(a.palette,themeColors('light'));
 assert.equal(boardThemeColors('light').paper,'#fdf6ed');assert.equal(boardThemeColors('light').target,'#fff7ed');assert.equal(boardThemeColors('wood').paper,'#e0d5bf');assert.equal(boardThemeColors('wood').target,'#cabc9f');assert.equal(themeUiColor('wood','#fffaf3ee'),'#fffaf3ee');a.setTheme('dark');
 assert.equal(themeUiColor('light','#FFF6E9'),'#FFF6E9');
 assert.equal(themeUiColor('dark','#FFF6E9'),'#352b35');
 assert.equal(themeUiColor('dark','#fffaf3ee'),'#352b36ee');
 assert.equal(themeTextColor('dark','#fffaf0'),'#fffaf0','cream button labels retain contrast');
 assert.equal(themeTextColor('dark','#642238'),a.palette.ink);
 assert.equal(themeFrameColor('dark','panel-gold','#D8AF70'),'#66533b','body text panels receive a dark gold surface');
 assert.equal(themeFrameColor('dark','button-gold-normal','#D8AF70'),'#d8af70','gold accent buttons remain gold');
 assert.ok(contrast(themeColors('dark').ink,themeFrameColor('dark','panel-gold',frames['panel-gold'].surface))>=4.5,'private chat body text remains readable on its dark gold bubble');
});

test('desktop panes keep pixel frames and clipped clicks aligned without leaking viewport state',()=>{
 const p=platform(2),stage=new Stage(p,x=>x);let clicks=0;stage.begin();
 const paint=x=>{p.commands.length=0;stage.frame({x,y:20,w:80,h:40},'button-cream-normal');return p.commands.filter(c=>c.op==='fillRect').map(c=>c.args);};
 const baseline=paint(10);let shifted;
 stage.withViewport({x:100,y:60,w:150,h:200},()=>{
  assert.equal(stage.w,150);assert.equal(stage.h,200);shifted=paint(10);
  stage.clip({x:0,y:15,w:45,h:50},()=>stage.button({x:10,y:20,w:80,h:40},'领取',()=>clicks++));
  stage.withViewport({x:25,y:90,w:80,h:50},()=>stage.hit({x:0,y:0,w:80,h:50},()=>clicks+=10));
 });
 assert.deepEqual(shifted,baseline.map(([x,y,w,h])=>[x+200,y+120,w,h]));
 assert.equal(stage.w,379);assert.equal(stage.h,601);
 const click=(x,y)=>{const point={id:1,x,y};stage.input({type:'down',points:[point],changed:[point]});stage.input({type:'up',points:[],changed:[point]});};
 click(120,90);assert.equal(clicks,1);click(160,90);assert.equal(clicks,1,'clipped button cannot be clicked through');click(20,30);assert.equal(clicks,1,'old local coordinates cannot trigger the moved button');
 click(130,155);assert.equal(clicks,11,'nested pane hits retain screen coordinates');
 const point={id:1,x:120,y:90};stage.input({type:'down',points:[point],changed:[point]});stage.input({type:'cancel',points:[],changed:[]});stage.input({type:'up',points:[],changed:[point]});assert.equal(clicks,11,'resize or Escape cancellation without coordinates prevents a stale action');
 assert.throws(()=>stage.withViewport({x:10,y:10,w:20,h:20},()=>{throw Error('test');}));
 assert.equal(stage.w,379);assert.equal(stage.h,601);assert.deepEqual(paint(10),baseline,'exceptions restore the root drawing origin');
});

test('all pixel frames change colour without changing geometry or physical-pixel alignment',()=>{
 for(const dpr of [1,2.625,3.5]){
  const p=platform(dpr),stage=new Stage(p,x=>x);
  for(const [id,spec] of Object.entries(frames))for(const r of [{x:12.3,y:9.7,w:133.2,h:41.4},{x:12.3,y:9.7,w:7,h:8}]){
   const draw=theme=>{stage.setTheme(theme);stage.begin();p.commands.length=0;stage.frame(r,id);return p.commands.filter(c=>c.op==='fillRect');};
   const light=draw('light'),dark=draw('dark');
   assert.deepEqual(dark.map(c=>c.args),light.map(c=>c.args),`${id} geometry`);
   assert.deepEqual(dark.map(c=>c.color),light.map(c=>themeFrameColor('dark',id,c.color)),`${id} palette`);
   assert.ok(dark.every(c=>c.args.every(Number.isInteger)),`${id} uses whole device pixels`);
   assert.equal(p.commands.filter(c=>c.op==='drawImage').length,0,'borders never resample images');
   assert.ok(dark.some(c=>c.color.toLowerCase()!==spec.surface.toLowerCase()||id.includes('gold')));
  }
 }
});

test('theme switching preserves image sources, drawing bounds, and button hit areas',async()=>{
 const p=platform(),stage=new Stage(p,x=>x),r={x:14,y:26,w:80,h:60};let clicks=0;
 stage.image('test-picture.png',r,'contain');await Promise.resolve();
 const draw=theme=>{stage.setTheme(theme);stage.begin();p.commands.length=0;stage.image('test-picture.png',r,'contain');stage.button({x:30,y:120,w:140,h:40},'进入拼图',()=>clicks++,{tone:'berry'});return p.commands.filter(c=>c.op==='drawImage');};
 const light=draw('light'),dark=draw('dark');assert.deepEqual(dark.map(c=>c.args),light.map(c=>c.args));assert.equal(dark[0].filter,'none');
 const point={id:1,x:100,y:140};stage.input({type:'down',points:[point],changed:[point]});stage.input({type:'up',points:[],changed:[point]});assert.equal(clicks,1);
});

test('utility icons retain their square SVG viewBox inside narrow and wide slots',()=>{
 const p=platform(),stage=new Stage(p,x=>x);
 for(const kind of ['piece','person','invite','daily','tools','chat','themeSun'])for(const r of [{x:10,y:20,w:14,h:22},{x:10,y:20,w:32,h:18},{x:10,y:20,w:24,h:24}]){
  p.commands.length=0;stage.icon(kind,r);
  const size=Math.min(r.w,r.h),transform=p.commands.find(c=>c.op==='scale'),origin=p.commands.find(c=>c.op==='translate');
  assert.deepEqual(transform.args,[size/24,size/24],`${kind} keeps the same scale on both axes`);
  assert.deepEqual(origin.args,[r.x+(r.w-size)/2,r.y+(r.h-size)/2],`${kind} remains centred in its existing slot`);
 }
});

test('atlas icons and recoloured decorations preserve aspect ratio and matching visible bounds',async()=>{
 const p=platform(),stage=new Stage(p,x=>x),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} should match ${b}`);
 for(const kind of ['coin','leaf','xpStar','moon','lantern'])for(const r of [{x:10,y:20,w:16,h:32},{x:10,y:20,w:40,h:19}]){
  stage.icon(kind,r);await Promise.resolve();p.commands.length=0;stage.icon(kind,r);
  const original=p.commands.findLast(c=>c.op==='drawImage').args;
  const [,sx,sy,sw,sh,x,y,w,h]=original;
  close(w/h,sw/sh);close(x+w/2,r.x+r.w/2);close(y+h/2,r.y+r.h/2);
  assert.ok(w<=r.w+1e-8&&h<=r.h+1e-8,`${kind} fits inside the slot`);
  p.commands.length=0;stage.decoration({artKey:kind,color:'#123456'},r);
  const coloured=p.commands.findLast(c=>c.op==='drawImage').args;
  close(coloured[7]/coloured[8],sw/sh);
  coloured.slice(5).forEach((v,i)=>close(v,original[i+5]));
  p.commands.length=0;stage.decoration({artKey:kind,color:'#123456'},r);
  assert.deepEqual(p.commands.findLast(c=>c.op==='drawImage').args,coloured,'cached colour variants retain their geometry');
 }
});

test('puzzle themes only change UI and keep decoded pictures, atlas and room state intact',async()=>{
 const p=platform(),state=createFittedPuzzle('theme-test',4,3,123),board=new PuzzleBoard(p,state,()=>{});
 board.setRect({x:0,y:80,w:379,h:500});await board.setImage('original-picture.png');board.trayOpen=true;board.showPreview=true;
 const atlas=board.atlas,picture=board.picture,before=JSON.stringify(state);
 const draw=theme=>{board.setTheme(theme);p.commands.length=0;board.draw(p.ctx);return p.commands.filter(c=>c.op==='drawImage');};
 // The first draw also paints the tray's piece pictures (one shared recording context here); compare later draws.
 draw('light');const light=draw('light'),wood=draw('wood'),dark=draw('dark');assert.deepEqual(dark.map(c=>c.args),light.map(c=>c.args));assert.deepEqual(wood.map(c=>c.args),light.map(c=>c.args));
 assert.equal(board.atlas,atlas);assert.equal(board.picture,picture);assert.equal(JSON.stringify(state),before);
 assert.ok(dark.some(c=>c.args[0]===atlas));assert.ok(dark.some(c=>c.args[0]===picture));assert.ok(dark.every(c=>c.filter==='none'));
 assert.ok(p.commands.some(c=>c.color==='#332a34f5'),'optional tray receives the dark surface');
 board.destroy();
});
