import {build} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runtimeAssets,mobileStaticAsset,hash,TAR} from './release-files.mjs';
import {checkImageLibrary} from './check-image-library.mjs';
import {buildRoomRealtime} from './build-room-realtime.mjs';

// Code-only upgrade requires byte-for-byte compatibility with every runtime
// asset in the installed release. New resources require the full API package.
const keepInstalled=process.argv.includes('--keep-installed-assets'),positional=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const release=positional[0],baselinePath=positional[1]||'work/mobile-backend-releases/20261011-wechat01/release.json';
if(!/^\d{8}-[a-z0-9-]{2,32}$/.test(release||''))throw Error('Usage: node scripts/package-mobile-upgrade.mjs YYYYMMDD-name [baseline-release.json]');
const root=realpathSync(process.cwd()),baselineBytes=readFileSync(baselinePath),baseline=JSON.parse(baselineBytes);
if(baseline.service!=='jigsaw-mobile-v3'||baseline.frontendIncluded!==false||!/^\d{8}-[a-z0-9-]{2,32}$/.test(baseline.release)||baseline.release===release)throw Error('Invalid baseline release');
await checkImageLibrary(root);
const runtime=JSON.parse(readFileSync('config/runtime-assets.json','utf8'));
const wanted=runtimeAssets(JSON.parse(readFileSync('content/puzzle-catalog.json','utf8')),{static:runtime.static.filter(mobileStaticAsset)});
// --keep-installed-assets: the installed release keeps legacy URLs that old clients still request (it was
// packaged with --keep-assets). Serve exactly that verified list; current assets must be an unchanged subset.
let assets=wanted;
if(keepInstalled){
 const installedPath=resolve(dirname(resolve(baselinePath)),'h5/asset-manifest.json'),installedBytes=readFileSync(installedPath),record=baseline.files.find(file=>file.path==='h5/asset-manifest.json');
 if(!record||record.sha256!==hash(installedBytes)||record.bytes!==installedBytes.length)throw Error('Installed asset manifest does not match the baseline release');
 const installed=JSON.parse(installedBytes),known=new Set(installed),missing=wanted.filter(path=>!known.has(path));
 if(missing.length)throw Error('New runtime resources need the full package: '+JSON.stringify(missing));
 assets=installed;
}
const previous=new Map(baseline.files.filter(file=>file.path.startsWith('public/')).map(file=>[file.path,file]));
const current=wanted.map(path=>{const name='public'+path,source=realpathSync(resolve(name));if(!source.startsWith(root+sep))throw Error('Asset escapes project');const bytes=readFileSync(source);return {path:name,bytes:bytes.length,sha256:hash(bytes)};});
const changed=current.filter(file=>!previous.has(file.path)||previous.get(file.path).sha256!==file.sha256||previous.get(file.path).bytes!==file.bytes).map(file=>file.path);
const names=new Set(current.map(file=>file.path)),removed=keepInstalled?[]:[...previous.keys()].filter(path=>!names.has(path));
if(changed.length||removed.length)throw Error('Runtime resources differ; use package-mobile-backend.mjs (full package). '+JSON.stringify({changed,removed}));
const stage=resolve('work/mobile-upgrade-releases',release);
if(existsSync(stage))throw Error('Upgrade stage already exists; choose a fresh release name');
mkdirSync(stage,{recursive:true});if(realpathSync(stage)!==stage)throw Error('Upgrade stage cannot be a link');
await build({configFile:false,publicDir:false,build:{ssr:resolve('server/mobile-engine.entry.ts'),target:'node24',outDir:resolve(stage,'outputs/mobile'),emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'engine.mjs'}}}});
await buildRoomRealtime(resolve(stage,'outputs/mobile'));
const files=['server/h5-gateway.mjs','server/mobile-service.mjs','server/mobile-room-history.mjs','server/tap-preview.mjs','server/mobile-social.mjs','server/mobile-privacy.mjs','server/mobile-events.mjs','server/mobile-levels.mjs','config/levels.json','config/social-phrases.json','server/daily-content.mjs','server/mobile-collection.mjs','server/mobile-economy.mjs','server/mobile-tasks.mjs','server/task-reward-settings.mjs','config/task-reward-defaults.json','server/game-settings.mjs','config/game-settings-defaults.json','server/album-content.mjs','server/content-release.mjs','server/mobile-managed-content.mjs','server/managed-daily-content.mjs','scripts/check-content-release.mjs','lib/mobile-collection-catalog.json','lib/tap-platform-id.mjs'];
for(const path of files){const from=realpathSync(resolve(path)),to=resolve(stage,path);if(!from.startsWith(root+sep)||!to.startsWith(stage+sep))throw Error('Unsafe code path');mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);}
mkdirSync(resolve(stage,'h5'),{recursive:true});writeFileSync(resolve(stage,'h5/asset-manifest.json'),JSON.stringify(assets,null,2)+'\n');
mkdirSync(resolve(stage,'server'),{recursive:true});copyFileSync(realpathSync(resolve('server/room-realtime.LICENSE.txt')),resolve(stage,'server/room-realtime.LICENSE.txt'));
files.push('outputs/mobile/engine.mjs','outputs/mobile/room-realtime.mjs','server/room-realtime.LICENSE.txt','h5/asset-manifest.json');
// The upgrade extracts into an empty release directory, so a delta over a full release must also carry
// every other installed code/content file. Copy them unchanged from the local baseline copy, hash-checked.
if(keepInstalled){
 const baseDir=dirname(resolve(baselinePath)),built=new Set(files);
 for(const item of baseline.files){
  if(item.path.startsWith('public/')||item.path==='release.json'||built.has(item.path))continue;
  const from=resolve(baseDir,item.path),to=resolve(stage,item.path);
  if(!from.startsWith(baseDir+sep)||!to.startsWith(stage+sep))throw Error('Unsafe baseline path');
  const bytes=readFileSync(from);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Local baseline copy differs from its manifest: '+item.path);
  mkdirSync(dirname(to),{recursive:true});writeFileSync(to,bytes);files.push(item.path);
 }
}
const code=files.map(path=>{const bytes=readFileSync(resolve(stage,path));return {path,bytes:bytes.length,sha256:hash(bytes)};});
// Kept installed assets are recorded with their verified baseline entries; the server re-checks every file.
const publicFiles=keepInstalled?[...previous.values()]:current;
const manifest={service:'jigsaw-mobile-v3',release,packageKind:'code-delta',baseRelease:baseline.release,baseManifestSha256:hash(baselineBytes),node:'>=24.0.0',backendMode:'mobile-v3-isolated',frontendIncluded:false,createdAt:new Date().toISOString(),assetCount:assets.length,reusedAssets:true,files:[...code,...publicFiles]};
writeFileSync(resolve(stage,'release.json'),JSON.stringify(manifest,null,2)+'\n');
mkdirSync('releases',{recursive:true});const archive=resolve('releases/jigsaw-mobile-upgrade-'+release+'.tar.gz'),list=resolve('work/mobile-upgrade-releases',release+'.files');
if(existsSync(archive))throw Error('Upgrade archive already exists');
writeFileSync(list,[...files,'release.json'].join('\0')+'\0');
const packed=spawnSync(TAR,['-czf',archive,'-C',stage,'--null','-T',list],{stdio:'inherit',windowsHide:true});if(packed.status!==0||packed.error)throw Error('Upgrade archive failed');
const bytes=readFileSync(archive),before=new Map(baseline.files.map(file=>[file.path,file]));
const report={release,archive,sha256:hash(bytes),bytes:bytes.length,packageKind:'code-delta',baseRelease:baseline.release,baseManifestSha256:hash(baselineBytes),payloadFiles:files.length+1,reusedAssetCount:assets.length,reusedAssetBytes:publicFiles.reduce((sum,file)=>sum+file.bytes,0),resourceChanges:[],removedResources:[],newCode:code.filter(file=>!before.has(file.path)).map(file=>file.path),changedCode:code.filter(file=>before.has(file.path)&&before.get(file.path).sha256!==file.sha256).map(file=>file.path),frontendIncluded:false};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
