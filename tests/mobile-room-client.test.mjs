import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/room-client.ts';
import { createPuzzle,createFittedPuzzle } from '../lib/puzzle-engine.ts';
import {PuzzleBoard,selectHintPieceIds} from '../mobile/puzzle-board.ts';
import {boardThemeColors} from '../mobile/theme.ts';

const until = async condition => { const end = Date.now() + 1500; while (!condition()) { if (Date.now() > end) throw new Error('Room client did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('energy refusal keeps room transport and camera ready, publishes authoritative profile, then accepts a replenished drag', async () => {
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window, previousDocument = globalThis.document;
  const room = {id:'a'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),expiresAt:Date.now()+60000,visibility:'public',startedAt:null,completedAt:null,members:[{id:'b'.repeat(32),name:'玩家',color:'#5b8b70',lastSeen:Date.now(),level:4}],leases:{}};
  const events = [], actionIds = [], windowEvents = new EventTarget();
  let energy = 0;
  globalThis.window = windowEvents; globalThis.document = {hidden:false};
  windowEvents.addEventListener('mobile:profile', event => events.push(['profile',event.detail.energy]));
  windowEvents.addEventListener('mobile:energy-empty', () => events.push(['empty']));
  globalThis.fetch = async (_url, init) => {
    const action = init?.body ? JSON.parse(init.body) : null;
    if (action && action.type !== 'leave') { assert.match(action.requestId,/^[a-f0-9]{32}$/); actionIds.push(action.requestId); }
    if (['claim','drop'].includes(action?.type) && energy === 0) return Response.json({error:'体力不足',code:'ENERGY_EMPTY',profile:{energy:0,level:4}},{status:402});
    if (action?.type === 'claim') { room.leases[action.groupId] = {playerId:'b'.repeat(32),expires:Date.now()+10000}; room.revision++; }
    if (action?.type === 'release') { delete room.leases[action.groupId]; room.revision++; }
    room.serverTime = Date.now();
    return Response.json({...room,profile:{energy,level:4}});
  };
  const client = new RoomClient({token:'room-token',playerId:'b'.repeat(32),room:structuredClone(room)});
  const table = {network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next){client.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
  const detach = client.attach(table);
  try {
    assert.equal(await table.network.acquire(0),false);
    await until(() => events.some(item => item[0] === 'empty'));
    assert.equal(client.connected,true,'insufficient stamina is not a disconnected room');
    assert.equal(table.networkReady,true,'camera and non-drag canvas tools remain usable');
    assert.ok(events.some(item => item[0] === 'profile' && item[1] === 0));
    energy = 50;
    assert.equal(await table.network.acquire(0),true);
    assert.ok(events.some(item => item[0] === 'profile' && item[1] === 50));
    energy = 0;
    client.state.groups.find(group => group.id === 0).dx = 999;
    await table.network.drop(0,999,999);
    assert.equal(client.connected,true,'a rejected drop is also a gameplay refusal, not a transport failure');
    assert.notEqual(client.state.groups.find(group => group.id === 0).dx,999,'rejected optimistic move reconciles to server position');
    energy = 50;
    assert.equal(await table.network.acquire(0),true);
    table.network.release(0);
    await until(() => !room.leases[0]);
    assert.equal(new Set(actionIds).size,actionIds.length,'different actions receive different idempotency IDs');
  } finally {
    detach(); globalThis.fetch=previousFetch; globalThis.window=previousWindow; globalThis.document=previousDocument;
  }
});


test('drop receipt survives an earlier poll and publishes the actual credited XP once', async () => {
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window,previousDocument=globalThis.document;
  const room={id:'c'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),expiresAt:Date.now()+60000,visibility:'public',startedAt:null,completedAt:null,members:[{id:'d'.repeat(32),name:'玩家',color:'#5b8b70',lastSeen:Date.now()}],leases:{}};
  const events=[],windowEvents=new EventTarget();let client;
  globalThis.window=windowEvents;globalThis.document={hidden:false};
  windowEvents.addEventListener('puzzle:successful-drop',event=>events.push(event.detail));
  globalThis.fetch=async(_url,init)=>{
    const action=init?.body?JSON.parse(init.body):null;
    if(action?.type==='claim'){
      room.leases[action.groupId]={playerId:'d'.repeat(32),expires:Date.now()+10000};room.revision++;
      // Poll already got the settled group before the client begins processing its drop.
      room.puzzle.groups.find(g=>g.id===action.groupId).locked=true;
    }
    room.serverTime=Date.now();
    if(action?.type==='drop'){
      delete room.leases[action.groupId];room.revision++;
      return Response.json({...room,mobileContribution:{requestId:action.requestId,groupId:action.groupId,creditedXp:2}});
    }
    return Response.json(room);
  };
  client=new RoomClient({token:'token',playerId:'d'.repeat(32),room:structuredClone(room)});
  const table={network:null,networkReady:true,cancelNetworkDrag(){},syncRemote(next){client.state.groups=structuredClone(next.groups);},playConnectionSound(){}};
  const detach=client.attach(table);
  try{
    assert.equal(await table.network.acquire(0),true);
    await table.network.drop(0,0,0);
    assert.equal(events.length,1);
    assert.equal(events[0].roomId,room.id);assert.equal(events[0].groupId,0);assert.equal(events[0].creditedXp,2);
    assert.match(events[0].requestId,/^[a-f0-9]{32}$/);
    const response=await client.request();
    assert.equal(response.mobileContribution,undefined,'later polls never carry forward a prior receipt');
    assert.equal(events.length,1);
  }finally{detach();globalThis.fetch=previousFetch;globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

test('unrelated contribution receipts cannot be attached to a client action', async () => {
  const previousFetch=globalThis.fetch;
  const room={id:'e'.repeat(32),puzzle:createPuzzle('seaside',12,9,123),revision:0,serverTime:Date.now(),members:[],leases:{}};
  const client=new RoomClient({token:'token',playerId:'f'.repeat(32),room});
  try{
    for(const receipt of [
      {requestId:'b'.repeat(32),groupId:0,creditedXp:1},
      {requestId:'a'.repeat(32),groupId:1,creditedXp:1},
      {requestId:'a'.repeat(32),groupId:0,creditedXp:0},
    ]){
      globalThis.fetch=async()=>Response.json({...room,mobileContribution:receipt});
      assert.equal((await client.request({type:'drop',groupId:0,dx:0,dy:0,seq:1,requestId:'a'.repeat(32)})).mobileContribution,undefined);
    }
  }finally{globalThis.fetch=previousFetch;}
});

// save-03: device progress, live hint overlays and camera framing. These tests
// belong to the existing test:mobile entry, so no package script changes are needed.
const hintGroup=(id,pieces=[id],locked=false)=>({id,pieces,locked,dx:0,dy:0});
function hintState(){return {cols:4,rows:3,groups:[hintGroup(0,[0],true),hintGroup(7,[1,2]),hintGroup(3),hintGroup(4),hintGroup(5)]};}

test('hint selection drops locally placed, unknown and duplicate IDs without mutating inputs',()=>{
 const state=hintState(),ids=[0,1,1,-1,99,1.5,NaN,4],owners={},before=structuredClone({state,ids,owners});
 assert.deepEqual(selectHintPieceIds(state,ids,owners,{topUp:false}),[1,4]);
 assert.deepEqual({state,ids,owners},before);
});

test('new hints retain grant count and top up with unowned singles before joined groups',()=>{
 const state=hintState();
 assert.deepEqual(selectHintPieceIds(state,[0]),[3],'one-piece grants remain one piece');
 assert.deepEqual(selectHintPieceIds(state,[0,0]),[3,4],'single loose pieces precede the joined group');
 assert.deepEqual(selectHintPieceIds(state,[0,1,3],{3:{name:'朋友',color:'#789'}}),[1,4,5],'a lease is keyed by group ID');
 assert.deepEqual(selectHintPieceIds(state,[1,0],{7:{name:'朋友',color:'#789'}}),[3,4],'every piece of an owned group is excluded');
 assert.deepEqual(selectHintPieceIds(state,[0,3,4],{3:{},4:{},5:{}}),[1],'fall back to the first piece of an unowned joined group');
});

test('hint selection caps at three, tolerates exhausted groups and can prune without topping up',()=>{
 const state=hintState();
 assert.deepEqual(selectHintPieceIds(state,[1,3,4,5]),[1,3,4]);
 assert.deepEqual(selectHintPieceIds(state,[],{},{count:99}),[3,4,5]);
 assert.deepEqual(selectHintPieceIds(state,[]),[]);
 assert.deepEqual(selectHintPieceIds({...state,groups:state.groups.map(g=>({...g,locked:true}))},[0,1,3]),[]);
 state.groups.find(g=>g.id===3).locked=true;
 assert.deepEqual(selectHintPieceIds(state,[1,3,4],{7:{}},{topUp:false}),[4]);
});

function hintPlatform(dashMode='native'){
 const contexts=[],frames=new Map(),hidden=new Set(),shown=new Set();let nextFrame=0;
 function canvas(){
  const canvas={width:1600,height:1200},events=[],stack=[];let s={a:1,b:0,c:0,d:1,e:0,f:0,globalAlpha:1,globalCompositeOperation:'source-over',shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',filter:'none',lineWidth:1,dash:[],fillStyle:'',strokeStyle:''},path=[];
  const point=(x,y)=>({x:s.e+x*s.a,y:s.f+y*s.d});
  const methods={canvas,events,save(){stack.push({...s,dash:[...s.dash]});},restore(){s=stack.pop();},getTransform(){return {...s};},setTransform(a,b,c,d,e,f){Object.assign(s,{a,b,c,d,e,f});},translate(x,y){s.e+=x*s.a;s.f+=y*s.d;},scale(x,y){s.a*=x;s.d*=y;},beginPath(){path=[];},moveTo(x,y){path.push(point(x,y));},lineTo(x,y){path.push(point(x,y));},arc(x,y,r){path.push({...point(x,y),radius:r*s.a});},stroke(){events.push({kind:'stroke',path:structuredClone(path),width:s.lineWidth*s.a,dash:s.dash.map(n=>n*s.a),color:s.strokeStyle,alpha:s.globalAlpha});},fill(){events.push({kind:'fill',path:structuredClone(path),color:s.fillStyle,alpha:s.globalAlpha});},fillText(text,x,y){events.push({kind:'text',text,point:point(x,y),font:s.font,scale:s.a,color:s.fillStyle,alpha:s.globalAlpha});},drawImage(source){events.push({kind:'image',source});},getLineDash(){return [...s.dash];},setLineDash:dashMode==='missing'?undefined:dash=>{if(dashMode==='throw')throw Error('unsupported dash');s.dash=[...dash];},measureText:text=>({width:String(text).length*8}),createPattern:()=>null,createLinearGradient:()=>({addColorStop(){}}),isPointInPath:()=>true};
  const ctx=new Proxy(methods,{get:(o,k)=>k in o?o[k]:k in s?s[k]:()=>{},set:(_o,k,v)=>(s[k]=v,true)});canvas.getContext=()=>ctx;contexts.push(ctx);return canvas;
 }
 const main=canvas();return {contexts,frames,canvas:main,ctx:main.getContext('2d'),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(_value){queueMicrotask(()=>this.onload?.());}}),config:{id:'wechat'},onHide:fn=>(hidden.add(fn),()=>hidden.delete(fn)),onShow:fn=>(shown.add(fn),()=>shown.delete(fn)),hide:()=>hidden.forEach(fn=>fn()),show:()=>shown.forEach(fn=>fn()),frame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),step(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(Date.now()));}};
}
function hintBoard(t,dashMode){
 const platform=hintPlatform(dashMode),state=createFittedPuzzle('hint',4,3,123),board=new PuzzleBoard(platform,state,()=>{});
 board.setRect({x:13,y:37,w:1600,h:1200});t.after(()=>board.destroy());return {platform,state,board};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('active hints prune on snapshots and local state changes; reapplying the same grant never replaces them',t=>{
 const {platform,state,board}=hintBoard(t),until=Date.now()+30000;state.groups[0].locked=true;
 assert.equal(board.setHints([0,1,2],until,'first'),true);assert.deepEqual(board.hintIds,[1,2,3]);
 const next=structuredClone(state);next.groups.find(g=>g.id===1).locked=true;
 board.syncRemote(next,{2:{name:'朋友',color:'#789'}},new Set(),false);assert.deepEqual(board.hintIds,[3]);
 assert.equal(board.setHints([0,1,2],until+1,'first'),false);assert.deepEqual(board.hintIds,[3]);
 state.groups.find(g=>g.id===3).locked=true;board.draw(platform.ctx);assert.deepEqual(board.hintIds,[]);
 assert.equal(board.setHints([0,1,2],until+2,'second'),true);assert.deepEqual(board.hintIds,[4,5,6]);
 board.setHints([],0);assert.deepEqual(board.hintIds,[]);
});

test('local hint fallback prefers single loose pieces and excludes teammate-held groups',t=>{
 const {state,board}=hintBoard(t);state.groups=[hintGroup(0,[0,1]),hintGroup(2),hintGroup(3),hintGroup(4)];
 board.syncRemote(structuredClone(state),{2:{name:'朋友',color:'#789'}},new Set(),false);board.hint();assert.deepEqual(board.hintIds,[3,4,0]);
});

test('hint camera stays untouched when both the loose piece and target already fit',t=>{
 const {state,board}=hintBoard(t);state.groups[0].dx=100;state.groups[0].dy=80;
 board.camera={x:160-board.board.x*.4,y:160-board.board.y*.4,z:.4};board.setHints([0],Date.now()+30000);
 const before=structuredClone({state,camera:board.camera});assert.equal(board.locateHints({top:40,right:72,bottom:72,left:104}),false);assert.deepEqual({state,camera:board.camera},before);
 const pad=Math.min(board.board.width/state.cols,board.board.height/state.rows)*.27;board.camera.x=104+pad*.4+3-board.board.x*.4;
 const nearEdge={...board.camera};assert.equal(board.locateHints({left:104}),false,'visible hints need no extra framing margin');assert.deepEqual(board.camera,nearEdge);
});

for(const [name,rect,insets,tray,sourceVisible]of [
 ['portrait',{x:23,y:77,w:390,h:650},{bottom:72},false,false],
 ['landscape',{x:13,y:19,w:780,h:330},{top:60,right:72,bottom:8,left:104},false,true],
 ['tray',{x:23,y:77,w:390,h:650},{bottom:72},true,false],
])test(`hint camera includes offscreen ${sourceVisible?'target':'piece'} and respects ${name} insets`,t=>{
 const {state,board}=hintBoard(t);board.setRect(rect);board.trayOpen=tray;const group=state.groups[0];group.dx=1800;group.dy=-700;
 board.camera={x:100-(board.board.x+(sourceVisible?group.dx:0))*.9,y:100-(board.board.y+(sourceVisible?group.dy:0))*.9,z:.9};board.setHints([0],Date.now()+30000);
 const before=JSON.stringify(state);assert.equal(board.locateHints(insets),true);assert.ok(board.camera.z<=.9);assert.equal(JSON.stringify(state),before);
 const w=board.board.width/state.cols,h=board.board.height/state.rows,pad=Math.min(w,h)*.27,bottomInset=tray?Math.max(insets.bottom,rect.y+rect.h-board.trayLayout().r.y):insets.bottom;
 for(const [dx,dy]of [[0,0],[group.dx,group.dy]])for(const [x,y]of [[board.board.x+dx-pad,board.board.y+dy-pad],[board.board.x+dx+w+pad,board.board.y+dy+h+pad]]){
  const screen=board.worldToScreen({x,y});assert.ok(screen.x>=rect.x+(insets.left??0)&&screen.x<=rect.x+rect.w-(insets.right??0));assert.ok(screen.y>=rect.y+(insets.top??0)&&screen.y<=rect.y+rect.h-bottomInset);
 }
 const camera={...board.camera};assert.equal(board.locateHints(insets),false);assert.deepEqual(board.camera,camera);
});

for(const theme of ['light','dark','wood'])for(const mode of ['direct','gesture','drag'])test(`${theme} hints keep live badges, pulsing outlines and matching links in ${mode} drawing`,async t=>{
 let now=12000;t.mock.method(Date,'now',()=>now);const {platform,state,board}=hintBoard(t);await board.setImage('hint.png');
 for(const group of state.groups){group.locked=group.id!==5;group.dx=0;group.dy=0;}const group=state.groups[5];group.dx=300;group.dy=-50;board.setTheme(theme);board.edgeOnly=true;board.setHints([5],now+30000,'grant');
 const before=JSON.stringify(state),paints=[],drawGroups=board.drawPieceGroups.bind(board);board.drawPieceGroups=(...args)=>{paints.push(args[4]??'all');return drawGroups(...args);};
 for(const zoom of [.25,1.4]){
  board.cancelNetworkDrag();board.pan=null;board.camera={x:30-board.board.x*zoom,y:100-board.board.y*zoom,z:zoom};
  const w=board.board.width/state.cols,h=board.board.height/state.rows,target={x:board.board.x+1.5*w,y:board.board.y+1.5*h},loose={x:target.x+group.dx,y:target.y+group.dy};
  if(mode==='gesture')board.pan={pointer:9};
  if(mode==='drag'){board.drag={id:5,pointer:9,live:true};board.pointers.set(9,{id:9,...board.worldToScreen(loose)});}
  const render=()=>{platform.ctx.events.length=0;board.draw(platform.ctx);return [...platform.ctx.events];};
  const events=render(),badges=events.filter(e=>e.kind==='fill'&&e.path[0]?.radius===11),texts=events.filter(e=>e.kind==='text'&&e.text==='1'),strokes=events.filter(e=>e.kind==='stroke'&&e.color===boardThemeColors(theme).hintLine),outline=strokes.find(e=>Math.abs(e.width-3.5)<1e-7),link=strokes.find(e=>Math.abs(e.width-1)<1e-7);
  assert.equal(badges.length,2);assert.equal(texts.length,2);assert.ok(strokes.some(e=>Math.abs(e.width-2)<1e-7),'target outline retained');assert.ok(outline);assert.ok(link);assert.deepEqual(link.dash,[5,4]);near(link.alpha,.6);
  for(const [index,world]of [target,loose].entries()){
   const expected=board.worldToScreen(world);near(badges[index].path[0].x,expected.x);near(badges[index].path[0].y,expected.y);near(texts[index].point.x,expected.x);near(texts[index].point.y,expected.y);near(texts[index].scale,1);assert.equal(texts[index].font,'bold 13px sans-serif');assert.equal(texts[index].color,'#ffffff');assert.equal(texts[index].alpha,1);
  }
  near(link.path[0].x,board.worldToScreen(loose).x);near(link.path[0].y,board.worldToScreen(loose).y);near(link.path[1].x,board.worldToScreen(target).x);near(link.path[1].y,board.worldToScreen(target).y);
  if(mode==='gesture'){assert.ok(board.gestureSurface);assert.ok(paints.includes('overlays'));assert.ok(paints.includes('pieces'));}if(mode==='drag')assert.ok(board.dragSurface);
  if(mode==='direct')assert.ok(events.some(e=>e.kind==='image'&&e.source===board.atlas),'hinted interior piece stays visible through edge filtering');
  const builds=board.performanceDetails().builds;now+=300;const pulsed=render().find(e=>e.kind==='stroke'&&e.color===boardThemeColors(theme).hintLine&&Math.abs(e.width-3.5)<1e-7);assert.notEqual(pulsed.alpha,outline.alpha);assert.equal(board.performanceDetails().builds,builds,'pulse cannot rebuild artwork caches');now+=900;
  const repeated=render().find(e=>e.kind==='stroke'&&e.color===boardThemeColors(theme).hintLine&&Math.abs(e.width-3.5)<1e-7);near(repeated.alpha,outline.alpha);
 }
 assert.equal(JSON.stringify(state),before);assert.ok(platform.contexts.slice(1).every(ctx=>!ctx.events.some(e=>e.kind==='fill'&&e.path[0]?.radius===11)),'badges are never baked into caches');
});

test('hint animation resumes after hiding and stops after expiry without a lingering overlay',t=>{
 let now=12000;t.mock.method(Date,'now',()=>now);const {platform,board}=hintBoard(t);board.setHints([0],now+30000);
 assert.equal(platform.frames.size,1);platform.hide();assert.equal(platform.frames.size,0);platform.show();assert.equal(platform.frames.size,1);
 now+=30001;platform.step();assert.equal(platform.frames.size,0);platform.ctx.events.length=0;board.draw(platform.ctx);assert.deepEqual(board.hintIds,[]);assert.equal(platform.ctx.events.filter(e=>e.kind==='fill'&&e.path[0]?.radius===11).length,0);
});

for(const dashMode of ['missing','throw'])test(`hint connectors have a native dashed fallback when setLineDash is ${dashMode}`,t=>{
 const {platform,state,board}=hintBoard(t,dashMode);state.groups[0].dx=200;board.setHints([0],Date.now()+30000);board.draw(platform.ctx);
 const link=platform.ctx.events.find(e=>e.kind==='stroke'&&e.color===boardThemeColors(board.theme).hintLine&&Math.abs(e.width-1)<1e-7);assert.ok(link.path.length>2);assert.equal(link.path.length%2,0);
 for(let i=0;i<link.path.length;i+=2){const a=link.path[i],b=link.path[i+1];assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<=5.0000001);}
});
