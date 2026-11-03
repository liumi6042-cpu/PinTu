import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn,setTimeout as wait} from 'node:timers/promises';
import {PuzzleBoard,FADE_IN_MS,TURN_MS,ROTATE_BUTTON_R} from '../mobile/puzzle-board.ts';
import {storyVariantFor,boardVariant,seededTilts,fadePixels,dropJoinsShadow,safeDropOffset,readWindSave,writeWindSave,windStorageKey,variantIntroSentence,variantIntroKey,DEFAULT_STORY_VARIANTS} from '../mobile/story-variants.ts';
import {createFittedPuzzle,createPuzzle,boardFor,snapTolerance,placedCount} from '../lib/puzzle-engine.ts';
import {RoomClient} from '../lib/room-client.ts';
import {makeRoom,addMember,applyAction,snapshot,PHOTO_IDS} from '../lib/room-engine.ts';
import {supportsPieceCount} from '../lib/piece-policy.ts';
import {readLevelConfiguration} from '../server/mobile-levels.mjs';

const storage=()=>{const values=new Map();return {values,get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};};
/** A recording 2D context. With pixels:true it also reads and writes image data, as a browser canvas does. */
function platform({pixels=false,store=storage()}={}){
 const commands=[],target={isPointInPath:()=>true,measureText:text=>({width:text.length*8})};
 if(pixels){target.getImageData=(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)});target.putImageData=(...args)=>commands.push(['putImageData',...args]);}
 const ctx=new Proxy(target,{get:(t,name)=>name in t?t[name]:(...args)=>commands.push([name,...args]),set:(t,name,value)=>{t[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx}),noop=()=>()=>{};
 return {commands,ctx,storage:store,createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:noop,onShow:noop,frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
const until=async(condition,label='did not settle')=>{for(let i=0;i<400;i++){if(condition())return;await turn();}assert.fail(label);};
const down=(board,points,changed=points)=>board.input({type:'down',points,changed});
const move=(board,points,changed=points)=>board.input({type:'move',points,changed});
const up=(board,points,changed)=>board.input({type:'up',points,changed});
const groupOf=(board,piece)=>board.state.groups.find(g=>g.pieces.includes(piece));
function screenOf(board,piece,dx=0,dy=0,id=1){
 const w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,c=board.camera,col=piece%board.state.cols,row=Math.floor(piece/board.state.cols);
 return {id,x:board.rect.x+c.x+(board.board.x+(col+.5)*w+dx)*c.z,y:board.rect.y+c.y+(board.board.y+(row+.5)*h+dy)*c.z};
}
/** Drags the group holding `piece` from where it lies to offset dx/dy and lets go. */
function dragTo(board,piece,dx,dy){
 const group=groupOf(board,piece),from=screenOf(board,piece,group.dx,group.dy),to=screenOf(board,piece,dx,dy);
 down(board,[from]);move(board,[{...from,x:from.x+12}]);move(board,[to]);up(board,[],[to]);
}
const pressRotate=board=>{const b=board.rotateRect;assert.ok(b,'the rotate button is shown');const p={id:7,x:b.x+3,y:b.y-2};down(board,[p]);up(board,[],[p]);};
const ROOM='a'.repeat(32);

test('the bundled placement, a server value and none decide the level variant',()=>{
 assert.deepEqual(Object.keys(DEFAULT_STORY_VARIANTS).sort(),['ch1-3','ch1-5','ch2-3','ch2-5','ch3-3','ch3-5','ch4-2','ch4-5']);
 assert.equal(storyVariantFor('ch1-5'),'fade');assert.equal(storyVariantFor('ch1-3'),'wind-light');assert.equal(storyVariantFor('ch4-2'),'wind-water');
 assert.equal(storyVariantFor('ch1-1'),null);assert.equal(storyVariantFor(undefined),null);
 assert.equal(storyVariantFor('ch1-5',{variant:'none'}),null,'none turns the default off');
 assert.equal(storyVariantFor('ch1-1',{variant:'wind'}),'wind','the server wins');
 assert.equal(storyVariantFor('ch1-5',{variant:'night'}),'fade','an unknown value keeps the default');
 assert.deepEqual(boardVariant('wind-light',ROOM),{kind:'wind',share:.25,roomId:ROOM});assert.deepEqual(boardVariant('fade',ROOM),{kind:'fade'});
 assert.match(variantIntroSentence('fade'),/褪色/);assert.match(variantIntroSentence('wind-water'),/水流/);assert.match(variantIntroSentence('wind-light'),/一阵风/);
 assert.equal(variantIntroKey('wind-light'),variantIntroKey('wind'),'one first-time sentence for both wind strengths');
});

test('wind tilts are seeded by room and piece: the same every time, about the share asked for',()=>{
 const ids=Array.from({length:400},(_,i)=>i),a=seededTilts(ROOM,ids,.5),b=seededTilts(ROOM,ids,.5),light=seededTilts(ROOM,ids,.25),other=seededTilts('f'.repeat(32),ids,.5);
 assert.deepEqual([...a],[...b]);assert.notDeepEqual([...a],[...other]);
 assert.ok(a.size>150&&a.size<250,'about half: '+a.size);assert.ok(light.size>60&&light.size<140,'about a quarter: '+light.size);
 for(const q of a.values())assert.ok(q>=1&&q<=3);
});

test('the faded look is luminance * .72 + 52 with a warm tint, alpha kept',()=>{
 const data=new Uint8ClampedArray([0,0,0,255,255,255,255,128]);fadePixels(data);
 assert.deepEqual([...data.slice(0,4)],[60,55,46,255]);assert.deepEqual([...data.slice(4)],[244,239,230,128]);
});

test('a saved wind room reads back; damaged saves are ignored',()=>{
 const save={rot:new Map([[3,1],[7,3]]),pos:new Map([[7,{dx:10,dy:-4,bx:200,by:90}]])},back=readWindSave(writeWindSave(save));
 assert.deepEqual([...back.rot],[...save.rot]);assert.deepEqual([...back.pos],[...save.pos]);
 assert.equal(readWindSave('{"v":2}'),null);assert.equal(readWindSave('nope'),null);assert.deepEqual([...readWindSave('{"v":1,"rot":{"1":9,"2":2}}').rot],[[2,2]]);
});

test('the drop check runs the shared engine as the room would: a drop that would join a tilted piece is moved out of reach',()=>{
 const state=createFittedPuzzle('test',4,3,123),tol=snapTolerance(state);
 // Piece 0 lies tilted at the room offset (300,40); piece 1 is its right-hand neighbour.
 for(const g of state.groups){g.dx=g.id*40+300;g.dy=40;}state.groups[0].dx=300;const shadows=new Map([[0,{dx:300,dy:40}]]);
 assert.equal(dropJoinsShadow(state,1,300,40,shadows),true,'aligned with the tilted piece');
 assert.equal(dropJoinsShadow(state,1,300+tol*2,40,shadows),false);assert.equal(dropJoinsShadow(state,1,300,40,new Map()),false);
 const safe=safeDropOffset(state,1,300,40,shadows);assert.ok(Math.hypot(safe.dx-300,safe.dy-40)>tol);assert.equal(dropJoinsShadow(state,1,safe.dx,safe.dy,shadows),false);
 // A drop that places a piece does not join a tilted neighbour lying elsewhere.
 assert.equal(dropJoinsShadow(state,1,0,0,shadows),false);
});

async function windBoard({share=1,store=storage(),network,state=createFittedPuzzle('test',8,6,123)}={}){
 const p=platform({store}),board=new PuzzleBoard(p,state,()=>{}),events=[],notices=[];
 board.setRect({x:10,y:80,w:390,h:700});board.setVariant({kind:'wind',share,roomId:ROOM});await board.setImage('test.png');board.networkReady=true;board.onNotice=t=>notices.push(t);
 board.network=network??{canAcquire:()=>true,acquire:async id=>(events.push(['claim',id]),true),move:(id,dx,dy)=>events.push(['move',id,dx,dy]),drop:async(id,dx,dy)=>events.push(['drop',id,dx,dy]),release:id=>events.push(['release',id])};
 board.draw(p.ctx);return {p,board,events,notices,store};
}
const looseTilted=board=>board.state.groups.find(g=>!g.locked&&g.pieces.length===1&&board.rot.get(g.pieces[0])).pieces[0];

test('a tilted piece moves on the device only: no claim, move or drop, and it never locks on its spot',async()=>{
 const {board,events,store}=await windBoard(),piece=looseTilted(board),room={...groupOf(board,piece)};
 dragTo(board,piece,2,-1);await turn();
 assert.deepEqual(events,[],'nothing reaches the room');const group=groupOf(board,piece);
 assert.equal(group.locked,false);assert.ok(Math.hypot(group.dx-2,group.dy+1)<1e-6,'drawn where it was let go');
 // The room's next state still has it at its old offset: the board keeps drawing it where the player put it.
 const next=structuredClone(board.state);next.groups.find(g=>g.id===group.id).dx=room.dx;next.groups.find(g=>g.id===group.id).dy=room.dy;
 board.syncRemote(next,{},new Set());assert.ok(Math.hypot(groupOf(board,piece).dx-2,groupOf(board,piece).dy+1)<1e-6);
 const saved=readWindSave(store.get(windStorageKey(ROOM)));assert.ok(saved.rot.get(piece)>0);assert.deepEqual(saved.pos.get(group.id),{dx:2,dy:-1,bx:room.dx,by:room.dy});
 board.destroy();
});

test('the rotate button sits beside the selected piece; turning it upright drops it where it lies',async()=>{
 const {p,board,events}=await windBoard(),piece=looseTilted(board),q=board.rot.get(piece);
 dragTo(board,piece,3,2);board.draw(p.ctx);
 const b=board.rotateRect,c=screenOf(board,piece,3,2);assert.ok(b);assert.equal(b.r,ROTATE_BUTTON_R);
 const z=board.camera.z,w=board.board.width/board.state.cols,h=board.board.height/board.state.rows,half=(Math.max(w,h)/2+Math.min(w,h)*.27)*z;
 assert.ok(Math.abs(b.x-c.x)>=half+ROTATE_BUTTON_R,'the button does not cover the piece');
 assert.ok(b.x-b.r>=board.rect.x&&b.x+b.r<=board.rect.x+board.rect.w&&b.y-b.r>=board.rect.y,'inside the table');
 assert.ok(p.commands.some(([name,text])=>name==='fillText'&&text==='旋转'));
 for(let i=q;i<4;i++){pressRotate(board);board.draw(p.ctx);}
 assert.equal(board.rot.has(piece),false,'upright');assert.deepEqual(events,[],'the drop waits for the turn to finish');
 await wait(TURN_MS+80);await until(()=>events.some(e=>e[0]==='drop'));
 assert.deepEqual(events.map(e=>e[0]),['claim','drop']);assert.deepEqual(events[1].slice(1),[groupOf(board,piece).id,0,0],'the drop assist puts it on its spot');
 board.destroy();
});

test('Space turns the selected piece; a tap on empty table hides the button',async()=>{
 const {p,board}=await windBoard(),piece=looseTilted(board),q=board.rot.get(piece);
 dragTo(board,piece,40,40);
 assert.equal(board.input({type:'key',points:[],changed:[],key:' ',keyDown:true}),true);assert.equal(board.rot.get(piece)??0,(q+1)%4);
 board.draw(p.ctx);assert.ok(board.rotateRect);
 const empty={id:3,x:board.rect.x+board.rect.w-14,y:board.rect.y+board.rect.h-90};assert.equal(board.groupAt(empty),null);
 down(board,[empty]);up(board,[],[empty]);board.draw(p.ctx);assert.equal(board.rotateRect,null);
 assert.equal(board.input({type:'key',points:[],changed:[],key:' ',keyDown:true}),false,'nothing selected: Space is left alone');
 board.destroy();
});

test('tilts and kept positions come back with the room, and a finished room forgets them',async()=>{
 const store=storage(),first=await windBoard({store}),piece=looseTilted(first.board),state=structuredClone(first.board.state);
 dragTo(first.board,piece,5,5);const q=first.board.rot.get(piece),room=first.board.roomOffsets.get(groupOf(first.board,piece).id);first.board.destroy();
 const back=structuredClone(state);back.groups.find(g=>g.pieces.includes(piece)).dx=room.dx;back.groups.find(g=>g.pieces.includes(piece)).dy=room.dy;
 const second=await windBoard({store,state:back});
 assert.equal(second.board.rot.get(piece),q);const g=groupOf(second.board,piece);assert.ok(Math.hypot(g.dx-5,g.dy-5)<1e-6,'drawn where it was left');
 const done=structuredClone(second.board.state);for(const group of done.groups){group.dx=0;group.dy=0;group.locked=true;}
 second.board.syncRemote(done,{},new Set());assert.equal(store.get(windStorageKey(ROOM)),null);assert.equal(second.board.rot.size,0);
 second.board.destroy();
});

test('a hinted piece lying tilted turns upright first; another player joining turns every piece upright',async()=>{
 const {board,events}=await windBoard(),piece=looseTilted(board);
 board.setHints([piece],Date.now()+30000,'grant-1');assert.equal(board.rot.has(piece),false);
 await wait(TURN_MS+80);await until(()=>events.some(e=>e[0]==='drop'&&e[1]===groupOf(board,piece).id));
 const other=looseTilted(board);dragTo(board,other,6,6);board.suspendVariant();
 assert.equal(board.variantKind,null);assert.equal(board.rot.size,0);
 await until(()=>events.some(e=>e[0]==='drop'&&e[1]===groupOf(board,other).id),'the kept piece is dropped for the room');
 board.destroy();
});

// The real RoomClient against the room engine: solo local play (batch replay on the server) and shared-room drags.
const playerId='b'.repeat(32),token='c'.repeat(32);let serial=100;const randomId=()=>(++serial).toString(16).padStart(32,'0');
function roomFixture(solo){
 const image=PHOTO_IDS.find(id=>supportsPieceCount(id,108)),room=makeRoom(ROOM,image,108,Date.now());room.puzzle=createPuzzle('seaside',12,9,123);
 const member=addMember(room,playerId,'玩家','digest',Date.now()),ticket={token,playerId,room:snapshot(room,Date.now())},requests=[],store=storage();
 const fetch=async(url,init)=>{const action=init?.body?JSON.parse(init.body):null;requests.push(action);
  if(action?.type==='batch'){for(const op of action.ops){applyAction(room,member,{type:'claim',groupId:op.groupId},Date.now());applyAction(room,member,{type:'drop',groupId:op.groupId,dx:op.dx,dy:op.dy,seq:1},Date.now());}room.revision++;return Response.json({...snapshot(room,Date.now()),soloBatch:{applied:action.ops.map(op=>op.requestId),skipped:[],stopped:null},mobileContributions:[]});}
  if(action&&action.type!=='leave'){applyAction(room,member,action,Date.now());room.revision++;}return Response.json(snapshot(room,Date.now()));};
 return {room,ticket,requests,store,deps:{fetch,storage:store,...(solo?{solo:{enabled:()=>true,storage:store,energy:()=>null}}:{})}};
}
async function attach(t,f){
 const p=platform({store:f.store}),board=new PuzzleBoard(p,structuredClone(f.ticket.room.puzzle),()=>{});board.setRect({x:0,y:60,w:390,h:760});
 board.setVariant({kind:'wind',share:1,roomId:ROOM});await board.setImage('test.png');
 const client=new RoomClient(f.ticket,{randomId,emit(){},hidden:()=>false,now:()=>Date.now(),performanceNow:()=>Date.now(),...f.deps});
 const detach=client.attach(board);t.after(()=>{detach();board.destroy();});board.networkReady=true;await until(()=>!client.polling);board.draw(p.ctx);return {p,board,client};
}
const roomGroup=(f,piece)=>f.room.puzzle.groups.find(g=>g.pieces.includes(piece));

test('solo local play: a tilted piece let go on its spot sends nothing and stays loose; upright it locks and the batch replays it',async t=>{
 const f=roomFixture(true),{p,board,client}=await attach(t,f);assert.equal(client.localPlay,true);
 const piece=looseTilted(board),sent=f.requests.length;
 dragTo(board,piece,1,1);await wait(50);
 assert.equal(client.pendingSoloOps,0,'no solo op for a tilted piece');assert.equal(groupOf(board,piece).locked,false);
 assert.equal(f.requests.slice(sent).filter(a=>a&&!['heartbeat'].includes(a.type)).length,0);
 board.draw(p.ctx);while(board.rot.has(piece)){pressRotate(board);board.draw(p.ctx);}
 await wait(TURN_MS+60);await until(()=>groupOf(board,piece).locked,'locks once upright');
 assert.ok(client.pendingSoloOps>=1||roomGroup(f,piece).locked);client.flushSoloNow();
 await until(()=>roomGroup(f,piece).locked,'the server batch replays the lock');
});

test('solo local play: a neighbour aligned to a tilted piece is never joined to it, here or in the batch replay',async t=>{
 const f=roomFixture(true),{board,client}=await attach(t,f),cols=board.state.cols;
 // The tilted piece T keeps its scattered room offset; its right-hand neighbour N is upright.
 const T=board.state.groups.find(g=>g.pieces.length===1&&board.rot.get(g.pieces[0])&&g.pieces[0]%cols<cols-1).pieces[0],N=T+1,tGroup=groupOf(board,T);
 board.rot.delete(N);const offset={dx:tGroup.dx,dy:tGroup.dy};
 dragTo(board,N,offset.dx+2,offset.dy-1);await wait(30);
 assert.equal(groupOf(board,T).pieces.length,1,'not joined on the device');assert.equal(groupOf(board,N).pieces.length,1);
 const n=groupOf(board,N);assert.ok(Math.hypot(n.dx-offset.dx,n.dy-offset.dy)>snapTolerance(board.state),'moved just out of reach');
 client.flushSoloNow();await until(()=>client.pendingSoloOps===0);
 assert.equal(roomGroup(f,T).pieces.length,1,'not joined by the server replay');assert.equal(roomGroup(f,T).locked,false);
});

test('a shared-room drag of a tilted piece sends no claim, move or drop',async t=>{
 const f=roomFixture(false),{board,client}=await attach(t,f);assert.equal(client.localPlay,false);
 const piece=looseTilted(board),sent=f.requests.length;dragTo(board,piece,0,0);await wait(80);
 assert.equal(f.requests.slice(sent).filter(a=>a&&['claim','move','drop'].includes(a.type)).length,0);
 assert.equal(roomGroup(f,piece).locked,false);assert.equal(groupOf(board,piece).locked,false);
});

test('fade: loose pieces draw from the grey atlas, a joined piece fades back to colour, and old canvases play in colour',async()=>{
 const p=platform({pixels:true}),state=createFittedPuzzle('test',4,3,123),board=new PuzzleBoard(p,state,()=>{});
 board.setRect({x:0,y:60,w:390,h:700});board.setVariant({kind:'fade'});await board.setImage('test.png');
 assert.ok(board.grayAtlas,'grey atlas built');assert.ok(p.commands.some(c=>c[0]==='putImageData'));
 const g=board.state.groups[0];assert.equal(board.fadeOf(g,g.pieces[0],Date.now()),1);
 const next=structuredClone(board.state),a=next.groups.find(x=>x.id===0),b=next.groups.find(x=>x.id===1);a.pieces.push(...b.pieces);b.pieces=[];next.groups=next.groups.filter(x=>x.pieces.length);
 board.syncRemote(next,{},new Set());const now=Date.now(),joined=board.state.groups.find(x=>x.id===0);
 assert.ok(board.colorAt.has(0)&&board.colorAt.has(1));const mid=board.fadeOf(joined,1,now+FADE_IN_MS/2);assert.ok(mid>0&&mid<1,'half way back');
 assert.equal(board.fadeOf(joined,1,now+FADE_IN_MS+5),0,'in colour');board.destroy();
 const plain=platform(),old=new PuzzleBoard(plain,createFittedPuzzle('test',4,3,123),()=>{});old.setRect({x:0,y:60,w:390,h:700});old.setVariant({kind:'fade'});await old.setImage('test.png');
 assert.equal(old.grayAtlas,null);assert.equal(old.fadeOf(old.state.groups[0],0,Date.now()),0,'no pixel access: in colour');old.destroy();
});

test('the levels configuration passes an optional variant through and refuses unknown ones',()=>{
 const base=readLevelConfiguration(),doc=structuredClone(base);doc.chapters[1].story[2]={...doc.chapters[1].story[2],variant:'wind'};
 assert.equal(readLevelConfiguration(doc).chapters[1].story[2].variant,'wind');
 doc.chapters[1].story[2].variant='night';assert.throws(()=>readLevelConfiguration(doc));
});
