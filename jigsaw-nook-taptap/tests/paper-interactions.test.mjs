import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPhoto,reelDestination,surpriseIndex,paperPause } from '../lib/paper-interactions.ts';

test('reel settles at whole frames and caps a fling at three extra images in either direction',()=>{
 assert.equal(reelDestination(1.2,0),1);
 assert.equal(reelDestination(1.2,100),4);
 assert.equal(reelDestination(-1.2,-100),-4);
 assert.equal(wrapPhoto(-1,4),3);
 assert.equal(wrapPhoto(8,4),0);
 assert.equal(wrapPhoto(3,1),0);
 assert.equal(wrapPhoto(3,0),0);
});
test('surprise choices remain inside the filtered pool and avoid the previous image when possible',()=>{
 assert.equal(surpriseIndex(0,-1),0);
 assert.equal(surpriseIndex(1,0),0);
 for(let length=2;length<=12;length++)for(let previous=-1;previous<length;previous++){
  const seen=new Set();
  for(let step=0;step<=200;step++){
   const choice=surpriseIndex(length,previous,step/200);
   assert.ok(choice>=0&&choice<length);
   if(previous>=0)assert.notEqual(choice,previous);
   seen.add(choice);
  }
  assert.equal(seen.size,length-(previous>=0?1:0));
 }
});
test('leaving during a paper transition cancels before real puzzle or room creation',async()=>{
 const controller=new AbortController();let started=false;
 const waiting=paperPause(1000,controller.signal).then(()=>{started=true;});
 controller.abort();
 await assert.rejects(waiting,{name:'AbortError'});assert.equal(started,false);
 await assert.rejects(paperPause(0,controller.signal),{name:'AbortError'});
});
test('a completed transition allows the start and removes its abort listener',async()=>{
 const controller=new AbortController();await paperPause(0,controller.signal);controller.abort();
});
