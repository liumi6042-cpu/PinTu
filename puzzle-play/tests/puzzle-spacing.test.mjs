import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzle,createFittedPuzzle,boardFor,worldFor,WORLD,restorePuzzle,shuffleLoose} from '../lib/puzzle-engine.ts';
import {expandCreatedTicket} from '../lib/room-creation.ts';
import {PHOTOS} from '../lib/puzzle-catalog.ts';
import {photoGuidance} from '../lib/play-guidance.ts';
import {gridForDimensions} from '../lib/piece-policy.ts';
import {cursorInput,cursorWorld} from '../lib/room-cursors.ts';

test('new fixed and published fitted grids leave a clear gap between full tab footprints',()=>{
 const grids=new Map([["4x3",[4,3]],["12x9",[12,9]],["20x15",[20,15]],["25x20",[25,20]],["40x25",[40,25]]]);
 for(const photo of PHOTOS){const dimensions=photoGuidance(photo.id);if(!dimensions)continue;
  for(const count of [108,300,500,1000]){const grid=gridForDimensions(dimensions.width,dimensions.height,count);if(grid)grids.set(`${grid.cols}x${grid.rows}`,[grid.cols,grid.rows]);}
 }
 for(const [cols,rows] of grids.values()){
  const puzzle=createFittedPuzzle('spacing',cols,rows,42),board=boardFor(cols,rows),world=worldFor(puzzle),unit=board.width/cols;
  const boxes=puzzle.groups.map(g=>{const id=g.pieces[0],x=board.x+(id%cols)*unit+g.dx,y=board.y+Math.floor(id/cols)*unit+g.dy;
   const box={x:x-unit*.23,y:y-unit*.23,width:unit*1.46,height:unit*1.46};
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=world.width&&box.y+box.height<=world.height);
   assert.ok(box.x+box.width<board.x||box.x>board.x+board.width||box.y+box.height<board.y||box.y>board.y+board.height);
   return box;
  }).sort((a,b)=>a.y-b.y);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length&&boxes[j].y<boxes[i].y+unit*1.52;j++){
   const a=boxes[i],b=boxes[j];
   assert.ok(a.x+a.width+unit*.1<b.x||b.x+b.width+unit*.1<a.x||a.y+a.height+unit*.1<b.y,`overlap/gap at ${cols}x${rows}`);
  }
 }
});

test('old room layouts and seed-v1 retain their exact positions and original table bounds',()=>{
 const old=createPuzzle('legacy',12,9,137,1),before=structuredClone(old);
 assert.equal(old.scatterVersion,undefined);assert.deepEqual(worldFor(old),WORLD);
 assert.deepEqual(restorePuzzle(JSON.stringify(old),['legacy']),before);
 const {groups:_groups,...seed}=old;
 const metadata={id:'a'.repeat(32),revision:0};
 const ticket={token:'b'.repeat(32),playerId:'c'.repeat(32),initialState:'seed-v1',room:{...metadata,puzzle:seed}};
 assert.deepEqual(expandCreatedTicket(ticket).room.puzzle,old);
 shuffleLoose(old,138);assert.deepEqual(worldFor(old),WORLD);
 assert.deepEqual(old.groups,createPuzzle('legacy',12,9,138,1).groups);
});

test('spacious table cursor coordinates remain valid beyond legacy table edges',()=>{
 const world=worldFor({scatterVersion:2}),point={x:1800,y:1300},input={clientId:'a'.repeat(32),seq:1,point};
 assert.deepEqual(cursorInput(input,world),input);assert.equal(cursorInput(input),null);
 assert.deepEqual(cursorWorld(point,{left:0,top:0,width:1900,height:1420},{x:0,y:0,z:1},world),point);
});
