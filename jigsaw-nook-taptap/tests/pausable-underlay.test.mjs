import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createMobileService} from '../server/mobile-service.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({
 absWorkingDir:root,
 stdin:{contents:'export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'node',target:'es2020'
});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=pausable-underlay-test-bundle.mjs').toString('base64'));

const rid=()=>randomBytes(16).toString('hex');

test('server underlay accumulates 30s across pause/resume, resists clock inflation, and requires ad once depleted',()=>{
 let now=1800000000000;
 const service=createMobileService({shareRewards:false,adEnabled:true,now:()=>now,randomInt:min=>min});
 const owner='a'.repeat(64);
 const call=(url,body,token)=>service.handle({identity:owner,method:body===undefined?'GET':'POST',url,body,authorization:token?'Bearer '+token:undefined});
 try{
  const ticket=call('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()}).data;
  const aidPath='/api/rooms/'+ticket.room.id+'/assistance';

  // 1st newcomer free use grants a 30s pausable bank starting active.
  const start=call(aidPath,{kind:'underlay',requestId:rid(),toolAd:true},ticket.token);
  assert.equal(start.status,200);
  assert.equal(start.data.freeRemaining.underlay,1);
  const g0=start.data.grants.find(g=>g.kind==='underlay');
  assert.equal(g0.pausable,true);assert.equal(g0.active,true);assert.equal(g0.remainingMs,30000);assert.equal(g0.expiresAt,now+30000);

  // Use 7s, then pause (even if client tries to claim 29s remaining, server clamps to 23s).
  now+=7000;
  const paused1=call(aidPath,{kind:'underlay',action:'pause',remainingMs:29000},ticket.token);
  assert.equal(paused1.status,200);
  const gp1=paused1.data.grants.find(g=>g.kind==='underlay');
  assert.equal(gp1.pausable,true);assert.equal(gp1.active,false);assert.equal(gp1.remainingMs,23000);assert.equal(gp1.expiresAt,0);

  // Wait 10 minutes while paused: remaining time stays frozen at 23s for v53.36+ (?lasting=1),
  // while legacy GET (without ?lasting=1) omits paused grants safely.
  now+=600000;
  const reloaded=call(aidPath+'?lasting=1',undefined,ticket.token);
  assert.equal(reloaded.status,200);
  const gr=reloaded.data.grants.find(g=>g.kind==='underlay');
  assert.equal(gr.active,false);assert.equal(gr.remainingMs,23000);
  const legacy=call(aidPath,undefined,ticket.token);
  assert.equal(legacy.data.grants.some(g=>g.kind==='underlay'),false,'legacy clients never see paused underlay');

  // Resume without spending free uses or ads.
  const resumed1=call(aidPath,{kind:'underlay',action:'resume'},ticket.token);
  assert.equal(resumed1.status,200);
  assert.equal(resumed1.data.freeRemaining.underlay,1,'resuming does not consume a free use');
  const gres1=resumed1.data.grants.find(g=>g.kind==='underlay');
  assert.equal(gres1.active,true);assert.equal(gres1.remainingMs,23000);assert.equal(gres1.expiresAt,now+23000);

  // Use 8s more (15s total used, 15s left), pause again.
  now+=8000;
  const paused2=call(aidPath,{kind:'underlay',action:'pause'},ticket.token);
  assert.equal(paused2.data.grants.find(g=>g.kind==='underlay').remainingMs,15000);

  // While paused, a plain activation without rewardToken resumes the existing bank for free instead of charging another use.
  now+=120000;
  const resumedViaPost=call(aidPath,{kind:'underlay',requestId:rid(),toolAd:true},ticket.token);
  assert.equal(resumedViaPost.status,200);
  assert.equal(resumedViaPost.data.freeRemaining.underlay,1,'plain POST while paused resumes without burning a free use');
  assert.equal(resumedViaPost.data.grants.find(g=>g.kind==='underlay').remainingMs,15000);

  // Let the final 15s run out: bank is exhausted after exactly 30s cumulative visible time.
  now+=15001;
  assert.equal(call(aidPath+'?lasting=1',undefined,ticket.token).data.grants.some(g=>g.kind==='underlay'),false);
  const resumeExpired=call(aidPath,{kind:'underlay',action:'resume'},ticket.token);
  assert.equal(resumeExpired.status,409);assert.equal(resumeExpired.data.code,'TOOL_EXPIRED');

  // 2nd newcomer free use also gets 30s; leaving the room auto-pauses it on the server.
  const second=call(aidPath,{kind:'underlay',requestId:rid(),toolAd:true},ticket.token);
  assert.equal(second.status,200);assert.equal(second.data.freeRemaining.underlay,0);
  now+=6000;
  const left=call('/api/rooms/'+ticket.room.id,{type:'leave',requestId:rid()},ticket.token);
  assert.equal(left.status,200);
  now+=300000;
  const afterReturn=call(aidPath+'?lasting=1',undefined,ticket.token);
  const gAfter=afterReturn.data.grants.find(g=>g.kind==='underlay');
  assert.ok(gAfter,'leaving room auto-paused active underlay');
  assert.equal(gAfter.active,false);assert.equal(gAfter.remainingMs,24000);

  // Resume and exhaust the 2nd bank -> 3rd activation requires rewarded ad -> grants fresh 30s pausable bank.
  assert.equal(call(aidPath,{kind:'underlay',action:'resume'},ticket.token).status,200);
  now+=24001;
  const gate=call(aidPath,{kind:'underlay',requestId:rid(),toolAd:true},ticket.token);
  assert.equal(gate.status,402);assert.equal(gate.data.code,'AD_REQUIRED');

  const adRid=rid();
  const ch=call('/api/rewarded/challenge',{kind:'underlay',requestId:adRid,context:'room/'+ticket.room.id},ticket.token);
  assert.equal(ch.status,200);
  const third=call(aidPath,{kind:'underlay',requestId:adRid,context:'room/'+ticket.room.id,rewardToken:ch.data.rewardToken,completed:true,toolAd:true},ticket.token);
  assert.equal(third.status,200);
  const g3=third.data.grants.find(g=>g.kind==='underlay');
  assert.equal(g3.pausable,true);assert.equal(g3.active,true);assert.equal(g3.remainingMs,30000);
 }finally{service.close();}
});

test('client toggles pausable underlay on/off with live badges, auto-pauses on hide/leave, and notifies on expiry',async t=>{
 let now=1800000000000;
 const realNow=Date.now;
 Date.now=()=>now;
 t.after(()=>{Date.now=realNow;});

 const service=createMobileService({shareRewards:false,adEnabled:true,now:()=>now,randomInt:min=>min});
 t.after(()=>service.close());
 const owner='b'.repeat(64);
 const ticket=service.handle({identity:owner,method:'POST',url:'/api/rooms',body:{mode:'random',pieces:48,visibility:'public',requestId:rid()}}).data;

 const notes=[],texts=[],storage=new Map();
 let onHideCb=null;
 const ctx=new Proxy({measureText:v=>({width:String(v).length*6})},{get:(target,k)=>target[k]??(()=>{}),set:(target,k,v)=>(target[k]=v,true)});
 const platform={
  config:{id:'taptap',apiBase:'https://test.invalid',gameName:'拼图小窝'},
  canvas:{style:{},getContext:()=>ctx},
  createImage:()=>({naturalWidth:1,naturalHeight:1}),
  viewport:()=>({width:390,height:844,top:20,bottom:12,dpr:1}),
  storage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},
  randomId:rid,
  onHide:fn=>{onHideCb=fn;return()=>{};},
  onShow:()=>()=>{},
  watchAd:async()=>'completed'
 };
 const stage=new Stage(platform,v=>v);
 stage.text=v=>{texts.push(String(v));};
 stage.frame=()=>{};stage.icon=()=>{};stage.panel=()=>{};
 const apiCalls=[];
 const client={
  config:{adRewardEnabled:true,rewardedAdUnitId:'ad-unit',capabilities:{energy:true,ads:true}},
  profile:{code:'123456789',level:1,energy:50,energyCap:50,supply:{energy:0,create:0},collection:{}},
  asset:v=>v,
  json:async(path,method='GET',body,headers={})=>{
   apiCalls.push({path,method,body});
   const res=service.handle({identity:owner,method,url:path,body,authorization:headers.Authorization});
   if(res.status<200||res.status>=300)throw Object.assign(Error(res.data?.error||'err'),{status:res.status,code:res.data?.code});
   return res.data;
  }
 };

 const app=new GameApp(platform,client,stage);
 const board={underlayUntil:0,edgeOnly:false,locating:false,hintsShowing:false,setUnderlay(u){this.underlayUntil=u;},get underlay(){return this.underlayUntil>Date.now();},setHints(){return false;},locateHints(){},destroy(){}};
 Object.assign(app,{
  route:'room',ready:true,imageReady:true,board,
  room:{ticket,connected:true,snapshot:{...ticket.room,visibility:'public'},leave(){},flushSoloNow(){},setHidden(){}},
  aid:{grants:[],freeRemaining:{hint:2,underlay:2},newcomerProtected:false,serverTime:now}
 });
 const origNote=app.note.bind(app);
 app.note=(msg,perm)=>{notes.push(msg);origNote(msg,perm);};

 // 1. Activate underlay -> starts active with 30s and teaches pause behavior.
 app.roomTool('underlay');
 await new Promise(r=>setTimeout(r,0));
 assert.equal(board.underlay,true);
 assert.equal(app.toolActive('underlay'),true);
 assert.equal(app.aidBadge('underlay'),'30秒');
 assert.ok(notes.at(-1).includes('再点底图可随时暂停'),notes.at(-1));

 // Collapsed portrait tool toggle draws live countdown pill while active.
 texts.length=0;
 app.drawRoomToolToggle({x:320,y:760,w:50,h:50},false,()=>{});
 assert.ok(texts.includes('30秒'),'collapsed portrait toggle displays active underlay countdown');

 // 2. Tap 底图 after 6s -> immediately pauses locally and syncs pause to server.
 now+=6000;
 app.roomTool('underlay');
 assert.equal(board.underlay,false,'board hides underlay immediately on pause');
 assert.equal(app.toolActive('underlay'),false,'button is unhighlighted while paused');
 assert.equal(app.aidBadge('underlay'),'剩24秒');
 assert.ok(notes.at(-1).includes('底图已暂停，还剩 24 秒'),notes.at(-1));
 await app.underlaySync;
 assert.equal(apiCalls.at(-1).body.action,'pause');

 // Draw badge in paused state: shows 剩24秒, NOT 看广告.
 texts.length=0;
 app.drawAidBadge('underlay',120,20);
 assert.deepEqual(texts,['剩24秒']);

 // 3. Wait 5 minutes paused, tap 底图 -> resumes immediately with 24s without ad!
 now+=300000;
 app.roomTool('underlay');
 assert.equal(board.underlay,true);
 assert.equal(app.toolActive('underlay'),true);
 assert.equal(app.aidBadge('underlay'),'24秒');
 assert.ok(notes.at(-1).includes('底图已继续，剩余 24 秒'),notes.at(-1));
 await app.underlaySync;
 assert.equal(apiCalls.at(-1).body.action,'resume');

 // 4. Simulate app backgrounding (pauseActiveUnderlay(true)) after 4s -> silently pauses with 20s left.
 now+=4000;
 app.pauseActiveUnderlay(true);
 assert.equal(board.underlay,false);
 assert.equal(app.aidBadge('underlay'),'剩20秒');
 await app.underlaySync;
 assert.equal(apiCalls.at(-1).body.action,'pause');
 // Verify server really stored 20s paused.
 const srv=service.handle({identity:owner,method:'GET',url:'/api/rooms/'+ticket.room.id+'/assistance?lasting=1',authorization:'Bearer '+ticket.token}).data;
 assert.equal(srv.grants.find(g=>g.kind==='underlay').remainingMs,20000);
 assert.equal(srv.grants.find(g=>g.kind==='underlay').active,false);

 // 5. Resume and let final 20s expire -> tickVisibleTime prunes grant and notifies user.
 app.roomTool('underlay');
 await app.underlaySync;
 now+=20001;
 app.tickVisibleTime();
 assert.equal(board.underlay,false);
 assert.equal(app.activeAid('underlay'),undefined);
 assert.equal(app.pausedUnderlay(),undefined);
 assert.equal(app.aidBadge('underlay'),'');
 assert.ok(notes.at(-1).includes('底图 30 秒已用完'),notes.at(-1));

 // 6. Activate 2nd free use, advance 5s, call leaveRoom() -> auto-pauses with 25s saved on server!
 app.roomTool('underlay');
 await new Promise(r=>setTimeout(r,0));
 assert.equal(board.underlay,true);
 now+=5000;
 app.leaveRoom();
 await app.underlaySync;
 const afterLeave=service.handle({identity:owner,method:'GET',url:'/api/rooms/'+ticket.room.id+'/assistance?lasting=1',authorization:'Bearer '+ticket.token}).data;
 const savedGrant=afterLeave.grants.find(g=>g.kind==='underlay');
 assert.ok(savedGrant,'leaveRoom preserves remaining underlay time on server');
 assert.equal(savedGrant.active,false);
 assert.equal(savedGrant.remainingMs,25000);
});
