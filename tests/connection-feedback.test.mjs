import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle,dropGroup,piecesFor,boardFor,pathFor } from '../lib/puzzle-engine.ts';
import { newConnections,successfulDrop,connectionPath,CONNECTION_GLOW_MS } from '../lib/connection-feedback.ts';
import { cardboardSamples,soundPreferences,SnapSound,SOUND_MERGE_MS } from '../lib/snap-sound.ts';
import {ConnectionGlowRenderer} from '../lib/connection-glow.ts';

function joined(){const state=createPuzzle('test',12,9,91);state.groups[0].dx=100;state.groups[0].dy=100;state.groups[1].dx=102;state.groups[1].dy=100;const before=structuredClone(state.groups);dropGroup(state,0,4);return {state,before};}
test('only newly joined edges glow; wrong drops, arrangement, locked placement and repeats add no seams',()=>{
 const {state,before}=joined(),glows=newConnections(before,state);
 assert.deepEqual(glows,[{anchor:0,seams:[{pieceId:0,side:1}]}]);assert.equal(CONNECTION_GLOW_MS,300);
 assert.ok(successfulDrop(before[0],state,0));assert.equal(successfulDrop(before[2],state,2),false);
 assert.deepEqual(newConnections(state.groups,structuredClone(state)),[]);
 const moved=structuredClone(state);moved.groups[0].dx+=100;assert.deepEqual(newConnections(state.groups,moved),[]);
 const placed=structuredClone(state);placed.groups.find(g=>g.id===2).locked=true;assert.ok(successfulDrop(state.groups.find(g=>g.id===2),placed,2));assert.deepEqual(newConnections(state.groups,placed),[]);
 assert.equal(successfulDrop(undefined,state,0),false);
});
test('large merges stay bounded and shared-edge paths follow the existing tabs',()=>{
 const state=createPuzzle('test',50,40,72),before=structuredClone(state.groups);state.groups=[{id:0,pieces:before.flatMap(g=>g.pieces),dx:0,dy:0,locked:true}];
 const glows=newConnections(before,state);assert.equal(glows.length,1);assert.equal(glows[0].seams.length,32);
 const pieces=piecesFor(12,9,91),board=boardFor(12,9);
 for(const side of [1,2]){const edge=connectionPath(pieces[0],12,9,side);assert.ok(edge.startsWith(side===1?`M ${board.width/12} 0`:`M ${board.width/12} ${board.height/9}`));assert.ok(pathFor(pieces[0],12,9).includes(edge.slice(edge.indexOf(' L '))));}
});
test('sound preferences default to mute and sanitize persisted values',()=>{
 for(const raw of [null,'broken','null','{"enabled":true,"volume":"1"}'])assert.deepEqual(soundPreferences(raw),{enabled:false,volume:.25});
 assert.deepEqual(soundPreferences('{"enabled":true,"volume":0.37}'),{enabled:true,volume:.37});
 assert.equal(soundPreferences('{"enabled":true,"volume":4}').volume,1);assert.equal(soundPreferences('{"enabled":false,"volume":-3}').volume,0);
});
test('glows paint once, follow the camera without repainting, and release all timers and canvases',()=>{
 const keys=['window','document','devicePixelRatio','Path2D','setTimeout','clearTimeout'],saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),nodes=[],timers=new Map();let serial=0,strokes=0,listeners=0;
 const context={scale(){},translate(){},save(){},restore(){},stroke(){strokes++;}};
 globalThis.devicePixelRatio=2;globalThis.Path2D=class{};
 globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,300);timers.set(++serial,fn);return serial;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.window={matchMedia:()=>({matches:false,addEventListener(){listeners++;},removeEventListener(){listeners--;}})};
 globalThis.document={hidden:false,addEventListener(){listeners++;},removeEventListener(){listeners--;},createElement:()=>({style:{},setAttribute(){},getContext:()=>context,remove(){nodes.splice(nodes.indexOf(this),1);}})};
 try{const {state,before}=joined(),camera={x:10,y:20,z:1},renderer=new ConnectionGlowRenderer({appendChild:c=>nodes.push(c)},state,piecesFor(12,9,91),()=>camera),glow=newConnections(before,state)[0];
  renderer.show([glow,glow,glow,glow]);assert.equal(nodes.length,3);assert.equal(timers.size,3);assert.ok(nodes.every(c=>Math.max(c.width,c.height)<=769));const painted=strokes,position=nodes[0].style.transform;
  camera.x+=120;renderer.update();assert.notEqual(nodes[0].style.transform,position);assert.equal(strokes,painted,'movement never repaints stamps or the puzzle');
  for(const finish of [...timers.values()])finish();assert.equal(nodes.length,0);assert.equal(timers.size,0);
  renderer.show([glow]);renderer.destroy();assert.equal(nodes.length,0);assert.equal(timers.size,0);assert.equal(listeners,0);
 }finally{for(const key of keys){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}}
});
test('four original dry clicks have a bounded short envelope with no ringing tail',()=>{
 const variants=[];
 for(let i=0;i<4;i++){const data=cardboardSamples(48000,i);assert.ok(data.length>=3600&&data.length<=4100);assert.equal(data[0],0);assert.equal(Math.abs(data.at(-1)),0);assert.ok(data.every(Number.isFinite));assert.ok(Math.max(...data.map(Math.abs))<.65);const energy=(samples)=>samples.reduce((sum,n)=>sum+n*n,0);assert.ok(energy(data.slice(-480))<energy(data.slice(0,480))*.001);variants.push([...data.slice(0,200)]);}
 assert.notDeepEqual(variants[0],variants[1]);assert.notDeepEqual(variants[1],variants[2]);assert.notDeepEqual(variants[2],variants[3]);
});
test('rapid successes merge to one voice, mute stops it, and disposal frees audio resources',async()=>{
 const saved={document:globalThis.document,AudioContext:globalThis.AudioContext,performance:globalThis.performance};let clock=0,created=0,played=0,stopped=0,closed=0;
 globalThis.document={hidden:false};globalThis.performance={now:()=>clock};
 globalThis.AudioContext=class{state='running';sampleRate=48000;currentTime=0;destination={};constructor(){created++;}createGain(){return {gain:{value:0,setValueAtTime(){}},connect(){},disconnect(){}};}createBuffer(_,n){return {getChannelData:()=>new Float32Array(n)};}createBufferSource(){return {connect(){},disconnect(){},start(){played++;},stop(){stopped++;},onended:null};}async resume(){}async close(){closed++;}};
 try{const sound=new SnapSound();await sound.play();assert.equal(created,0);sound.setPreferences({enabled:true,volume:.3});await Promise.all([sound.play(),sound.play(),sound.play()]);assert.equal(played,1);clock=SOUND_MERGE_MS+1;await sound.play();assert.equal(played,2);assert.equal(stopped,1,'a previous voice cannot overlap');sound.setPreferences({enabled:false,volume:.3});assert.equal(stopped,2);clock+=1000;await sound.play();assert.equal(played,2);sound.destroy();assert.equal(closed,1);await sound.play();assert.equal(played,2);}finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
