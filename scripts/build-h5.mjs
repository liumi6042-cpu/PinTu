import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,statSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runtimeAssets,TAR} from './release-files.mjs';
import {checkImageLibrary} from './check-image-library.mjs';
import {resetGeneratedStage} from './generated-stage.mjs';
const root=process.cwd();
const pixelAssets=spawnSync(process.execPath,[resolve(root,'scripts/build-pixel-ui.mjs'),'--check'],{stdio:'inherit',windowsHide:true});
if(pixelAssets.status!==0||pixelAssets.error)throw Error('Pixel UI assets do not match their source generator');
await checkImageLibrary(root);
const source=JSON.parse(readFileSync('h5/source-version.json','utf8'));
const game=JSON.parse(readFileSync('config/taptap-game.json','utf8'));
const assets=runtimeAssets(JSON.parse(readFileSync('content/puzzle-catalog.json','utf8')),JSON.parse(readFileSync('config/runtime-assets.json','utf8')));
const previews=assets.filter(url=>/^\/puzzles\/.*-thumbnail-[a-f0-9]{12}\.webp$/.test(url));
writeFileSync('h5/preview-assets.json',JSON.stringify(previews,null,2)+'\n');
const stage=await resetGeneratedStage(root,'work/h5-shell-public');
const fontNotices=['OFL-NotoSansSC.txt','OFL-NotoSerifSC.txt','FONT-NOTICES.md','manifest.json'].map(name=>'licenses/fonts/'+name);
for(const path of fontNotices){const target=resolve(stage,path),source=resolve('public/fonts',path.slice('licenses/fonts/'.length));mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
for(const url of previews){const target=resolve(stage,'.'+url),source=resolve('public','.'+url);if(!target.startsWith(stage+sep)||!source.startsWith(resolve('public')+sep))throw Error('Invalid packaged preview');mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
writeFileSync('h5/asset-manifest.json',JSON.stringify(assets,null,2)+'\n');
for(const url of assets.filter(url=>url.startsWith('/favicon')||url.startsWith('/apple-touch'))){const target=resolve(stage,'.'+url),source=resolve('public','.'+url);if(!target.startsWith(stage+sep))throw Error('Invalid asset');mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
const apiBase=process.env.H5_PUBLIC_API_BASE||'https://jigsawnook.online/h5-mobile-v3';
const check=new URL(apiBase,'http://localhost/');
if(!['http:','https:'].includes(check.protocol)||check.username||check.password||check.hash||check.search)throw Error('Invalid H5 API base');
if(!apiBase.startsWith('./')&&check.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(check.hostname))throw Error('Public gateway requires HTTPS');
writeFileSync(resolve(stage,'config.js'),'window.JIGSAW_H5_CONFIG='+JSON.stringify({apiBase,gameBase:process.env.H5_PUBLIC_GAME_BASE||'https://jigsawnook.online/taptap-mobile-v3/'})+';\n');
await resetGeneratedStage(root,'outputs/h5');
const result=spawnSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--config','h5/vite.config.ts'],{stdio:'inherit',windowsHide:true});
if(result.status!==0||result.error)throw Error('H5 build failed');
const output=resolve('outputs/h5');
if(!existsSync(resolve(output,'index.html')))throw Error('H5 index missing');
const files=[];
const assetManifest=JSON.parse(readFileSync(resolve(output,'.vite/manifest.json'),'utf8'));
const selected=new Set(['index.html','config.js',...fontNotices,...previews.map(url=>url.slice(1)),...assets.filter(url=>url.startsWith('/favicon')||url.startsWith('/apple-touch')).map(url=>url.slice(1))]);
for(const entry of Object.values(assetManifest))for(const name of [entry.file,...(entry.css||[]),...(entry.assets||[])])selected.add(name);
for(const path of selected){const file=resolve(output,path);if(!file.startsWith(output+sep)||!existsSync(file))throw Error('Missing H5 output: '+path);files.push({path,bytes:statSync(file).size});}
const manifest={...source,zipRoot:'jigsaw-nook/',screenOrientation:1,builtAt:new Date().toISOString(),apiBase,files:files.length,bytes:files.reduce((n,x)=>n+x.bytes,0),packagedPreviewCount:previews.length,packagedPreviewBytes:previews.reduce((n,url)=>n+statSync(resolve(output,'.'+url)).size,0),adGateImplemented:true,adRewardsConfigured:Boolean(game.rewardedAdUnitId&&game.h5AdvertisingToolAuthorizationComplete),appId:game.appId,rewardedAdUnitId:game.rewardedAdUnitId,adRuntimeConfigEndpoint:apiBase+'/config',backendMode:'mobile-v3-isolated',releaseStatus:'development-preview',onlineEndpointVerified:false,adPolicy:{supplies:'one complete rewarded video per selected stored pack or ticket; max three of each',hint:'first room protected; two free uses per room, then one complete rewarded video per 30-second activation',underlay:'first room protected; two free uses per room, then one complete rewarded video per 30-second activation'}};
manifest.fontNotices=fontNotices;
writeFileSync(resolve(output,'h5-build.json'),JSON.stringify(manifest,null,2)+'\n');
mkdirSync('releases',{recursive:true});
const archive=resolve('releases/jigsaw-nook-taptap-h5.zip');
const zipStage=await resetGeneratedStage(root,'work/h5-platform-zip'),gameRoot=resolve(zipStage,'jigsaw-nook');
mkdirSync(gameRoot,{recursive:true});
for(const path of [...files.map(file=>file.path),'h5-build.json']){const target=resolve(gameRoot,path);if(!target.startsWith(gameRoot+sep))throw Error('Unsafe H5 ZIP path');mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(output,path),target);}
const packed=spawnSync(TAR,['-a','-cf',archive,'-C',zipStage,...files.map(file=>'jigsaw-nook/'+file.path),'jigsaw-nook/h5-build.json'],{stdio:'inherit',windowsHide:true});
if(packed.status!==0||packed.error)throw Error('H5 ZIP failed');
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync('releases/jigsaw-nook-taptap-h5.sha256',digest+'  jigsaw-nook-taptap-h5.zip\n');
writeFileSync('releases/h5-build.json',JSON.stringify({...manifest,zipBytes:statSync(archive).size,sha256:digest},null,2)+'\n');
console.log(JSON.stringify({archive,zipBytes:statSync(archive).size,sha256:digest,files:files.length},null,2));
