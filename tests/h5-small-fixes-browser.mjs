import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const bundle=await build({stdin:{contents:'export {GameApp} from "./mobile/app";export {Stage} from "./mobile/ui";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Task10',platform:'browser'});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const directory=resolve('work/task10-review');mkdirSync(directory,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:1000}});
 await page.route('http://task10.local/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{display:block}</style><canvas></canvas>'});
  const file=resolve('public',path.replace(/^\/(?:assets\/ui|art)\//,'mobile-icons/').replace(/^\//,''));
  return existsSync(file)?route.fulfill({body:readFileSync(file)}):route.abort();
 });
 await page.goto('http://task10.local/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const {GameApp,Stage}=Task10,canvas=document.querySelector('canvas'),overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  function check(value,label){if(!value)throw Error(label);}
  let width=320,height=900,capsule={x:220,y:24,w:88,h:32},rotated='';
  const platform={config:{id:'taptap',gameName:'一起拼拼拼'},canvas,viewport:()=>({width,height,top:20,bottom:0,dpr:1}),menuButtonRect:()=>capsule,createImage:()=>new Image(),createCanvas:()=>document.createElement('canvas'),setOrientation:async value=>{rotated=value;}};
  const stage=new Stage(platform,x=>x),app=Object.create(GameApp.prototype);
  Object.assign(app,{stage,platform,client:{asset:x=>x,cookieIdentity:false,config:{capabilities:{energy:true,shareRewards:true,createTickets:true,rewardedAd:true},adRewardEnabled:true,rewardedAdUnitId:'test'},profile:{level:10,xp:20,xpToNext:100,energy:70,energyCap:100,supply:{energy:1,create:1},ownedRooms:[]}},route:'supplies',scroll:0,bodyTop:80,bodyBottom:900,busy:false,modal:null,rooms:[],messages:[],social:{blockedCodes:[]},invalidate(){},showModal(){},board:{},pieces:48,visibility:'public'});
  const records={buttons:[],text:[],panels:[]};
  for(const [method,key] of [['button','buttons'],['text','text'],['panel','panels']]){const original=stage[method].bind(stage);stage[method]=(...args)=>{records[key].push(args);return original(...args);};}
  function begin(){canvas.style.width=width+'px';canvas.style.height=height+'px';stage.resize();stage.begin();for(const list of Object.values(records))list.length=0;}
  let supplyChecks=0;
  for(width=320;width<=650;width++)for(const ads of [false,true]){
   app.client.config.adRewardEnabled=ads;begin();app.drawSupplies();
   const cards=records.panels.slice(0,2).map(args=>args[0]);
   for(const card of cards){const buttons=records.buttons.filter(([r])=>r.x>=card.x&&r.x+r.w<=card.x+card.w&&r.y>=card.y&&r.y+r.h<=card.y+card.h);check(buttons.length>0,'supply action exists');for(const [r] of buttons){check(r.w===card.w-24,'full row action');for(const [text,x,y,size] of records.text.filter(([,x,y])=>x>=card.x&&x<card.x+card.w&&y>=card.y&&y<card.y+150))check(y+size<=r.y,'supply text above action: '+text);}}
   supplyChecks++;
  }
  for(const dimensions of [[651,390],[844,390],[1000,480]]){[width,height]=dimensions;app.bodyBottom=height;begin();app.drawSupplies();const [a,b]=records.panels.slice(0,2).map(args=>args[0]);check(a.y===b.y&&!overlap(a,b),'two supply columns');}
  width=320;height=900;app.bodyBottom=900;begin();app.drawSupplies();await new Promise(resolve=>setTimeout(resolve,250));begin();app.drawSupplies();
  window.task10={app,stage,records,platform,setSize(w,h){width=w;height=h;},begin};
  app.route='lobby';begin();app.drawHeader();const rotate=records.buttons.find(([,label,fn,opts])=>opts?.icon==='orientation');check(rotate&&rotate[0].w>=40&&rotate[0].h>=40,'lobby rotation hit');check(!overlap(rotate[0],capsule),'lobby clears capsule');
  const otherHits=stage.hits.filter(hit=>hit.fn!==rotate[2]);check(otherHits.every(hit=>!overlap(hit.r,rotate[0])),'rotation clears counters and profile');await rotate[2]();await Promise.resolve();check(rotated==='landscape','lobby toggles host');
  delete platform.setOrientation;begin();app.drawHeader();check(!records.buttons.some(([,,,opts])=>opts?.icon==='orientation'),'unsupported lobby hides rotation');
  platform.setOrientation=async value=>{rotated=value;};
  for(const mode of ['portrait','landscape'])for(const native of ['taptap','wechat','web'])for(const available of [false,true]){
   width=mode==='portrait'?320:844;height=mode==='portrait'?900:390;platform.config.id=native;capsule=available?{x:width-100,y:24,w:88,h:32}:null;begin();
   app.room={snapshot:{title:'测试房间',visibility:'public',members:[{id:'a'}],puzzle:{imageId:'test'}},state:{cols:8,rows:6,groups:[],imageId:'test'}};
   const top=app.headerSafeTop();check(native==='web'?top===20:top>=(available?64:60),'safe top and web unchanged');
   app.drawRoomTopBar({x:0,y:top,w:width-(mode==='landscape'?62:0),h:mode==='portrait'?76:52},mode);
   if(native!=='web'&&capsule)check(stage.hits.every(hit=>!overlap(hit.r,capsule)),'room hits clear capsule');
  }
  width=844;height=390;platform.config.id='taptap';app.room.snapshot.visibility='public';begin();app.drawToolColumn({x:782,y:64,w:60,h:320});check(records.text.some(([text])=>text==='竖屏'),'orientation replaces chat');check(!records.text.some(([text])=>text==='聊天'||text==='整理'),'multiplayer hides organize and duplicate chat');check(!app.roomTools.some(([kind])=>kind==='organize'),'rail hides organize');
  app.room.snapshot.visibility='solo';check(app.roomTools.some(([kind])=>kind==='organize'),'solo retains organize');
  delete platform.setOrientation;begin();app.drawToolColumn({x:782,y:64,w:60,h:320});check(!records.text.some(([text])=>text==='竖屏'),'unsupported column omits orientation');
  const pack={id:'locked',title:'锁定图包',price:180,imageIds:['locked-image']};app.collection={packs:[pack]};app.selected='locked-image';app.client.profile.supply.create=0;app.client.config.capabilities.shareRewards=false;let opened=false,launched=false;app.openPackPreview=p=>{opened=p===pack;};app.launch=()=>{launched=true;};
  width=320;height=900;begin();app.drawCreatePanel({x:0,y:80,w:320,h:600},{id:'locked-image',title:'锁定图片',category:'测试',thumbSrc:''},new Set(),true);const unlock=records.buttons.find(([,label])=>label==='解锁图包');
  // drawPictureButton paints its own label, so find its corresponding full-width button.
  const action=unlock??records.buttons.find(([r])=>r.h===44&&r.w===292);check(action&&!action[3]?.disabled,'locked create remains actionable without tickets');action[2]();check(opened&&!launched,'locked create opens pack preview without launching');
  return {supplyChecks,roomCases:12,lockedCreate:true};
 });
 assert.equal(result.supplyChecks,662);
 // Save representative renders from the actual shared Canvas renderer.
 for(const [name,width,height,scene] of [['supplies-320',320,900,'supplies'],['supplies-650',650,1000,'supplies'],['supplies-landscape',844,390,'supplies'],['lobby-320',320,900,'lobby'],['room-portrait',320,900,'portrait'],['room-landscape',844,390,'landscape']]){
  await page.setViewportSize({width,height});await page.evaluate(({width,height,scene})=>{const {app,stage,platform,setSize,begin}=window.task10;setSize(width,height);app.bodyTop=80;app.bodyBottom=height;app.route=scene;app.client.config.capabilities.shareRewards=true;app.client.config.adRewardEnabled=true;app.client.profile.supply.create=1;platform.setOrientation=async()=>{};begin();if(scene==='supplies')app.drawSupplies();else if(scene==='lobby')app.drawHeader();else app.drawRoomTopBar({x:0,y:app.headerSafeTop(),w:width-(scene==='landscape'?62:0),h:scene==='portrait'?76:52},scene);},{width,height,scene});
  await page.screenshot({path:resolve(directory,name+'.png')});
 }
 console.log(JSON.stringify(result));
}finally{await browser.close();}
