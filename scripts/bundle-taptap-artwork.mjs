import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

// mobile/app.ts: collection viewport <= 1144, padding 24, cover inset 12 => 1108.
// Album covers are wider than the gallery/room grids. Cap their 2x width for package size.
export const TAPTAP_THUMBNAIL_WIDTH=Math.min(1108*2,640);

/** Snapshot public artwork only. Exact content hashes make later CMS edits fall back online. */
export async function planTapTapArtwork({root,catalog,albums,fullAlbumIds}){
 const base=realpathSync(resolve(root,'public')),files=new Map(),mapping={};
 // Package theme-album thumbnails, including newly created/hidden albums.
 // Web-gallery-only and daily-only material remains online.
 const themeAlbums=albums.filter(a=>a.id!=='album-bdf936b9'&&a.title!=='网页图库'&&a.id!=='curated-daily-specials');
 const albumImages=new Set(themeAlbums.flatMap(a=>a.imageIds));
 // 默认预置当前小程序可见相册的实际拼图用图，避免每次开局都远程下载。
 // 显式列表仍用于制作旧版本或局部素材包；空列表只打包服务器缩略图。
 const puzzleAlbumIds=fullAlbumIds??themeAlbums.filter(a=>a.showOnMobile===true&&a.imageIds.length).map(a=>a.id);
 const published=catalog.filter(p=>albumImages.has(p.id)&&['published','archived'].includes(p.status)&&['project-ai-generated','user-provided'].includes(p.origin));
 const known=new Set(published.map(p=>p.id));for(const id of albumImages)if(!known.has(id))throw Error('Album thumbnail unavailable: '+id);
 const byId=new Map(published.map(p=>[p.id,p]));
 const add=(url,kind,imageId)=>{
  const match=typeof url==='string'&&/^\/puzzles\/([a-z0-9-]+)-(?:thumbnail|optimized|play)-([a-f0-9]{12})\.webp$/.exec(url);
  if(!match)throw Error('Bundle requires a public content-addressed WebP: '+imageId);
  const source=resolve(base,'.'+url);if(!source.startsWith(base+sep)||lstatSync(source).isSymbolicLink()||!realpathSync(source).startsWith(base+sep))throw Error('Unsafe bundled artwork source');
  const bytes=readFileSync(source),sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256.slice(0,12)!==match[2]||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Artwork hash or WebP differs: '+url);
  const path='assets'+url;files.set(url,{url,path,source,bytes:bytes.length,sha256,kind,imageId});mapping[url]=path;
  return files.get(url);
 };
 const selected=[],puzzles=new Map();
 for(const id of new Set(puzzleAlbumIds)){
  const album=albums.find(a=>a.id===id);if(!album)throw Error('Bundled album is absent from current content: '+id);
  selected.push({id,title:album.title,imageIds:[...album.imageIds]});
  for(const imageId of album.imageIds){const photo=byId.get(imageId);if(!photo)throw Error('Bundled album image is not published: '+imageId);if(!puzzles.has(imageId))puzzles.set(imageId,add(photo.optimizedSrc??photo.playSrc,'puzzle',imageId));}
 }
 for(const photo of published){
  const puzzle=puzzles.get(photo.id);
  if(!puzzle){add(photo.thumbSrc,'thumbnail',photo.id);continue;}
  if(!/^[a-z0-9-]+$/.test(photo.id)||!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play)-[a-f0-9]{12}\.webp$/.test(photo.thumbSrc))throw Error('Invalid bundled thumbnail: '+photo.id);
  // Transform the exact HD bytes we verified, never the server thumbnail.
  const sourceBytes=readFileSync(puzzle.source);
  if(createHash('sha256').update(sourceBytes).digest('hex')!==puzzle.sha256)throw Error('Bundled artwork changed during thumbnail generation');
  const data=await sharp(sourceBytes).resize({width:TAPTAP_THUMBNAIL_WIDTH}).webp({quality:80}).toBuffer();
  const sha256=createHash('sha256').update(data).digest('hex'),url='/puzzles/'+photo.id+'-thumb2x-'+sha256.slice(0,12)+'.webp',path='assets'+url;
  files.set(url,{url,path,data,bytes:data.length,sha256,kind:'thumbnail',imageId:photo.id});mapping[photo.thumbSrc]=path;
 }
 return {mapping,files:[...files.values()],albums:selected,thumbnailCount:published.length,totalBytes:[...files.values()].reduce((s,f)=>s+f.bytes,0)};
}
