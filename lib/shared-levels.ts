import defaults from '../config/levels.json';
import {localDb} from './local-db';
import {effectiveManagedAlbums,type ManagedContentSnapshot} from './managed-content';
import {sharedImage} from './shared-client-model';

type Chapter={id:string;title:string;albumId:string;pieces:number[];lines?:(string|null)[]};
type Configuration={schema:string;seriesTitle?:string;firstClearEnergy:number;chapters:Chapter[]};
type Progress={level_id:string;room_id:string|null;cleared_at:number|null;energy:number};
type Level={id:string;imageId:string|null;title:string|null;pieces:number;status:'unavailable'|'cleared'|'unlocked'|'locked';line:string|null};
const invalid=():never=>{throw new TypeError('Invalid levels configuration');};
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
function shape(value:unknown,fields:string[],optional:string[]=[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)&&!optional.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))invalid();}
export function readLevelConfiguration(configuration:unknown=defaults):Configuration{
 const document=configuration;shape(document,['schema','firstClearEnergy','chapters'],['seriesTitle']);
 if(Object.hasOwn(document,'seriesTitle')&&(typeof document.seriesTitle!=='string'||!document.seriesTitle.trim()||document.seriesTitle.length>40))invalid();
 if(document.schema!=='jigsaw-levels/v1'||!Number.isSafeInteger(document.firstClearEnergy)||document.firstClearEnergy<0||!Array.isArray(document.chapters)||!document.chapters.length)invalid();
 const seen=new Set<string>(),chapters=document.chapters.map((chapter:Record<string,any>)=>{
  shape(chapter,['id','title','albumId','pieces'],['lines']);
  if(!identifier(chapter.id)||seen.has(chapter.id)||!identifier(chapter.albumId)||typeof chapter.title!=='string'||!chapter.title.trim()||chapter.title.length>180||!Array.isArray(chapter.pieces)||chapter.pieces.length!==6||chapter.pieces.some((value:unknown)=>!Number.isSafeInteger(value)||Number(value)<=0))invalid();
  if(Object.hasOwn(chapter,'lines')&&(!Array.isArray(chapter.lines)||chapter.lines.length>chapter.pieces.length||chapter.lines.some((line:unknown)=>line!==null&&(typeof line!=='string'||!line.trim()||line.length>40))))invalid();
  seen.add(chapter.id);return {...chapter,pieces:[...chapter.pieces],...(chapter.lines?{lines:[...chapter.lines]}:{})} as Chapter;
 });return {schema:document.schema,firstClearEnergy:document.firstClearEnergy,chapters,...(Object.hasOwn(document,'seriesTitle')?{seriesTitle:document.seriesTitle}:{})};
}
const configuration=readLevelConfiguration();
export async function levelProgress(owner:string){return (await localDb().prepare('SELECT level_id,room_id,cleared_at,energy FROM puzzle_level_progress WHERE owner=? ORDER BY level_id').bind(owner).all<Progress>()).results;}
// Web has no energy wallet. The first-write receipt still makes repeated clears idempotent.
export async function recordLevelClear(owner:string,levelId:string,roomId:string,clearedAt:number){return (await localDb().prepare('INSERT OR IGNORE INTO puzzle_level_progress(owner,level_id,room_id,cleared_at,energy) VALUES(?,?,?,?,0)').bind(owner,levelId,roomId,clearedAt).run()).meta.changes===1;}
export function destination(levelId:string,config=configuration){
 const ordered=config.chapters.flatMap(chapter=>chapter.pieces.map((_,index)=>chapter.id+'-'+(index+1))),index=ordered.indexOf(levelId);
 return {nextLevelId:index<0?null:ordered[index+1]??null,chapterComplete:config.chapters.some(chapter=>levelId===chapter.id+'-'+chapter.pieces.length)};
}
export async function levelsView(owner:string,content:ManagedContentSnapshot,origin:string,now=Date.now(),config=configuration){
 const cleared=new Set((await levelProgress(owner)).filter(row=>row.cleared_at!==null).map(row=>row.level_id)),albums=effectiveManagedAlbums(content,now,{includeHidden:true}),photos=new Map(content.photos.map(photo=>[photo.id,photo]));
 let previous:{id:string;available:boolean}|null=null,current:Level|null=null;
 const chapters=config.chapters.map(chapter=>{
  const album=albums.find(album=>album.id===chapter.albumId),images=chapter.pieces.map((_,index)=>album?.imageIds[index]??null),available=!!album&&images.every(id=>id!==null&&photos.has(id));
  const coverImageId=album?.coverImageId??album?.imageIds[0]??null,cover=coverImageId?photos.get(coverImageId):undefined;
  const levels=chapter.pieces.map((pieces,index)=>{
   const id=chapter.id+'-'+(index+1),imageId=images[index],photo=imageId?photos.get(imageId):undefined;
   const status=!available?'unavailable':cleared.has(id)?'cleared':previous===null||previous.available&&cleared.has(previous.id)?'unlocked':'locked';
   const level:Level={id,imageId,title:photo?.title??null,pieces,status,line:chapter.lines?.[index]??null};previous={id,available};
   if(status==='unlocked'&&current===null)current=level;return level;
  });return {id:chapter.id,title:chapter.title,albumId:chapter.albumId,coverImageId:cover?.id??null,coverSrc:cover?sharedImage(cover,origin).thumbSrc:null,status:available?'available':'unavailable',levels};
 });return {seriesTitle:config.seriesTitle??null,chapters,current:current as Level|null,firstClearEnergy:config.firstClearEnergy};
}
export function findLevel(view:Awaited<ReturnType<typeof levelsView>>,levelId:string){return view.chapters.flatMap(chapter=>chapter.levels).find(level=>level.id===levelId);}
