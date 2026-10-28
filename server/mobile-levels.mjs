import defaults from '../config/levels.json' with {type:'json'};

const invalid=()=>{throw new TypeError('Invalid levels configuration');};
const identifier=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
function shape(value,fields,optional=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)&&!optional.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))invalid();}
const storyText=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)invalid();};
function readComic(comic){
 shape(comic,['panels']);if(!Array.isArray(comic.panels)||comic.panels.length!==4)invalid();
 return {panels:Array.from(comic.panels,panel=>{
  shape(panel,['crop','texts']);const {crop,texts}=panel;
  if(!Array.isArray(crop)||crop.length!==4||!Array.from(crop).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)||crop[2]<=0||crop[3]<=0||crop[0]+crop[2]>1.0001||crop[1]+crop[3]>1.0001||!Array.isArray(texts)||texts.length>4)invalid();
  return {crop:[...crop],texts:Array.from(texts,item=>{
   shape(item,['kind','at','text']);if(!['caption','say','sfx'].includes(item.kind)||!['tl','tr','bl','br'].includes(item.at))invalid();storyText(item.text,40);return {...item};
  })};
 })};
}
function readStory(story,length){
 if(!Array.isArray(story)||story.length>length)invalid();
 return Array.from(story,item=>{
  if(item===null)return null;shape(item,[],['timeLabel','intro','comic','comicPage']);
  if(Object.hasOwn(item,'timeLabel'))storyText(item.timeLabel,8);
  if(Object.hasOwn(item,'intro'))storyText(item.intro,60);
  return {...item,...(Object.hasOwn(item,'comic')?{comic:readComic(item.comic)}:{}),...(Object.hasOwn(item,'comicPage')?{comicPage:readComicPage(item.comicPage)}:{})};
 });
}
function readComicPage(page){
 shape(page,['src','panels'],['thumbSrc']);
 const source=value=>{
  if(typeof value!=='string'||!value||value.length>300||/\s|\.\.|\\/.test(value))return false;
  if(value.startsWith('/'))return !value.startsWith('//');
  try{return value.startsWith('https://')&&new URL(value).protocol==='https:';}catch{return false;}
 };
 if(!source(page.src)||Object.hasOwn(page,'thumbSrc')&&!source(page.thumbSrc)||!Array.isArray(page.panels)||page.panels.length!==4)invalid();
 return {...page,panels:Array.from(page.panels,crop=>{
  if(!Array.isArray(crop)||crop.length!==4||!Array.from(crop).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)||crop[2]<=0||crop[3]<=0||crop[0]+crop[2]>1.0001||crop[1]+crop[3]>1.0001)invalid();
  return [...crop];
 })};
}
export function readLevelConfiguration(configuration){
 const document=configuration===undefined?defaults:configuration;
 shape(document,['schema','firstClearEnergy','chapters'],['seriesTitle']);
 if(Object.hasOwn(document,'seriesTitle')&&(typeof document.seriesTitle!=='string'||!document.seriesTitle.trim()||document.seriesTitle.length>40))invalid();
 if(document.schema!=='jigsaw-levels/v1'||!Number.isSafeInteger(document.firstClearEnergy)||document.firstClearEnergy<0||!Array.isArray(document.chapters)||!document.chapters.length)invalid();
 const seen=new Set(),chapters=document.chapters.map(chapter=>{
  shape(chapter,['id','title','albumId','pieces'],['lines','story']);
  if(!identifier(chapter.id)||seen.has(chapter.id)||!identifier(chapter.albumId)||typeof chapter.title!=='string'||!chapter.title.trim()||chapter.title.length>180||!Array.isArray(chapter.pieces)||chapter.pieces.length!==6||chapter.pieces.some(value=>!Number.isSafeInteger(value)||value<=0))invalid();
  if(Object.hasOwn(chapter,'lines')&&(!Array.isArray(chapter.lines)||chapter.lines.length>chapter.pieces.length||chapter.lines.some(line=>line!==null&&(typeof line!=='string'||!line.trim()||line.length>40))))invalid();
  seen.add(chapter.id);return {...chapter,pieces:[...chapter.pieces],...(chapter.lines?{lines:[...chapter.lines]}:{}),...(Object.hasOwn(chapter,'story')?{story:readStory(chapter.story,chapter.pieces.length)}:{})};
 });return {schema:document.schema,firstClearEnergy:document.firstClearEnergy,chapters,...(Object.hasOwn(document,'seriesTitle')?{seriesTitle:document.seriesTitle}:{})};
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
    const level={id,imageId,title:photo?.title??null,pieces,status,line:chapter.lines?.[index]??null};previous={id,available};
    const story=chapter.story?.[index];
    for(const key of ['timeLabel','intro','comic','comicPage'])if(story&&Object.hasOwn(story,key))level[key]=key==='comic'||key==='comicPage'?structuredClone(story[key]):story[key];
    for(const key of ['src','thumbSrc'])if(typeof photo?.[key]==='string')level[key]=photo[key];
    if(status==='unlocked'&&current===null)current=level;return level;
   });return {id:chapter.id,title:chapter.title,albumId:chapter.albumId,coverImageId:cover?.id??null,coverSrc:cover?.thumbSrc??null,status:available?'available':'unavailable',levels};
  });return {chapters,current,firstClearEnergy:config.firstClearEnergy,seriesTitle:config.seriesTitle??null};
 }
 return {progress,recordClear,destination,view};
}
