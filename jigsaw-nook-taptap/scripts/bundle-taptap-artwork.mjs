import {readFileSync,realpathSync,lstatSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {resolveMediaDir,safeMediaFile} from './media-paths.mjs';

// TapTap is a phone client: gallery/album cards render at about 180 CSS px wide in portrait, so 2x is
// about 360. 400 px stays sharper than the 288 px server thumbnails while keeping the package near
// its previous size (640 px added ~8 MB).
export const TAPTAP_THUMBNAIL_WIDTH=400;
export const TAPTAP_THUMBNAIL_QUALITY=78;

/** Snapshot public artwork only. Exact content hashes make later CMS edits fall back online. */
export const freeMobileAlbums=albums=>albums.filter(a=>a.showOnMobile===true&&a.imageIds.length&&!(a.purchasable===true&&a.price>0));
export function fullImageAlbumIds({albums,fullAlbumIds,levelAlbumIds=[]}){
 return [...new Set(fullAlbumIds??[...freeMobileAlbums(albums).map(a=>a.id),...levelAlbumIds])];
}
/** Paid mobile albums in store (content) order: candidates for cache-only full images. */
export const paidMobileAlbums=albums=>albums.filter(a=>a.showOnMobile===true&&a.imageIds.length&&a.purchasable===true&&a.price>0);
// Artwork bytes (full images + thumbnails) the zip may carry: about 48 MB of zip with the
// client, fonts and music. package-taptap.mjs keeps its own 55 MiB hard gate.
export const TAPTAP_ARTWORK_BUDGET_BYTES=38*1024*1024;
/**
 * cacheAlbumIds adds full images on top of the default (free + story) set, in the given order,
 * while artwork stays within budgetBytes; an album that would not fit is skipped. They are only a
 * local cache for the same URLs: they never enter the offline catalog and ownership stays with
 * the server.
 */
export async function planTapTapArtwork({root,catalog,albums,fullAlbumIds,levelAlbumIds=[],roomArtwork=[],cacheAlbumIds=[],budgetBytes=Infinity}){
 const puzzlesDir=resolveMediaDir(root,'puzzles'),files=new Map(),mapping={};
 // Package theme-album thumbnails, including newly created/hidden albums.
 // Web-gallery-only and daily-only material remains online.
 const themeAlbums=albums.filter(a=>a.id!=='album-bdf936b9'&&a.title!=='网页图库'&&a.id!=='curated-daily-specials');
 const albumImages=new Set(themeAlbums.flatMap(a=>a.imageIds));
 // Free mobile albums and story chapters are playable without a network.
 // 显式列表仍用于制作旧版本或局部素材包；空列表只打包服务器缩略图。
 const puzzleAlbumIds=fullImageAlbumIds({albums,fullAlbumIds,levelAlbumIds});
 const artworkById=new Map(roomArtwork.map(photo=>[photo.id,photo]));
 const published=catalog.filter(p=>albumImages.has(p.id)&&['published','archived'].includes(p.status)&&['project-ai-generated','user-provided'].includes(p.origin));
 const known=new Set(published.map(p=>p.id));for(const id of albumImages)if(!known.has(id))throw Error('Album thumbnail unavailable: '+id);
 const byId=new Map(published.map(p=>[p.id,p]));
 const add=(url,kind,imageId)=>{
  const match=typeof url==='string'&&/^\/puzzles\/([a-z0-9-]+)-(?:thumbnail|optimized|play)-([a-f0-9]{12})\.webp$/.exec(url);
  if(!match)throw Error('Bundle requires a public content-addressed WebP: '+imageId);
  const source=safeMediaFile(puzzlesDir,url.slice('/puzzles/'.length));
  const bytes=readFileSync(source),sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256.slice(0,12)!==match[2]||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Artwork hash or WebP differs: '+url);
  const path='assets'+url;files.set(url,{url,path,source,bytes:bytes.length,sha256,kind,imageId});mapping[url]=path;
  return files.get(url);
 };
 const selected=[],puzzles=new Map(),puzzleThumbs=new Map();
 for(const id of new Set(puzzleAlbumIds)){
  const album=albums.find(a=>a.id===id);if(!album)throw Error('Bundled album is absent from current content: '+id);
  selected.push({id,title:album.title,imageIds:[...album.imageIds]});
  for(const imageId of album.imageIds){
   const photo=byId.get(imageId);if(!photo)throw Error('Bundled album image is not published: '+imageId);
   const artwork=artworkById.get(imageId);
   if(!puzzles.has(imageId)){puzzles.set(imageId,add(artwork?.src??photo.optimizedSrc??photo.playSrc,'puzzle',imageId));puzzleThumbs.set(imageId,artwork?.thumbSrc??photo.thumbSrc);}
  }
 }
 const cached=[],cacheSkipped=[];
 if(cacheAlbumIds.length){
  // Thumbnails are counted at their server size; generated 2x thumbnails are of the same order.
  const size=url=>{if(!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play)-[a-f0-9]{12}\.webp$/.test(url??''))throw Error('Bundle requires a public content-addressed WebP: '+url);return statSync(safeMediaFile(puzzlesDir,url.slice('/puzzles/'.length))).size;};
  let used=[...puzzles.values()].reduce((sum,file)=>sum+file.bytes,0)+published.reduce((sum,photo)=>sum+size(photo.thumbSrc),0);
  for(const id of new Set(cacheAlbumIds)){
   if(puzzleAlbumIds.includes(id))continue;
   const album=albums.find(a=>a.id===id);if(!album)throw Error('Cached album is absent from current content: '+id);
   const fresh=[...new Set(album.imageIds)].filter(imageId=>!puzzles.has(imageId)).map(imageId=>{
    const photo=byId.get(imageId);if(!photo)throw Error('Cached album image is not published: '+imageId);
    const artwork=artworkById.get(imageId);return {imageId,url:artwork?.src??photo.optimizedSrc??photo.playSrc,thumb:artwork?.thumbSrc??photo.thumbSrc};
   });
   const extra=fresh.reduce((sum,item)=>sum+size(item.url),0);
   if(used+extra>budgetBytes){cacheSkipped.push(id);continue;}
   for(const item of fresh){puzzles.set(item.imageId,add(item.url,'puzzle',item.imageId));puzzleThumbs.set(item.imageId,item.thumb);}
   used+=extra;cached.push({id,title:album.title,images:fresh.length,bytes:extra});
  }
 }
 for(const photo of published){
  const puzzle=puzzles.get(photo.id);
  if(!puzzle){add(photo.thumbSrc,'thumbnail',photo.id);continue;}
  const thumbSrc=puzzleThumbs.get(photo.id);
  if(!/^[a-z0-9-]+$/.test(photo.id)||!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play)-[a-f0-9]{12}\.webp$/.test(thumbSrc))throw Error('Invalid bundled thumbnail: '+photo.id);
  // Keep current online thumbnails as well when TapTap rooms use a legacy edition.
  if(thumbSrc!==photo.thumbSrc)add(photo.thumbSrc,'thumbnail',photo.id);
  // Transform the exact HD bytes we verified, never the server thumbnail.
  const sourceBytes=readFileSync(puzzle.source);
  if(createHash('sha256').update(sourceBytes).digest('hex')!==puzzle.sha256)throw Error('Bundled artwork changed during thumbnail generation');
  const data=await sharp(sourceBytes).resize({width:TAPTAP_THUMBNAIL_WIDTH}).webp({quality:TAPTAP_THUMBNAIL_QUALITY}).toBuffer();
  const sha256=createHash('sha256').update(data).digest('hex'),url='/puzzles/'+photo.id+'-thumb2x-'+sha256.slice(0,12)+'.webp',path='assets'+url;
  files.set(url,{url,path,data,bytes:data.length,sha256,kind:'thumbnail',imageId:photo.id});mapping[thumbSrc]=path;
 }
 const bytesByKind={puzzle:0,thumbnail:0};for(const file of files.values())bytesByKind[file.kind]+=file.bytes;
 return {mapping,files:[...files.values()],albums:selected,thumbnailCount:published.length,
  paidAlbumsExcluded:themeAlbums.filter(a=>a.showOnMobile===true&&a.imageIds.length&&a.purchasable===true&&a.price>0&&!puzzleAlbumIds.includes(a.id)&&!cached.some(item=>item.id===a.id)).map(a=>a.id),
  cachedAlbums:cached,cacheSkipped,budgetBytes,
  bytesByKind,totalBytes:bytesByKind.puzzle+bytesByKind.thumbnail};
}
