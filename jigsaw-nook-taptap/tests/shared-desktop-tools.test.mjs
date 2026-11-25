import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Same app bundling approach as shared-navigation-refresh; keep Stage hits/input real.
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const preference='jigsaw:desktop-tools-open:v1';

function fixture({saved,height=720,solo=false}={}){
 const storage=new Map([['jigsaw:room-guide:v1','done']]);if(saved!==undefined)storage.set(preference,saved);
 const records=[],boardInputs=[],fits=[],ctx=new Proxy({measureText:value=>({width:String(value).length*6})},{get:(target,key)=>target[key]??(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const viewport={width:1280,height,top:0,bottom:12,dpr:1};
 const platform={config:{id:'web',apiBase:'/api'},canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const stage=new Stage(platform,value=>value),client={config:{capabilities:{}},profile:{collection:{}},asset:value=>value};
 stage.frame=(r,name)=>records.push({type:'frame',r:{...r},name});stage.icon=(name,r)=>records.push({type:'icon',name,r:{...r}});stage.text=value=>records.push({type:'text',value});
 const hit=stage.hit.bind(stage);stage.hit=(r,fn)=>{records.push({type:'hit',r:{...r}});hit(r,fn);};
 const app=new GameApp(platform,client,stage);
 const board={camera:{x:40,y:30,z:1},setRect(r){this.rect={...r};},fit(completed,insets){fits.push({completed,insets});},draw(){records.push({type:'board'});},input(input){boardInputs.push(input);return true;}};
 Object.assign(app,{route:'room',ready:true,imageReady:true,roomViewPending:true,board,room:{connected:true,snapshot:{visibility:solo?'solo':'public'}}});
 // Unrelated room chrome does not affect toolbar drawing or Stage routing.
 for(const method of ['drawRoomTopBar','drawRoomPanel','drawRoomGift','drawZoomControl'])app[method]=()=>{};
 const surface=app.drawLandscapeSurface.bind(app);app.drawLandscapeSurface=(...args)=>{records.push({type:'surface',r:{...args[0]}});surface(...args);};
 const render=()=>{records.length=0;stage.begin();app.drawRoom();stage.endFrame();};
 const pointer=(type,x,y)=>{const point={id:1,x,y};return app.input({type,points:type==='up'?[]:[point],changed:[point]});};
 const click=(x,y)=>{pointer('down',x,y);pointer('up',x,y);};
 const key=(value,extra={})=>app.input({type:'key',points:[],changed:[],key:value,keyDown:true,repeat:false,...extra});
 return {app,board,stage,storage,records,boardInputs,fits,viewport,render,pointer,click,key,platform};
}

test('desktop board spans the left edge and floating card is drawn afterward above the gift',()=>{
 for(const solo of [false,true]){
  const f=fixture({height:600,solo});f.render();
  assert.equal(f.app.desktopToolsOpen,true);assert.deepEqual(f.app.roomArea,{x:0,y:60,w:980,h:540});assert.deepEqual(f.board.rect,f.app.roomArea);
  const card=f.app.roomToolsArea;assert.equal(card.x,12);assert.equal(card.y,72);assert.equal(card.w,80);assert.ok(card.y+card.h<=f.viewport.height-f.viewport.bottom-80);
  assert.ok(f.records.findIndex(r=>r.type==='board')<f.records.findIndex(r=>r.type==='surface'));
  assert.deepEqual(f.records.find(r=>r.type==='hit').r,card,'card shield is registered before button hits');
  assert.equal(f.records.filter(r=>r.type==='frame'&&r.r.x===20).length,solo?6:5);
  assert.deepEqual(f.fits,[{completed:false,insets:{bottom:56,left:104}}]);
  f.app.roomPanelCollapsed=true;f.render();assert.equal(f.app.roomArea.w,1248);
 }
});

test('collapse and expand clicks persist preference, leave only a 48px toggle, and preserve camera',()=>{
 const f=fixture();f.render();const camera={...f.board.camera};
 f.click(72,90);assert.equal(f.app.desktopToolsOpen,false);assert.equal(f.storage.get(preference),'0');assert.equal(f.app.roomViewPending,false);
 f.render();assert.deepEqual(f.app.roomToolsArea,{x:12,y:72,w:48,h:48});
 assert.deepEqual(f.records.filter(r=>r.type==='frame'&&r.r.x<100).map(r=>r.name),['button-cream-normal']);assert.deepEqual(f.records.filter(r=>r.type==='icon').map(r=>r.name),['tools']);
 assert.ok(f.records.some(r=>r.type==='text'&&r.value==='T'));assert.equal(f.records.filter(r=>r.type==='hit'&&r.r.x<100).length,1);
 assert.deepEqual(f.board.camera,camera);assert.equal(f.fits.length,1);
 f.key('f');assert.deepEqual(f.fits.at(-1),{completed:false,insets:{bottom:56,left:72}});
 f.click(36,96);assert.equal(f.app.desktopToolsOpen,true);assert.equal(f.storage.get(preference),'1');f.render();assert.deepEqual(f.board.camera,camera);assert.equal(f.fits.length,2);
 f.key('F');assert.deepEqual(f.fits.at(-1),{completed:false,insets:{bottom:56,left:104}});
 assert.equal(fixture({saved:'0'}).app.desktopToolsOpen,false);assert.equal(fixture({saved:'1'}).app.desktopToolsOpen,true);
 const initial=fixture({saved:'0'});initial.render();assert.equal(initial.fits[0].insets.left,72);
});

test('T toggles only in an unblocked desktop room on a fresh keydown',()=>{
 const f=fixture();f.render();assert.equal(f.key('T'),true);assert.equal(f.app.desktopToolsOpen,false);assert.equal(f.storage.get(preference),'0');
 f.key('t',{repeat:true});f.key('t',{keyDown:false});assert.equal(f.app.desktopToolsOpen,false);
 f.app.modal='settings';f.key('t');assert.equal(f.app.desktopToolsOpen,false);f.app.modal=null;
 f.app.route='lobby';f.key('t');assert.equal(f.app.desktopToolsOpen,false);f.app.route='room';
 for(const [width,height] of [[844,390],[390,844]]){Object.assign(f.viewport,{width,height});f.key('t');assert.equal(f.app.desktopToolsOpen,false);}
 Object.assign(f.viewport,{width:1280,height:720});f.key('t');assert.equal(f.app.desktopToolsOpen,true);assert.equal(f.storage.get(preference),'1');assert.equal(f.app.roomViewPending,false);
});

test('card gaps and disabled buttons shield board drags and cursor; later tool hits still win',()=>{
 const f=fixture();f.app.aid={grants:[],freeRemaining:{hint:0,underlay:0}};f.render();
 // Right padding is inside the card but outside every button.
 f.pointer('move',89,145);assert.equal(f.platform.canvas.style.cursor,'pointer');
 f.pointer('down',89,145);assert.equal(f.app.pointer.board,false);f.pointer('move',89,165);f.pointer('up',89,165);
 assert.equal(f.boardInputs.length,0,'gap gesture never reaches the puzzle board');
 f.click(50,190);assert.equal(f.boardInputs.length,0,'disabled hint remains shielded');
 f.click(50,130);assert.equal(f.board.edgeOnly,true,'edge button wins over the earlier shield');
 f.pointer('down',200,145);assert.equal(f.app.pointer.board,true);assert.equal(f.boardInputs.at(-1).type,'down','the surrounding board still receives drags');
});
