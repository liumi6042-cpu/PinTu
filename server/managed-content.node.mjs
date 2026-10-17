import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {readManagedRelease,createManagedReleaseReader,contentReleaseImageIds,freezeContent} from './content-release.mjs';
import {validateAlbumConfiguration} from './album-content.mjs';
import {createDailyContent,validateDailyConfiguration} from './daily-content.mjs';
import {validateGameConfiguration} from './game-settings.mjs';
import {validateTaskRewardConfiguration} from './task-reward-settings.mjs';
import catalogSeed from '../content/puzzle-catalog.json' with {type:'json'};
import guidanceSeed from '../content/puzzle-guidance.json' with {type:'json'};

// Delivered artwork registry and dimensions are read at process start from the
// shared asset directory written by the admin delivery step. The bundled copies
// remain the fallback, so a missing or damaged file never empties the gallery.
const assetCatalogDir=process.env.JIGSAW_ASSET_CATALOG_DIR||'/srv/sites/jigsaw-content/assets';
function loadDeliveredJson(name,seed){
 try{const value=JSON.parse(readFileSync(resolve(assetCatalogDir,name),'utf8'));
  return Array.isArray(seed)===Array.isArray(value)?value:seed;
 }catch{return seed;}
}
const catalog=loadDeliveredJson('catalog.json',catalogSeed);
const guidance=loadDeliveredJson('guidance.json',guidanceSeed);

export const managedPhotos=freezeContent(catalog.filter(photo=>['project-ai-generated','user-provided'].includes(photo.origin)&&['published','archived'].includes(photo.status)).map(photo=>{
 const dimensions=guidance[photo.id];
 if(!Number.isSafeInteger(dimensions?.width)||dimensions.width<=0||!Number.isSafeInteger(dimensions?.height)||dimensions.height<=0)throw Object.assign(new Error('已交付图片缺少有效的实测尺寸。'),{status:503,code:'CONTENT_ASSET_DIMENSIONS_UNAVAILABLE'});
 return {...photo,originalSrc:photo.src,src:photo.optimizedSrc??photo.playSrc,width:dimensions.width,height:dimensions.height};
}));
const unavailable=cause=>Object.assign(new Error('统一内容发布暂时不可用，请稍后重试。'),{status:503,code:'CONTENT_RELEASE_UNAVAILABLE',cause});

/** Pure validation: no player database, appearance receipts or filesystem mutations. */
export function validateWebContentRelease(release,{photos=managedPhotos,assetDir}={}){
 if(!release)return null;
 const {documents}=release;
 const gameSettings=validateGameConfiguration(documents.gameSettings);
 const taskRewards=validateTaskRewardConfiguration(documents.taskRewards);
 const albums=validateAlbumConfiguration(documents.albums,{photos,decorations:gameSettings.decorations});
 const daily=validateDailyConfiguration(documents.daily,{photos});
 const albumById=new Map(albums.albums.map(album=>[album.id,album]));
 if(daily.albums.some(album=>!albumById.has(album.id)))throw unavailable(new Error('每日归属相册未包含在同一发布版本。'));
 const imageIds=new Set([...albums.albums.flatMap(album=>album.imageIds),...daily.entries.map(entry=>entry.imageId),...daily.automaticCandidates.map(entry=>entry.imageId),...daily.fallbackImageIds]);
 const byId=new Map(photos.map(photo=>[photo.id,photo]));
 const root=assetDir?realpathSync(resolve(assetDir)):null;
 for(const imageId of imageIds){
  const photo=byId.get(imageId);if(!photo)throw unavailable(new Error('发布配置引用未交付图片。'));
  if(!Number.isSafeInteger(photo.width)||photo.width<=0||!Number.isSafeInteger(photo.height)||photo.height<=0)throw unavailable(new Error('发布图片缺少有效的实测尺寸。'));
  if(!root)continue;
  for(const path of [...new Set([photo.src,photo.thumbSrc,photo.playSrc].filter(Boolean))]){
   if(typeof path!=='string'||!/^\/puzzles\/[a-zA-Z0-9._-]+$/.test(path))throw unavailable(new Error('图片路径未登记。'));
   const file=resolve(root,path.slice(1));
   if(!file.startsWith(root+sep)||!existsSync(file)||!lstatSync(file).isFile()||!realpathSync(file).startsWith(root+sep))throw unavailable(new Error('当前运行素材目录缺少图片。'));
  }
 }
 return freezeContent({releaseId:release.manifest.releaseId,manifestSha256:release.manifestSha256,documents,albums,daily,gameSettings,taskRewards,photos,
  summary:{albumCount:albums.albums.length,imageCount:imageIds.size,taskCount:taskRewards.tasks.length},
  configDigests:Object.fromEntries(['albums','daily','gameSettings','taskRewards'].map(key=>[key,documents[key].configDigest]))});
}

/** A single call pins and validates one whole release. Health checks never select a daily. */
function withDailyRuntime(snapshot,{directory,appearanceDir,photos}){
  if(!snapshot)return null;
  const dailyChoices=photos.filter(photo=>photo.status==='published'&&photo.dailyOnly===true),fallbackChoices=dailyChoices.length?dailyChoices:photos.filter(photo=>photo.status==='published');
  const dailyRuntime=createDailyContent({readConfiguration:()=>snapshot.documents.daily,appearanceDir:appearanceDir||resolve(directory,'daily-appearances'),photos,fallback:clock=>fallbackChoices[Math.floor((clock+8*3600000)/86400000)%fallbackChoices.length]});
  // The verified snapshot is already deeply frozen. Only these per-operation
  // methods are new; avoid walking every cached configuration object again.
  return Object.freeze({...snapshot,dailyRuntime:Object.freeze(dailyRuntime)});
}

export function readNodeManagedContent({directory=process.env.JIGSAW_CONTENT_DIR,appearanceDir=process.env.JIGSAW_DAILY_APPEARANCES_DIR,photos=managedPhotos,assetDir}={}){
 try{return withDailyRuntime(validateWebContentRelease(readManagedRelease(directory),{photos,assetDir}),{directory,appearanceDir,photos});}
 catch(error){throw unavailable(error);}
}

/** Service-scoped cache for verified configuration, never daily appearance facts. */
export function createNodeManagedContent({directory=process.env.JIGSAW_CONTENT_DIR,appearanceDir=process.env.JIGSAW_DAILY_APPEARANCES_DIR,photos=managedPhotos,assetDir}={}){
 const byId=new Map(photos.map(photo=>[photo.id,photo]));
 const reader=createManagedReleaseReader(directory,{
  validate:release=>validateWebContentRelease(release,{photos,assetDir}),
  watchPaths:release=>{
   if(!assetDir)return [];
   const root=resolve(assetDir),paths=[root];
   for(const imageId of contentReleaseImageIds(release)){
    const photo=byId.get(imageId);
    for(const path of [photo?.src,photo?.thumbSrc,photo?.playSrc].filter(Boolean)){
     const file=resolve(root,path.slice(1));paths.push(dirname(file));
    }
   }
   return paths;
  },
 });
 return {read(){
  try{return withDailyRuntime(reader.read(),{directory,appearanceDir,photos});}
  catch(error){throw unavailable(error);}
 }};
}
