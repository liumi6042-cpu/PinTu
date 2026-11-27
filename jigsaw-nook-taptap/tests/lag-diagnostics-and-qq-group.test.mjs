import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {LagMonitor,PLAYER_QQ_GROUP} from '../mobile/lag-monitor.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({
 absWorkingDir:root,
 stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'node',target:'es2020'
});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=lag-diag-qq-test-bundle.mjs').toString('base64'));

test('LagMonitor ignores warmup/background resume and detects render stalls, slow network, and disconnect with cooldown',()=>{
 let now=1_000_000;
 const m=new LagMonitor();
 m.resetRoom(now);
 m.markRoomReady(now);

 // During 2.5s warmup, even slow frames never fire an alert.
 now+=1000;
 assert.equal(m.recordFrame({now,gapMs:500,drawMs:180,painted:true,active:true,context:'300片/拖动'}),false);
 assert.equal(m.snapshot(now).activeAlert,null);

 // Healthy 60fps frames after warmup never alert and report ~60fps.
 now+=2000;
 for(let i=0;i<10;i++){
  now+=16;
  assert.equal(m.recordFrame({now,gapMs:16,drawMs:4,painted:true,active:true}),false);
 }
 const healthy=m.snapshot(now);
 assert.equal(healthy.activeAlert,null);
 assert.ok(healthy.fps>=55&&healthy.fps<=65,'healthy fps: '+healthy.fps);

 // 3 consecutive slow painted frames trigger render lag alert.
 now+=130;m.recordFrame({now,gapMs:130,drawMs:85,painted:true,active:true,context:'500片/拖动'});
 now+=130;m.recordFrame({now,gapMs:130,drawMs:90,painted:true,active:true,context:'500片/拖动'});
 now+=130;
 assert.equal(m.recordFrame({now,gapMs:130,drawMs:95,painted:true,active:true,context:'500片/拖动'}),true);
 const alerted=m.snapshot(now);
 assert.ok(alerted.activeAlert);
 assert.equal(alerted.activeAlert.kind,'render');
 assert.match(alerted.activeAlert.title,/检测到画面卡顿/);
 assert.equal(alerted.events.length,1);

 // Cooldown (3 min) prevents alert spam while still recording events into ring buffer after 5s throttle.
 now+=6000;
 assert.equal(m.recordNetwork({now,action:'drop',ms:4200,status:200,active:true,context:'500片'}),false);
 assert.equal(m.snapshot(now).events.length,2,'network lag event is still recorded during alert cooldown');
 assert.equal(m.snapshot(now).events.at(-1).kind,'network');

 // After 15s, banner expires cleanly via pruneAlert.
 now+=10000;
 assert.equal(m.pruneAlert(now),true);
 assert.equal(m.snapshot(now).activeAlert,null);

 // After cooldown (>3 min), a 5s continuous disconnect triggers reconnect alert.
 now+=180000;
 assert.equal(m.recordConnection({now,connected:false,active:true}),false);
 now+=5100;
 assert.equal(m.recordConnection({now,connected:false,active:true}),true);
 assert.equal(m.snapshot(now).activeAlert?.kind,'reconnect');

 // Returning from background resets warmup so resume spike is ignored.
 m.markHidden(now);
 now+=60000;
 m.markShown(now);
 now+=500;
 assert.equal(m.recordFrame({now,gapMs:600,drawMs:200,painted:true,active:true}),false);

 // Muting for room suppresses further alerts until resetRoom.
 m.muteForRoom();
 now+=200000;
 assert.equal(m.recordFrame({now,gapMs:600,drawMs:200,painted:true,active:true}),false);
 assert.equal(m.snapshot(now).activeAlert,null);
});

function uiFixture(platformId='taptap'){
 const texts=[],buttons=[],hits=[],copied=[],notes=[],alerts=[],storage=new Map();
 const ctx=new Proxy({measureText:v=>({width:String(v).length*6})},{get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>(t[k]=v,true)});
 const platform={
  config:{id:platformId,apiBase:'https://jigsawnook.online/h5-mobile-v3',gameName:'拼图小窝',development:false},
  canvas:{width:780,height:1688,style:{},getContext:()=>ctx},
  createImage:()=>({naturalWidth:1,naturalHeight:1}),
  viewport:()=>({width:390,height:844,top:20,bottom:12,dpr:2}),
  storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},
  randomId:()=>'a'.repeat(32),
  copyText:async text=>{copied.push(text);return true;},
  alert:msg=>alerts.push(msg),
  onHide:()=>()=>{},onShow:()=>()=>{},
 };
 const stage=new Stage(platform,v=>v);
 stage.text=v=>{texts.push(String(v));};
 stage.hit=(r,fn)=>{hits.push({r,fn});};
 stage.button=(r,label,fn)=>{buttons.push({r,label:String(label),fn});};
 stage.frame=()=>{};stage.icon=()=>{};stage.panel=()=>{};stage.meter=()=>{};stage.ornaments=()=>{};stage.clip=(_r,fn)=>fn();
 const client={
  cookieIdentity:false,
  config:{capabilities:{energy:true,ads:true,customNames:false}},
  profile:{code:'987654321',name:'拼友',level:5,xp:10,xpToNext:100,energy:40,energyCap:50,supply:{energy:1,create:2},collection:{coins:10,fragments:5},ownedRooms:[]},
  asset:v=>v,
 };
 const app=new GameApp(platform,client,stage);
 Object.assign(app,{
  ready:true,route:'lobby',bodyTop:90,bodyBottom:780,rooms:[],
  room:{
   connected:true,localPlay:false,pendingSoloOps:0,
   state:{cols:12,rows:9},
   snapshot:{id:'1234567890abcdef1234567890abcdef',revision:12,visibility:'public',members:[{id:'p1',name:'我'}],leases:{},puzzle:{cols:12,rows:9}},
  },
  board:{
   remoteCursorCount:0,gestureCacheEnabled:true,edgeOnly:false,showPreview:false,trayOpen:false,input(){return false;},
   performanceDetails:()=>({gesture:'拖动碎片',pieces:108,cache:true,builds:3,allocations:3,bufferBytes:3*1024*1024,pointers:1}),
  },
  roomArea:{x:0,y:80,w:390,h:700},
  imageReady:true,
 });
 app.note=msg=>{notes.push(msg);};
 return {app,texts,buttons,hits,copied,notes,alerts,storage};
}

test('TapTap shows QQ group 397229653 in Lobby, Settings, Room tools, Help, and Lag Feedback modal with 1-tap copy',async()=>{
 const f=uiFixture('taptap');

 // 1. Lobby portrait displays QQ group banner with copy action.
 f.app.drawLobby();
 assert.ok(f.texts.some(t=>t.includes(PLAYER_QQ_GROUP)),'lobby displays QQ group '+PLAYER_QQ_GROUP);
 const lobbyCopy=f.buttons.find(b=>b.label==='复制群号');
 assert.ok(lobbyCopy,'lobby has 复制群号 button');
 lobbyCopy.fn();
 await new Promise(r=>setTimeout(r,0));
 assert.equal(f.copied.at(-1),PLAYER_QQ_GROUP);
 assert.ok(f.notes.at(-1).includes(PLAYER_QQ_GROUP));

 // 2. Settings exposes QQ group copy, open-to-all diagnostic toggle, and log feedback entry.
 f.texts.length=0;f.buttons.length=0;
 f.app.modal='settings';
 f.app.drawModal();
 assert.ok(f.buttons.some(b=>b.label.includes(PLAYER_QQ_GROUP)),'settings has QQ group copy button');
 assert.ok(f.buttons.some(b=>b.label==='房间网络诊断浮窗'),'settings exposes diagnostic pill toggle to all players');
 assert.ok(f.buttons.some(b=>b.label==='查看 / 复制卡顿诊断日志'),'settings exposes lag feedback modal');

 // 3. Room tools (更多) exposes lag diagnostics and QQ group copy.
 f.texts.length=0;f.buttons.length=0;
 f.app.modal='tools';
 f.app.drawModal();
 assert.ok(f.buttons.some(b=>b.label.includes('卡顿与网络诊断')));
 assert.ok(f.buttons.some(b=>b.label.includes(PLAYER_QQ_GROUP)));

 // 4. Help page (玩法帮助) mentions QQ group and provides copy button.
 f.texts.length=0;f.buttons.length=0;
 f.app.modal=null;f.app.route='help';
 f.app.drawPolicy();
 assert.ok(f.buttons.some(b=>b.label.includes(PLAYER_QQ_GROUP)),'help page has QQ group copy button');

 // 5. Local lag trigger shows in-room banner -> 1-tap copy log & lagFeedback modal both include lagEvents + QQ group.
 f.app.route='room';
 const realNow=Date.now;
 let now=2_000_000;
 Date.now=()=>now;
 try{
  f.app.lag.resetRoom(now);
  f.app.lag.markRoomReady(now);
  now+=3000;
  f.app.recordFrameSample(480,160,true);
  f.texts.length=0;f.hits.length=0;
  f.app.drawLagAlertBanner();
  assert.ok(f.texts.some(t=>t.includes('检测到画面卡顿')),'room draws lag alert banner');
  assert.ok(f.texts.some(t=>t.includes(PLAYER_QQ_GROUP)),'lag banner reminds player of QQ group');
  assert.ok(f.texts.some(t=>t==='复制日志'),'lag banner has 1-tap copy button');

  // Tap banner body -> opens lagFeedback modal.
  f.hits[0].fn();
  assert.equal(f.app.modal,'lagFeedback');
  f.texts.length=0;f.buttons.length=0;
  f.app.drawModal();
  const copyLogBtn=f.buttons.find(b=>b.label==='一键复制诊断日志');
  assert.ok(copyLogBtn);
  copyLogBtn.fn();
  await new Promise(r=>setTimeout(r,0));
  assert.match(f.copied.at(-1),/lagEvents=.*检测到画面卡顿/);
  assert.match(f.copied.at(-1),/playerCode=987654321/);
  assert.match(f.copied.at(-1),/397229653/);
  assert.ok(f.notes.at(-1).includes(PLAYER_QQ_GROUP));
 }finally{Date.now=realNow;}
});

test('WeChat hides external QQ group copy everywhere while keeping local lag diagnostics working',()=>{
 const f=uiFixture('wechat');
 f.app.drawLobby();
 assert.equal(f.texts.some(t=>t.includes(PLAYER_QQ_GROUP)||t.includes('QQ')),false,'wechat lobby hides QQ group');
 f.texts.length=0;f.buttons.length=0;
 f.app.modal='settings';
 f.app.drawModal();
 assert.equal(f.buttons.some(b=>b.label.includes('QQ')||b.label.includes(PLAYER_QQ_GROUP)),false,'wechat settings hides QQ group');
 assert.ok(f.buttons.some(b=>b.label==='房间网络诊断浮窗'),'wechat still keeps diagnostics toggle');
 f.texts.length=0;f.buttons.length=0;
 f.app.modal='lagFeedback';
 f.app.drawModal();
 assert.equal(f.buttons.some(b=>b.label.includes('QQ')||b.label.includes(PLAYER_QQ_GROUP)),false,'wechat lag modal hides QQ group');
 assert.equal(f.app.roomDiagnosticSnapshot().copyText.includes(PLAYER_QQ_GROUP),false,'wechat copied report omits QQ group');
});
