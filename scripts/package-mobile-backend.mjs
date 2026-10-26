import {build} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runtimeAssets,TAR} from './release-files.mjs';
import {checkImageLibrary} from './check-image-library.mjs';
import {checkArtworkRevisions} from './check-artwork-revisions.mjs';
import {buildRoomRealtime} from './build-room-realtime.mjs';

// API-only release: does not rebuild or deploy either platform's frontend.
// Optional: --base <installed release.json> declares the baseline (for a sparse transfer), and
// --keep-assets <installed h5/asset-manifest.json> keeps every URL the installed release serves, so
// older clients that still request earlier hashes keep working. Files absent locally are taken from
// --asset-fallback <dir> (a verified copy of the installed public tree).
const release=process.argv[2],option=key=>{const i=process.argv.indexOf(key);return i>0?process.argv[i+1]:undefined;};
if(!/^\d{8}-[a-z0-9-]{2,32}$/.test(release||''))throw Error('Usage: node scripts/package-mobile-backend.mjs YYYYMMDD-name [--base release.json] [--keep-assets asset-manifest.json] [--asset-fallback dir]');
const basePath=option('--base'),keepPath=option('--keep-assets'),fallback=option('--asset-fallback');
const root=realpathSync(process.cwd()),stage=resolve('work/mobile-backend-releases',release);
const archive=resolve('releases/jigsaw-mobile-backend-'+release+'.tar.gz');
if(existsSync(stage)||existsSync(archive))throw Error('Use a fresh mobile release identifier; prepared packages are immutable');
mkdirSync(stage,{recursive:true});if(realpathSync(stage)!==stage)throw Error('Release stage cannot be a link');
await checkImageLibrary(root);
const artworkOverlay=await checkArtworkRevisions(root);
await build({configFile:false,publicDir:false,build:{ssr:resolve('server/mobile-engine.entry.ts'),target:'node24',outDir:resolve(stage,'outputs/mobile'),emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'engine.mjs'}}}});
await buildRoomRealtime(resolve(stage,'outputs/mobile'));
const runtime=JSON.parse(readFileSync('config/runtime-assets.json','utf8'));
const catalog=JSON.parse(readFileSync('content/puzzle-catalog.json','utf8'));
const current=runtimeAssets(catalog,{static:runtime.static.filter(path=>/^\/(?:cosmetics\/|favicon|apple-touch)/.test(path))});
const kept=keepPath?JSON.parse(readFileSync(keepPath,'utf8')):[];
for(const url of kept)if(typeof url!=='string'||!/^\/(?:puzzles\/|cosmetics\/(?:assets\/)?)?[a-zA-Z0-9._-]+$/.test(url))throw Error('Unsafe kept asset: '+url);
const assets=[...new Set([...current,...kept])].sort();
const files=['server/h5-gateway.mjs','server/mobile-service.mjs','server/diagnostic-actions.mjs','server/guest-names.mjs','server/room-realtime.LICENSE.txt','server/mobile-room-history.mjs','server/tap-preview.mjs','server/mobile-social.mjs','server/mobile-privacy.mjs','server/mobile-events.mjs','config/social-phrases.json','server/daily-content.mjs','server/mobile-collection.mjs','server/mobile-economy.mjs','server/mobile-tasks.mjs','server/task-reward-settings.mjs','config/task-reward-defaults.json','server/game-settings.mjs','config/game-settings-defaults.json','server/album-content.mjs','server/content-release.mjs','server/mobile-managed-content.mjs','server/managed-daily-content.mjs','scripts/check-content-release.mjs','lib/mobile-collection-catalog.json','lib/decoration-policy.mjs','lib/tap-platform-id.mjs','scripts/check-artwork-revisions.mjs','content/artwork-revisions.json','content/puzzle-catalog.json',...catalog.map(photo=>'content/image-provenance/'+photo.id+'.json'),...assets.map(path=>'public'+path)];
for(const file of files){
 if(/(?:^|\/)(?:\.env[^/]*|\.git|data|backups|node_modules)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)$/i.test(file))throw Error('Private data in release');
 const local=resolve(file),fromFallback=fallback&&file.startsWith('public/')&&!existsSync(local);
 const source=realpathSync(fromFallback?resolve(fallback,file):local),target=resolve(stage,file);
 if(!source.startsWith(root+sep)||!target.startsWith(stage+sep))throw Error('Unsafe release path');
 mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
}
mkdirSync(resolve(stage,'h5'),{recursive:true});writeFileSync(resolve(stage,'h5/asset-manifest.json'),JSON.stringify(assets,null,2)+'\n');
files.push('outputs/mobile/engine.mjs','outputs/mobile/room-realtime.mjs','h5/asset-manifest.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseBytes=basePath?readFileSync(basePath):null,base=baseBytes?JSON.parse(baseBytes):null;
if(base&&(base.service!=='jigsaw-mobile-v3'||base.release===release))throw Error('Invalid base release');
const manifest={service:'jigsaw-mobile-v3',release,...(base?{baseRelease:base.release,baseManifestSha256:sha(baseBytes)}:{}),node:'>=24.0.0',backendMode:'mobile-v3-isolated',packageKind:'full',frontendIncluded:false,artworkOverlay:{activeImages:artworkOverlay.activeImages,files:artworkOverlay.overlayFiles},adConfigured:false,createdAt:new Date().toISOString(),files:files.map(path=>{const bytes=readFileSync(resolve(stage,path));return {path,bytes:bytes.length,sha256:sha(bytes)};}),assetCount:assets.length};
writeFileSync(resolve(stage,'release.json'),JSON.stringify(manifest,null,2)+'\n');
mkdirSync('releases',{recursive:true});const list=resolve('work/mobile-backend-releases',release+'.files');
writeFileSync(list,[...files,'release.json'].join('\0')+'\0');
const result=spawnSync(TAR,['-czf',archive,'-C',stage,'--null','-T',list],{stdio:'inherit',windowsHide:true});if(result.status!==0||result.error)throw Error('Backend archive failed');
const report={release,archive,sha256:sha(readFileSync(archive)),bytes:statSync(archive).size,files:files.length,assetCount:assets.length};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
