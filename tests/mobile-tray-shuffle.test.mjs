import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,trayHash} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

// Players placed tray pieces one after another because the tray listed them in solved order (11-03).
function platform(){
 const ctx=new Proxy({isPointInPath:()=>true,measureText:text=>({width:text.length*8})},{get:(target,name)=>name in target?target[name]:()=>{},set:(target,name,value)=>{target[name]=value;return true;}});
 const canvas=()=>({width:1,height:1,getContext:()=>ctx});
 return {ctx,canvas:canvas(),createCanvas:canvas,createImage:()=>({naturalWidth:800,naturalHeight:600,set src(value){queueMicrotask(()=>this.onload());}}),onHide:()=>()=>{},onShow:()=>()=>{},frame:()=>1,cancelFrame(){},config:{id:'taptap'}};
}
const ROOM_A='a'.repeat(32),ROOM_B='b'.repeat(32);
async function board({cols=12,rows=9,seed=123,key=ROOM_A,state}={}){
 const p=platform(),b=new PuzzleBoard(p,state??createFittedPuzzle('test',cols,rows,seed),()=>{});b.trayKey=key;
 b.setRect({x:0,y:77,w:390,h:767});await b.setImage('test.png');b.trayOpen=true;b.draw(p.ctx);return b;
}
const minOf=group=>Math.min(...group.pieces);
const order=b=>b.trayLayout().groups.map(minOf);
/** Share of consecutive tray entries that are neighbours on the picture. */
function neighbourRatio(ids,cols){let n=0;for(let i=1;i<ids.length;i++){const a=ids[i-1],b=ids[i],d=Math.abs(a-b);if(d===cols||d===1&&Math.floor(a/cols)===Math.floor(b/cols))n++;}return n/(ids.length-1);}
const clone=state=>({...state,groups:state.groups.map(g=>({...g,pieces:[...g.pieces]}))});
const tap=(b,rect)=>{const v=b.trayLayout(),p={id:9,x:v.r.x+rect.x+rect.w/2,y:v.r.y+rect.y+rect.h/2};b.input({type:'down',points:[p],changed:[p]});b.input({type:'up',points:[],changed:[p]});};

test('the tray is not in solved order on 108 and 500 pieces',async()=>{
 for(const [cols,rows]of [[12,9],[25,20]]){
  const b=await board({cols,rows}),ids=order(b),solved=[...ids].sort((x,y)=>x-y);
  assert.equal(ids.length,cols*rows);assert.notDeepEqual(ids,solved);
  assert.ok(neighbourRatio(solved,cols)>.9,'solved order is almost all neighbours');
  assert.ok(neighbourRatio(ids,cols)<.06,`neighbours follow each other ${neighbourRatio(ids,cols).toFixed(3)} of the time`);
  // The first page must not be a corner or a row of the picture either.
  const first=ids.slice(0,b.trayLayout().pageSize);assert.ok(new Set(first.map(id=>Math.floor(id/cols))).size>=Math.min(rows,6),'the first page spans many rows');
  b.destroy();
 }
});

test('the order is the same for the same room every time and differs between rooms',async()=>{
 const state=createFittedPuzzle('test',12,9,123),a1=await board({state:clone(state)}),a2=await board({state:clone(state)}),b=await board({state:clone(state),key:ROOM_B});
 assert.deepEqual(order(a1),order(a2),'a reopened tray (or a reconnect) shows the same order');
 assert.deepEqual(order(a1),order(a1),'and drawing again does not reshuffle');
 const x=order(a1),y=order(b);assert.notDeepEqual(x,y);
 let same=0;for(let i=0;i<x.length;i++)if(x[i]===y[i])same++;assert.ok(same<10,'two rooms share few positions');
 const seedOnly=await board({state:clone(state),key:''}),otherSeed=await board({state:createFittedPuzzle('test',12,9,456),key:''});
 assert.notDeepEqual(order(seedOnly),order(otherSeed),'without a room id the puzzle seed still separates rooms');
 assert.equal(trayHash('abc'),trayHash('abc'));assert.notEqual(trayHash('abc|1'),trayHash('abc|2'));
 for(const b2 of [a1,a2,b,seedOnly,otherSeed])b2.destroy();
});

test('placing or merging groups never moves the others, and a merged group takes its smallest piece’s place',async()=>{
 const b=await board(),before=order(b),placed=b.state.groups.find(g=>minOf(g)===before[7]);
 const next=clone(b.state);next.groups.find(g=>g.id===placed.id).locked=true;b.syncRemote(next,{},new Set(),false);
 assert.deepEqual(order(b),before.filter(id=>id!==before[7]),'only the placed group leaves');
 // Merge the groups holding pieces 0 and 1: the merged group sorts as piece 0 did.
 const now=order(b),g0=b.state.groups.find(g=>g.pieces.includes(0)),g1=b.state.groups.find(g=>g.pieces.includes(1)),merged=clone(b.state);
 merged.groups=merged.groups.filter(g=>g.id!==g1.id);merged.groups.find(g=>g.id===g0.id).pieces.push(...g1.pieces);b.syncRemote(merged,{},new Set(),false);
 assert.deepEqual(order(b),now.filter(id=>id!==minOf(g1)),'the merged group stays where piece 0 was');
 b.destroy();
});

test('the page the player is on keeps its pieces when groups before it are placed, and paging still covers every group once',async()=>{
 const b=await board(),v=b.trayLayout();
 tap(b,v.next);tap(b,v.next);assert.equal(b.trayPage,2);
 const page=()=>{const w=b.trayLayout();return w.groups.slice(w.start,w.start+w.pageSize).map(minOf);},shown=page();
 const next=clone(b.state),gone=order(b).slice(0,3);for(const g of next.groups)if(gone.includes(minOf(g)))g.locked=true;b.syncRemote(next,{},new Set(),false);
 assert.deepEqual(page(),shown,'same pieces on the page after three earlier groups were placed');
 const label=b.trayLayout();assert.equal(label.page,Math.ceil(label.start/label.pageSize));
 // Placing the page's own first group lets the next one move up; nothing jumps to another page.
 const first=shown[0],again=clone(b.state);again.groups.find(g=>minOf(g)===first).locked=true;b.syncRemote(again,{},new Set(),false);
 assert.deepEqual(page().slice(0,shown.length-1),shown.slice(1));
 // From the first page, the arrows visit every group exactly once.
 b.trayPage=0;const seen=[];for(let i=0;i<40;i++){seen.push(...page());const w=b.trayLayout();if(w.page>=w.pages-1)break;tap(b,w.next);}
 assert.deepEqual([...seen].sort((x,y)=>x-y),[...order(b)].sort((x,y)=>x-y));assert.equal(new Set(seen).size,seen.length);
 b.destroy();
});
