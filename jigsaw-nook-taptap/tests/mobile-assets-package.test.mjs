import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {resolveSharedConfig} from '../scripts/build-mobile-shared.mjs';
import {cacheControlForAsset,packageMobileAssets,planMobileAssets} from '../scripts/package-mobile-assets.mjs';

const root=resolve(import.meta.dirname,'..');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const writeJson=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value));};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const work=realpathSync(join(root,'work')),dir=mkdtempSync(join(work,'mobile-assets-test-'));
 const first=readJson(join(root,'content/puzzle-catalog.json'))[0],bytes=readFileSync(join(root,'public',first.thumbSrc.slice(1))),sha256=digest(bytes),photos=[],paths=[];
 for(const [id,status] of [['public-photo','published'],['archived-photo','archived']]){
  const photo={id,status,origin:'project-ai-generated',src:'/puzzles/'+id+'.png'},delivery={};
  for(const [kind,field] of [['optimized','optimizedSrc'],['thumbnail','thumbSrc']]){
   const path='/puzzles/'+id+'-'+kind+'-'+sha256.slice(0,12)+'.webp';photo[field]=path;paths.push(path);delivery[kind]={src:path,sha256,bytes:bytes.length};
   mkdirSync(join(dir,'public/puzzles'),{recursive:true});writeFileSync(join(dir,'public',path.slice(1)),bytes);
  }
  writeFileSync(join(dir,'public',photo.src.slice(1)),'SOURCE PNG MUST NOT SHIP');
  writeJson(join(dir,'content/image-provenance',id+'.json'),{id,origin:photo.origin,review:{status:'reviewed'},delivery});photos.push(photo);
 }
 writeJson(join(dir,'content/puzzle-catalog.json'),photos);writeJson(join(dir,'h5/asset-manifest.json'),paths);
 writeJson(join(dir,'lib/mobile-collection-catalog.json'),{packs:[{id:'public-pack',imageIds:['public-photo']}]});
 return {dir,photos,paths,cleanup(){assert.ok(realpathSync(dir).startsWith(work+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('shared asset override is independent, preserves API override, and rejects unsafe bases',()=>{
 const original={apiBase:'https://api.example.test/game',assetBase:'https://api.example.test/game/assets',development:true};
 const onlyAssets=resolveSharedConfig(original,{JIGSAW_SHARED_ASSET_BASE:'https://cdn.example.test/art/'});
 assert.equal(onlyAssets.apiBase,original.apiBase);assert.equal(onlyAssets.assetBase,'https://cdn.example.test/art');assert.equal(original.assetBase,'https://api.example.test/game/assets');
 const legacy=resolveSharedConfig(original,{JIGSAW_SHARED_API_BASE:'http://127.0.0.1:3211/h5'});assert.equal(legacy.assetBase,'http://127.0.0.1:3211/h5/assets');
 const both=resolveSharedConfig(original,{JIGSAW_SHARED_API_BASE:'https://new.example.test/h5',JIGSAW_SHARED_ASSET_BASE:'https://cdn.example.test/art'});assert.equal(both.apiBase,'https://new.example.test/h5');assert.equal(both.assetBase,onlyAssets.assetBase);
 for(const value of ['https://user:password@cdn.example.test/art','https://cdn.example.test/art?token=x','https://cdn.example.test/art#x','https://cdn.example.test/a/../art','https://cdn.example.test/%2e%2e/art','http://cdn.example.test/art','//cdn.example.test/art','file:///tmp','https://cdn.example.test/\\private',' https://cdn.example.test/art'])assert.throws(()=>resolveSharedConfig(original,{JIGSAW_SHARED_ASSET_BASE:value}),/Invalid shared/);
 assert.throws(()=>resolveSharedConfig({...original,development:false},{JIGSAW_SHARED_ASSET_BASE:'http://localhost:3211/art'}),/Invalid shared/);
});

test('actual shared catalog plan includes all public and archived rooms, every pack, and no original PNG or unused lossless editions',()=>{
 const plan=planMobileAssets(root),catalog=readJson(join(root,'content/puzzle-catalog.json'));
 assert.equal(plan.photos.filter(photo=>photo.status==='published').length,catalog.filter(photo=>photo.status==='published').length);
 assert.equal(plan.photos.filter(photo=>photo.status==='archived').length,catalog.filter(photo=>photo.status==='archived').length);
 assert.ok(plan.photos.some(photo=>photo.status==='published'));assert.ok(plan.photos.some(photo=>photo.status==='archived'));
 assert.equal(plan.assets.length,plan.photos.length*2);
 const urls=new Set(plan.assets.map(file=>file.url));
 for(const photo of catalog.filter(photo=>['published','archived'].includes(photo.status))){assert.ok(urls.has(photo.optimizedSrc??photo.playSrc));assert.ok(urls.has(photo.thumbSrc));assert.ok(!urls.has(photo.src));if(photo.optimizedSrc)assert.ok(!urls.has(photo.playSrc));}
 for(const pack of plan.packs)for(const id of pack.imageIds)assert.ok(plan.photos.some(photo=>photo.id===id));
 assert.ok(plan.assets.every(file=>file.contentType==='image/webp'&&file.cacheControl.endsWith('immutable')));
});

test('delivery package writes only selected WebPs and verifiable metadata; repeated packaging is safe',()=>{
 const f=fixture();try{
  const result=packageMobileAssets({root:f.dir}),again=packageMobileAssets({root:f.dir});
  assert.equal(result.fileCount,4);assert.equal(result.totalBytes,again.totalBytes);assert.equal(result.publishedImages,1);assert.equal(result.archivedImages,1);
  assert.deepEqual(readdirSync(join(result.directory,'objects')),['puzzles']);assert.equal(readdirSync(join(result.directory,'objects/puzzles')).length,4);
  for(const file of result.files){const data=readFileSync(join(result.directory,'objects',file.path));assert.equal(digest(data),file.sha256);assert.equal(data.length,file.bytes);assert.ok(!file.source);}
  assert.equal(cacheControlForAsset('/puzzles/public-photo-optimized.webp','0'.repeat(64)),'public, max-age=86400');
  assert.throws(()=>cacheControlForAsset('/puzzles/public-photo-optimized-111111111111.webp','0'.repeat(64)),/hash differs/);
  writeFileSync(join(result.directory,'do-not-touch.txt'),'other work');assert.throws(()=>packageMobileAssets({root:f.dir}),/unrecognized files/);assert.equal(readFileSync(join(result.directory,'do-not-touch.txt'),'utf8'),'other work');
 }finally{f.cleanup();}
});

test('missing, unlisted, tampered, unreviewed and private paths fail before output is written',()=>{
 const cases=[
  [f=>unlinkSync(join(f.dir,'public',f.paths[0].slice(1))),/Missing puzzle asset/],
  [f=>writeJson(join(f.dir,'h5/asset-manifest.json'),f.paths.slice(1)),/Unlisted/],
  [f=>writeFileSync(join(f.dir,'public',f.paths[0].slice(1)),'secret plaintext'),/not a WebP/],
  [f=>{const p=join(f.dir,'content/image-provenance/public-photo.json'),record=readJson(p);record.review.status='draft';writeJson(p,record);},/Unreviewed/],
  [f=>{f.photos[0].optimizedSrc='/puzzles/../../.env';writeJson(join(f.dir,'content/puzzle-catalog.json'),f.photos);},/Unsafe or private/],
  [f=>writeJson(join(f.dir,'h5/asset-manifest.json'),[...f.paths,'/private/player.sqlite']),/Unsafe or private/],
  [f=>{f.photos[0].optimizedSrc=f.photos[0].src;writeJson(join(f.dir,'content/puzzle-catalog.json'),f.photos);},/Unlisted/],
  [f=>writeJson(join(f.dir,'lib/mobile-collection-catalog.json'),{packs:[{id:'wrong-pack',imageIds:['missing-photo']}]}),/missing or unpublished/],
 ];
 for(const [mutate,error]of cases){const f=fixture();try{mutate(f);assert.throws(()=>packageMobileAssets({root:f.dir}),error);assert.equal(existsSync(join(f.dir,'outputs/mobile-assets')),false);}finally{f.cleanup();}}
});
