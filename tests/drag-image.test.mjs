import test from 'node:test';
import assert from 'node:assert/strict';
import {DragImage,DRAG_IMAGE_PIXELS} from '../lib/drag-image.ts';
import {createPuzzle,piecesFor,boardFor} from '../lib/puzzle-engine.ts';

test('drag cache is stable across long movement and bounded at extreme zoom',()=>{
 const previous=globalThis.document,allocated=[],copies=[];
 globalThis.document={createElement:()=>{const image={width:0,height:0,getContext:()=>({scale(){},translate(){}})};allocated.push(image);return image;}};
 try{
  const cache=new DragImage(),state=createPuzzle('test',12,9,91),pieces=piecesFor(12,9,91),board=boardFor(12,9),group=state.groups[0],c={drawImage(...args){copies.push(args);}};let paints=0;
  const draw=(scale=2)=>cache.draw(c,group,pieces,board.width/12,board.height/9,board,scale,40,'normal',()=>paints++);
  assert.ok(draw());const pixels=allocated[0].width*allocated[0].height;assert.ok(pixels<=DRAG_IMAGE_PIXELS);
  for(let i=0;i<10800;i++){group.dx+=.01;group.dy-=.02;assert.ok(draw());}
  assert.equal(paints,1);assert.equal(allocated.length,1);assert.equal(copies.length,10801);
  assert.ok(Math.abs(copies.at(-1)[1]-copies[0][1]-108)<.00001);assert.ok(Math.abs(copies.at(-1)[2]-copies[0][2]+216)<.00001);
  assert.equal(draw(100),false);assert.equal(allocated.length,1,'oversized textures are not allocated');assert.equal(allocated[0].width,0);
  assert.ok(draw(3));cache.clear();assert.ok(allocated.every(image=>image.width===0&&image.height===0));
 }finally{globalThis.document=previous;}
});
