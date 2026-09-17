import test from 'node:test';
import assert from 'node:assert/strict';
import {DragImage,DRAG_IMAGE_PIXELS} from '../lib/drag-image.ts';
import {createPuzzle,piecesFor,boardFor} from '../lib/puzzle-engine.ts';

test('drag cache is stable across long movement and bounded at extreme zoom',()=>{
 const previous=globalThis.document,allocated=[],copies=[];
 globalThis.document={createElement:()=>{const image={width:0,height:0,getContext:()=>({scale(){},translate(){}})};allocated.push(image);return image;}};
 try{
  const cache=new DragImage(),state=createPuzzle('test',12,9,91),pieces=piecesFor(12,9,91),board=boardFor(12,9),group=state.groups[0],c={drawImage(...args){copies.push(args);}};let paints=0;
  // The compositor takes the whole carried selection so a multi-group drag stays a
  // single bitmap. A one-element array is the old single-group behaviour.
  const draw=(scale=2)=>cache.draw(c,[group],pieces,board.width/12,board.height/9,scale,40,'normal',()=>paints++);
  assert.ok(draw());const pixels=allocated[0].width*allocated[0].height;assert.ok(pixels<=DRAG_IMAGE_PIXELS);
  // The bitmap is anchored on the selection's own bounding box and the compositor
  // reports how far it drifted, so 10,800 frames of movement still rasterize once.
  for(let i=0;i<10800;i++){group.dx+=.01;group.dy-=.02;assert.ok(draw());}
  assert.equal(paints,1);assert.equal(allocated.length,1);assert.equal(copies.length,10801);
  // The draw position must track the accumulated drift (108 right, 216 up) — the
  // floating overlay follows the pointer. An earlier bug compared the live layout
  // string to the live group positions, which are always equal, so the drift was
  // always zero and a dragged selection stayed frozen at its first position.
  // drawImage args are [image, x, y, w, h], so the position lives at [1] and [2].
  const [firstX,firstY]=[copies[0][1],copies[0][2]],[lastX,lastY]=[copies.at(-1)[1],copies.at(-1)[2]];
  assert.ok(Math.abs(lastX-(firstX+108))<1e-6,`draw x follows the drift: ${lastX} vs ${firstX+108}`);
  assert.ok(Math.abs(lastY-(firstY-216))<1e-6,`draw y follows the drift: ${lastY} vs ${firstY-216}`);
  assert.equal(draw(100),false);assert.equal(allocated.length,1,'oversized textures are not allocated');assert.equal(allocated[0].width,0);
  assert.ok(draw(3));cache.clear();assert.ok(allocated.every(image=>image.width===0&&image.height===0));
 }finally{globalThis.document=previous;}
});
