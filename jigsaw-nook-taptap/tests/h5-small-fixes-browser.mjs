import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const bundle=await build({stdin:{contents:'export {GameApp} from "./mobile/app";export {Stage} from "./mobile/ui";export {PuzzleBoard} from "./mobile/puzzle-board";export {createPuzzle} from "./lib/puzzle-engine";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Task10',platform:'browser'});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const directory=resolve('work/task10-review');mkdirSync(directory,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:1000},deviceScaleFactor:Number(process.env.HARNESS_DPR)||1});
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
  for(const [method,key] of [['button','buttons'],['text','text'],['textMiddle','text'],['panel','panels']]){const original=stage[method].bind(stage);stage[method]=(...args)=>{records[key].push(args);return original(...args);};}
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
   const top=app.headerSafeTop();check(native==='web'?top===20:top===22,'fixed 2px top inset; web unchanged');check(app.roomHeaderTop()===(native==='web'?20:mode==='landscape'?26:34),'portrait room gap matches lobby; landscape uses the mockup top 10');
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
  const records={surfaces:[],landscapeButtons:[],text:[],icons:[],hits:[],buttons:[],meters:[],frames:[]};let fits=0;
  const surface=app.drawLandscapeSurface.bind(app);app.drawLandscapeSurface=(...args)=>{records.surfaces.push(args);return surface(...args);};
  const landscapeButton=app.drawLandscapeButton.bind(app);app.drawLandscapeButton=(...args)=>{records.landscapeButtons.push(args);return landscapeButton(...args);};
  const fit=app.phoneFit.bind(app);app.phoneFit=(...args)=>{fits++;return fit(...args);};
  for(const [method,key] of [['text','text'],['textMiddle','text'],['icon','icons'],['hit','hits'],['button','buttons'],['meter','meters'],['frame','frames']]){const original=stage[method].bind(stage);stage[method]=(...args)=>{records[key].push(args);return original(...args);};}
  function render(){canvas.style.width=width+'px';canvas.style.height=height+'px';stage.resize();stage.begin();for(const list of Object.values(records))list.length=0;app.drawRoom();stage.endFrame();}
  function setMembers(n){app.room.snapshot.members=Array.from({length:n},(_,index)=>({id:'p'+index,name:['小鹿','阿禾','小满','星星'][index%4],code:index?'friend'+index:'self',color:['#a85567','#6f8a4f','#477e9b','#9866a1'][index%4]}));}
  function toggle(){const before=app.landscapeToolsOpen,button=stage.hits.findLast(hit=>hit.r.x>width-130&&hit.r.w===36);check(button,'round toggle exists');button.fn();check(app.landscapeToolsOpen!==before,'round button toggles');check(storage.get(key)===(app.landscapeToolsOpen?'1':'0'),'toggle persists');}
  check(!app.landscapeToolsOpen,'constructor defaults closed');render();check(records.icons.filter(([name])=>name==='tools').length===1&&!records.text.some(([t])=>t==='边缘'),'collapsed has only tools toggle');
  const checks=[];
  for(const [w,h] of [[844,390],[667,375],[740,360],[932,430]]){
   width=w;height=h;const rightWidths=[];
   for(const members of [1,4,8]){
    setMembers(members);app.room.snapshot.title=members===8?'这是用于检查省略和避让的很长很长的拼图房间标题':'云海鲸歌';app.room.snapshot.visibility=members===1?'solo':'public';
    for(const open of [false,true]){
     app.setLandscapeToolsOpen(open);const beforeFits=fits;render();check(fits-beforeFits<=1,'toggle refits at most once');const afterFits=fits;render();check(fits===afterFits,'unrelated redraw never refits');
     const back=records.landscapeButtons.find(([,label])=>label==='<')[0],invite=records.landscapeButtons.find(([,label])=>label==='＋ 邀请')[0],title=records.text.find(([t])=>t===app.room.snapshot.title),avatars=records.icons.filter(([name])=>name==='avatar'),right={x:app.roomMembersArea.x,y:invite.y,w:invite.x+invite.w-app.roomMembersArea.x,h:34};
     const [centre,radius,fill,border,lineWidth]=records.surfaces.find(([,radius,fill])=>fill==='rgba(255,250,243,.92)'),meter=records.surfaces.find(([,radius,fill])=>fill==='#efe0d6')[0],left={x:back.x,y:back.y,w:title[1]+title[6]-back.x,h:36};
     check(back.x===12&&back.y===app.roomHeaderTop()&&back.w===36&&back.h===36,'back uses unchanged safe header anchor');check(invite.y===back.y&&invite.h===34&&invite.x+invite.w===app.roomArea.w-12,'invite geometry follows table right');
     check(!overlap(left,centre)&&!overlap(centre,right)&&!overlap(left,right),'title, capsule and members never overlap');check(radius===16&&fill==='rgba(255,250,243,.92)'&&border==='#b88f84'&&lineWidth===1.5,'approved capsule styling');check(Math.abs(centre.x+centre.w/2-app.roomArea.w/2)<.1,'capsule centred on the table area');
     check(meter.w===180&&meter.h===8,'full 180 by 8 meter');check(records.text.some(([t,,,size,color,weight])=>t==='38%'&&size===13&&color==='#6f8a4f'&&weight===900),'progress percentage rounds and uses green');
     check(avatars.length===members&&avatars.every(([,r])=>r.w===26&&r.h===26),'one unframed 26px avatar per actual member');check(avatars.slice(1).every(([,r],i)=>Math.abs(r.x-avatars[i][1].x-19)<.01),'avatars overlap by exactly 7');check(invite.x-(avatars.at(-1)[1].x+26)===8,'8px gap before invite');
     const forbidden=[left,app.roomMembersArea];check(records.surfaces.every(([r])=>forbidden.every(box=>!(r.x===box.x&&r.y===box.y&&r.w===box.w&&r.h===box.h)))&&!records.frames.length,'no background frames behind title or avatars');
     const topHits=stage.hits.filter(({r})=>r.y>=back.y&&r.y<back.y+70&&r.x<app.roomArea.w&&r.h!==58);for(let i=0;i<topHits.length;i++)for(let j=i+1;j<topHits.length;j++)check(!overlap(topHits[i].r,topHits[j].r),'top action targets never overlap');
     check(!overlap(app.roomToolsArea,left)&&!overlap(app.roomToolsArea,centre)&&!overlap(app.roomToolsArea,right),'tools clear header');
     check(records.text.some(([t])=>t==='整理')===(open&&members===1),'organize only in solo expanded column');check(records.text.some(([t])=>t==='横竖屏')===open,'supported rotation only in expanded column');
     if(open){check(records.text.some(([t,,,size,color])=>t==='免费'&&size===8.5&&color==='#7a4d10'),'approved free badge');check(app.roomArea.w===width-72&&app.roomToolsArea.w===72&&app.roomToolsArea.y===0&&app.roomToolsArea.h===height,'full-height 72px column');const items=records.hits.filter(([r])=>r.h===58);check(items.length===(members===1?6:5)&&items.every(([r])=>r.x===width-66&&r.w===60&&r.y>=0&&r.y+r.h<=height),'58px items with 6px horizontal inset');check(items.slice(1).every(([r],i)=>r.y>=items[i][0].y+58),'tool items never overlap');if(h===390)check(items.slice(1).every(([r],i)=>r.y-items[i][0].y===62),'design gap is 4px');}else{check(app.roomArea.w===width,'collapsed board uses freed width');if(members<=4)rightWidths.push({members,width:right.w});}
     checks.push({width:w,height:h,members,open,left,centre,right,boardWidth:app.roomArea.w});
    }
   }
   check(rightWidths[0].width<rightWidths[1].width,'member entry grows from one to four members');
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
  const memberHit=stage.hits.find(hit=>hit.r.x===app.roomMembersArea.x&&hit.r.w===app.roomMembersArea.w);memberHit.fn();check(modal==='chat','avatars open existing chat entry');records.landscapeButtons.find(([,label])=>label==='＋ 邀请')[2]();check(modal==='invite','invite opens invite modal');modal=null;
  app.setLandscapeToolsOpen(true);delete platform.setOrientation;render();check(!records.text.some(([t])=>t==='横竖屏'),'unsupported landscape omits rotation');platform.setOrientation=async value=>{orientation=value;};render();const rotation=records.hits.findLast(([r])=>records.text.some(([text,x,y])=>text==='横竖屏'&&x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<r.y+r.h));rotation[1]();await Promise.resolve();await Promise.resolve();check(orientation==='portrait','landscape rotation uses existing host action');
  width=390;height=844;app.roomViewPending=true;app.toolsOpen=true;render();check(records.text.some(([t])=>t==='横屏')&&records.icons.some(([kind])=>kind==='orientation'),'portrait adds rotate cell');
  const cellHits=records.hits.filter(([r])=>r.h===76);check(cellHits.length===6&&cellHits.every(([r])=>Math.abs(r.w-cellHits[0][0].w)<.01),'six equal portrait tool cells in solo room');
  orientation='';const portraitRotate=cellHits.at(-1);portraitRotate[1]();await Promise.resolve();await Promise.resolve();check(orientation==='landscape','portrait rotate invokes host');app.toolsOpen=true;delete platform.setOrientation;render();check(!records.text.some(([t])=>t==='横屏')&&records.hits.filter(([r])=>r.h===76).length===5,'unsupported portrait retains five equal cells');
  platform.config.id='web';width=844;height=390;app.landscapeToolsOpen=true;render();check(!records.surfaces.length&&app.roomArea.w===width-62&&records.text.some(([t])=>t==='更多')&&!board.phoneLandscapeRoom,'Web landscape retains its existing header and column layout');platform.config.id='taptap';
  // Exercise pressed/active paint and inspect real Canvas operations, including lease styles.
  width=844;height=390;setMembers(4);app.room.snapshot.title='云海鲸歌';app.room.snapshot.visibility='public';app.setLandscapeToolsOpen(true);render();
  const edge=records.hits.find(([r])=>r.h===58)[0],edgePoint={id:1,x:edge.x+edge.w/2,y:edge.y+edge.h/2};stage.input({type:'down',points:[edgePoint],changed:[edgePoint]});render();check(records.surfaces.some(([r,radius,fill])=>r.x===edge.x&&r.y===edge.y&&radius===8&&fill==='#f4dde0'),'pressed tool uses rose-light rounded fill');stage.input({type:'cancel',points:[],changed:[edgePoint]});board.edgeOnly=true;render();check(records.surfaces.some(([r,,fill])=>r.y===edge.y&&fill==='#f4dde0'),'active edge filter uses rose-light fill');board.edgeOnly=false;
  const ctx=stage.ctx,arc=ctx.arc.bind(ctx),clip=ctx.clip.bind(ctx);let avatarArcs=0,avatarClips=0;ctx.arc=(...args)=>{avatarArcs++;return arc(...args);};ctx.clip=(...args)=>{avatarClips++;return clip(...args);};app.drawRoomTopBar({x:0,y:app.roomHeaderTop(),w:app.roomArea.w,h:52},'landscape');ctx.arc=arc;ctx.clip=clip;check(avatarArcs===0&&avatarClips===0,'landscape avatars have no circle mask or extra border');
  const message={id:1,name:'阿禾',text:'这块我来拼',playerId:'p1',code:'friend1'};app.messages=[message];app.bubbleSeen=0;render();
  let bubble=records.surfaces.find(([,radius,fill])=>fill==='rgba(255,250,243,.95)');check(bubble&&bubble[0].x===12&&bubble[0].y+bubble[0].h===height-12&&bubble[1]===14&&bubble[3]==='#b88f84'&&bubble[4]===1.5,'chat bubble has approved bottom-left geometry and styling');
  check(records.text.some(([t,,,size,color,weight])=>t==='阿禾'&&size===12&&color==='#6f8a4f'&&weight===700),'speaker is bold in their member colour');const gift=records.icons.find(([kind])=>kind==='gift')[1];check(gift.y+gift.h<bubble[0].y,'gift remains visible above chat');
  const fill=ctx.fill.bind(ctx),stroke=ctx.stroke.bind(ctx),fillText=ctx.fillText.bind(ctx),curves=ctx.quadraticCurveTo.bind(ctx),radial=ctx.createRadialGradient.bind(ctx);let paints=[],strokes=[],labels=[],corners=0,gradient=[];
  ctx.fill=(...args)=>{paints.push({color:ctx.fillStyle,alpha:ctx.globalAlpha});return fill(...args);};ctx.stroke=(...args)=>{strokes.push({color:ctx.strokeStyle,width:ctx.lineWidth*ctx.getTransform().a});return stroke(...args);};ctx.fillText=(...args)=>{labels.push({text:args[0],color:ctx.fillStyle});return fillText(...args);};ctx.quadraticCurveTo=(...args)=>{corners++;return curves(...args);};
  const now=Date.now;try{const start=now();Date.now=()=>start;app.chatBubble={message,until:start+500};render();check(paints.some(p=>p.color==='rgba(255, 250, 243, 0.95)'&&p.alpha===.5),'chat opacity fades in its last second');Date.now=()=>start+501;render();check(!records.surfaces.some(([,radius,fill])=>fill==='rgba(255,250,243,.95)'),'chat expires without an extra bubble');}finally{Date.now=now;}
  const held=board.state.groups.find(group=>!group.locked),heldPiece=board.pieces[held.pieces[0]],b=board.board;held.dx=32-heldPiece.col*b.width/board.state.cols;held.dy=150-heldPiece.row*b.height/board.state.rows;board.syncRemote(structuredClone(board.state),{[held.id]:{name:'阿禾',color:'#6f8a4f'}},new Set(),false);render();paints=[];strokes=[];labels=[];corners=0;board.draw(stage.ctx);
  check(strokes.some(s=>s.color==='#6f8a4f'&&Math.abs(s.width-2.5)<.01),'held piece outline is 2.5 screen pixels in owner colour');check(labels.some(l=>l.text==='阿禾'&&l.color==='#ffffff')&&paints.some(p=>p.color==='#6f8a4f')&&corners>=4,'held-piece name tag is white on rounded owner colour');check(strokes.some(s=>s.color==='#ffffff'&&Math.abs(s.width-1)<.01),'held piece includes arrow cursor');
  ctx.createRadialGradient=(...args)=>{gradient.push(args);const value=radial(...args),stop=value.addColorStop.bind(value);value.addColorStop=(...args)=>{gradient.push(args);return stop(...args);};return value;};board.paintPaper(ctx);check(gradient[0][0]===app.roomArea.w*.5&&gradient[0][1]===height*.45&&gradient[1][1]==='#fbf3e8'&&gradient[2][1]==='#f3e5d4','phone landscape tabletop gradient has exact centre and colours');
  ctx.fill=fill;ctx.stroke=stroke;ctx.fillText=fillText;ctx.quadraticCurveTo=curves;ctx.createRadialGradient=radial;board.syncRemote(structuredClone(board.state),{},new Set(),false);app.messages=[];app.chatBubble=null;
  platform.setOrientation=async()=>{};
  window.task17={app,board,stage,records,platform,render,setMembers,setSize(w,h){width=w;height=h;}};
  return {landscapeCases:checks.length,checks,persistence:true,backgroundTap:true,dragAndPinchPreserved:true,portraitRotation:true,chatFade:true,remoteHeldPiece:true,avatarFrames:true,pressedTools:true};
 });
 const task17Directory=resolve('work/task17-review');mkdirSync(task17Directory,{recursive:true});
 for(const [name,members,open] of [['landscape-1p-collapsed',1,false],['landscape-1p-expanded',1,true],['landscape-4p-collapsed',4,false],['landscape-4p-expanded',4,true]]){
  const width=844,height=390;await page.setViewportSize({width,height});
  await page.evaluate(async({width,height,members,open})=>{
   const {app,board,setSize,setMembers,render}=window.task17;setSize(width,height);setMembers(members);app.room.snapshot.visibility=members===1?'solo':'public';app.setLandscapeToolsOpen(open);app.toolsOpen=false;app.roomViewPending=true;render();
   const b=board.board,z=.78;board.camera={x:(app.roomArea.w-b.width*z)/2-b.x*z,y:14-b.y*z,z};
   const message={id:10,name:members===1?'小鹿':'阿禾',text:'这块我来拼，一起加油！',playerId:members===1?'p0':'p1',code:members===1?'self':'friend1'};app.messages=[message];app.bubbleSeen=9;
   const remote=board.state.groups.find(group=>!group.locked),piece=board.pieces[remote.pieces[0]],pw=b.width/board.state.cols,ph=b.height/board.state.rows;remote.dx=230-piece.col*pw;remote.dy=320-piece.row*ph;
   board.syncRemote(structuredClone(board.state),members===4?{[remote.id]:{name:'阿禾',color:'#6f8a4f'}}:{},new Set(),false);board.setCursors([]);
   await new Promise(resolve=>setTimeout(resolve,200));render();
  },{width,height,members,open});
  await page.screenshot({path:resolve(task17Directory,name+'.png')});
 }
 writeFileSync(resolve(task17Directory,'checks.json'),JSON.stringify(landscapeResult,null,2));
 console.log(JSON.stringify({...result,task17:{...landscapeResult,checks:undefined}}));
}finally{await browser.close();}
