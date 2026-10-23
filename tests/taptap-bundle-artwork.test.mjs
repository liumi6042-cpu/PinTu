import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {planTapTapArtwork,TAPTAP_THUMBNAIL_WIDTH} from '../scripts/bundle-taptap-artwork.mjs';
import {writeBundledArtwork} from '../scripts/build-mobile-shared.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'taptap-thumbnails-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'public/puzzles'),{recursive:true});
 const image=async(id,kind,width,height,color)=>{
  const data=await sharp({create:{width,height,channels:3,background:color}}).webp().toBuffer();
  const url=`/puzzles/${id}-${kind}-${sha(data).slice(0,12)}.webp`;writeFileSync(join(root,'public',url),data);return url;
 };
 const catalog=[];
 for(const [id,width,height] of [['landscape',1280,640],['portrait',800,1200],['online',900,600]])catalog.push({id,status:'published',origin:'project-ai-generated',thumbSrc:await image(id,'thumbnail',100,100,'#00ff00'),optimizedSrc:await image(id,'optimized',width,height,'#ff0000')});
 return {root,catalog,albums:[{id:'local',title:'Local',showOnMobile:true,imageIds:['landscape','portrait']},{id:'online',title:'Online',showOnMobile:false,imageIds:['online']}]};
}

test('bundled HD art produces deterministic 400px WebP thumbnails, mapped and written with verified hashes',async t=>{
 const input=await fixture(t),plan=await planTapTapArtwork(input);
 assert.equal(TAPTAP_THUMBNAIL_WIDTH,400);assert.equal(plan.thumbnailCount,3);
 assert.equal(plan.files.length,5);assert.equal(plan.totalBytes,plan.files.reduce((sum,file)=>sum+file.bytes,0));
 for(const [id,height] of [['landscape',200],['portrait',600]]){
  const photo=input.catalog.find(photo=>photo.id===id),file=plan.files.find(file=>file.imageId===id&&file.kind==='thumbnail');
  assert.match(file.path,new RegExp(`^assets/puzzles/${id}-thumb2x-[a-f0-9]{12}\\.webp$`));
  assert.equal(plan.mapping[photo.thumbSrc],file.path);assert.equal(plan.mapping[photo.optimizedSrc],'assets'+photo.optimizedSrc);
  assert.ok(!plan.files.some(file=>file.url===photo.thumbSrc));
  assert.equal(file.sha256,sha(file.data));assert.equal(file.bytes,file.data.length);assert.ok(file.path.endsWith(sha(file.data).slice(0,12)+'.webp'));
  const metadata=await sharp(file.data).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,400);assert.equal(metadata.height,height);
  const {data}=await sharp(file.data).raw().toBuffer({resolveWithObject:true});assert.ok(data[0]>240&&data[1]<10&&data[2]<10,'thumbnail must use red HD art, not the green server thumbnail');
 }
 const online=input.catalog[2];assert.equal(plan.mapping[online.thumbSrc],'assets'+online.thumbSrc);assert.equal(plan.mapping[online.optimizedSrc],undefined);
 const repeat=await planTapTapArtwork(input);assert.deepEqual(repeat.mapping,plan.mapping);
 const out=join(input.root,'package');writeBundledArtwork(out,plan);
 for(const file of plan.files){const bytes=readFileSync(join(out,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 for(const photo of input.catalog.slice(0,2))assert.equal(existsSync(join(out,'assets'+photo.thumbSrc)),false);
});

test('partial packages keep server thumbnails and local generation never reads the server thumbnail',async t=>{
 const input=await fixture(t),thumbOnly=await planTapTapArtwork({...input,fullAlbumIds:[]});
 assert.equal(thumbOnly.files.length,3);for(const photo of input.catalog)assert.equal(thumbOnly.mapping[photo.thumbSrc],'assets'+photo.thumbSrc);
 // Removing a selected server thumbnail must not affect generation from HD.
 rmSync(join(input.root,'public',input.catalog[0].thumbSrc));
 assert.match((await planTapTapArtwork(input)).mapping[input.catalog[0].thumbSrc],/-thumb2x-/);
});

test('bundled output safety accepts thumb2x and rejects traversal, malformed names and changed data',async t=>{
 const input=await fixture(t),plan=await planTapTapArtwork(input),file=plan.files.find(file=>file.data),out=join(input.root,'package');
 for(const url of ['/puzzles/../escape-thumb2x-0123456789ab.webp','/puzzles/test-thumb2x-invalid.webp','/puzzles/test-thumb2x-0123456789ab.webp?x=1','/puzzles/test-thumb2x-0123456789ab.webp/extra','/puzzles\\test-thumb2x-0123456789ab.webp'])assert.throws(()=>writeBundledArtwork(out,{files:[{...file,url,path:'assets'+url}]}),/Unsafe bundled artwork output/);
 assert.throws(()=>writeBundledArtwork(out,{files:[{...file,path:'../escape.webp'}]}),/Unsafe bundled artwork output/);
 assert.throws(()=>writeBundledArtwork(out,{files:[{...file,data:Buffer.from('changed')}]}),/Bundled artwork changed during build/);
});
