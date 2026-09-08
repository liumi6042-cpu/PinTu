import test from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATION_DURATION, celebrationParticles, celebrationFrame, CompletionGate } from '../lib/celebration-engine.ts';
import { CelebrationRenderer } from '../lib/celebration-renderer.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';
import { BOARD } from '../lib/puzzle-engine.ts';

const viewport={x:0,y:0,width:1440,height:900},board={x:340,y:130,width:760,height:570};

test('completion waits for the ready board and is not repeated by multiplayer snapshots',()=>{
  for(const total of [12,5000]){
    const gate=new CompletionGate();
    assert.equal(gate.observe(total,total,false),false);
    assert.equal(gate.observe(total-1,total,true),false);
    assert.equal(gate.observe(total,total,true),true);
    for(let poll=0;poll<25;poll++)assert.equal(gate.observe(total,total,true),false);
    assert.equal(new CompletionGate().observe(total,total,true),true,'the next puzzle must celebrate again');
  }
  assert.equal(new CompletionGate().observe(0,0,true),false);
});

test('celebration has bounded, deterministic particle layers including large foreground pieces',()=>{
  const particles=celebrationParticles(1440,42);
  const small=celebrationParticles(390,42);
  assert.ok(particles.length<=3200);assert.ok(small.length<=1600);
  assert.ok(particles.filter(p=>p.kind==='puzzle').length>=900,'puzzle confetti should be much denser than the original burst');
  assert.ok(particles.filter(p=>p.kind==='dust').length>=1500);
  assert.ok(small.filter(p=>p.kind==='puzzle').length>=450);assert.ok(small.filter(p=>p.kind==='dust').length>=800);
  assert.ok(particles.filter(p=>p.kind==='puzzle'&&p.delay>640).length>=200,'later waves should keep the celebration full');
  assert.deepEqual(particles,celebrationParticles(1440,42));
  assert.deepEqual(new Set(particles.map(p=>p.kind)),new Set(['puzzle','foil','ribbon','dust']));
  assert.deepEqual(new Set(particles.map(p=>p.depth)),new Set([0,1,2]));
  assert.ok(particles.filter(p=>p.depth===2&&p.kind==='puzzle'&&p.size>=64).length>=14);
  assert.ok(particles.filter(p=>p.kind==='ribbon'&&p.metallic).length>=16);
});

test('both fountains travel across the picture, stay frame-rate independent and fade away',()=>{
  const particles=celebrationParticles(1440,19);
  for(const p of particles){
    assert.equal(celebrationFrame(p,p.delay-1,viewport,board),null);
    const origin=celebrationFrame(p,p.delay,viewport,board);
    const rising=celebrationFrame(p,p.delay+400,viewport,board);
    assert.ok((rising.x-origin.x)*p.side>0);assert.ok(rising.y<origin.y);
    const direct=celebrationFrame(p,1200,viewport,board);
    for(let elapsed=0;elapsed<1200;elapsed+=1000/30)celebrationFrame(p,elapsed,viewport,board);
    assert.deepEqual(celebrationFrame(p,1200,viewport,board),direct);
    for(const value of Object.values(direct))assert.ok(Number.isFinite(value));
    assert.ok(celebrationFrame(p,CELEBRATION_DURATION-1,viewport,board).alpha<.002);
    assert.equal(celebrationFrame(p,CELEBRATION_DURATION,viewport,board),null);
  }
  assert.ok(particles.filter(p=>{const f=celebrationFrame(p,1200,viewport,board);return f.x>board.x&&f.x<board.x+board.width&&f.y>board.y&&f.y<board.y+board.height;}).length>50,'the celebration should overlap the picture');
});

function renderEnvironment(reduced=false){
  const keys=['window','document','Path2D','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
  const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const frames=new Map(),timers=new Map(),canvases=[],documentListeners=new Map(),motionListeners=new Map();
  let id=0,disconnected=0;
  function canvas(){
    const stats={draws:0,dustDraws:0,clears:0,transforms:[]};
    const context=new Proxy({drawImage(image){stats.draws++;if(image.width===32&&this.globalCompositeOperation==='lighter')stats.dustDraws++;},clearRect(){stats.clears++;},setTransform(...args){stats.transforms.push(args);},createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};}},{get(target,key){return key in target?target[key]:()=>{};}});
    const value={width:0,height:0,stats,getContext:()=>context,getBoundingClientRect:()=>({width:1440,height:900})};
    canvases.push(value);return value;
  }
  const motion={matches:reduced,addEventListener(type,fn){motionListeners.set(type,fn);},removeEventListener(type){motionListeners.delete(type);}};
  Object.assign(globalThis,{
    window:{devicePixelRatio:3,matchMedia:()=>motion},
    document:{hidden:false,createElement:canvas,addEventListener(type,fn){documentListeners.set(type,fn);},removeEventListener(type){documentListeners.delete(type);}},
    Path2D:class{},ResizeObserver:class{observe(){}disconnect(){disconnected++;}},
    requestAnimationFrame(fn){const n=++id;frames.set(n,fn);return n;},cancelAnimationFrame(n){frames.delete(n);},
    setTimeout(fn){const n=++id;timers.set(n,fn);return n;},clearTimeout(n){timers.delete(n);}
  });
  return {canvas,canvases,frames,timers,motion,documentListeners,motionListeners,
    advance(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));},
    get disconnected(){return disconnected;},
    restore(){for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
  };
}

test('renderer completes once, reuses sprites, releases resources and can replay',()=>{
  const env=renderEnvironment();let renderer,finished=0;
  try{
    const canvas=env.canvas();renderer=new CelebrationRenderer(canvas,()=>board,()=>finished++,21);
    assert.equal(canvas.width,2160,'render scale should cap at 1.5 even on a 3x screen');
    env.advance(0);env.advance(1000);assert.ok(canvas.stats.draws>100);
    assert.ok(canvas.stats.dustDraws>1000,'gold powder must actually render above the picture');
    const sprites=env.canvases.length;env.advance(1200);assert.equal(env.canvases.length,sprites,'a frame should reuse existing sprites');
    assert.equal(finished,0);env.advance(3500);assert.equal(finished,1);
    assert.equal(env.frames.size,0);assert.equal(env.documentListeners.size,0);assert.equal(env.motionListeners.size,0);
    assert.equal(env.disconnected,1);assert.ok(env.canvases.slice(1).every(c=>c.width===0&&c.height===0));
    renderer.destroy();assert.equal(finished,1);
    renderer=new CelebrationRenderer(canvas,()=>board,()=>finished++,22);
    env.advance(5000);env.advance(6000);assert.ok(env.frames.size>0);
    env.advance(8500);assert.equal(finished,2);assert.equal(env.frames.size,0);
  }finally{renderer?.destroy();env.restore();}
});

test('closing an in-progress preview cancels drawing without opening a result dialog',()=>{
  const env=renderEnvironment();let renderer,finished=0;
  try{
    renderer=new CelebrationRenderer(env.canvas(),()=>board,()=>finished++);
    env.advance(0);env.advance(900);renderer.destroy();env.advance(5000);
    assert.equal(finished,0);assert.equal(env.frames.size,0);assert.equal(env.documentListeners.size,0);
  }finally{renderer?.destroy();env.restore();}
});

test('reduced-motion preference skips particle frames and still reaches completion',()=>{
  const env=renderEnvironment(true);let renderer,finished=0;
  try{
    const canvas=env.canvas();renderer=new CelebrationRenderer(canvas,()=>board,()=>finished++);
    assert.equal(env.frames.size,0);assert.equal(env.timers.size,1);
    [...env.timers.values()][0]();assert.equal(finished,1);assert.equal(env.timers.size,0);assert.equal(canvas.stats.draws,0);
  }finally{renderer?.destroy();env.restore();}
});

test('hiding the page ends the celebration instead of keeping a stalled frame loop',()=>{
  const env=renderEnvironment();let renderer,finished=0;
  try{
    renderer=new CelebrationRenderer(env.canvas(),()=>board,()=>finished++);env.advance(0);
    globalThis.document.hidden=true;env.documentListeners.get('visibilitychange')();
    assert.equal(finished,1);assert.equal(env.frames.size,0);assert.equal(env.documentListeners.size,0);
  }finally{renderer?.destroy();env.restore();}
});

test('completion framing keeps the entire finished puzzle centered with room for confetti',()=>{
  const table=Object.create(PuzzleTable.prototype);let draws=0,updates=0;
  Object.assign(table,{width:1440,height:760,draw(){draws++;},update(){updates++;}});
  table.fit(true);
  const {x,y,z}=table.camera;
  assert.equal(x+(BOARD.x+BOARD.width/2)*z,720);
  assert.equal(y+(BOARD.y+BOARD.height/2)*z,380);
  assert.ok(BOARD.width*z<1440&&BOARD.height*z<760);assert.equal(draws,1);assert.equal(updates,1);
});
