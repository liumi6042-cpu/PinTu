import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {readLevelConfiguration} from '../server/mobile-levels.mjs';
import {mobileStaticAsset} from '../scripts/release-files.mjs';

// 拾光物语 ch3/ch4 drawn comic pages (2026-10-29): served by the mobile backend like level images, but they are
// not catalogue pictures, so they never reach the gallery, the daily pool or the TapTap offline bundle.
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const levels=read('config/levels.json'),runtime=read('config/runtime-assets.json'),manifest=read('h5/asset-manifest.json'),catalog=read('content/puzzle-catalog.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pages=levels.chapters.flatMap(chapter=>(chapter.story??[]).map((story,index)=>({level:chapter.id+'-'+(index+1),chapter:chapter.id,story})));

test('every ch3/ch4 level has a valid comic page; ch1/ch2 keep crops only',()=>{
 const config=readLevelConfiguration(levels);
 for(const {level,chapter,story} of pages){
  assert.equal(story.comic.panels.length,4,level); // old clients keep drawing these crops
  if(chapter==='ch1'||chapter==='ch2'){assert.ok(!('comicPage' in story),level);continue;}
  const page=story.comicPage;assert.deepEqual(Object.keys(page),['src','thumbSrc','panels'],level);
  const [c,n]=level.slice(2).split('-');
  assert.match(page.src,new RegExp(`^/puzzles/story-comic-ch${c}-0${n}-page-[a-f0-9]{12}\.webp$`));
  assert.match(page.thumbSrc,new RegExp(`^/puzzles/story-comic-ch${c}-0${n}-pagethumb-[a-f0-9]{12}\.webp$`));
  assert.deepEqual(config.chapters.find(item=>item.id===chapter).story[Number(n)-1].comicPage,page);
 }
 assert.equal(pages.filter(page=>page.story.comicPage).length,12);
});

test('page panels follow the game template: tall P1 left, P2 and P3 top right, wide P4 below',()=>{
 for(const {level,story} of pages.filter(page=>page.story.comicPage)){
  // Generated pages keep the layout within a few percent; the client cover-fits each crop into its panel. A crop may
  // be narrowed to the landscape-phone panel aspect to keep off-centre content in view (deliver-comic-pages.mjs FOCUS).
  const [p1,p2,p3,p4]=story.comicPage.panels,right=p=>p[0]+p[2],bottom=p=>p[1]+p[3],within=(v,lo,hi)=>v>=lo&&v<=hi;
  assert.ok(within(p1[0],0,.02)&&within(p1[2],.42,.5)&&within(p1[3],.55,.98)&&bottom(p1)<=1,level+' P1 '+p1);
  assert.ok(right(p1)<p2[0]&&right(p1)<p4[0]&&right(p2)<p3[0]&&bottom(p2)<p4[1]&&bottom(p3)<p4[1],level+' order');
  assert.ok(within(p2[3],.28,.5)&&within(p3[3],.28,.5)&&within(p4[3],.3,.54)&&within(p4[2],.48,.55),level+' sizes');
  assert.ok(within(right(p3),.98,1)&&within(right(p4),.98,1)&&bottom(p2)<.53&&bottom(p3)<.53&&bottom(p4)<=1,level+' edges');
 }
});

test('page images are hashed WebP files that the mobile backend serves and nothing else uses',async()=>{
 const catalogUrls=new Set(catalog.flatMap(photo=>Object.values(photo).filter(value=>typeof value==='string')));
 for(const {level,story} of pages.filter(page=>page.story.comicPage)){
  for(const [url,kind] of [[story.comicPage.src,'page'],[story.comicPage.thumbSrc,'thumb']]){
   const file=new URL('../public'+url,import.meta.url);assert.ok(existsSync(file),url);
   const bytes=readFileSync(file);assert.equal(sha(bytes).slice(0,12),url.match(/-([a-f0-9]{12})\.webp$/)[1],url);
   const meta=await sharp(bytes).metadata();assert.equal(meta.format,'webp');
   if(kind==='page')assert.deepEqual([meta.width,meta.height],[1536,1024],level);else assert.ok(meta.width<=384&&meta.height<=384,level);
   assert.ok(runtime.static.includes(url)&&manifest.includes(url)&&mobileStaticAsset(url),url);
   assert.ok(!catalogUrls.has(url),url);
   // Not a bundled-artwork name (thumbnail|optimized|play|thumb2x), so the TapTap offline bundle never picks it up.
   assert.doesNotMatch(url,/-(?:thumbnail|optimized|play|thumb2x|standard|compact)-[a-f0-9]{12}\.webp$/);
  }
 }
 assert.equal(runtime.static.filter(url=>url.startsWith('/puzzles/story-comic-')).length,24);
 assert.equal(manifest.filter(url=>url.startsWith('/puzzles/story-comic-')).length,24);
 assert.equal(new Set(manifest).size,manifest.length);
});
