import {existsSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {createManagedReleaseReader,contentReleaseImageIds,freezeContent} from './content-release.mjs';
import {validateAlbumConfiguration} from './album-content.mjs';
import {validateDailyConfiguration} from './daily-content.mjs';
import {validateGameConfiguration} from './game-settings.mjs';
import {validateTaskRewardConfiguration} from './task-reward-settings.mjs';

const unavailable=(message,cause)=>Object.assign(new Error(message),{status:503,code:'CONTENT_RELEASE_UNAVAILABLE',cause});

/** Validate public configuration without creating a player, database or daily receipt. */
export function validateMobileContentRelease(release,{photos,assetDir,assetPaths}={}){
 if(!release)return null;
 const documents=release.documents;
 const gameSettings=validateGameConfiguration(documents.gameSettings);
 const taskRewards=validateTaskRewardConfiguration(documents.taskRewards);
 const albums=validateAlbumConfiguration(documents.albums,{photos,decorations:gameSettings.decorations});
 const daily=validateDailyConfiguration(documents.daily,{photos});
 const albumIds=new Set(albums.albums.map(album=>album.id));
 if(daily.albums.some(album=>!albumIds.has(album.id)))throw unavailable('每日图片引用了本发布版本中不存在的相册。');
 const imageIds=new Set([...albums.albums.flatMap(album=>album.imageIds),...daily.entries.map(entry=>entry.imageId),...daily.automaticCandidates.map(entry=>entry.imageId),...daily.fallbackImageIds]);
 const byId=new Map(photos.map(photo=>[photo.id,photo]));
 const allowed=assetPaths?new Set(assetPaths):null;
 const root=assetDir?realpathSync(resolve(assetDir)):null;
 for(const imageId of imageIds){
  const photo=byId.get(imageId);
  if(!photo)throw unavailable('本发布版本包含尚未交付的图片：'+imageId);
  if(!root&&!allowed)continue;
  for(const path of [photo.src,photo.thumbSrc]){
   if(typeof path!=='string'||!/^\/puzzles\/[a-zA-Z0-9._-]+$/.test(path)||allowed&&!allowed.has(path))throw unavailable('图片未登记在当前运行素材清单：'+imageId);
   if(root){const file=resolve(root,path.slice(1));if(!file.startsWith(root+sep)||!existsSync(file)||!lstatSync(file).isFile()||!realpathSync(file).startsWith(root+sep))throw unavailable('图片尚未交付到当前运行目录：'+imageId);}
  }
 }
 return freezeContent({releaseId:release.manifest.releaseId,manifestSha256:release.manifestSha256,documents,gameSettings,taskRewards,albums,daily,
  summary:{albumCount:albums.albums.length,imageCount:imageIds.size,taskCount:taskRewards.tasks.length},
  configDigests:{albums:documents.albums.configDigest,daily:documents.daily.configDigest,gameSettings:documents.gameSettings.configDigest,taskRewards:documents.taskRewards.configDigest}});
}

/** Read the pointer once per operation. Invalid existing releases never use legacy settings. */
export function createMobileManagedContent(options){
 const byId=new Map((options.photos??[]).map(photo=>[photo.id,photo]));
 const reader=createManagedReleaseReader(options.directory,{
  validate:release=>validateMobileContentRelease(release,options),
  watchPaths:release=>{
   if(!options.assetDir)return [];
   const root=resolve(options.assetDir),paths=[root];
   for(const imageId of contentReleaseImageIds(release))for(const path of [byId.get(imageId)?.src,byId.get(imageId)?.thumbSrc].filter(Boolean)){
    // Child removal/replacement changes its directory signature; keep the hot
    // path bounded to directories instead of stat-ing the entire artwork set.
    const file=resolve(root,path.slice(1));paths.push(dirname(file));
   }
   return paths;
  },
 });
 return {read(){
  try{return reader.read();}
  catch(error){throw unavailable('统一内容发布暂时不可用，请稍后重试。',error);}
 }};
}
