import assert from 'node:assert/strict';
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TAR} from './release-files.mjs';

// The installed runtime is the only code baseline. Append the three approved
// catalog records and trusted versions, without bringing in other source edits.
const root=resolve(import.meta.dirname,'..');
const release=process.argv[2]??'20261016-blossom41';
assert.match(release,/^\d{8}-[a-z0-9-]{2,32}$/);
const ids=['blossom-rainy-flower-lane-v1','blossom-osmanthus-tea-courtyard-v1','blossom-firefly-conservatory-v1'];
const baseline=resolve(root,'work/mobile-backend-releases/20261015-artwork40');
const baselineBytes=readFileSync(resolve(baseline,'release.json')),previous=JSON.parse(baselineBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(baselineBytes),'2f90ac23d60b58bd6d0825c3c0fcd0c22e5f90d905e41d01bc42576f23c5f5c8');
assert.equal(previous.release,'20261015-artwork40');
assert.equal(previous.frontendIncluded,false);
const stage=resolve(root,'work/mobile-backend-releases',release),archive=resolve(root,'releases/jigsaw-mobile-sparse-'+release+'.tar.gz');
assert(!existsSync(stage)&&!existsSync(archive),'Use a fresh immutable release name');
const save=(path,bytes)=>{const full=resolve(stage,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,bytes);};
const read=(base,path)=>readFileSync(resolve(base,path),'utf8');
const catalog=JSON.parse(read(root,'content/puzzle-catalog.json'));
const oldCatalog=JSON.parse(read(baseline,'content/puzzle-catalog.json'));
assert.equal(catalog.length,oldCatalog.length+ids.length);
assert.deepEqual(catalog.filter(photo=>!ids.includes(photo.id)),oldCatalog,'Existing catalog entries changed');
const added=ids.map(id=>{const photo=catalog.find(item=>item.id===id);assert(photo);assert.equal(photo.status,'archived');return photo;});
const beforeRegistry=JSON.parse(read(baseline,'content/artwork-revisions.json'));
const registry=JSON.parse(read(root,'content/artwork-revisions.json'));
assert.deepEqual(registry.active,beforeRegistry.active);assert.deepEqual(registry.legacy,beforeRegistry.legacy);assert.deepEqual(registry.files,beforeRegistry.files);
assert.deepEqual(Object.fromEntries(Object.entries(registry.versions).filter(([id])=>!ids.includes(id))),beforeRegistry.versions);
assert.equal(Object.keys(registry.versions).length,Object.keys(beforeRegistry.versions).length+ids.length);

// Verify every baseline byte before declaring it reusable. The review stage
// deliberately contains only code and changed images; it is not a full install.
for(const item of previous.files){
 const bytes=readFileSync(resolve(baseline,item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256,'Frozen baseline changed: '+item.path);
 if(!item.path.startsWith('public/'))save(item.path,bytes);
}
let engine=read(baseline,'outputs/mobile/engine.mjs');
const catalogPattern=/var puzzle_catalog_default = \/\* @__PURE__ \*\/ JSON\.parse\(("(?:[^"\\]|\\.)*")\);/;
const match=engine.match(catalogPattern);assert(match);assert.deepEqual(JSON.parse(JSON.parse(match[1])),oldCatalog);
const newCatalogBlock='var puzzle_catalog_default = /* @__PURE__ */ JSON.parse('+JSON.stringify(JSON.stringify([...oldCatalog,...added]))+');';
engine=engine.replace(catalogPattern,()=>newCatalogBlock);
const guidancePattern=/var records = (\{[\s\S]*?\n\});\nfunction photoGuidance\(/;
const guidanceMatch=engine.match(guidancePattern);assert(guidanceMatch);
const oldGuidance=JSON.parse(guidanceMatch[1]),sourceGuidance=JSON.parse(read(root,'content/puzzle-guidance.json'));
for(const id of ids){assert(!Object.hasOwn(oldGuidance,id));assert(sourceGuidance[id]);}
const newGuidance={...oldGuidance,...Object.fromEntries(ids.map(id=>[id,sourceGuidance[id]]))};
const guidanceBlock='var records = '+JSON.stringify(newGuidance,null,2)+';\nfunction photoGuidance(';
engine=engine.replace(guidancePattern,()=>guidanceBlock);
const stripData=value=>value.replace(catalogPattern,'CATALOG').replace(guidancePattern,'GUIDANCE');
assert.equal(stripData(engine),stripData(read(baseline,'outputs/mobile/engine.mjs')),'Non-catalog puzzle engine code changed');
save('outputs/mobile/engine.mjs',engine);
await build({configFile:false,publicDir:false,build:{ssr:resolve(root,'lib/room-artwork.ts'),target:'node24',outDir:resolve(stage,'outputs/mobile'),emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'artwork.mjs'}}}});
const resolverLogic=value=>{const start=value.indexOf('//#region lib/room-artwork.ts');assert(start>=0);return value.slice(start);};
assert.equal(resolverLogic(read(stage,'outputs/mobile/artwork.mjs')),resolverLogic(read(baseline,'outputs/mobile/artwork.mjs')),'Trusted artwork resolver code changed outside its image registry');
save('content/puzzle-catalog.json',readFileSync(resolve(root,'content/puzzle-catalog.json')));
save('content/artwork-revisions.json',readFileSync(resolve(root,'content/artwork-revisions.json')));
const previousAssets=JSON.parse(read(baseline,'h5/asset-manifest.json'));
const newAssets=added.flatMap(photo=>['playSrc','thumbSrc','optimizedSrc'].map(key=>{assert.match(photo[key],new RegExp('^/puzzles/'+photo.id+'-(?:play|thumbnail|optimized)-[a-f0-9]{12}\\.webp$'));return photo[key];}));
const assets=[...new Set([...previousAssets,...newAssets])].sort();assert.equal(assets.length,previousAssets.length+9);
save('h5/asset-manifest.json',JSON.stringify(assets,null,2)+'\n');
const newFiles=[];
for(const photo of added){
 const provenance='content/image-provenance/'+photo.id+'.json';save(provenance,readFileSync(resolve(root,provenance)));newFiles.push(provenance);
 const record=JSON.parse(read(stage,provenance));
 const version=registry.versions[photo.id];assert.equal(version.length,1);assert.deepEqual(version[0],{revision:record.sha256,src:photo.optimizedSrc,thumbSrc:photo.thumbSrc,width:record.width,height:record.height});
 for(const [key,kind] of [['playSrc','play'],['thumbSrc','thumbnail'],['optimizedSrc','optimized']]){
  const file='public'+photo[key],bytes=readFileSync(resolve(root,file)),facts=record.delivery[kind];
  assert.equal(facts.src,photo[key]);assert.equal(facts.bytes,bytes.length);assert.equal(facts.sha256,sha(bytes));assert.equal(facts.sourceSha256,record.sha256);
  assert.equal(photo[key],'/puzzles/'+photo.id+'-'+kind+'-'+sha(bytes).slice(0,12)+'.webp');
  if(kind==='optimized'){assert.equal(facts.quality,70);assert.equal(facts.width,2144);assert.equal(facts.height,2144);}
  save(file,bytes);newFiles.push(file);
 }
}
const changedPaths=['outputs/mobile/engine.mjs','outputs/mobile/artwork.mjs','content/puzzle-catalog.json','content/artwork-revisions.json','h5/asset-manifest.json'];
const inventory=previous.files.map(item=>changedPaths.includes(item.path)?{path:item.path,bytes:readFileSync(resolve(stage,item.path)).length,sha256:sha(readFileSync(resolve(stage,item.path)))}:item);
for(const path of newFiles){assert(!inventory.some(item=>item.path===path));const bytes=readFileSync(resolve(stage,path));inventory.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const manifest={service:'jigsaw-mobile-v3',release,node:'>=24.0.0',backendMode:'mobile-v3-isolated',packageKind:'full',baseRelease:previous.release,baseManifestSha256:sha(baselineBytes),frontendIncluded:false,createdAt:new Date().toISOString(),artworkOverlay:previous.artworkOverlay,files:inventory,assetCount:assets.length};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');save('release.json',manifestBytes);
const beforeByPath=new Map(previous.files.map(item=>[item.path,item]));
const changed=inventory.filter(item=>JSON.stringify(beforeByPath.get(item.path))!==JSON.stringify(item));
assert.deepEqual(changed.filter(item=>beforeByPath.has(item.path)).map(item=>item.path).sort(),changedPaths.sort());
const descriptor={schema:'jigsaw-mobile-sparse-transfer/v1',baseRelease:previous.release,baseManifestSha256:sha(baselineBytes),release,manifestSha256:sha(manifestBytes),payload:changed.map(item=>item.path),reusedFiles:inventory.length-changed.length};
save('sparse-transfer.json',JSON.stringify(descriptor,null,2)+'\n');
const list=resolve(root,'work/mobile-backend-releases',release+'.files');writeFileSync(list,['sparse-transfer.json','release.json',...descriptor.payload].join('\0')+'\0');
const packed=spawnSync(TAR,['-czf',archive,'-C',stage,'--null','-T',list],{windowsHide:true,stdio:'inherit'});assert.equal(packed.status,0);
// Baseline metadata and all unchanged engine functions remain immutable.
assert.equal(sha(readFileSync(resolve(baseline,'release.json'))),sha(baselineBytes));
const bytes=readFileSync(archive),report={release,stage,sparseOnlyReviewStage:true,archive,sha256:sha(bytes),bytes:bytes.length,manifestSha256:sha(manifestBytes),baseRelease:previous.release,baseManifestSha256:sha(baselineBytes),files:inventory.length,assetCount:assets.length,newImages:ids,addedFiles:newFiles,changedExistingFiles:changedPaths,payloadFiles:changed.length,reusedFiles:descriptor.reusedFiles,serverAndConfigByteIdentical:true,engineOnlyCatalogAndGuidanceChanged:true,activeRevisions:34,legacyRevisions:34,frontendIncluded:false,prepared:true,tested:false,deployed:false};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
