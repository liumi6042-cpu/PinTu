import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const bundle=await build({stdin:{contents:'export {GameApp} from "./mobile/app";export {Stage} from "./mobile/ui";export {PuzzleBoard} from "./mobile/puzzle-board";export {createPuzzle} from "./lib/puzzle-engine";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Task10',platform:'browser'});
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
  const platform={config:{id:'taptap',gameName:'一起拼拼拼'},canvas,viewport:()=>({width,height,top:20,bottom:0,dpr:1}),createImage:()=>new Image(),createCanvas:()=>document.createElement('canvas'),setOrientation:async value=>{rotated=value;}};
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
  app.route='lobby';begin();app.drawHeader();const rotate=records.buttons.find(([,label,fn,opts])=>opts?.icon==='orientation');check(rotate&&rotate[0].w>=40&&rotate[0].h>=40,'lobby rotation hit');
  const otherHits=stage.hits.filter(hit=>hit.fn!==rotate[2]);check(otherHits.every(hit=>!overlap(hit.r,rotate[0])),'rotation clears counters and profile');await rotate[2]();await Promise.resolve();check(rotated==='landscape','lobby toggles host');
  delete platform.setOrientation;begin();app.drawHeader();check(!records.buttons.some(([,,,opts])=>opts?.icon==='orientation'),'unsupported lobby hides rotation');
  platform.setOrientation=async value=>{rotated=value;};
  for(const mode of ['portrait','landscape'])for(const native of ['taptap','wechat','web'])for(const available of [false,true]){
   width=mode==='portrait'?320:844;height=mode==='portrait'?900:390;platform.config.id=native;capsule=available?{x:width-100,y:24,w:88,h:32}:null;begin();
   app.room={snapshot:{title:'测试房间',visibility:'public',members:[{id:'a'}],puzzle:{imageId:'test'}},state:{cols:8,rows:6,groups:[],imageId:'test'}};
   const top=app.headerSafeTop();check(native==='web'?top===20:top===22,'fixed 2px top inset; web unchanged');check(app.roomHeaderTop()===(native==='web'?20:34),'room top gap matches lobby');
   app.drawRoomTopBar({x:0,y:app.roomHeaderTop(),w:width-(mode==='landscape'?62:0),h:mode==='portrait'?76:52},mode);
  }
  width=844;height=390;platform.config.id='taptap';app.room.snapshot.visibility='public';app.landscapeToolsOpen=true;begin();app.drawToolColumn({x:782,y:64,w:60,h:320});check(records.text.some(([text])=>text==='横竖屏'),'orientation replaces chat');check(!records.text.some(([text])=>text==='聊天'||text==='整理'),'multiplayer hides organize and duplicate chat');check(!app.roomTools.some(([kind])=>kind==='organize'),'rail hides organize');
  app.room.snapshot.visibility='solo';check(app.roomTools.some(([kind])=>kind==='organize'),'solo retains organize');
  delete platform.setOrientation;begin();app.drawToolColumn({x:782,y:64,w:60,h:320});check(!records.text.some(([text])=>text==='横竖屏'),'unsupported column omits orientation');
  const pack={id:'locked',title:'锁定图包',price:180,imageIds:['locked-image']};app.collection={packs:[pack]};app.selected='locked-image';app.client.profile.supply.create=0;app.client.config.capabilities.shareRewards=false;let opened=false,launched=false;app.openPackPreview=p=>{opened=p===pack;};app.launch=()=>{launched=true;};
  width=320;height=900;begin();app.drawCreatePanel({x:0,y:80,w:320,h:600},{id:'locked-image',title:'锁定图片',category:'测试',thumbSrc:''},new Set(),true);const unlock=records.buttons.find(([,label])=>label==='解锁图包');
  // drawPictureButton paints its own label, so find its corresponding full-width button.
  const action=unlock??records.buttons.find(([r])=>r.h===44&&r.w===292);check(action&&!action[3]?.disabled,'locked create remains actionable without tickets');action[2]();check(opened&&!launched,'locked create opens pack preview without launching');
  return {supplyChecks,roomCases:12,lockedCreate:true};
 });
 assert.equal(result.supplyChecks,662);
 // Save representative renders from the actual shared Canvas renderer.
 for(const [name,width,height,scene] of [['supplies-320',320,900,'supplies'],['supplies-650',650,1000,'supplies'],['supplies-landscape',844,390,'supplies'],['lobby-320',320,900,'lobby'],['room-portrait',320,900,'portrait'],['room-landscape',844,390,'landscape']]){
  await page.setViewportSize({width,height});await page.evaluate(({width,height,scene})=>{const {app,stage,platform,setSize,begin}=window.task10;setSize(width,height);app.bodyTop=80;app.bodyBottom=height;app.route=scene;app.client.config.capabilities.shareRewards=true;app.client.config.adRewardEnabled=true;app.client.profile.supply.create=1;platform.setOrientation=async()=>{};begin();if(scene==='supplies')app.drawSupplies();else if(scene==='lobby')app.drawHeader();else app.drawRoomTopBar({x:0,y:app.roomHeaderTop(),w:width-(scene==='landscape'?62:0),h:scene==='portrait'?76:52},scene);},{width,height,scene});
  await page.screenshot({path:resolve(directory,name+'.png')});
 }
 const landscapeResult=await page.evaluate(async()=>{
  const {GameApp,Stage,PuzzleBoard,createPuzzle}=Task10,canvas=document.querySelector('canvas'),storage=new Map(),key='jigsaw:landscape-tools-open:v1';let width=844,height=390,modal=null,orientation='';
  const check=(value,label)=>{if(!value)throw Error(label);},overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const platform={canvas,config:{id:'taptap',apiBase:'fixture',gameName:'一起拼拼拼'},viewport:()=>({width,height,top:20,bottom:0,dpr:1}),storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},createImage:()=>new Image(),createCanvas:()=>document.createElement('canvas'),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},setOrientation:async value=>{orientation=value;}};
  const client={asset:x=>x,cookieIdentity:false,config:{capabilities:{energy:true,shareRewards:true},adRewardEnabled:false},profile:{code:'self',giftProgress:3,giftCount:0,collection:{equipped:null}}},stage=new Stage(platform,x=>x),app=new GameApp(platform,client,stage);
  app.invalidate=()=>{};app.showModal=value=>{modal=value;};app.ready=true;app.privacyAccepted=true;app.route='room';app.cursorVisible=true;app.roomViewPending=true;
  const state=createPuzzle('fixture',12,9,16);for(const group of state.groups.slice(0,41)){group.locked=true;group.dx=group.dy=0;}
  const board=new PuzzleBoard(platform,state,()=>{});board.networkReady=true;board.network={acquire:async()=>true,move(){},drop:async()=>{},release(){}};app.board=board;app.room={connected:true,state:board.state,snapshot:{title:'云海鲸歌',visibility:'solo',members:[{id:'p1'}],puzzle:{imageId:'fixture'}}};app.imageReady=true;app.aid={grants:[],freeRemaining:{hint:1,underlay:1}};storage.set('jigsaw:room-guide:v1','done');
  await board.setImage('/puzzles/album-cloud-wonders-04-20261020-optimized-708922e5f718.webp');
  const records={floats:[],text:[],icons:[],hits:[],buttons:[],meters:[]};let fits=0;
  const float=app.drawRoomFloat.bind(app);app.drawRoomFloat=(r,rounded)=>{records.floats.push({...r,rounded:!!rounded});return float(r,rounded);};
  const fit=app.phoneFit.bind(app);app.phoneFit=(...args)=>{fits++;return fit(...args);};
  for(const [method,key] of [['text','text'],['icon','icons'],['hit','hits'],['button','buttons'],['meter','meters']]){const original=stage[method].bind(stage);stage[method]=(...args)=>{records[key].push(args);return original(...args);};}
  function render(){canvas.style.width=width+'px';canvas.style.height=height+'px';stage.resize();stage.begin();for(const list of Object.values(records))list.length=0;app.drawRoom();stage.endFrame();}
  function setMembers(n){app.room.snapshot.members=Array.from({length:n},(_,index)=>({id:'p'+index,name:'拼友'+index}));}
  function toggle(){const before=app.landscapeToolsOpen,button=stage.hits.findLast(hit=>hit.r.x>=width-60&&hit.r.w===36);check(button,'round toggle exists');button.fn();check(app.landscapeToolsOpen!==before,'round button toggles');check(storage.get(key)===(app.landscapeToolsOpen?'1':'0'),'toggle persists');}
  check(!app.landscapeToolsOpen,'constructor defaults closed');render();check(records.icons.filter(([name])=>name==='tools').length===1&&!records.text.some(([t])=>t==='边缘'),'collapsed has only tools toggle');
  const checks=[];
  for(const [w,h] of [[844,390],[667,375],[740,360],[932,430]]){
   width=w;height=h;const rightWidths=[];
   for(const members of [1,3,8]){
    setMembers(members);app.room.snapshot.title=members===8?'这是用于检查省略和避让的很长很长的拼图房间标题':'云海鲸歌';app.room.snapshot.visibility=members===1?'solo':'public';
    for(const open of [false,true]){
     app.setLandscapeToolsOpen(open);const beforeFits=fits;render();check(fits-beforeFits<=1,'toggle refits at most once');const afterFits=fits;render();check(fits===afterFits,'unrelated redraw never refits');
     const [left,centre,right]=records.floats;check([left,centre,right].every(r=>r.y===app.roomHeaderTop()),'top inset unchanged');check(!overlap(left,centre)&&!overlap(centre,right)&&!overlap(left,right),'three top blocks never overlap');check(centre.w<=300&&centre.w>90&&centre.h===30&&centre.rounded,'bounded rounded capsule');check(Math.abs(centre.x+centre.w/2-app.roomArea.w/2)<.1,'capsule centred on play width');
     check(left.w<=220&&right.x+right.w<=app.roomArea.w,'top blocks fit play width');check(records.meters[0][0].w>0,'progress meter remains visible');
     const hits=stage.hits.filter(({r})=>r.y<app.roomHeaderTop()+46);for(let i=0;i<hits.length;i++)for(let j=i+1;j<hits.length;j++){const a=hits[i].r,b=hits[j].r,block=r=>[left,centre,right].findIndex(box=>r.x>=box.x&&r.x+r.w<=box.x+box.w+.01);if(block(a)!==block(b))check(!overlap(a,b),'hit areas from different top blocks never overlap');}
     check(!overlap(app.roomToolsArea,left)&&!overlap(app.roomToolsArea,centre)&&!overlap(app.roomToolsArea,right),'tools clear top blocks');
     check(records.text.some(([t])=>t==='整理')===(open&&members===1),'organize only in solo expanded column');check(records.text.some(([t])=>t==='横竖屏')===open,'supported rotation only in expanded column');
     if(open){check(records.text.some(([t])=>t==='免费1次'),'aid badge retained');check(app.roomArea.w===width-60,'expanded board area');}else{check(app.roomArea.w===width,'collapsed board uses freed width');if(members<=3)rightWidths.push({members,width:right.w});}
     checks.push({width:w,height:h,members,open,left,centre,right,boardWidth:app.roomArea.w});
    }
   }
   check(rightWidths[0].width<rightWidths[1].width,'right block grows from one to three members');
  }
  width=844;height=390;setMembers(1);app.room.snapshot.title='云海鲸歌';app.room.snapshot.visibility='solo';app.setLandscapeToolsOpen(false);render();const closedWidth=app.roomArea.w;toggle();const beforeFits=fits;render();check(fits===beforeFits+1,'one refit on opening');check(app.roomArea.w<closedWidth,'opening narrows board');
  const restored=new GameApp(platform,client,stage);check(restored.landscapeToolsOpen,'next app restores open preference');render();toggle();render();check(!new GameApp(platform,client,stage).landscapeToolsOpen,'next app restores closed preference');toggle();render();
  // The app routes real pointer gestures to the real board: only a background tap collapses.
  const event=(type,p,points=type==='up'?[]:[p],extra={})=>app.input({type,points,changed:[p],...extra});
  let background;for(let y=110;y<height-60&&!background;y+=9)for(let x=65;x<width-80;x+=9){const p={id:1,x,y};if(!stage.hasHit(x,y)&&!board.groupAt(p)){background=p;break;}}check(background,'empty board background found');
  event('down',background);event('move',{...background,x:background.x+20});event('up',{...background,x:background.x+20});check(app.landscapeToolsOpen,'background pan does not collapse');
  event('down',background);event('cancel',background,[]);check(app.landscapeToolsOpen,'cancel does not collapse');
  event('down',background);const second={id:2,x:background.x+30,y:background.y+30};event('down',second,[background,second]);event('up',second,[background]);event('up',background);check(app.landscapeToolsOpen,'pinch does not collapse');
  let piece;for(let y=95;y<height-40&&!piece;y+=5)for(let x=60;x<width-80;x+=5){const p={id:1,x,y};if(!stage.hasHit(x,y)&&board.groupAt(p)){piece=p;break;}}check(piece,'visible loose piece found');
  event('down',piece);await Promise.resolve();event('up',piece);check(app.landscapeToolsOpen,'piece tap or drag never collapses');
  event('down',piece);event('move',{...piece,x:piece.x+18});event('up',{...piece,x:piece.x+18});check(app.landscapeToolsOpen,'piece drag preserves column');
  render();background=null;for(let y=110;y<height-60&&!background;y+=9)for(let x=65;x<width-80;x+=9){const p={id:1,x,y};if(!stage.hasHit(x,y)&&!board.groupAt(p)){background=p;break;}}check(background,'empty background after camera gestures');event('down',background);event('up',background);check(!app.landscapeToolsOpen&&storage.get(key)==='0','background tap collapses and persists');render();
  // Exercise actual Canvas action targets for the members/chat and invite entries.
  const memberHit=stage.hits.find(hit=>hit.r.x===app.roomMembersArea.x&&hit.r.w===app.roomMembersArea.w);memberHit.fn();check(modal==='chat','avatars open existing chat entry');records.buttons.find(([,label])=>label==='+ 邀请')[2]();check(modal==='invite','invite opens invite modal');modal=null;
  app.setLandscapeToolsOpen(true);delete platform.setOrientation;render();check(!records.text.some(([t])=>t==='横竖屏'),'unsupported landscape omits rotation');platform.setOrientation=async value=>{orientation=value;};render();const rotation=records.hits.findLast(([r])=>records.text.some(([text,x,y])=>text==='横竖屏'&&x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<r.y+r.h));rotation[1]();await Promise.resolve();await Promise.resolve();check(orientation==='portrait','landscape rotation uses existing host action');
  width=390;height=844;app.roomViewPending=true;app.toolsOpen=true;render();check(records.text.some(([t])=>t==='横屏')&&records.icons.some(([kind])=>kind==='orientation'),'portrait adds rotate cell');
  const cellHits=records.hits.filter(([r])=>r.h===76);check(cellHits.length===6&&cellHits.every(([r])=>Math.abs(r.w-cellHits[0][0].w)<.01),'six equal portrait tool cells in solo room');
  orientation='';const portraitRotate=cellHits.at(-1);portraitRotate[1]();await Promise.resolve();await Promise.resolve();check(orientation==='landscape','portrait rotate invokes host');app.toolsOpen=true;delete platform.setOrientation;render();check(!records.text.some(([t])=>t==='横屏')&&records.hits.filter(([r])=>r.h===76).length===5,'unsupported portrait retains five equal cells');
  platform.config.id='web';width=844;height=390;app.landscapeToolsOpen=true;render();check(!records.floats.length&&app.roomArea.w===width-62&&records.text.some(([t])=>t==='更多'),'Web landscape retains its existing header and column layout');platform.config.id='taptap';
  platform.setOrientation=async()=>{};
  window.task16={app,board,stage,records,platform,render,setMembers,setSize(w,h){width=w;height=h;}};
  return {landscapeCases:checks.length,checks,persistence:true,backgroundTap:true,dragAndPinchPreserved:true,portraitRotation:true};
 });
 const task16Directory=resolve('work/task16-review');mkdirSync(task16Directory,{recursive:true});
 for(const [name,members,open] of [['landscape-1p-collapsed',1,false],['landscape-1p-expanded',1,true],['landscape-3p-collapsed',3,false],['landscape-3p-expanded',3,true],['portrait-tray-open',1,false]]){
  const portrait=name==='portrait-tray-open',width=portrait?390:844,height=portrait?844:390;await page.setViewportSize({width,height});
  await page.evaluate(async({width,height,members,open,portrait})=>{const {app,board,stage,setSize,setMembers,render}=window.task16;setSize(width,height);setMembers(members);app.room.snapshot.visibility=members===1?'solo':'public';app.setLandscapeToolsOpen(open);app.toolsOpen=portrait;app.roomViewPending=true;render();if(!portrait){const b=board.board,z=.78;board.camera={x:(app.roomArea.w-b.width*z)/2-b.x*z,y:14-b.y*z,z};}await new Promise(resolve=>setTimeout(resolve,200));render();},{width,height,members,open,portrait});
  await page.screenshot({path:resolve(task16Directory,name+'.png')});
 }
 writeFileSync(resolve(task16Directory,'checks.json'),JSON.stringify(landscapeResult,null,2));
 console.log(JSON.stringify({...result,task16:{...landscapeResult,checks:undefined}}));
}finally{await browser.close();}
