import defaults from '../config/levels.json' with {type:'json'};

const invalid=()=>{throw new TypeError('Invalid levels configuration');};
const identifier=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
function shape(value,fields){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))invalid();}
export function readLevelConfiguration(configuration){
 const document=configuration===undefined?defaults:configuration;
 shape(document,['schema','firstClearEnergy','chapters']);
 if(document.schema!=='jigsaw-levels/v1'||!Number.isSafeInteger(document.firstClearEnergy)||document.firstClearEnergy<0||!Array.isArray(document.chapters)||!document.chapters.length)invalid();
 const seen=new Set(),chapters=document.chapters.map(chapter=>{
  shape(chapter,['id','title','albumId','pieces']);
  if(!identifier(chapter.id)||seen.has(chapter.id)||!identifier(chapter.albumId)||typeof chapter.title!=='string'||!chapter.title.trim()||chapter.title.length>180||!Array.isArray(chapter.pieces)||chapter.pieces.length!==6||chapter.pieces.some(value=>!Number.isSafeInteger(value)||value<=0))invalid();
  seen.add(chapter.id);return {...chapter,pieces:[...chapter.pieces]};
 });return {schema:document.schema,firstClearEnergy:document.firstClearEnergy,chapters};
}

/** Progress helpers share the caller's transaction; reading levels never grants rewards. */
export function createMobileLevels({db,photos,collection,configuration}){
 const config=readLevelConfiguration(configuration),photoById=new Map(photos.map(photo=>[photo.id,photo]));
 db.exec('CREATE TABLE IF NOT EXISTS mobile_level_progress(owner TEXT,level_id TEXT,room_id TEXT,cleared_at INTEGER,energy INTEGER,PRIMARY KEY(owner,level_id));');
 function progress(owner){return db.prepare('SELECT level_id,room_id,cleared_at,energy FROM mobile_level_progress WHERE owner=? ORDER BY level_id').all(owner);}
 function recordClear(owner,levelId,roomId,clearedAt,energy){return db.prepare('INSERT OR IGNORE INTO mobile_level_progress(owner,level_id,room_id,cleared_at,energy) VALUES(?,?,?,?,?)').run(owner,levelId,roomId,clearedAt,energy).changes===1;}
 function destination(levelId){
  const ordered=config.chapters.flatMap(chapter=>chapter.pieces.map((_,index)=>chapter.id+'-'+(index+1))),index=ordered.indexOf(levelId);
  return {nextLevelId:index<0?null:ordered[index+1]??null,chapterComplete:config.chapters.some(chapter=>levelId===chapter.id+'-'+chapter.pieces.length)};
 }
 function view(owner,now=Date.now()){
  const cleared=new Set(progress(owner).filter(row=>row.cleared_at!==null).map(row=>row.level_id));let previous=null,current=null;
  const chapters=config.chapters.map(chapter=>{
   const album=collection.albumImages(chapter.albumId,now),images=chapter.pieces.map((_,index)=>album?.imageIds[index]??null),available=!!album&&images.every(imageId=>photoById.has(imageId));
   const coverImageId=album?.coverImageId??album?.imageIds[0]??null,cover=photoById.get(coverImageId);
   const levels=chapter.pieces.map((pieces,index)=>{
    const id=chapter.id+'-'+(index+1),imageId=images[index],photo=photoById.get(imageId);
    const status=!available?'unavailable':cleared.has(id)?'cleared':previous===null||previous.available&&cleared.has(previous.id)?'unlocked':'locked';
    const level={id,imageId,title:photo?.title??null,pieces,status};previous={id,available};
    if(status==='unlocked'&&current===null)current=level;return level;
   });return {id:chapter.id,title:chapter.title,albumId:chapter.albumId,coverImageId:cover?.id??null,coverSrc:cover?.thumbSrc??null,status:available?'available':'unavailable',levels};
  });return {chapters,current,firstClearEnergy:config.firstClearEnergy};
 }
 return {progress,recordClear,destination,view};
}
