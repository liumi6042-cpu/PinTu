import {DatabaseSync} from 'node:sqlite';
import {createMobileLevels} from '../server/mobile-levels.mjs';
import {mobileGridForPhoto} from '../server/mobile-service.mjs';
import {currentRoomArtwork,RESTORABLE_PHOTOS} from '../outputs/mobile/engine.mjs';
import {readOfflineCatalog} from '../lib/offline-catalog-types.ts';
import {freeMobileAlbums} from './bundle-taptap-artwork.mjs';

// Exactly creationArtwork(photo,pieces,request) in POST /api/rooms for the TapTap
// client, which sends X-Jigsaw-Artwork-Snapshot: 1 on every request (mobile/client.ts),
// so legacy-only artwork is off. Compiled/restorable photos take precedence.
export function offlineRoomArtwork(photo,pieces){
 return currentRoomArtwork(RESTORABLE_PHOTOS.find(item=>item.id===photo.id)??photo,pieces,false);
}

/** The optional factory is a test seam for additive fields in future server views. */
export function buildOfflineCatalog({levels,albums,photos,plan},createLevels=createMobileLevels){
 const db=new DatabaseSync(':memory:');
 try{
  const byId=new Map(photos.map(photo=>[photo.id,photo])),albumById=new Map(albums.map(album=>[album.id,album]));
  const collection={albumImages:id=>albumById.get(id)??null};
  const view=createLevels({db,photos,collection,configuration:levels}).view('offline-package');
  const result={schema:'jigsaw-offline/v1',seriesTitle:view.seriesTitle,firstClearEnergy:view.firstClearEnergy,chapters:[],free:[],photos:Object.create(null)};
  function boundPhoto(imageId,pieces){
   const photo=byId.get(imageId);if(!photo)throw Error('Offline photo unavailable: '+imageId);
   const artwork=offlineRoomArtwork(photo,pieces);
   for(const url of [artwork.src,artwork.thumbSrc])if(!Object.hasOwn(plan.mapping,url)||typeof plan.mapping[url]!=='string'||!plan.mapping[url])throw Error('Offline artwork is not bundled: '+imageId+' '+url);
   const bound={id:photo.id,title:photo.title,category:photo.category,src:artwork.src,thumbSrc:artwork.thumbSrc,width:artwork.width,height:artwork.height,artwork};
   if(result.photos[imageId]&&JSON.stringify(result.photos[imageId])!==JSON.stringify(bound))throw Error('Offline artwork differs between piece counts: '+imageId);
   result.photos[imageId]=bound;return {...photo,...artwork};
  }
  result.chapters=view.chapters.map(chapter=>({id:chapter.id,title:chapter.title,albumId:chapter.albumId,levels:chapter.levels.map(level=>{
   if(level.status==='unavailable')throw Error('Offline level unavailable: '+level.id+' (album '+chapter.albumId+')');
   const photo=boundPhoto(level.imageId,level.pieces),grid=mobileGridForPhoto(photo,level.pieces,'level');
   if(!grid)throw Error('Offline level grid unavailable: '+level.id);
   // Carry every server-owned story field, irrespective of its config placement.
   const {status,...fields}=level;return {...fields,cols:grid.cols,rows:grid.rows};
  })}));
  const seen=new Set(),levelAlbums=new Set(view.chapters.map(chapter=>chapter.albumId));
  for(const album of freeMobileAlbums(albums).filter(album=>!levelAlbums.has(album.id)))for(const imageId of album.imageIds){
   if(seen.has(imageId))continue;seen.add(imageId);
   const grids={};for(const count of [48,108]){
    const grid=mobileGridForPhoto(boundPhoto(imageId,count),count,'gallery');
    if(grid)grids[count]={cols:grid.cols,rows:grid.rows};
   }
   if(Object.keys(grids).length)result.free.push({imageId,title:byId.get(imageId).title,albumId:album.id,grids});
  }
  const validated=readOfflineCatalog(result);
  if(!validated)throw Error('Invalid offline catalog: check shape/JSON-safe story fields, depth <=16 and size <50 KiB');
  return validated;
 }finally{db.close();}
}
