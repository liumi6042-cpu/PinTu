import {mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {problem} from './store.mjs';
import {validateDraft} from './model.mjs';
import {buildAlbumConfiguration} from '../jigsaw-nook-taptap/server/album-content.mjs';

/** The saved shared albums are the only source of per-album rewards. */
export function buildPublicAlbumDocument(document,source){
 const validated=validateDraft(document,source);
 const playable=new Set(source.assets.filter(asset=>asset.lifecycle==='retained').map(asset=>asset.id));
 return {schema:'jigsaw-albums/v1',albums:validated.albums.map(album=>{
  // Keep pending artwork in management while exporting only delivered images.
  // Daily-release visibility is applied by the runtime, not by deleting members.
  const imageIds=album.imageIds.filter(id=>playable.has(id));
  return {id:album.id,title:album.title,description:album.description,imageIds,
   coverImageId:imageIds.includes(album.coverImageId)?album.coverImageId:imageIds[0]??null,
   showOnPc:album.showOnPc,showOnMobile:album.showOnMobile,purchasable:album.purchasable,
   price:album.price,decorationId:album.decorationId,milestones:structuredClone(album.milestones)};
 })};
}

export function writeAlbumConfiguration(bridgeDir,document,options){
 const configuration=buildAlbumConfiguration(document,options),bytes=JSON.stringify(configuration,null,2)+'\n';
 mkdirSync(bridgeDir,{recursive:true});const path=join(bridgeDir,'configuration.json');
 try{if(readFileSync(path,'utf8')===bytes)return configuration;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=join(bridgeDir,'.configuration-'+randomUUID()+'.tmp');
 try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,path);}
 finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return configuration;
}

/** Read/export only: never initializes or saves unrelated game settings. */
export function createAlbumCoordinator({store,getSource,bridgeDir,getDocument}){
 return {sync(){
  const source=getSource(),draft=getDocument?.(store.activeDraftId())??store.draft(store.activeDraftId());
  const document=buildPublicAlbumDocument(draft.document,source);
  try{return writeAlbumConfiguration(bridgeDir,document,{photos:source.assets.filter(asset=>asset.lifecycle==='retained'),decorations:source._private.collection.decorations});}
  catch{throw problem(503,'相册已保留，但游戏相册配置暂未更新，请重新载入后台后重试','ALBUM_BRIDGE_FAILED');}
 }};
}
