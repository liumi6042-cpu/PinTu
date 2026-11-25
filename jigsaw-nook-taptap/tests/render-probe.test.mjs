import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderProbe} from '../mobile/render-probe.ts';

test('four windows sample independent RAF, input and timer rates, with one frozen-frame paint',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:10000});
 let moves=0;const paints=[],probe=new RenderProbe(()=>Date.now(),()=>({touchMoves:moves,pointerMoves:moves}));
 const paint=(mode,changed)=>{if(mode!=='frozen'||changed)paints.push(mode);};
 probe.tick(paint);
 for(let n=0;n<900&&!probe.finished;n++){t.mock.timers.tick(16);moves++;probe.input();probe.tick(paint);}
 assert.equal(probe.finished,true);assert.equal(probe.disposed,true);
 assert.deepEqual(probe.samples.map(s=>s.mode),['direct','room','frozen','flat']);
 assert.equal(paints.filter(mode=>mode==='frozen').length,1);
 for(const s of probe.samples){assert.ok(s.raf>=61&&s.raf<=64);assert.ok(s.timer>=49&&s.timer<=51);assert.ok(s.touch>=61&&s.touch<=64);assert.ok(s.input>=61&&s.input<=64);assert.equal(s.longTasks,null);}
 const snapshot=JSON.stringify(probe.samples);t.mock.timers.tick(10000);probe.tick(paint);assert.equal(JSON.stringify(probe.samples),snapshot);
});

test('long scheduling gaps are measured instead of skipping or inventing phase results',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:10000});
 const probe=new RenderProbe(()=>Date.now(),()=>undefined);probe.tick(()=>{});
 t.mock.timers.tick(5000);probe.tick(()=>{});
 assert.equal(probe.samples.length,1);assert.equal(probe.samples[0].raf,0);assert.equal(probe.samples[0].touch,null);assert.equal(probe.samples[0].ms,4500);
 assert.equal(probe.finished,false);probe.dispose();assert.equal(probe.disposed,true);
});

test('long-task observer is optional and disposal disconnects it and stops sampling',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:10000});
 const original=Object.getOwnPropertyDescriptor(globalThis,'PerformanceObserver');let disconnected=0,callback;
 class Observer{static supportedEntryTypes=['longtask'];constructor(fn){callback=fn;}observe(){}takeRecords(){return [];}disconnect(){disconnected++;}}
 Object.defineProperty(globalThis,'PerformanceObserver',{configurable:true,value:Observer});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'PerformanceObserver',original);else delete globalThis.PerformanceObserver;});
 const probe=new RenderProbe(()=>Date.now(),()=>undefined);probe.tick(()=>{});t.mock.timers.tick(600);probe.tick(()=>{});
 callback({getEntries:()=>[{startTime:10620,duration:80}]});
 t.mock.timers.tick(2900);probe.tick(()=>{});
 assert.equal(probe.samples[0].longTasks,1);assert.equal(probe.samples[0].longTaskMs,80);
 probe.dispose();probe.dispose();assert.equal(disconnected,1);
 const count=probe.timers.length;t.mock.timers.tick(1000);assert.equal(probe.timers.length,count);
});
