import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {createFittedPuzzle,restorePuzzle,shuffleLoose,worldFor} from '../lib/puzzle-engine.ts';

const original=execFileSync('git',['show','9664450bea92d90cbda85ccb3f0ea3f883005ac4:lib/puzzle-engine.ts'],{encoding:'utf8'});
const legacy=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(original)).toString('base64'));

test('legacy v1/v2 seeds and saved positions remain unchanged',()=>{
 for(const version of [1,2])for(const [cols,rows] of [[4,3],[12,9],[20,15],[25,20],[40,25]]){
  const old=legacy.createFittedPuzzle('sample',cols,rows,731,version),now=createFittedPuzzle('sample',cols,rows,731,version);
  assert.deepEqual(now,old);now.groups[0].dx+=17;now.elapsed=80;
  assert.deepEqual(restorePuzzle(JSON.stringify(now),['sample']),now);
  shuffleLoose(now,127);legacy.shuffleLoose(old,127);assert.deepEqual(now.groups,old.groups);
 }
});
test('shared v3 has safe protruding-edge spacing, survives save and keeps its bounds',()=>{
 for(const [cols,rows] of [[4,3],[12,9],[18,6],[20,15],[25,20],[31,16]]){
  const state=createFittedPuzzle('sample',cols,rows,731,3),world=worldFor(state),board=legacy.boardFor(cols,rows),unit=board.width/cols;
  assert.deepEqual(world,{x:-100,y:-80,width:1720,height:1280});
  assert.deepEqual(restorePuzzle(JSON.stringify(state),['sample']),state);
  const centers=state.groups.map(g=>({x:board.x+(g.id%cols+.5)*unit+g.dx,y:board.y+(Math.floor(g.id/cols)+.5)*unit+g.dy}));
  for(let i=0;i<centers.length;i++){
   const a=centers[i];assert.ok(a.x-unit*.73>=world.x&&a.x+unit*.73<=world.x+world.width);assert.ok(a.y-unit*.73>=world.y&&a.y+unit*.73<=world.y+world.height);
   for(let j=0;j<i;j++)assert.ok(Math.abs(a.x-centers[j].x)>=unit*1.46||Math.abs(a.y-centers[j].y)>=unit*1.46);
  }
 }
});
