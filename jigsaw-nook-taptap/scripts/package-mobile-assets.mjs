import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isPlayableOrigin,isRetained} from './image-origin.mjs';

const projectRoot=resolve(import.meta.dirname,'..');
const schema='jigsaw-mobile-assets/v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const privatePath=/(?:^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*|\.git|\.aws|\.codex|data|backups|private|uploads|node_modules)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)(?:$|\.)/i;
const puzzlePath=/^\/puzzles\/[a-z0-9-]+-(?:optimized|play|thumbnail)(?:-[a-f0-9]{12})?\.webp$/;

function safeManifestPath(path){
 if(typeof path!=='string'||!/^\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..')||path.includes('//')||privatePath.test(path))throw Error('Unsafe or private asset manifest path');
 return path;
}

// Validate every existing ancestor as well as the leaf; a symlinked puzzles folder
// must never turn a public asset package into a copy of files outside the project.
function safePath(root,path){
 const target=resolve(path),parts=relative(root,target).split(sep);
 if(!target.startsWith(root+sep)||parts.includes('..'))throw Error('Asset path escapes its project directory');
 let current=root;
 for(const part of parts){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Asset paths cannot contain symbolic links');}
 return target;
}

function filesIn(root,dir=root){
 if(!existsSync(dir))return [];
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const path=safePath(root,join(dir,entry.name));
  if(entry.isDirectory())return filesIn(root,path);
  if(!entry.isFile())throw Error('Asset package contains a non-file entry');
  return [relative(root,path).split(sep).join('/')];
 });
}

export function cacheControlForAsset(url,sha256){
 const digest=/-([a-f0-9]{12})\.webp$/.exec(url)?.[1];
 if(digest&&digest!==sha256.slice(0,12))throw Error('Asset filename hash differs from its content');
 return digest?'public, max-age=31536000, immutable':'public, max-age=86400';
}

/** Public, reviewed catalog artwork only. No production engine/database is imported. */
export function planMobileAssets(root=projectRoot){
 root=realpathSync(root);
 const catalog=json(safePath(root,join(root,'content/puzzle-catalog.json')));
 const manifest=json(safePath(root,join(root,'h5/asset-manifest.json')));
 const collection=json(safePath(root,join(root,'lib/mobile-collection-catalog.json')));
 if(!Array.isArray(catalog)||!Array.isArray(manifest)||!Array.isArray(collection.packs))throw Error('Invalid public asset catalogs');
 const allowed=new Set(manifest.map(safeManifestPath)),photos=[],sources=new Map(),ids=new Set();
 for(const photo of catalog){
  if(!isPlayableOrigin(photo?.origin))throw Error('Unregistered image origin');
  if(!isRetained(photo))continue;
  if(!/^[a-z0-9-]+$/.test(photo.id)||ids.has(photo.id))throw Error('Invalid or duplicate public image ID');
  ids.add(photo.id);
  const record=json(safePath(root,join(root,'content/image-provenance',photo.id+'.json')));
  if(record.id!==photo.id||record.origin!==photo.origin||record.review?.status!=='reviewed')throw Error('Unreviewed image: '+photo.id);
  const runtime={id:photo.id,status:photo.status,src:photo.optimizedSrc??photo.playSrc,thumbSrc:photo.thumbSrc};
  for(const [kind,url] of [[photo.optimizedSrc?'optimized':'play',runtime.src],['thumbnail',runtime.thumbSrc]]){
   safeManifestPath(url);
   if(!puzzlePath.test(url)||!new RegExp('^/puzzles/'+photo.id+'-'+kind+'(?:-[a-f0-9]{12})?\\.webp$').test(url)||!allowed.has(url))throw Error('Unlisted public puzzle asset: '+photo.id);
   const source=safePath(root,join(root,'public',url.slice(1)));
   if(!existsSync(source)||!lstatSync(source).isFile())throw Error('Missing puzzle asset: '+url);
   const bytes=readFileSync(source),sha256=hash(bytes),delivery=record.delivery?.[kind];
   if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Puzzle asset is not a WebP image: '+url);
   if(delivery?.src!==url||delivery.sha256!==sha256||delivery.bytes!==bytes.length)throw Error('Puzzle asset differs from its reviewed delivery record: '+url);
   sources.set(url,{source,url,path:url.slice(1),bytes:bytes.length,sha256,contentType:'image/webp',cacheControl:cacheControlForAsset(url,sha256)});
  }
  photos.push(runtime);
 }
 if(!photos.some(photo=>photo.status==='published'))throw Error('Public image package is empty');
 const packs=collection.packs.map(pack=>{
  if(!/^[a-z0-9-]+$/.test(pack.id)||!Array.isArray(pack.imageIds)||!pack.imageIds.length||new Set(pack.imageIds).size!==pack.imageIds.length||pack.imageIds.some(id=>!photos.some(photo=>photo.id===id&&photo.status==='published')))throw Error('Image pack references missing or unpublished artwork');
  return {id:pack.id,imageIds:[...pack.imageIds]};
 });
 const assets=[...sources.values()].sort((a,b)=>a.url.localeCompare(b.url));
 return {root,photos,packs,assets};
}

export function packageMobileAssets({root=projectRoot,outDir}={}){
 const plan=planMobileAssets(root);root=plan.root;
 const output=safePath(root,outDir??join(root,'outputs/mobile-assets'));
 if(!output.startsWith(join(root,'outputs')+sep))throw Error('Asset package output must be inside this project outputs directory');
 const previousPath=join(output,'asset-manifest.json'),existing=filesIn(root,output).map(path=>relative(output,join(root,path)).split(sep).join('/'));
 let previous=null;
 if(existsSync(previousPath)){
  previous=json(previousPath);
  if(previous.schema!==schema||!Array.isArray(previous.files))throw Error('Output is not a generated mobile asset package');
  for(const file of previous.files)if(typeof file.path!=='string'||!puzzlePath.test('/'+file.path)||privatePath.test(file.path))throw Error('Unsafe previous asset package manifest');
 }
 const owned=new Set(['asset-manifest.json','README.md',...(previous?.files??[]).map(file=>'objects/'+file.path)]);
 if(existing.some(path=>!previous||!owned.has(path)))throw Error('Output contains unrecognized files; use a clean asset package output directory');
 const next=new Set(plan.assets.map(file=>'objects/'+file.path));
 // Delete only explicitly owned stale package files, never recursively delete folders.
 for(const path of existing.filter(path=>path.startsWith('objects/')&&!next.has(path)))unlinkSync(safePath(root,join(output,path)));
 for(const asset of plan.assets){const target=safePath(root,join(output,'objects',asset.path));mkdirSync(dirname(target),{recursive:true});copyFileSync(asset.source,target);}
 const report={schema,createdAt:new Date().toISOString(),scope:'Shared Canvas public catalog and archived room artwork; no private images or original PNGs',publishedImages:plan.photos.filter(photo=>photo.status==='published').length,archivedImages:plan.photos.filter(photo=>photo.status==='archived').length,totalBytes:plan.assets.reduce((n,file)=>n+file.bytes,0),fileCount:plan.assets.length,photos:plan.photos,packs:plan.packs,files:plan.assets.map(({source,...file})=>file)};
 mkdirSync(output,{recursive:true});writeFileSync(previousPath,JSON.stringify(report,null,2)+'\n');
 writeFileSync(join(output,'README.md'),`# Shared mobile public artwork\n\nGenerated by scripts/package-mobile-assets.mjs. Upload only the contents of objects/ to the approved CDN asset base, retaining puzzles/ and every filename. asset-manifest.json records hashes and response headers; it is delivery metadata, not game/player data.\n\nIncludes ${report.publishedImages} published and ${report.archivedImages} archived images (${report.fileCount} WebP files, ${report.totalBytes} bytes). Archived artwork remains for existing rooms. Includes current shared Canvas display images and thumbnails; excludes source PNGs, unused lossless/legacy derivatives, runtime uploads, accounts, saves, databases and secrets. Do not replace the legacy PC/H5 assets directory with this smaller package.\n\nServe image/webp, Access-Control-Allow-Origin: *, Cross-Origin-Resource-Policy: cross-origin and X-Content-Type-Options: nosniff. Apply each file's Cache-Control from asset-manifest.json; do not alter hashed file bytes, force image recompression, or cache 404 errors. Preserve old published hashed objects when adding new releases. The CDN URL must use HTTPS, and its host must be allowed in each platform's download/request settings.\n\nThe separate CDN is not activated automatically. After uploading and verifying files, set JIGSAW_SHARED_ASSET_BASE to its public base URL before building both clients. API endpoints stay unchanged. No cloud accounts, paid resources, uploads or production changes are performed by this command.\n`);
 return {directory:output,...report};
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 if(process.argv.length>2)throw Error('Usage: node scripts/package-mobile-assets.mjs');
 const {directory,publishedImages,archivedImages,fileCount,totalBytes}=packageMobileAssets();
 console.log(JSON.stringify({directory,publishedImages,archivedImages,fileCount,totalBytes},null,2));
}
