import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn,setTimeout as wait} from 'node:timers/promises';
import {PuzzleBoard,DRAG_SLOP,TRAY_STRIP_PX,TRAY_LIFT_MS} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle,createPuzzle,placedCount} from '../lib/puzzle-engine.ts';
import {RoomClient} from '../lib/room-client.ts';
import {makeRoom,addMember,applyAction,snapshot,PHOTO_IDS} from '../lib/room-engine.ts';
import {supportsPieceCount} from '../lib/piece-policy.ts';
import {createOfflineRoomServer} from '../lib/offline-play.ts';

/** A recording 2D context: calls are logged, and every globalAlpha assignment is kept. */
function platform(){
 const commands=[],alphas=[],ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:(...args)=>commands.push([name,...args]),set:(target,name,value)=>{if(name==='globalAlpha')alphas.push(value);target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {commands,alphas,ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
const until=async condition=>{for(let i=0;i<300;i++){if(condition())return;await turn();}assert.fail('did not settle');};
const down=(board,points,changed=points)=>board.input({type:'down',points,changed});
const move=(board,points,changed=points)=>board.input({type:'move',points,changed});
const up=(board,points,changed)=>board.input({type:'up',points,changed});
const groupOf=(board,id)=>board.state.groups.find(g=>g.id===id);
const unit=board=>({w:board.board.width/board.state.cols,h:board.board.height/board.state.rows});
/** Screen point of a tray cell (page-relative index) and the group it shows. */
function cell(board,index=0,id=1){
 const v=board.trayLayout(),group=v.groups[board.trayPage*v.pageSize+index];
 return {group,point:{id,x:v.r.x+8+(index%v.columns+.5)*v.cellW,y:v.r.y+v.top+(Math.floor(index/v.columns)+.5)*v.cellH}};
}
/** Screen point of the centre of piece `piece`, placed at offset dx/dy. */
function screenOf(board,piece,dx=0,dy=0,id=1){
 const {w,h}=unit(board),c=board.camera,col=piece%board.state.cols,row=Math.floor(piece/board.state.cols);
 return {id,x:board.rect.x+c.x+(board.board.x+(col+.5)*w+dx)*c.z,y:board.rect.y+c.y+(board.board.y+(row+.5)*h+dy)*c.z};
}
/** Lifts a cell's group out of the tray and returns it with the finger now on the table. */
function pullOut(board,index=0){
 const {group,point}=cell(board,index),origin={dx:group.dx,dy:group.dy};
 down(board,[point]);const lifted={...point,y:point.y-DRAG_SLOP-4};move(board,[lifted]);
 return {group,origin,point,lifted};
}
async function boardFixture({network}={}){
 const p=platform(),state=createFittedPuzzle('test',8,6,123),board=new PuzzleBoard(p,state,()=>{}),events=[],notices=[];
 board.setRect({x:10,y:80,w:390,h:700});await board.setImage('test.png');board.networkReady=true;board.onNotice=text=>notices.push(text);
 board.network=network??{canAcquire:()=>true,acquire:async id=>(events.push(['claim',id]),true),move:(id,dx,dy)=>events.push(['move',id,dx,dy]),drop:async(id,dx,dy)=>events.push(['drop',id,dx,dy]),release:id=>events.push(['release',id])};
 board.trayOpen=true;board.draw(p.ctx);
 return {p,state,board,events,notices};
}

test('a tap on a tray cell still only locates the group, and the header names both uses',async()=>{
 const {p,board,events,state}=await boardFixture(),before=JSON.stringify(state.groups),{group,point}=cell(board,2);
 assert.ok(p.commands.some(([name,text])=>name==='fillText'&&text==='点选定位 · 拖出放置'));
 down(board,[point]);move(board,[{...point,x:point.x+3}]);up(board,[],[{...point,x:point.x+3}]);
 assert.deepEqual(events,[],'no claim, move or drop');assert.equal(JSON.stringify(state.groups),before);
 assert.equal(board.focusedPiece,group.pieces[0]);assert.equal(board.trayLayout().r.h>TRAY_STRIP_PX,true);
 board.destroy();
});

test('a long press lifts the cell, and then any movement pulls the group out',async()=>{
 const {p,board,events}=await boardFixture(),{group,point}=cell(board,3);
 down(board,[point]);await wait(TRAY_LIFT_MS+40);
 p.commands.length=0;board.draw(p.ctx);assert.equal(board.trayTouch.lifted,true,'the cell is lifted');
 move(board,[{...point,x:point.x+2}]);assert.deepEqual(events[0],['claim',group.id],'two pixels are enough once lifted');
 assert.equal(board.trayLayout().r.h,TRAY_STRIP_PX);up(board,[],[{...point,x:point.x+2}]);await turn();
 assert.equal(events.at(-1)[0],'drop');board.destroy();
});

test('a long press released without moving puts nothing down and does not locate; a quick tap still locates',async()=>{
 const {board,events,state}=await boardFixture(),before=JSON.stringify(state.groups),camera={...board.camera},{group,point}=cell(board,1);
 down(board,[point]);await wait(TRAY_LIFT_MS+40);up(board,[],[point]);await turn();
 assert.deepEqual(events,[]);assert.equal(JSON.stringify(state.groups),before);assert.deepEqual(board.camera,camera,'no locate');assert.equal(board.focusedPiece,null);
 down(board,[point]);await wait(TRAY_LIFT_MS/3);up(board,[],[point]);await wait(TRAY_LIFT_MS);
 assert.equal(board.focusedPiece,group.pieces[0],'the quick tap locates');assert.deepEqual(events,[]);assert.equal(board.trayTouch,null);
 board.destroy();
});

test('a second finger or a cancelled touch stops the long press',async()=>{
 const {board,events}=await boardFixture(),{point}=cell(board,0),other={id:2,x:board.rect.x+200,y:board.rect.y+100};
 down(board,[point]);await wait(TRAY_LIFT_MS/3);down(board,[point,other],[other]);await wait(TRAY_LIFT_MS);
 assert.notEqual(board.trayTouch?.lifted,true,'a pinch never lifts');move(board,[{...point,x:point.x+2},other],[{...point,x:point.x+2}]);assert.deepEqual(events,[]);
 up(board,[],[point,other]);
 down(board,[point]);board.input({type:'cancel',points:[],changed:[]});await wait(TRAY_LIFT_MS+40);
 assert.equal(board.trayTouch,null);assert.deepEqual(events,[]);board.destroy();
});

test('sliding off a cell pulls the group out under the finger, shrinks the tray to a strip, and drops where it is let go',async()=>{
 const {board,events}=await boardFixture();board.trayPage=1;const full=board.trayLayout().r,{group,lifted}=pullOut(board,1);
 assert.deepEqual(events[0],['claim',group.id]);
 const held=screenOf(board,group.pieces[0],groupOf(board,group.id).dx,groupOf(board,group.id).dy);
 assert.ok(Math.abs(held.x-lifted.x)<.01&&Math.abs(held.y-lifted.y)<.01,'the cell piece sits centred under the finger');
 const strip=board.trayLayout().r;assert.equal(strip.h,TRAY_STRIP_PX);assert.equal(strip.y+strip.h,full.y+full.h,'the strip keeps the tray bottom');
 const there={...lifted,x:board.rect.x+120,y:board.rect.y+150};move(board,[there]);
 const g=groupOf(board,group.id),at=screenOf(board,group.pieces[0],g.dx,g.dy);assert.ok(Math.abs(at.x-there.x)<.01&&Math.abs(at.y-there.y)<.01,'the group follows the finger');
 up(board,[],[there]);await turn();
 assert.deepEqual(events.at(-1),['drop',group.id,groupOf(board,group.id).dx,groupOf(board,group.id).dy]);
 assert.deepEqual(board.trayLayout().r,full,'the tray opens again at full height');assert.equal(board.trayPage,1,'on the same page');
 board.destroy();
});

test('letting go on the strip puts the group back on its own spot without drop assist',async()=>{
 const {board,events}=await boardFixture(),{group,origin,lifted}=pullOut(board,0);
 move(board,[{...lifted,y:board.rect.y+200}]);const strip=board.trayLayout().r,onStrip={...lifted,x:strip.x+strip.w/2,y:strip.y+strip.h/2};
 move(board,[onStrip]);up(board,[],[onStrip]);await turn();
 assert.deepEqual({dx:groupOf(board,group.id).dx,dy:groupOf(board,group.id).dy},origin);
 assert.deepEqual(events.at(-1),['drop',group.id,origin.dx,origin.dy]);assert.ok(board.trayLayout().r.h>TRAY_STRIP_PX);
 board.destroy();
});

test('a group held by another player is dimmed in the tray, can be located but not pulled out',async()=>{
 const {p,board,events,notices,state}=await boardFixture(),{group}=cell(board,0);
 board.syncRemote({...state,groups:state.groups.map(g=>({...g,pieces:[...g.pieces]}))},{[group.id]:{name:'小满',color:'#88aaee'}},new Set(),false);
 p.alphas.length=0;board.draw(p.ctx);assert.ok(p.alphas.includes(.35),'the held cell is drawn faded');
 const {point}=cell(board,0);down(board,[point]);assert.equal(notices.at(-1),'小满 正在移动这组拼块','told on press');
 move(board,[{...point,y:point.y-30}]);up(board,[],[{...point,y:point.y-30}]);
 assert.deepEqual(events,[],'never claimed');board.destroy();
});

test('a refused claim springs the group back to its spot and restores the tray; a busy room refuses up front',async()=>{
 let answer;const events=[],network={canAcquire:()=>true,acquire:id=>(events.push(['claim',id]),new Promise(resolve=>{answer=resolve;})),move(){},drop:async(id)=>events.push(['drop',id]),release(){}};
 const {board,notices}=await boardFixture({network}),{group,origin,lifted}=pullOut(board,0);
 move(board,[{...lifted,y:lifted.y-60}]);answer(false);await turn();
 assert.deepEqual({dx:groupOf(board,group.id).dx,dy:groupOf(board,group.id).dy},origin);assert.equal(notices.at(-1),'这组拼块没能确认，已恢复服务器位置');
 assert.ok(board.trayLayout().r.h>TRAY_STRIP_PX);up(board,[],[{...lifted,y:lifted.y-60}]);await turn();
 assert.deepEqual(events,[['claim',group.id]],'nothing is dropped after the refusal');
 network.canAcquire=()=>false;const second=pullOut(board,1);
 assert.equal(notices.at(-1),'这组拼块还在确认位置，请稍候');assert.deepEqual({dx:groupOf(board,second.group.id).dx,dy:groupOf(board,second.group.id).dy},second.origin);
 assert.equal(events.length,1);board.destroy();
});

test('a second finger pans while the pulled-out group stays held, and a cancelled touch drops it where it lies',async()=>{
 const {board,events}=await boardFixture(),{group,lifted}=pullOut(board,0),there={...lifted,y:board.rect.y+200};move(board,[there]);
 const b={id:2,x:board.rect.x+300,y:board.rect.y+100},camera={...board.camera};down(board,[there,b],[b]);
 move(board,[there,{...b,x:b.x-40,y:b.y+25}],[{...b,x:b.x-40,y:b.y+25}]);
 assert.equal(board.camera.z,camera.z);assert.notDeepEqual([board.camera.x,board.camera.y],[camera.x,camera.y],'the second finger pans');
 const g=groupOf(board,group.id),at=screenOf(board,group.pieces[0],g.dx,g.dy);assert.ok(Math.abs(at.x-there.x)<.01&&Math.abs(at.y-there.y)<.01,'still under the holding finger');
 board.input({type:'cancel',points:[],changed:[]});await turn();
 assert.deepEqual(events.at(-1),['drop',group.id,groupOf(board,group.id).dx,groupOf(board,group.id).dy]);assert.ok(board.trayLayout().r.h>TRAY_STRIP_PX);
 board.destroy();
});

// The real RoomClient against the room engine, the device-only solo mode and the offline room server.
const roomId='a'.repeat(32),playerId='b'.repeat(32),token='c'.repeat(32);
const storage=()=>{const values=new Map();return {values,get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};};
let serial=100;const randomId=()=>(++serial).toString(16).padStart(32,'0');
async function attach(t,ticket,deps){
 const p=platform(),board=new PuzzleBoard(p,structuredClone(ticket.room.puzzle),()=>{});board.setRect({x:0,y:60,w:390,h:760});await board.setImage('test.png');
 const client=new RoomClient(ticket,{randomId,emit(){},hidden:()=>false,now:()=>Date.now(),performanceNow:()=>Date.now(),...deps});
 const detach=client.attach(board);t.after(()=>{detach();board.destroy();});board.networkReady=true;await until(()=>!client.polling);
 board.trayOpen=true;board.draw(p.ctx);return {board,client};
}
/** The tray index of a single loose piece whose own spot is above the tray. */
function topPiece(board){const v=board.trayLayout();return v.groups.findIndex(g=>g.pieces.length===1&&Math.floor(g.pieces[0]/board.state.cols)<2&&v.groups.indexOf(g)<v.pageSize);}
function roomFixture(t,solo){
 const image=PHOTO_IDS.find(id=>supportsPieceCount(id,108)),room=makeRoom(roomId,image,108,Date.now());room.puzzle=createPuzzle('seaside',12,9,123);
 const member=addMember(room,playerId,'玩家','digest',Date.now()),ticket={token,playerId,room:snapshot(room,Date.now())},requests=[],store=storage();
 const fetch=async(url,init)=>{const action=init?.body?JSON.parse(init.body):null;requests.push(action);
  if(action?.type==='batch'){for(const op of action.ops){applyAction(room,member,{type:'claim',groupId:op.groupId},Date.now());applyAction(room,member,{type:'drop',groupId:op.groupId,dx:op.dx,dy:op.dy,seq:1},Date.now());}return Response.json({...snapshot(room,Date.now()),soloBatch:{applied:action.ops.map(op=>op.requestId),skipped:[],stopped:null},mobileContributions:[]});}
  if(action&&action.type!=='leave'){applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));};
 return {room,ticket,requests,deps:{fetch,storage:store,...(solo?{solo:{enabled:()=>true,storage:store,energy:()=>null}}:{})}};
}

test('in a shared room the pull-out is an ordinary claim, move and drop, and the strip returns the room position',async t=>{
 const f=roomFixture(t,false),{board,client}=await attach(t,f.ticket,f.deps);assert.equal(client.localPlay,false);
 const {group,origin,lifted}=pullOut(board,0),there={...lifted,x:board.rect.x+200,y:board.rect.y+180};move(board,[there]);
 await until(()=>f.requests.some(a=>a?.type==='claim'));up(board,[],[there]);
 await until(()=>f.requests.some(a=>a?.type==='drop')&&!Object.keys(f.room.leases).length);
 const kept=groupOf(board,group.id),server=f.room.puzzle.groups.find(g=>g.id===group.id);
 assert.deepEqual({dx:server.dx,dy:server.dy},{dx:kept.dx,dy:kept.dy});assert.notDeepEqual({dx:server.dx,dy:server.dy},origin);
 assert.ok(f.requests.some(a=>a?.type==='claim'&&a.groupId===group.id)&&f.requests.some(a=>a?.type==='drop'&&a.groupId===group.id));
 const second=pullOut(board,1);move(board,[{...second.lifted,y:board.rect.y+150}]);const strip=board.trayLayout().r,back={...second.lifted,x:strip.x+20,y:strip.y+10};move(board,[back]);
 await until(()=>f.requests.filter(a=>a?.type==='claim').length===2);up(board,[],[back]);
 await until(()=>f.requests.filter(a=>a?.type==='drop').length===2&&!Object.keys(f.room.leases).length);
 const returned=f.room.puzzle.groups.find(g=>g.id===second.group.id);assert.deepEqual({dx:returned.dx,dy:returned.dy},second.origin);
});

test('in solo local play the pull-out places the piece on the device without any request',async t=>{
 const f=roomFixture(t,true),{board,client}=await attach(t,f.ticket,f.deps);assert.equal(client.localPlay,true);
 const index=topPiece(board);assert.ok(index>=0);const sent=f.requests.length,{group,lifted}=pullOut(board,index);
 const home=screenOf(board,group.pieces[0]);move(board,[{...lifted,...home,id:lifted.id}]);up(board,[],[{...home,id:lifted.id}]);
 await until(()=>board.state.groups.find(g=>g.pieces.includes(group.pieces[0]))?.locked===true);
 assert.equal(f.requests.slice(sent).filter(a=>a&&a.type!=='batch'&&a.type!=='heartbeat').length,0,'no claim/move/drop request');
 assert.equal(client.pendingSoloOps>=1,true);
});

test('in an offline room the pull-out drops onto its spot and counts',async t=>{
 const catalog={schema:'jigsaw-offline/v1',seriesTitle:'拾光物语',firstClearEnergy:30,chapters:[{id:'ch-z',title:'第一章',albumId:'story-z',levels:[{id:'ch-z-1',imageId:'a',title:'一',pieces:12,cols:4,rows:3,line:'故事'}]}],free:[],photos:{a:{id:'a',title:'画',category:'故事',src:'/a.webp',thumbSrc:'/a-thumb.webp',width:1600,height:1200,artwork:{revision:'r',src:'/a.webp',thumbSrc:'/a-thumb.webp',width:1600,height:1200}}}};
 const server=createOfflineRoomServer({catalog,storage:storage(),now:()=>Date.now(),randomId}),ticket=server.createRoom({kind:'level',levelId:'ch-z-1'});
 const {board,client}=await attach(t,ticket,{fetch:server.fetch});assert.equal(client.localPlay,false);
 const index=topPiece(board);assert.ok(index>=0);const {group,lifted}=pullOut(board,index),home=screenOf(board,group.pieces[0],5,-4);
 move(board,[{...home,id:lifted.id}]);up(board,[],[{...home,id:lifted.id}]);
 await until(()=>placedCount(client.snapshot.puzzle)===1);assert.equal(client.snapshot.puzzle.groups.find(g=>g.pieces.includes(group.pieces[0])).locked,true);
});
