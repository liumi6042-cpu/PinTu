import test from 'node:test';
import assert from 'node:assert/strict';
import { createFittedPuzzle, shuffleLoose, moveGroup, dropGroup, boardFor, WORLD } from '../lib/puzzle-engine.ts';

// Big puzzles used to take random cells anywhere on the 1720x1280 table, so a
// 500-piece game put pieces in the far corners. New games and 整理 now fill the
// cells nearest the target frame first, without giving up the tab clearance.
const center=(state,g,id=g.pieces[0])=>{const b=boardFor(state.cols,state.rows),u=b.width/state.cols;return {x:b.x+(id%state.cols+.5)*u+g.dx,y:b.y+(Math.floor(id/state.cols)+.5)*u+g.dy};};
const gap=(b,p)=>Math.hypot(Math.max(b.x-p.x,0,p.x-b.x-b.width),Math.max(b.y-p.y,0,p.y-b.y-b.height));
const farthestCorner=b=>Math.max(...[[WORLD.x,WORLD.y],[WORLD.x+WORLD.width,WORLD.y],[WORLD.x,WORLD.y+WORLD.height],[WORLD.x+WORLD.width,WORLD.y+WORLD.height]].map(([x,y])=>gap(b,{x,y})));
const BIG=[[20,15],[25,20],[19,26],[22,14],[18,17],[26,19]];

test('big puzzles start in a ring around the target, never in the far corners',()=>{
 for(const [cols,rows] of BIG)for(const seed of [1,72,4242,987654321]){
  const s=createFittedPuzzle('seaside',cols,rows,seed),b=boardFor(cols,rows),u=b.width/cols,limit=farthestCorner(b);
  const gaps=s.groups.map(g=>gap(b,center(s,g)));
  assert.ok(Math.max(...gaps)<limit*.62,`${cols}x${rows} seed ${seed}: farthest piece ${Math.round(Math.max(...gaps))} of ${Math.round(limit)}`);
  // Nothing is left near the table corners.
  for(const g of s.groups){const p=center(s,g);for(const [x,y] of [[WORLD.x,WORLD.y],[WORLD.x+WORLD.width,WORLD.y],[WORLD.x,WORLD.y+WORLD.height],[WORLD.x+WORLD.width,WORLD.y+WORLD.height]])assert.ok(Math.hypot(p.x-x,p.y-y)>u*3,'corner stays clear');}
 }
});
test('the ring keeps the full-tab gap between every pair of pieces and clears the frame',()=>{
 for(const [cols,rows] of BIG){
  const s=createFittedPuzzle('seaside',cols,rows,72),b=boardFor(cols,rows),u=b.width/cols,half=u*.73,c=s.groups.map(g=>center(s,g));
  for(let i=0;i<c.length;i++){
   const a=c[i];
   assert.ok(a.x-half>WORLD.x&&a.x+half<WORLD.x+WORLD.width&&a.y-half>WORLD.y&&a.y+half<WORLD.y+WORLD.height,'tabs stay on the table');
   assert.ok(a.x+half<b.x-9||a.x-half>b.x+b.width+9||a.y+half<b.y-9||a.y-half>b.y+b.height+9,'tabs stay off the target frame');
   for(let j=0;j<i;j++)assert.ok(Math.max(Math.abs(a.x-c[j].x),Math.abs(a.y-c[j].y))-2*half>u*.025,'outlines never touch');
  }
  assert.deepEqual(createFittedPuzzle('seaside',cols,rows,72),s,'the same seed rebuilds the same table');
 }
});
test('整理 gathers loose pieces next to the target and steps around kept groups',()=>{
 const s=createFittedPuzzle('seaside',25,20,72),b=boardFor(25,20),u=b.width/25;
 // A combined group right next to the target, where the nearest cells are.
 moveGroup(s,0,-u*2.2,-u*2.2);moveGroup(s,1,-u*2.2,-u*2.2);assert.equal(dropGroup(s,0,u*.26).joined,1);
 // One piece someone is holding, also next to the target.
 const held=s.groups.find(g=>g.id===300);moveGroup(s,300,-u*2,0);
 // Every other loose piece pushed out to the table edge.
 for(const g of s.groups)if(g.pieces.length===1&&g.id!==300){g.dx=WORLD.x+WORLD.width-60-b.x-(g.id%25)*u;g.dy=WORLD.y+40-b.y-Math.floor(g.id/25)*u;}
 const kept=s.groups.find(g=>g.pieces.length===2),before={dx:kept.dx,dy:kept.dy,heldDx:held.dx,heldDy:held.dy};
 const moved=shuffleLoose(s,45,new Set([300]));
 assert.equal(moved,500-2-1);
 assert.deepEqual({dx:kept.dx,dy:kept.dy,heldDx:held.dx,heldDy:held.dy},before,'kept and held groups do not move');
 const stay=[...kept.pieces.map(id=>center(s,kept,id)),center(s,held)],limit=farthestCorner(b);
 for(const g of s.groups){if(g===kept||g===held)continue;const p=center(s,g);
  assert.ok(gap(b,p)<limit*.62,'loose pieces come back next to the target');
  for(const k of stay)assert.ok(Math.max(Math.abs(p.x-k.x),Math.abs(p.y-k.y))>u*1.46,'no loose piece lands on a kept group');
 }
 assert.equal(shuffleLoose(s,46,new Set(s.groups.map(g=>g.id))),0,'nothing to organize when every piece is held');
});
