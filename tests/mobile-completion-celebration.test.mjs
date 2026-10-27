import test from 'node:test';
import assert from 'node:assert/strict';
import {completionCelebration,popperCelebration,celebrationCount,drawCelebration,CELEBRATION_MAX_PARTICLES} from '../mobile/completion-celebration.ts';
import {CompletionTransition,COMPLETION_BURST_MS} from '../mobile/completion-transition.ts';
import {CheerEffects} from '../mobile/cheer-effects.ts';
import {PAL} from '../mobile/cheer-icons.ts';
const view={picture:{x:156,y:40,w:470,h:310},field:{x:62,y:0,w:658,h:350},clip:{x:0,y:0,w:782,h:390}};
function recording(matrix){
 const calls=[],rects=[],stack=[];let transform=matrix;const target={globalAlpha:.73,fillStyle:'original',save(){stack.push({alpha:this.globalAlpha,style:this.fillStyle,transform});calls.push(['save']);},restore(){assert.ok(stack.length);const s=stack.pop();this.globalAlpha=s.alpha;this.fillStyle=s.style;transform=s.transform;calls.push(['restore']);},fillRect(...r){assert.ok(r.every(Number.isInteger));assert.ok(r[2]>0&&r[3]>0);rects.push({r,color:this.fillStyle,alpha:this.globalAlpha});calls.push(['fill',...r,this.fillStyle,this.globalAlpha]);}};
 if(matrix){target.getTransform=()=>transform;target.setTransform=(...args)=>{calls.push(['transform',...args]);transform={a:args[0],b:args[1],c:args[2],d:args[3],e:args[4],f:args[5]};};}
 const ctx=new Proxy(target,{get(o,k){assert.ok(k in o||k==='getTransform'||k==='setTransform','forbidden canvas call: '+String(k));return o[k];},set(o,k,v){assert.ok(k==='globalAlpha'||k==='fillStyle','forbidden canvas property: '+String(k));o[k]=v;return true;}});return {ctx,calls,rects,stack,transform:()=>transform};
}
const onlyBurst=(scene,burst)=>({...scene,fireworks:[burst],confetti:[],stars:[]});
test('three timed bursts have independent lifetimes, picture anchors and clamped centres',()=>{
 const transition=new CompletionTransition(100),scene=transition.celebration;assert.deepEqual(COMPLETION_BURST_MS,[900,1150,1400]);assert.equal(scene.start,1000);assert.deepEqual(scene.fireworks.map(b=>[b.x,b.y]),[[.14,.2],[.86,.2],[.5,.1]]);
 for(const [i,burst] of scene.fireworks.entries()){assert.equal(scene.start+burst.delay,100+COMPLETION_BURST_MS[i]);assert.equal(burst.streaks.filter(s=>s.ring==='outer').length,24);assert.equal(burst.streaks.filter(s=>s.ring==='inner').length,14);assert.equal(burst.streaks.filter(s=>s.ring==='star').length,6);assert.ok(burst.streaks.filter(s=>s.ring==='outer').every(s=>s.color===(i===1?'B':'R')));
  const isolated=onlyBurst(scene,burst);for(const offset of [-1,1200,1300]){const f=recording();assert.equal(drawCelebration(f.ctx,isolated,scene.start+burst.delay+offset,view),0);assert.equal(f.rects.length,0);}for(const offset of [0,159,650,1199]){const f=recording();assert.ok(drawCelebration(f.ctx,isolated,scene.start+burst.delay+offset,view)>0);}
  for(const clip of [view.clip,{x:180,y:95,w:280,h:200}]){const f=recording();drawCelebration(f.ctx,isolated,scene.start+burst.delay,{...view,clip});const [x,y]=f.rects[0].r,r=Math.max(32,.3*310),cx=Math.max(clip.x+r/2,Math.min(clip.x+clip.w-r/2,view.picture.x+view.picture.w*burst.x)),cy=Math.max(clip.y+r/2,Math.min(clip.y+clip.h-r/2,view.picture.y+view.picture.h*burst.y));assert.ok(Math.abs(x-cx)<=1&&Math.abs(y-cy)<=1);assert.ok(x>=clip.x&&x<clip.x+clip.w&&y>=clip.y&&y<clip.y+clip.h);}
 }
});
test('full and popper scenes have bounded exact content and deterministic seeds',()=>{
 const full=completionCelebration(900),small=popperCelebration(4000,8);assert.equal(CELEBRATION_MAX_PARTICLES,400);assert.equal(celebrationCount(full),323);assert.equal(full.confetti.length,164);assert.ok(full.confetti.length>150);assert.deepEqual(['jigsaw','foil','flower','streamer'].map(k=>full.confetti.filter(p=>p.kind===k).length),[72,48,32,12]);assert.equal(full.stars.length,24);assert.equal(celebrationCount(small),59);assert.equal(small.confetti.length,28);assert.ok(!small.confetti.some(p=>p.kind==='streamer'));assert.equal(small.end,5600);
 assert.ok(full.confetti.every(p=>p.y<=-.02&&p.y>=-.15&&p.delay>=0&&p.delay<1100));assert.ok(full.stars.every(p=>p.delay>=100&&p.delay<=2000));assert.deepEqual(full,completionCelebration(900));assert.deepEqual(small,popperCelebration(4000,8));assert.notDeepEqual(small,popperCelebration(4000,9));
 for(let seed=0;seed<100;seed++){const p=popperCelebration(0,seed),b=p.fireworks[0];assert.ok(celebrationCount(p)<=400);assert.ok(b.x>=.3&&b.x<=.7&&b.y>=.2&&b.y<=.45);assert.equal(b.radius,.34);}
});
test('a storm of 300 poppers and repeated combo starts retains only the newest four scenes',()=>{
 const fx=new CheerEffects(()=>0);for(let i=0;i<300;i++){fx.receive({playerId:String(i),emote:'popper'},false,0);if(i%3===0)fx.combo=null;assert.ok(fx.celebrations.length<=4);assert.ok(fx.celebrations.reduce((n,s)=>n+celebrationCount(s),0)<=400);}assert.equal(fx.celebrations.length,4);assert.equal(fx.celebrations.reduce((n,s)=>n+celebrationCount(s),0),236);assert.equal(fx.particles.length,0);
 const newest=fx.celebrations.at(-1);fx.receive({playerId:'last',emote:'popper'},false,10);assert.equal(fx.celebrations.at(-2),newest);assert.equal(fx.celebrations.at(-1).end,1610);fx.update(1600);assert.equal(fx.celebrations.length,1);fx.update(1610);assert.equal(fx.celebrations.length,0);fx.receive({playerId:'a',emote:'popper'},false,2000);fx.bubbles=[];fx.hops.clear();fx.combo=null;assert.equal(fx.alive(3599),true);assert.equal(fx.alive(3600),false);fx.receive({playerId:'a',emote:'popper'},false,4000);fx.clear();assert.deepEqual(fx.celebrations,[]);assert.equal(fx.alive(4000),false);
});
test('scenes draw at capture times and stop completely at their absolute ends',()=>{
 const scene=completionCelebration(1900);assert.equal(scene.end,1000+3200);for(const transitionTime of [1200,1600,2400]){const f=recording();assert.ok(drawCelebration(f.ctx,scene,1000+transitionTime,view)>0);assert.ok(f.rects.length>0);}
 for(const s of [scene,popperCelebration(5000,1)])for(const now of [s.start-1,s.end,s.end+1000]){const f=recording();assert.equal(drawCelebration(f.ctx,s,now,view),0);assert.deepEqual(f.calls,[]);}
});
test('pixel drawing restores alpha, uses allowed calls only, and is deterministic in logical and device modes',()=>{
 for(const matrix of [undefined,{a:2.75,b:0,c:0,d:2.75,e:3,f:7}])for(const factory of [()=>completionCelebration(900),()=>popperCelebration(900,15)])for(const now of [900,1200,1600,2400]){const scene=factory(),f=recording(matrix),g=recording(matrix);drawCelebration(f.ctx,scene,now,view);drawCelebration(g.ctx,factory(),now,view);assert.deepEqual(f.calls,g.calls);assert.equal(f.ctx.globalAlpha,.73);assert.equal(f.ctx.fillStyle,'original');assert.equal(f.stack.length,0);assert.deepEqual(f.transform(),matrix);if(now>=scene.end)continue;assert.ok(f.rects.length);assert.equal(f.calls[0][0],'save');assert.equal(f.calls.at(-1)[0],'restore');const cell=matrix?6:2;assert.ok(f.rects.every(p=>p.r.every(v=>v%cell===0)));if(matrix)assert.deepEqual(f.calls[1],['transform',1,0,0,1,0,0]);else assert.ok(!f.calls.some(c=>c[0]==='transform'));}
});
test('skewed transforms fall back to logical blocks and resizing recomputes fractional positions',()=>{
 const scene=completionCelebration(900),skew={a:2,b:.1,c:0,d:2,e:3,f:7},f=recording(skew),g=recording();drawCelebration(f.ctx,scene,1200,view);drawCelebration(g.ctx,scene,1200,view);assert.deepEqual(f.calls,g.calls);const shifted=recording(),offset=100;drawCelebration(shifted.ctx,scene,1200,{picture:{...view.picture,x:view.picture.x+offset},field:{...view.field,x:view.field.x+offset},clip:{...view.clip,x:view.clip.x+offset}});assert.deepEqual(shifted.rects,g.rects.map(p=>({...p,r:[p.r[0]+offset,...p.r.slice(1)]})));
 const small=recording(),large=recording(),burst=onlyBurst(scene,scene.fireworks[0]);drawCelebration(small.ctx,burst,scene.start,view);const picture={x:0,y:0,w:900,h:750},field={x:0,y:0,w:1000,h:900};drawCelebration(large.ctx,burst,scene.start,{picture,field});assert.notDeepEqual(small.rects,large.rects);assert.ok(large.rects.every(p=>p.r.every(v=>v%4===0)));
});
test('confetti coverage stays below twelve percent of the landscape picture at all three captures',t=>{
 const full=completionCelebration(900),scene={...full,fireworks:[],stars:[]},p=view.picture;
 for(const now of [1200,1600,2400]){const f=recording();assert.ok(drawCelebration(f.ctx,scene,now,view)>0);const area=f.rects.reduce((sum,{r:[x,y,w,h]})=>sum+Math.max(0,Math.min(x+w,p.x+p.w)-Math.max(x,p.x))*Math.max(0,Math.min(y+h,p.y+p.h)-Math.max(y,p.y)),0),coverage=area/(p.w*p.h);t.diagnostic(`${now} ms: ${area}/${p.w*p.h} = ${(coverage*100).toFixed(4)}%`);assert.ok(coverage<.12);}
});
test('fireworks, confetti and dust render in that order and all palette colours remain flat',()=>{
 const scene=completionCelebration(900),time=1600,f=recording();drawCelebration(f.ctx,scene,time,view);const expected=[];for(const group of [{...scene,confetti:[],stars:[]},{...scene,fireworks:[],stars:[]},{...scene,fireworks:[],confetti:[]}]){const r=recording();drawCelebration(r.ctx,group,time,view);expected.push(...r.rects);}assert.deepEqual(f.rects,expected);assert.ok(f.rects.every(r=>Object.values(PAL).includes(r.color)));
});
test('device-mode sprites keep their exact cell shapes at a fractional DPR',()=>{
 const base=completionCelebration(900),grid=['..oo....','..oo....','hhoooo..','hooooo..','oooooooo','oooooooo','oooooo..','oooooo..'],piece={kind:'jigsaw',delay:0,x:.37,y:.41,speed:1,drift:0,phase:0,spin:0,color:'R',light:'r',turn:0};
 const shape=(rects,cell)=>{const cells=new Set();for(const {r:[x,y,w,h]} of rects){assert.equal(h,cell);for(let i=0;i<w/cell;i++)cells.add(`${x/cell+i},${y/cell}`);}const xs=[...cells].map(c=>+c.split(',')[0]),ys=[...cells].map(c=>+c.split(',')[1]);return {cells:[...cells].sort(),x0:Math.min(...xs),y0:Math.min(...ys)};};
 for(const shift of [0,.3,.5,.9,1.7,3.1]){const matrix={a:2.75,b:0,c:0,d:2.75,e:shift,f:shift*.7};
  const f=recording(matrix);drawCelebration(f.ctx,{...base,fireworks:[],stars:[],confetti:[{...piece,x:piece.x+shift/997,y:piece.y+shift/1009}]},900,view);const got=shape(f.rects,6),want=[];grid.forEach((row,iy)=>[...row].forEach((v,ix)=>{if(v!=='.')want.push(`${got.x0+ix},${got.y0+iy}`);}));assert.deepEqual(got.cells,want.sort());
  const g=recording(matrix);drawCelebration(g.ctx,{...base,fireworks:[],confetti:[],stars:[{delay:0,x:.3+shift/997,y:.3}]},1100,view);const star=shape(g.rects,6),cx=star.x0+2,cy=star.y0+2;assert.deepEqual(star.cells,[[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1],[0,1],[0,-2],[0,2]].map(([dx,dy])=>`${cx+dx},${cy+dy}`).sort());
 }
});
