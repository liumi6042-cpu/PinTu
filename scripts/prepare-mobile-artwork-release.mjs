import assert from 'node:assert/strict';
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runtimeAssets,TAR} from './release-files.mjs';
import {checkImageLibrary} from './check-image-library.mjs';
import {checkArtworkRevisions} from './check-artwork-revisions.mjs';

// Freeze the installed 39 runtime and transplant only image-version support.
const root=realpathSync(resolve(import.meta.dirname,'..'));
const release=process.argv[2]??'20261015-artwork40';
assert.match(release,/^\d{8}-[a-z0-9-]{2,32}$/);
const baseline=realpathSync(resolve(root,'../content-admin/work/collection-ui-release-20261015/mobile/stage'));
const baselineBytes=readFileSync(resolve(baseline,'release.json')),previous=JSON.parse(baselineBytes);
assert.equal(previous.release,'20261015-freealbums39');assert.equal(previous.frontendIncluded,false);
const stage=resolve(root,'work/mobile-backend-releases',release),archive=resolve(root,'releases/jigsaw-mobile-backend-'+release+'.tar.gz');
assert(!existsSync(stage)&&!existsSync(archive),'Use a fresh release name; reviewed packages are immutable');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=(base,file)=>readFileSync(resolve(base,file),'utf8').replace(/\r\n/g,'\n');
const save=(file,value)=>{const path=resolve(stage,file);assert(path.startsWith(stage+sep));mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);};
function one(text,oldValue,newValue){assert(oldValue&&newValue&&oldValue!==newValue);assert.equal(text.split(oldValue).length,2,'Expected one frozen baseline block');return text.replace(oldValue,newValue);}
function block(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a,'Expected source block '+start);return text.slice(a,b);}
function transplant(text,current,start,end){return one(text,block(text,start,end),block(current,start,end));}
const imageValidation=await checkImageLibrary(root),artworkOverlay=await checkArtworkRevisions(root);
mkdirSync(stage,{recursive:true});assert.equal(realpathSync(stage),stage);
const files=[];
for(const file of previous.files.filter(file=>!file.path.startsWith('public/'))){
 const bytes=readFileSync(resolve(baseline,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
 save(file.path,bytes);files.push(file.path);
}
const currentService=read(root,'server/mobile-service.mjs');let service=read(baseline,'server/mobile-service.mjs');
service=transplant(service,currentService,'const directionOf=','// Keep the artwork');
service=one(service,'const d=engine.photoGuidance(photo.id);if(!d||!MOBILE_COUNTS.includes(count))return null;','const d=Number.isFinite(photo.width)&&Number.isFinite(photo.height)?photo:engine.photoGuidance(photo.id);if(!d||!MOBILE_COUNTS.includes(count))return null;');
service=transplant(service,currentService,' const photoOf=',' function authorize(');
service=one(service,' function join(room,p,input,now){',' function join(room,p,input,now,request={}){\n  requireArtworkClient(room,request);');
service=transplant(service,currentService,"  if(path==='/api/daily'","  if(path==='/api/mobile/profile')");
service=transplant(service,currentService,'  const collectionView=','  if(path===\'/api/mobile/collection\'');
service=transplant(service,currentService,'   let cards=db.prepare(',"   const dir=url.searchParams.get('direction')");
service=transplant(service,currentService,"  if(path==='/api/rooms'&&method==='POST')",'  const match=/');
service=one(service,"if(!match)fail(404,'NOT_FOUND','接口不存在');const room=readRoom(match[1]),part=match[2];","if(!match)fail(404,'NOT_FOUND','接口不存在');const room=readRoom(match[1]),part=match[2];\n  if(part!=='management'&&method!=='DELETE'&&!(method==='POST'&&!part&&input.type==='leave'))requireArtworkClient(room,request);");
service=one(service,"if(part==='join'&&method==='POST')return join(room,p,input,now);","if(part==='join'&&method==='POST')return join(room,p,input,now,request);");
service=one(service,'const data=route(request,p,input,url,now);saveProfile(p);','const data=route(request,p,input,url,now);if(data?.room?.puzzle)requireArtworkClient(data.room,request);saveProfile(p);');
// Exclude source-only runtime profiles, cursor persistence, and reward/decoration edits.
assert(!service.includes('const web=options.runtimeProfile'));assert(!service.includes('pruneRoomCursors'));
save('server/mobile-service.mjs',service);
let gateway=read(baseline,'server/h5-gateway.mjs');const currentGateway=read(root,'server/h5-gateway.mjs');
gateway=one(gateway,"    if(request.headers['content-type'])headers.set('Content-Type',request.headers['content-type']);","    if(request.headers['content-type'])headers.set('Content-Type',request.headers['content-type']);\n    if(request.headers['x-jigsaw-artwork-snapshot']==='1')headers.set('X-Jigsaw-Artwork-Snapshot','1');");
gateway=transplant(gateway,currentGateway,"        if(!['GET','POST','DELETE','PATCH'].includes(method)","      }\n      response.setHeader('Access-Control-Expose-Headers'");
gateway=one(gateway,"authorization:request.headers.authorization});json(response,result.status,result.data);return;\n        }","authorization:request.headers.authorization,artworkSnapshot:request.headers['x-jigsaw-artwork-snapshot']==='1'});json(response,result.status,result.data);return;\n        }");
assert(!gateway.includes('MOBILE_RUNTIME_PROFILE'));save('server/h5-gateway.mjs',gateway);
// Retain the baseline puzzle implementation byte-for-byte. The added module
// contains only the trusted artwork resolver and its immutable public registry.
await build({configFile:false,publicDir:false,build:{ssr:resolve(root,'lib/room-artwork.ts'),target:'node24',outDir:resolve(stage,'outputs/mobile'),emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'artwork.mjs'}}}});
save('outputs/mobile/engine.mjs',readFileSync(resolve(baseline,'outputs/mobile/engine.mjs'),'utf8')+'\nexport {currentRoomArtwork,resolveRoomArtwork,roomUsesUpgradedArtwork,roomArtworkPhoto,activeArtworkPhoto} from "./artwork.mjs";\n');
files.push('outputs/mobile/artwork.mjs');
const catalog=JSON.parse(read(root,'content/puzzle-catalog.json')),runtime=JSON.parse(read(root,'config/runtime-assets.json'));
const assets=runtimeAssets(catalog,{static:runtime.static.filter(path=>/^\/(?:cosmetics\/|favicon|apple-touch)/.test(path))});
const assetPaths=new Set(assets.map(path=>'public'+path)),oldAssets=previous.files.filter(file=>file.path.startsWith('public/'));
assert.equal(oldAssets.length,610);assert.equal(assets.length,oldAssets.length+artworkOverlay.overlayFiles);
for(const item of oldAssets){assert(assetPaths.has(item.path),'Old room resource removed: '+item.path);const bytes=readFileSync(resolve(root,item.path));assert.equal(sha(bytes),item.sha256,'Old room resource changed: '+item.path);assert.equal(bytes.length,item.bytes);}
const extra=['scripts/check-artwork-revisions.mjs','content/artwork-revisions.json','content/puzzle-catalog.json',...catalog.map(photo=>'content/image-provenance/'+photo.id+'.json'),...assets.map(path=>'public'+path)];
for(const file of extra){assert(!files.includes(file));const from=realpathSync(resolve(root,file));assert(from.startsWith(root+sep));save(file,readFileSync(from));files.push(file);}
save('h5/asset-manifest.json',JSON.stringify(assets,null,2)+'\n');
const inventory=files.map(path=>{const bytes=readFileSync(resolve(stage,path));return{path,bytes:bytes.length,sha256:sha(bytes)};});
const manifest={service:'jigsaw-mobile-v3',release,node:'>=24.0.0',backendMode:'mobile-v3-isolated',packageKind:'full',baseRelease:previous.release,baseManifestSha256:sha(baselineBytes),frontendIncluded:false,createdAt:new Date().toISOString(),artworkOverlay:{activeImages:artworkOverlay.activeImages,files:artworkOverlay.overlayFiles},files:inventory,assetCount:assets.length};
save('release.json',JSON.stringify(manifest,null,2)+'\n');
mkdirSync(resolve(root,'releases'),{recursive:true});const list=resolve(root,'work/mobile-backend-releases',release+'.files');writeFileSync(list,[...files,'release.json'].join('\0')+'\0');
const packed=spawnSync(TAR,['-czf',archive,'-C',stage,'--null','-T',list],{windowsHide:true,stdio:'inherit'});assert.equal(packed.status,0,'API archive creation failed');
const before=new Map(previous.files.map(file=>[file.path,file])),changed=inventory.filter(file=>before.has(file.path)&&before.get(file.path).sha256!==file.sha256).map(file=>file.path).sort();
assert.deepEqual(changed,['h5/asset-manifest.json','outputs/mobile/engine.mjs','server/h5-gateway.mjs','server/mobile-service.mjs']);
const report={release,stage,archive,sha256:sha(readFileSync(archive)),bytes:readFileSync(archive).length,manifestSha256:sha(readFileSync(resolve(stage,'release.json'))),baseRelease:previous.release,baseManifestSha256:sha(baselineBytes),files:files.length,assetCount:assets.length,oldResourceCount:oldAssets.length,newArtworkFiles:artworkOverlay.overlayFiles,changedExistingFiles:changed,newFiles:inventory.filter(file=>!before.has(file.path)&&!file.path.startsWith('public/')).map(file=>file.path),baselineEngineSha256:before.get('outputs/mobile/engine.mjs').sha256,frozenOtherRuntime:true,frontendIncluded:false,imageValidation,prepared:true,tested:false};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
