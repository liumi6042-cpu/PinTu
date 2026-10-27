import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fixture,levels,artwork} from './mobile-level-card-fixture.mjs';

const bundle=await build({stdin:{contents:'export * from "./mobile/story-timeline";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {timeLabelFor,nodeState}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const story=JSON.parse(await readFile(new URL('../mobile/story-comics-ch1.json',import.meta.url),'utf8'));

test('time labels prefer nonblank server values and fall back by chapter and level order',()=>{
 const chapter=levels().chapters[0];
 assert.equal(timeLabelFor(chapter,0,{timeLabel:'服务器清晨'}),'服务器清晨');
 for(const timeLabel of [undefined,null,'','  '])for(let index=0;index<6;index++)assert.equal(timeLabelFor(chapter,index,{timeLabel}),story.levels[index].timeLabel);
 assert.equal(timeLabelFor({id:'other',albumId:'shiguang-ch1'},5,{}),story.levels[5].timeLabel);
 assert.equal(timeLabelFor({id:'other',albumId:'other'},0,{}),null);
 assert.equal(timeLabelFor({id:'other',albumId:'other'},0,{timeLabel:'自定义'}),'自定义');
 for(const index of [-1,6,1.5])assert.equal(timeLabelFor(chapter,index,{}),null);
});

test('node states use clear status before current identity and require an unlocked current level',()=>{
 const current={id:'a'};
 assert.equal(nodeState({id:'a',status:'cleared'},current),'cleared');
 assert.equal(nodeState({id:'a',status:'unlocked'},current),'current');
 for(const status of ['locked','unavailable'])assert.equal(nodeState({id:'a',status},current),'locked');
 assert.equal(nodeState({id:'b',status:'unlocked'},current),'locked');
 assert.equal(nodeState({id:'a',status:'unlocked'},null),'locked');
});

function record(f){
 const nodes=[],gradients=[],clips=[],ctx=f.stage.ctx;
 ctx.arc=(x,y,radius)=>nodes.push({x,y,radius,color:ctx.strokeStyle});
 ctx.createLinearGradient=(...axis)=>{const stops=[];gradients.push({axis,stops});return {addColorStop:(at,color)=>stops.push([at,color])};};
 const clip=f.stage.clip;f.stage.clip=(r,fn)=>{clips.push(r);clip(r,fn);};
 return {nodes,gradients,clips};
}
const inside=(r,w,h)=>{assert.ok(r.x>=0&&r.y>=0&&r.w>=0&&r.h>=0&&r.x+r.w<=w+.01&&r.y+r.h<=h+.01,JSON.stringify(r));};

for(const [width,height]of [[844,390],[390,844]])for(const cleared of [0,3,6])test(`${width}×${height}, ${cleared}/6 draws six timeline nodes and preserves actions`,async()=>{
 const f=fixture({width,height,data:levels(cleared)});await artwork(f);const {nodes,gradients,clips}=record(f);f.app.drawChapter();
 assert.equal(nodes.length,6);assert.equal(nodes.filter(node=>node.radius===13).length,cleared<6?1:0);
 assert.equal(nodes.filter(node=>node.color==='#b88f84').length,Math.max(0,5-cleared));
 assert.equal(nodes.filter(node=>node.color==='#a85567').length,cleared);
 assert.equal(f.texts.filter(text=>text==='?').length,Math.max(0,5-cleared));
 assert.ok(f.texts.includes('小窝的故事'));assert.ok(f.texts.includes('第 1 章 · 开张'));assert.ok(f.texts.includes(`${cleared} / 6 格`));assert.ok(!f.texts.some(text=>text.includes('拾光物语')));
 assert.deepEqual(gradients[0].stops.map(stop=>stop[1]),['#f3c7a0','#9cc9e6','#f0cf6e','#eba965','#d4776c','#3d4170']);
 assert.equal(f.fills.filter(fill=>fill.color==='rgba(251,243,232,.62)').length,cleared<6?1:0);
 if(cleared<6){assert.ok(f.texts.includes(`第 ${cleared+1} 格`));assert.ok(f.texts.includes(`${f.app.levels.current.pieces} 片 · 拼完揭晓`));}
 const calls=[];f.app.openLevelComic=(...args)=>calls.push(args);
 if(cleared===6){f.buttons.find(button=>button.label==='从头看').fn();assert.deepEqual(calls,[['ch1-1',{sequence:true}]]);}
 if(cleared){f.hits[0].fn();assert.deepEqual(calls.at(-1),['ch1-1']);}
 if(width>height){
  assert.equal(f.app.extent,0);assert.equal(f.app.scroll,0);
  const cards=f.strokes.map(stroke=>({x:stroke.r.x-1,y:stroke.r.y-1,w:stroke.r.w+2,h:stroke.r.h+2}));assert.equal(cards.length,6);
  cards.forEach((r,index)=>{assert.equal(r.w,168);assert.equal(r.h,92);inside(r,width,height);assert.ok(index%2===0?r.y+r.h<nodes[index].y:r.y>nodes[index].y);});
  for(const {r}of [...f.images,...f.buttons,...f.fills,...f.strokes])inside(r,width,height);
  for(const node of nodes)inside({x:node.x-node.radius,y:node.y-node.radius,w:node.radius*2,h:node.radius*2},width,height);
  for(const glyph of f.glyphs)inside({x:glyph.x,y:glyph.y,w:f.stage.measure(glyph.value),h:glyph.size},width,height);
 }else{
  assert.ok(clips.some(r=>r.y===f.app.bodyTop&&r.h===f.app.bodyBottom-f.app.bodyTop));assert.ok(nodes.every(node=>node.x===nodes[0].x));
  assert.equal(f.buttons[0].r.h,52);assert.equal(f.buttons[1].r.h,44);
  f.images.slice(0,cleared).forEach(image=>{assert.equal(image.r.w,116);assert.equal(image.r.h,76);});
  if(cleared<6){assert.equal(f.images.at(-1).r.h,128);assert.ok(f.strokes.slice(cleared+1).every(stroke=>stroke.r.h===44));}
 }
});

test('narrow landscape cards scale proportionally, keep minimum size and stay on canvas',async()=>{
 for(const width of [740,667,568]){
  const f=fixture({width,height:390,data:levels(3)});await artwork(f);f.app.scroll=50;f.app.drawChapter();
  assert.equal(f.app.scroll,0);assert.equal(f.app.extent,0);
  for(const {r}of f.strokes){assert.ok(r.w+2>=132);assert.ok(r.h+2>=72);assert.ok(r.w+2<168);assert.ok(Math.abs((r.w+2)/(r.h+2)-168/92)<.001);inside(r,width,390);}
 }
});

test('sequence opens the first comic and ignores stale account data',async()=>{
 const f=fixture({data:levels(6)});await artwork(f);f.app.stopCheers=()=>{};f.app.drawChapter();f.buttons.find(button=>button.label==='从头看').fn();
 assert.equal(f.app.modal,'levelComic');assert.equal(f.app.comicPage.index,0);assert.equal(f.app.comicPage.sequence,true);
 f.app.modal=null;f.client.account={id:'other'};f.app.openLevelComic('ch1-1',{sequence:true});assert.equal(f.app.modal,null);
});
