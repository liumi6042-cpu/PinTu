export type OfflineJson=null|boolean|number|string|OfflineJson[]|{[key:string]:OfflineJson};
export type OfflineGrid={cols:number;rows:number};
/** Story fields are owned by the server level view and remain extensible. */
export type OfflineLevel={id:string;imageId:string;title:string;pieces:number;cols:number;rows:number;line:string|null;[field:string]:OfflineJson};
export type OfflineChapter={id:string;title:string;albumId:string;levels:OfflineLevel[]};
export type OfflinePhoto={id:string;title:string;category:string;src:string;thumbSrc:string;width:number;height:number;artwork:{revision:string;src:string;thumbSrc:string;width:number;height:number}};
export type OfflinePicture={imageId:string;title:string;albumId:string;grids:Partial<Record<'48'|'108',OfflineGrid>>};
export type OfflineCatalog={schema:'jigsaw-offline/v1';seriesTitle:string|null;firstClearEnergy:number;chapters:OfflineChapter[];free:OfflinePicture[];photos:Record<string,OfflinePhoto>};
export const OFFLINE_CATALOG_MAX_BYTES=50*1024;

const object=(value:any):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const id=(value:unknown)=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const text=(value:unknown)=>typeof value==='string'&&!!value.trim();
const path=(value:unknown)=>typeof value==='string'&&/^\/puzzles\/[a-z0-9-]+\.webp$/.test(value);
const grid=(value:any)=>object(value)&&positive(value.cols)&&positive(value.rows);

/** Reject non-JSON values before stringify can silently erase/coerce them. */
function jsonSafe(value:unknown,depth:number,budget:{nodes:number},seen:Set<object>):boolean{
 if(depth>16||--budget.nodes<0)return false;
 if(value===null||typeof value==='boolean'||typeof value==='string')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value!=='object'||(!Array.isArray(value)&&!object(value))||seen.has(value))return false;
 if(Array.isArray(value)&&Object.getPrototypeOf(value)!==Array.prototype)return false;
 seen.add(value);
 const keys=Reflect.ownKeys(value),array=Array.isArray(value);
 if(keys.length>12000||array&&keys.length!==value.length+1)return false;
 for(const key of keys){
  if(array&&key==='length')continue;
  if(typeof key!=='string'||array&&!/^(0|[1-9][0-9]*)$/.test(key))return false;
  const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
  if(!descriptor.enumerable||!('value' in descriptor)||!jsonSafe(descriptor.value,depth+1,budget,seen))return false;
 }
 seen.delete(value);return true;
}

/** Invalid packaged/cached input is unavailable, never a client startup exception. */
export function readOfflineCatalog(value:unknown):OfflineCatalog|null{
 try{
  if(!jsonSafe(value,0,{nodes:12000},new Set()))return null;
  const serialized=JSON.stringify(value);let bytes=0;
  for(const char of serialized){const code=char.codePointAt(0)!;bytes+=code<128?1:code<2048?2:code<65536?3:4;if(bytes>=OFFLINE_CATALOG_MAX_BYTES)return null;}
  const item=JSON.parse(serialized);
  if(!object(item)||item.schema!=='jigsaw-offline/v1'||!(item.seriesTitle===null||text(item.seriesTitle))||!Number.isSafeInteger(item.firstClearEnergy)||item.firstClearEnergy<0||!Array.isArray(item.chapters)||!item.chapters.length||!Array.isArray(item.free)||!object(item.photos))return null;
  for(const [key,photo] of Object.entries(item.photos)){
   if(!id(key)||!object(photo)||photo.id!==key||!text(photo.title)||!text(photo.category)||!path(photo.src)||!path(photo.thumbSrc)||!positive(photo.width)||!positive(photo.height))return null;
   const art=photo.artwork;
   if(!object(art)||!text(art.revision)||!path(art.src)||!path(art.thumbSrc)||!positive(art.width)||!positive(art.height)||art.src!==photo.src||art.thumbSrc!==photo.thumbSrc||art.width!==photo.width||art.height!==photo.height)return null;
  }
  const chapters=new Set(),levels=new Set(),pictures=new Set();
  for(const chapter of item.chapters){
   if(!object(chapter)||!id(chapter.id)||chapters.has(chapter.id)||!id(chapter.albumId)||!text(chapter.title)||!Array.isArray(chapter.levels)||!chapter.levels.length)return null;
   chapters.add(chapter.id);
   for(const level of chapter.levels){
    if(!object(level)||!id(level.id)||levels.has(level.id)||!id(level.imageId)||!Object.hasOwn(item.photos,level.imageId)||!text(level.title)||!positive(level.pieces)||!grid(level)||!(level.line===null||typeof level.line==='string'))return null;
    levels.add(level.id);
   }
  }
  for(const picture of item.free){
   if(!object(picture)||!id(picture.imageId)||pictures.has(picture.imageId)||!Object.hasOwn(item.photos,picture.imageId)||!id(picture.albumId)||!text(picture.title)||!object(picture.grids)||!Object.keys(picture.grids).length)return null;
   if(Object.entries(picture.grids).some(([count,g])=>!['48','108'].includes(count)||!grid(g)))return null;
   pictures.add(picture.imageId);
  }
  return item as OfflineCatalog;
 }catch{return null;}
}
