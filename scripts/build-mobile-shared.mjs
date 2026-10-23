import {build} from 'esbuild';
import {readFileSync,mkdirSync,copyFileSync,writeFileSync,readdirSync,statSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
export function writeBundledArtwork(out,plan){
 for(const file of plan.files){
  if(file.path!=='assets'+file.url||!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play|thumb2x)-[a-f0-9]{12}\.webp$/.test(file.url))throw Error('Unsafe bundled artwork output');
  const bytes=file.data??readFileSync(file.source);
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Bundled artwork changed during build');
  const destination=join(out,file.path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes);
 }
}
export function sharedPlatformPlugins(config){
 return config.id==='wechat'&&config.nativeSocialEnabled===true?{MiniGameChat:{version:'latest',provider:'wx2ea687f4258401a9',contexts:[{type:'isolatedContext'}]}}:undefined;
}
export function resolveSharedConfig(input,env=process.env){
 const config={...input};
 // Preserve the existing API override, with a separate CDN override taking priority.
 if(env.JIGSAW_SHARED_API_BASE){config.apiBase=env.JIGSAW_SHARED_API_BASE;config.assetBase=config.apiBase.replace(/\/$/,'')+'/assets';}
 if(env.JIGSAW_SHARED_ASSET_BASE)config.assetBase=env.JIGSAW_SHARED_ASSET_BASE;
 if(env.JIGSAW_SHARED_GAME_BASE)config.gameBase=env.JIGSAW_SHARED_GAME_BASE;
 for(const field of ['apiBase','assetBase',...(config.gameBase?['gameBase']:[])]){
  const value=config[field];let url;
  try{url=new URL(value);}catch{throw Error('Invalid shared '+field);}
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(typeof value!=='string'||/\s|\\|[?#%]/.test(value)||url.username||url.password||
     !(url.protocol==='https:'||(config.development===true&&loopback&&url.protocol==='http:'))||
     value.replace(/\/+$/,'')!==url.href.replace(/\/+$/,''))throw Error('Invalid shared '+field+': use a clean HTTPS URL or development loopback URL');
  config[field]=value.replace(/\/+$/,'');
 }
 return config;
}

export async function buildMobileShared({outputRoot,production=false,prepareAssets=true,platforms=['wechat','taptap'],bundledArtwork=null,env=process.env}={}){
if(!Array.isArray(platforms)||!platforms.length||new Set(platforms).size!==platforms.length||platforms.some(id=>!['wechat','taptap','web'].includes(id)))throw Error('Choose one or more shared platforms: wechat, taptap, web');
let isolatedRoot;
if(outputRoot!==undefined){
 if(typeof outputRoot!=='string'||!outputRoot.trim())throw Error('Invalid isolated output root');
 isolatedRoot=resolve(root,outputRoot);
 const protectedRoots=[root,join(root,'outputs'),join(root,'outputs/shared-build'),join(root,'outputs/wechat-game'),join(root,'outputs/shared-web')];
 if(!isolatedRoot.startsWith(root+sep)||protectedRoots.some(path=>isolatedRoot===path||[join(root,'outputs/wechat-game'),join(root,'outputs/shared-web')].includes(path)&&isolatedRoot.startsWith(path+sep)))throw Error('Isolated output must not replace standard build directories');
 if(existsSync(isolatedRoot))throw Error('Isolated output directory already exists; choose a fresh directory');
 let ancestor=dirname(isolatedRoot);while(!existsSync(ancestor))ancestor=dirname(ancestor);
 if(realpathSync(ancestor)!==ancestor)throw Error('Isolated output ancestor must not be a directory link');
}
if(production&&!isolatedRoot)throw Error('Production preparation requires an explicit isolated output root');
const configs=JSON.parse(readFileSync(join(root,'config/mobile-platforms.json'),'utf8'));
// Default builds retain the existing WeChat/TapTap outputs. Desktop Web is opt-in.
const resolvedConfigs=Object.fromEntries(platforms.map(id=>{const config=configs[id];if(!config)throw Error('Missing shared platform: '+id);return [id,resolveSharedConfig(production?{...config,development:false}:config,production?{}:env)];}));
if(prepareAssets){await import('./build-mobile-audio.mjs');await import('./build-mobile-pixels.mjs');}
const outputNames={wechat:'wechat-game',taptap:'shared-web',web:'shared-desktop-web'};
const outputs=Object.fromEntries(platforms.map(id=>[id,join(isolatedRoot??join(root,'outputs'),outputNames[id])]));
const recordDir=isolatedRoot?join(isolatedRoot,'records'):join(root,'outputs/shared-build'),records=[];
const commonArt=['b2-card-icons1023.png','b2-core-icons23.png','b2-task-icons23.png'];
const extraArt=['b2-supply-scenes.png','b2-pixel-atlas.png'];
const fonts=['OFL-NotoSansSC.txt','FONT-NOTICES.md'];
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
function copy(from,to){mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);}
for(const [platform,out]of Object.entries(outputs)){
 mkdirSync(out,{recursive:true});
 copy(join(root,'public/audio/mobile-snap.wav'),join(out,'assets/audio/mobile-snap.wav'));
 copy(join(root,'public/audio/mobile-coin.wav'),join(out,'assets/audio/mobile-coin.wav'));
 for(const file of commonArt)copy(join(root,'public/mobile-icons',file),join(out,'assets/ui',file));
 if(platform==='taptap')copy(join(root,'public/mobile-icons/taptap-nickname-authorize.png'),join(out,'assets/ui/taptap-nickname-authorize.png'));
 for(const file of extraArt)copy(join(root,'public/mobile-icons',file),join(out,'art',file));
 for(const file of [...fonts,'jigsaw-ui-sc.'+(platform==='wechat'?'ttf':'woff2')])copy(join(root,'public/fonts',file),join(out,'assets/fonts',file));
 const obsoleteFont=join(out,'assets/fonts/jigsaw-ui-sc.'+(platform==='wechat'?'woff2':'ttf'));if(existsSync(obsoleteFont))unlinkSync(obsoleteFont);
 const config={...resolvedConfigs[platform],...(platform==='taptap'&&bundledArtwork?{bundledArtwork:bundledArtwork.mapping}:{})};
 if(platform==='taptap'&&bundledArtwork)writeBundledArtwork(out,bundledArtwork);
 // The WeChat upload parser is older than its simulator runtime.
 const target=platform==='wechat'?'es2017':'es2020';
 await build({absWorkingDir:root,entryPoints:['mobile/entry-'+(platform==='wechat'?'wechat':'web')+'.ts'],outfile:join(out,platform==='wechat'?'game.js':'game.js'),bundle:true,format:'iife',target,platform:'browser',minify:true,legalComments:'eof',define:{__GAME_CONFIG__:JSON.stringify(config)},metafile:true}).then(result=>{
  const prohibited=Object.keys(result.metafile.inputs).filter(path=>/node_modules\/(react|react-dom)\//.test(path));
  if(prohibited.length)throw Error('Shared Canvas bundle must not import React DOM');
  mkdirSync(recordDir,{recursive:true});json(join(recordDir,platform+'-inputs.json'),Object.keys(result.metafile.inputs));
 });
 if(platform==='wechat'){
  const plugins=sharedPlatformPlugins(config);
  json(join(out,'game.json'),{deviceOrientation:'portrait',showStatusBar:false,networkTimeout:{request:15000,downloadFile:20000},subpackages:[{name:'art',root:'art/'}],...(plugins?{plugins}:{})});
  writeFileSync(join(out,'art/game.js'),'// Shared supplemental artwork package.\n');
  json(join(out,'project.config.json'),{appid:config.appId,projectname:config.gameName,description:'拼图小窝：TapTap/微信共用内容与Canvas界面的开发测试版',compileType:'game',libVersion:'latest',setting:{es6:false,enhance:false,minified:false,urlCheck:true,coverView:true},packOptions:{ignore:[]},condition:{}});
 }else{
  if(platform==='taptap')json(join(out,'game.json'),{deviceOrientation:'portrait'});
  const title=platform==='web'?'拼图小窝 · 桌面体验':config.gameName;
  writeFileSync(join(out,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#fdf6ed"><title>'+title+'</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fdf6ed}canvas{width:100%;height:100%;display:block;touch-action:none}</style></head><body><canvas id="game" aria-label="'+title+'"></canvas><script src="game.js"></script></body></html>\n');
 }
 function size(dir,skipArt=false){return readdirSync(dir,{withFileTypes:true}).reduce((n,item)=>n+(skipArt&&item.name==='art'?0:item.isDirectory()?size(join(dir,item.name)):statSync(join(dir,item.name)).size),0);}
 const main=size(out,true),total=size(out);if(platform==='wechat'&&main>4*1024*1024)throw Error('WeChat main package exceeds 4 MiB: '+main);
 const files=[];
 function inventory(dir,prefix=''){for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name),name=prefix+item.name;if(item.isDirectory())inventory(path,name+'/');else{const bytes=readFileSync(path);files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
 inventory(out);
 const record={platform,directory:out,mainBytes:main,totalBytes:total,config,files};records.push(record);
 console.log(JSON.stringify({platform,directory:out,mainBytes:main,totalBytes:total}));
}
if(isolatedRoot)json(join(isolatedRoot,'build-record.json'),{createdAt:new Date().toISOString(),production,isolated:true,preparedAssetsReused:!prepareAssets,platforms:records});
return records;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const platform=process.argv.find(value=>value.startsWith('--platform='))?.slice('--platform='.length);
 await buildMobileShared({...(platform?{platforms:[platform]}:{}),prepareAssets:!process.argv.includes('--reuse-assets')});
}
