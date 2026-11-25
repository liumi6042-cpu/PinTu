import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

let clock=1_800_000_000_000;const realNow=Date.now;
test.beforeEach(()=>{clock=1_800_000_000_000;Date.now=()=>clock;});
test.afterEach(()=>{Date.now=realNow;});
function app({id='taptap',layout='phonePortrait'}={}){
 const storage=new Map([['jigsaw:room-guide:v1','done']]),viewport=layout==='phoneLandscape'?{width:844,height:390,top:0,bottom:0,dpr:1}:{width:390,height:844,top:20,bottom:0,dpr:1};
 const ctx=new Proxy({measureText:value=>({width:String(value).length*6})},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const platform={config:{id,apiBase:'/api'},createImage:()=>({}),createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const stage=new Stage(platform,value=>value),client={config:{capabilities:{}},profile:{collection:{}},asset:value=>value};
 const game=new GameApp(platform,client,stage),boardInputs=[],notes=[];
 globalThis.matchMedia=()=>({matches:false});
 game.note=text=>notes.push(text);game.roomViewPending=false;game.ready=true;game.privacyAccepted=true;game.route='room';
 game.board={input:input=>(boardInputs.push({type:input.type,points:input.points.map(p=>({...p}))}),true),camera:{x:0,y:0,z:1}};
 game.roomArea={x:0,y:100,w:viewport.width,h:viewport.height-180};
 return {game,stage,boardInputs,notes};
}
/** A floating control drawn over the table, registered the way a frame registers it. */
function control(stage,r,onTap){stage.begin?.();stage.hit(r,onTap);}
const at=(x,y)=>({id:1,x,y});
const send=(game,type,points,changed=points)=>game.input({type,points,changed});

test('a drag that starts on a control over the table moves the table instead; a tap still presses the control',()=>{
 const {game,stage,boardInputs}=app();let taps=0;const r={x:20,y:700,w:140,h:52};
 control(stage,r,()=>taps++);
 send(game,'down',[at(40,720)]);send(game,'move',[at(44,722)]);send(game,'up',[],[at(44,722)]);
 assert.equal(taps,1,'a short press is still a tap on 任务');assert.equal(boardInputs.length,0);
 control(stage,r,()=>taps++);
 send(game,'down',[at(40,720)]);send(game,'move',[at(52,714)]);
 assert.deepEqual(boardInputs.map(i=>i.type),['down','move'],'the table gets the landing point, then the move');
 assert.deepEqual(boardInputs[0].points,[at(40,720)]);
 send(game,'move',[at(80,690)]);send(game,'up',[],[at(80,690)]);
 assert.equal(taps,1,'the control is not triggered by the drag');assert.deepEqual(boardInputs.map(i=>i.type),['down','move','move','up']);
 assert.equal(game.pointer,null);
});

test('drag-through stays off for modals, the open tools popup, the landscape tools column, two fingers and Web',()=>{
 const cases=[
  ['modal',({game})=>{game.modal='members';}],
  ['tools popup',({game})=>{game.toolsOpen=true;}],
  ['two fingers',null],
 ];
 for(const [name,prepare]of cases){
  const f=app();prepare?.(f);control(f.stage,{x:20,y:700,w:140,h:52},()=>{});
  send(f.game,'down',[at(40,720)]);
  if(name==='two fingers')send(f.game,'move',[at(52,714),{id:2,x:200,y:400}],[at(52,714)]);else send(f.game,'move',[at(52,714)]);
  assert.deepEqual(f.boardInputs,[],name);
 }
 const land=app({layout:'phoneLandscape'});land.game.landscapeToolsOpen=true;land.game.roomToolsArea={x:760,y:0,w:84,h:390};control(land.stage,{x:770,y:120,w:64,h:58},()=>{});
 send(land.game,'down',[at(790,140)]);send(land.game,'move',[at(800,160)]);assert.deepEqual(land.boardInputs,[],'landscape tools column');
 const web=app({id:'web'});control(web.stage,{x:20,y:700,w:140,h:52},()=>{});send(web.game,'down',[at(40,720)]);send(web.game,'move',[at(52,714)]);assert.deepEqual(web.boardInputs,[],'web');
});

test('a chat bubble only opens the chat once it has shown for 600 ms',()=>{
 const {game,stage}=app(),r={x:100,y:300,w:180,h:32},centre=[r.x+r.w/2,r.y+r.h/2];
 stage.begin?.();game.bubbleHit({until:Date.now()+5000},r);assert.equal(stage.hasHit(...centre),false,'fresh bubble: no tap area yet');
 stage.begin?.();game.bubbleHit({until:Date.now()+5000-599},r);assert.equal(stage.hasHit(...centre),false);
 stage.begin?.();game.bubbleHit({until:Date.now()+5000-600},r);assert.equal(stage.hasHit(...centre),true,'armed after 600 ms');
 clearTimeout(game.bubbleArmTimer);
});

test('整理 needs a second tap within three seconds, and R works the same',async()=>{
 const {game,notes}=app();let organized=0;
 game.room={snapshot:{visibility:'solo'},organize:async()=>{organized++;}};game.toolsOpen=true;
 game.roomTool('organize');await Promise.resolve();
 assert.equal(organized,0,'the first tap only arms');assert.equal(game.toolActive('organize'),true,'整理 is lit');assert.equal(game.toolsOpen,true,'the tools stay open');
 assert.deepEqual(notes,['再点一次「整理」，会把所有散片重新铺开']);
 clock+=2000;game.roomTool('organize');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(organized,1,'the second tap reshuffles');assert.equal(game.toolActive('organize'),false);
 game.roomTool('organize');clock+=3100;game.roomTool('organize');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(organized,1,'a second tap after three seconds arms again instead');
 clock+=4000;game.input({type:'key',key:'r',keyDown:true,points:[],changed:[]});game.input({type:'key',key:'R',keyDown:true,points:[],changed:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(organized,2,'R then R reshuffles once');
});
