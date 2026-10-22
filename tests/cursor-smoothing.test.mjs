import test from 'node:test';
import assert from 'node:assert/strict';
import {PuzzleBoard,CURSOR_SMOOTHING_MS} from '../mobile/puzzle-board.ts';
import {createFittedPuzzle} from '../lib/puzzle-engine.ts';

function fixture(t){
 let clock=100000,frameId=0,invalidations=0;const frames=new Map(),hide=new Set(),show=new Set();t.mock.method(Date,'now',()=>clock);
 const ctx=new Proxy({isPointInPath:()=>true},{get:(target,key)=>key in target?target[key]:()=>{}}),platform={config:{id:'wechat'},createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),onHide:fn=>(hide.add(fn),()=>hide.delete(fn)),onShow:fn=>(show.add(fn),()=>show.delete(fn)),frame:fn=>(frames.set(++frameId,fn),frameId),cancelFrame:id=>frames.delete(id)};
 const board=new PuzzleBoard(platform,createFittedPuzzle('cursor',4,3,123),()=>invalidations++);t.after(()=>board.destroy());
 const cursor=(x,updatedAt=clock)=>({playerId:'friend',x,y:0,name:'朋友',color:'#abc',updatedAt});
 return{board,frames,cursor,invalidations:()=>invalidations,entry:()=>board.cursors.get('friend'),tick(ms){clock+=ms;const [id,fn]=frames.entries().next().value;frames.delete(id);fn(clock-100000);},hide(){for(const fn of hide)fn();},show(){for(const fn of show)fn({});},advance(ms){clock+=ms;}};
}

test('cursor step response matches the same 50 ms exponential curve at 30, 60 and 120 Hz',t=>{
 assert.equal(CURSOR_SMOOTHING_MS,50);const curves=[];
 for(const hz of [30,60,120]){
  const f=fixture(t);f.board.setCursors([f.cursor(0)]);f.board.setCursors([f.cursor(100)]);
  let previous=0;const samples={};for(let i=1;i<=hz/2;i++){if(!f.frames.size)break;f.tick(1000/hz);const value=f.entry().x;assert.ok(value>=previous&&value<=100,'no overshoot or extrapolation');previous=value;if(i===hz/10)samples.at100ms=value;if(i===hz*.15)samples.at150ms=value;if(i===hz*.3)samples.at300ms=value;}
  assert.ok(Math.abs(samples.at100ms-100*(1-Math.exp(-2)))<1e-8);assert.equal(f.entry().x,100);assert.equal(f.frames.size,0,'final exact target stops RAF');
  const idle=f.invalidations();f.board.setCursors([f.cursor(100,Date.now()+1000)]);assert.equal(f.invalidations(),idle,'timestamp-only packets stay idle');f.board.setCursors([f.cursor(100.05)]);assert.equal(f.entry().x,100.05,'subthreshold motion reaches its exact latest target');assert.equal(f.frames.size,0);curves.push(samples.at100ms);f.board.destroy();
 }
 assert.ok(Math.max(...curves)-Math.min(...curves)<1e-8);
});

test('reversal never predicts beyond the latest target, hide pauses time, and final frame clears',t=>{
 const f=fixture(t);f.board.setCursors([f.cursor(0)]);f.board.setCursors([f.cursor(100)]);f.tick(50);const before=f.entry().x;assert.ok(Math.abs(before-63.212055882855765)<1e-8);
 f.hide();assert.equal(f.frames.size,0);f.advance(60000);f.board.setCursors([f.cursor(0)]);assert.equal(f.entry().x,before);assert.equal(f.frames.size,0);
 f.show();f.tick(20);assert.ok(Math.abs(f.entry().x-before*Math.exp(-.4))<1e-8,'hidden minute is excluded');let previous=f.entry().x,lastInvalidation=0;
 while(f.frames.size){lastInvalidation=f.invalidations();f.tick(20);const value=f.entry().x;assert.ok(value<=previous&&value>=0);previous=value;}
 assert.equal(f.entry().x,0);assert.equal(f.invalidations(),lastInvalidation+1,'settled target is repainted once');const idle=f.invalidations();f.board.setCursors([f.cursor(0)]);assert.equal(f.frames.size,0);assert.equal(f.invalidations(),idle);
 f.advance(600000);assert.equal(f.entry().x,0,'no expiry removes a retained room member');f.board.setCursors([]);assert.equal(f.board.cursors.size,0,'authoritative leave removes it');
});
