import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFor, LEVELS, BOARD, createPuzzle, restorePuzzle, normalizePuzzle, placedCount, piecesFor } from '../lib/puzzle-engine.ts';
import { pictureCrop, drawPiecePicture } from '../lib/puzzle-picture.ts';

test('every level has square piece bodies, with exactly 2000 pieces in a 5:4 frame',()=>{
  for(const {count,cols,rows} of LEVELS){
    const board=boardFor(cols,rows);
    assert.equal(cols*rows,count);assert.ok(Math.abs(board.width/cols-board.height/rows)<1e-10);
    assert.ok(board.width<=BOARD.width&&board.height<=BOARD.height);
    assert.equal(board.x+board.width/2,760);assert.equal(board.y+board.height/2,560);
  }
  const level=LEVELS.find(l=>l.count===2000),board=boardFor(level.cols,level.rows);
  assert.equal(level.cols*level.rows,2000);assert.equal(board.width/board.height,5/4);
});

test('legacy progress migrates once without losing group membership, locks or time',()=>{
  const legacy={version:1,imageId:'seaside',cols:100,rows:50,seed:91,elapsed:173,groups:Array.from({length:5000},(_,id)=>({id,pieces:[id],dx:100,dy:150,locked:false}))};
  legacy.groups[0].locked=true;legacy.groups[0].dx=0;legacy.groups[0].dy=0;
  legacy.groups[1].pieces.push(2);legacy.groups.splice(2,1);legacy.groups[1].dx=150;legacy.groups[1].dy=225;
  const restored=restorePuzzle(JSON.stringify(legacy),['seaside']);assert.ok(restored);
  assert.equal(restored.layout,'square');assert.equal(restored.elapsed,173);assert.equal(restored.seed,91);
  assert.equal(placedCount(restored),1);assert.deepEqual(restored.groups[0],legacy.groups[0]);
  assert.deepEqual(restored.groups[1].pieces,[1,2]);assert.equal(restored.groups[1].dx,150);assert.equal(restored.groups[1].dy,150);
  assert.equal(new Set(restored.groups.flatMap(g=>g.pieces)).size,5000);
  const saved=JSON.stringify(restored);normalizePuzzle(restored);assert.equal(JSON.stringify(restored),saved);
  assert.deepEqual(restorePuzzle(saved,['seaside']),restored);
});

test('source crop preserves image proportions at every level and uses native resolution',()=>{
  for(const {cols,rows} of LEVELS){
    const board=boardFor(cols,rows),crop=pictureCrop(1448,1086,board.width,board.height);
    assert.ok(Math.abs(crop.width/board.width-crop.height/board.height)<1e-10);
    assert.ok(crop.x>=0&&crop.y>=0&&crop.x+crop.width<=1448&&crop.y+crop.height<=1086);
  }
  assert.deepEqual(pictureCrop(1448,1086,800,400),{x:0,y:181,width:1448,height:724});
  assert.deepEqual(pictureCrop(8000,6000,800,400),{x:0,y:1000,width:8000,height:4000});
});

test('zoomed sampling includes tabs and stays inside the native image at each corner',()=>{
  const picture={width:8000,height:4000},pieces=piecesFor(100,50,42),calls=[];
  const context={drawImage(...args){calls.push(args);}};
  for(const id of [0,99,4900,4999,2341])drawPiecePicture(context,picture,pieces[id],100,50,800,400);
  for(const [image,sx,sy,sw,sh,dx,dy,dw,dh] of calls){
    assert.equal(image,picture);assert.ok(sx>=0&&sy>=0&&sx+sw<=8000&&sy+sh<=4000);
    assert.ok(Math.abs(sw/dw-sh/dh)<1e-10);assert.ok(dw>=8&&dh>=8);
    assert.ok(dx<=0&&dy<=0);
  }
  assert.ok(calls.at(-1)[7]>8&&calls.at(-1)[8]>8,'an interior piece must include its protruding tabs');
});
