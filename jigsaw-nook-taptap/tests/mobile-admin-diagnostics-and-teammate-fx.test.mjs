import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({
 stdin:{
  contents:`
   export {GameApp} from "./mobile/app";
   export {PuzzleBoard} from "./mobile/puzzle-board";
   export {RoomClient} from "./lib/room-client";
   export {TEAMMATE_SOUND_KEY,ADMIN_DIAG_KEY} from "./mobile/panels/shared";
  `,
  resolveDir:process.cwd(),
  loader:'ts',
 },
 bundle:true,write:false,platform:'node',format:'esm',
});
const {GameApp,PuzzleBoard,RoomClient,TEAMMATE_SOUND_KEY,ADMIN_DIAG_KEY}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

function makeBoard(played){
 const p={
  config:{id:'web'},
  createCanvas:()=>({width:1,height:1,getContext:()=>({})}),
  onHide:()=>()=>{},
  onShow:()=>()=>{},
  frame:()=>1,
  cancelFrame(){},
  playSound:url=>played.push(url),
 };
 const state={
  version:1,layout:'square',imageId:'test',cols:2,rows:2,seed:1,elapsed:0,
  groups:[
   {id:0,pieces:[0],dx:100,dy:100,locked:false},
   {id:1,pieces:[1],dx:100,dy:100,locked:false},
   {id:2,pieces:[2],dx:300,dy:300,locked:false},
   {id:3,pieces:[3],dx:400,dy:400,locked:false},
  ],
 };
 const board=new PuzzleBoard(p,state,()=>{});
 board.soundUrl='snap.wav';
 return {board,state};
}

test('PuzzleBoard respects teammateSoundEnabled gate and renders teammate-colored sparkles without arc or XP',()=>{
 const played=[];
 const {board,state}=makeBoard(played);

 // Teammate sound is silent when disabled; local sound still plays.
 board.teammateSoundEnabled=false;
 board.playConnectionSound('teammate');
 assert.equal(played.length,0,'teammate snap sound must be muted when toggle is off');
 board.playConnectionSound('local');
 assert.deepEqual(played,['snap.wav'],'local snap sound still plays');

 // Turning toggle on restores teammate snap sound.
 board.teammateSoundEnabled=true;
 board.playConnectionSound('teammate');
 assert.equal(played.length,2);

 // Simulate teammate holding piece 0 (pink color) then snapping pieces 0+1 together.
 const held=structuredClone(state);
 board.syncRemote(held,{0:{playerId:'p2',name:'队友',color:'#ff66aa'}},new Set(),false);
 const merged=structuredClone(state);
 merged.groups=[
  {id:0,pieces:[0,1],dx:100,dy:100,locked:false},
  {id:2,pieces:[2],dx:300,dy:300,locked:false},
  {id:3,pieces:[3],dx:400,dy:400,locked:false},
 ];
 board.syncRemote(merged,{},new Set(),true);
 assert.equal(board.flashes.length,1);
 assert.equal(board.flashes[0].local,false);
 assert.equal(board.flashes[0].color,'#ff66aa');

 const ops=[],fillStyles=[];
 const ctx=new Proxy({},{
  get:(_t,key)=>(...args)=>ops.push({op:key,args}),
  set:(_t,key,val)=>{if(key==='fillStyle')fillStyles.push(val);return true;},
 });
 board.drawSnapFeedback(ctx,Date.now()+40);
 assert.ok(ops.some(o=>o.op==='stroke'),'teammate outline is painted');
 assert.equal(ops.filter(o=>o.op==='fill').length,4,'teammate snap draws 4 gentle diamond sparkles');
 assert.ok(fillStyles.includes('#ff66aa'),'teammate sparkles use the teammate color');
 assert.equal(ops.some(o=>o.op==='arc'),false,'teammate snap keeps expanding ring exclusive to local snaps');
 assert.equal(ops.some(o=>o.op==='fillText'),false,'teammate snap never paints +XP');
});

function appFixture({development=false,admin=false,storageInit={}}={}){
 const memory=new Map(Object.entries(storageInit));
 const texts=[],hits=[],buttons=[],copied=[],notes=[],alerts=[];
 const app=Object.create(GameApp.prototype);
 Object.defineProperty(app,'layout',{value:'phonePortrait',configurable:true});
 Object.defineProperty(app,'colors',{value:{ink:'#3b2820',muted:'#7a6458',cream:'#fff8ee',onAccent:'#fff9f0',berry:'#a94763',line:'#e5d5c3',placeholder:'#e8dfd4',overlay:'rgba(0,0,0,.4)'},configurable:true});
 Object.assign(app,{
  route:'room',
  modal:null,
  modalScroll:0,
  busy:false,
  roomArea:{x:0,y:80,w:390,h:700},
  teammateSoundEnabled:memory.get(TEAMMATE_SOUND_KEY)==='1',
  adminDiagEnabled:memory.get(ADMIN_DIAG_KEY)==='1',
  adminDiagExpanded:false,
  roomTimings:new Map([['drop',{action:'drop',ms:42,status:200,at:Date.now()}]]),
  nineTimings:new Map(),
  social:{title:'好友',unread:0},
  audioSettings:{hasMusic:false,levels:{music:0,effects:1}},
  platform:{
   config:{id:'taptap',apiBase:'https://jigsawnook.online/h5-mobile-v3',development,buildVersion:'v53.25'},
   storage:{get:k=>memory.get(k)??null,set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)},
   viewport:()=>({width:390,height:844,top:0,bottom:0}),
   copyText:async text=>{copied.push(text);return true;},
   alert:msg=>alerts.push(msg),
   onlineBattleDiagnostics:()=>({managerAvailable:true}),
  },
  client:{
   profile:{code:'123456789',name:'测试员',level:12,xp:10,xpToNext:120,taptap:{bound:true,diagnostics:admin}},
   config:{capabilities:{customNames:false},identityMode:'taptap'},
  },
  room:{
   connected:true,
   localPlay:false,
   pendingSoloOps:0,
   snapshot:{id:'abcdef1234567890abcdef1234567890',revision:18,members:[{id:'m1',name:'我'},{id:'m2',name:'队友'}],leases:{3:{playerId:'m2'}}},
  },
  realtime:{
   connected:true,
   diagnostics:()=>({connected:true,connections:1,reconnects:0,roomMessages:12,pendingActions:0,lastError:'',preview:'taptap-test',previewConnected:true,previewMembersReady:2,previewMembersTotal:2,platformSendRate:6,platformSendPeak:10,platformSucceeded:40,platformFailed:0,platformReceived:35,previewDetail:'ok'}),
  },
  board:{
   teammateSoundEnabled:false,
   remoteCursorCount:1,
   performanceDetails:()=>({gesture:'idle',pieces:108,cache:true,builds:2,allocations:2,bufferBytes:4*1024*1024,pointers:0}),
  },
  stage:{
   w:390,h:844,theme:'light',
   ctx:{fillStyle:'',fillRect(){},save(){},restore(){},beginPath(){},fill(){},stroke(){}},
   measure:text=>String(text).length*6,
   text(value){texts.push(String(value));},
   hit(rect,action){hits.push({rect,action});},
   icon(){},button(){},frame(){},panel(){},clip(_r,fn){fn();},
   imageDiagnostics:()=>({entries:8,decodedBytes:12*1024*1024,loading:0,queued:0,pinned:1,maxBytes:100,maxEntries:50,maxLoading:4}),
  },
  roomHeaderTop:()=>0,
  drawLandscapeSurface(){},
  invalidate(){},
  note:msg=>notes.push(msg),
  button(_x,_y,_w,label,action){buttons.push({label,action});},
  paragraph(_text,_x,y){return y+14;},
  rowOptions(){},
  drawAudioLevel(_k,_l,_x,y){return y+60;},
  openWeb(){},navigate(){},showModal(){},
 });
 return {app,memory,texts,hits,buttons,copied,notes,alerts};
}

test('teammate sound toggle defaults OFF and persists + updates live board when toggled in Settings',()=>{
 const {app,memory,buttons}=appFixture({admin:false});
 assert.equal(app.teammateSoundEnabled,false,'defaults to off for cozy non-competitive play');
 app.modal='settings';
 app.drawModal();
 const toggle=buttons.find(b=>b.label==='队友拼合音效');
 assert.ok(toggle,'Settings exposes 队友拼合音效 toggle');
 toggle.action();
 assert.equal(app.teammateSoundEnabled,true);
 assert.equal(app.board.teammateSoundEnabled,true);
 assert.equal(memory.get(TEAMMATE_SOUND_KEY),'1');
 // Non-admin must NOT see admin room diagnostic toggle.
 assert.equal(buttons.some(b=>b.label.includes('房间网络诊断浮窗')),false);
});

test('admin room network diagnostics pill is hidden for normal players and works end-to-end for whitelisted admins',async()=>{
 // Normal player cannot see diagnostics even if storage flag is set.
 const normal=appFixture({admin:false,development:false,storageInit:{[ADMIN_DIAG_KEY]:'1'}});
 assert.equal(normal.app.adminDiagnosticsAllowed,false);
 assert.equal(normal.texts.length,0);

 // Whitelisted admin on production build (development: false) can enable, expand, copy, and collapse.
 const {app,memory,texts,hits,buttons,copied,notes}=appFixture({admin:true,development:false});
 assert.equal(app.adminDiagnosticsAllowed,true);
 app.modal='settings';
 app.drawModal();
 const diagToggle=buttons.find(b=>b.label==='房间网络诊断浮窗');
 assert.ok(diagToggle,'whitelisted admin sees 房间网络诊断浮窗 toggle in Settings');
 diagToggle.action();
 assert.equal(app.adminDiagEnabled,true);
 assert.equal(memory.get(ADMIN_DIAG_KEY),'1');

 // Collapsed pill renders key status at a glance.
 texts.length=0;hits.length=0;
 app.drawAdminDiagnostics();
 assert.ok(texts.some(t=>t.includes('WS✓')&&t.includes('平台✓')&&t.includes('42ms')&&t.includes('rev18')&&t.includes('2人')),'pill summarizes live connection, RTT, revision and seats: '+JSON.stringify(texts));

 // Clicking pill expands details card with copy & collapse actions.
 hits[0].action();
 assert.equal(app.adminDiagExpanded,true);
 texts.length=0;hits.length=0;
 app.drawAdminDiagnostics();
 assert.ok(texts.some(t=>t.includes('abcdef12')&&t.includes('租约1')&&t.includes('光标1')));
 assert.ok(texts.some(t=>t.includes('图片缓存：8张/12.0MB')));
 assert.ok(texts.some(t=>t.includes('复制诊断')));

 // Clicking copy button copies full report and notifies admin.
 const copyHit=hits[2];
 copyHit.action();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(copied.length,1);
 assert.match(copied[0],/roomId=abcdef1234567890abcdef1234567890/);
 assert.match(copied[0],/previewDetail=ok/);
 assert.deepEqual(notes,['已复制房间诊断信息']);

 // Clicking collapse button folds card back to pill.
 hits[3].action();
 assert.equal(app.adminDiagExpanded,false);
});

test('RoomClient emits room:request-timing in normal rooms only when traceTimings() is enabled',async()=>{
 const makeTicket=()=>({
  token:'t'.repeat(32),playerId:'p1',
  room:{id:'a'.repeat(32),title:'t',revision:1,serverTime:1000,completedAt:null,startedAt:1000,members:[{id:'p1',name:'我',color:'#f00',lastSeen:1000}],leases:{},puzzle:{version:1,layout:'square',imageId:'x',cols:2,rows:2,seed:1,elapsed:0,groups:[{id:0,pieces:[0],dx:10,dy:10,locked:false}]}},
 });
 const runOnce=async traceEnabled=>{
  const emitted=[];
  const client=new RoomClient(makeTicket(),{
   traceTimings:()=>traceEnabled,
   fetch:async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({...makeTicket().room,revision:2})}),
   emit:(name,detail)=>emitted.push({name,detail}),
   randomId:()=>'b'.repeat(32),
   hidden:()=>false,
   now:()=>1000,
   performanceNow:()=>1050,
  });
  await client.request();
  return emitted.filter(e=>e.name==='room:request-timing');
 };
 assert.equal((await runOnce(false)).length,0,'normal players emit zero room timing events');
 const traced=await runOnce(true);
 assert.equal(traced.length,1,'enabled admin diagnostics emit request timing');
 assert.equal(traced[0].detail.action,'poll');
 assert.equal(traced[0].detail.status,200);
});
