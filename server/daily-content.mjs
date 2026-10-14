import {createHash,randomInt as secureRandomInt} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const OFFSET=8*3600000;
export const dailyContentDate=now=>new Date(now+OFFSET).toISOString().slice(0,10);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const dailyConfigurationDigest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const invalid=message=>{throw Object.assign(new Error(message),{status:503,code:'DAILY_CONTENT_INVALID'});};
const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const id=value=>typeof value==='string'&&/^[a-z0-9-]+$/.test(value);

/** Validate one complete public configuration without reading or writing runtime data. */
export function validateDailyConfiguration(input,{photos}){
  const photoById=new Map(photos.filter(photo=>['published','archived'].includes(photo.status)).map(photo=>[photo.id,photo]));
  const version=input?.schema==='jigsaw-daily-content/v2'?2:input?.schema==='jigsaw-daily-content/v1'?1:0;
  if(!version||!keys(input,version===2?['schema','timezone','entries','automaticCandidates','fallbackImageIds','albums','configDigest']:['schema','timezone','entries','albums','configDigest'])||input.timezone!=='Asia/Shanghai'||!Array.isArray(input.entries)||!Array.isArray(input.albums)||version===2&&(!Array.isArray(input.automaticCandidates)||!Array.isArray(input.fallbackImageIds)))invalid('每日配置格式无效。');
  const {configDigest,...content}=input;
  if(typeof configDigest!=='string'||!/^[a-f0-9]{64}$/.test(configDigest)||dailyConfigurationDigest(content)!==configDigest)invalid('每日配置校验不匹配。');
  const albums=new Map(),dates=new Set(),managedImages=new Set();
  for(const album of input.albums){
   if(!keys(album,['id','title','description','showOnPc','showOnMobile','purchasable','price','decorationId','milestones'])||!id(album.id)||albums.has(album.id)||typeof album.title!=='string'||typeof album.description!=='string'||typeof album.showOnPc!=='boolean'||typeof album.showOnMobile!=='boolean'||typeof album.purchasable!=='boolean'||!Number.isSafeInteger(album.price)||album.price<0||!album.purchasable&&album.price!==0||!(album.decorationId===null||id(album.decorationId))||!Array.isArray(album.milestones))invalid('每日归属相册格式无效。');
   albums.set(album.id,album);
  }
  for(const entry of input.entries){
   if(!keys(entry,['date','imageId','albumId'])||!day(entry.date)||dates.has(entry.date)||!photoById.has(entry.imageId)||!id(entry.albumId)||!albums.has(entry.albumId))invalid('每日排期包含不可用图片、重复日期或相册。');
   dates.add(entry.date);
   managedImages.add(entry.imageId);
  }
  if(version===2){
   for(const entry of input.automaticCandidates){
    if(!keys(entry,['imageId','albumId'])||!photoById.has(entry.imageId)||managedImages.has(entry.imageId)||!id(entry.albumId)||!albums.has(entry.albumId))invalid('每日自动发布包含不可用图片、重复图片或相册。');
    managedImages.add(entry.imageId);
   }
   const pool=new Set();
   for(const imageId of input.fallbackImageIds){if(!photoById.has(imageId)||pool.has(imageId))invalid('每日图库包含不可用或重复图片。');pool.add(imageId);}
  }
  return {...input,version,automaticCandidates:input.automaticCandidates??[],fallbackImageIds:input.fallbackImageIds??[],albumById:albums};
}

/** Public configuration and appearance receipts only. No account or database access. */
export function createDailyContent({configurationPath,readConfiguration,appearanceDir,photos,fallback,now=Date.now,randomInt=secureRandomInt}){
 const filename=readConfiguration===undefined?resolve(configurationPath):null,directory=resolve(appearanceDir),photoById=new Map(photos.filter(photo=>['published','archived'].includes(photo.status)).map(photo=>[photo.id,photo]));
 let timer=null,tickError=null;
 function configuration(){
  let input;try{input=readConfiguration===undefined?JSON.parse(readFileSync(filename,'utf8')):readConfiguration();}catch{invalid('每日配置无法读取。');}
  return validateDailyConfiguration(input,{photos});
 }
 function receipt(date,clock){
  let value;try{value=JSON.parse(readFileSync(join(directory,date+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;invalid('每日出场记录无法读取。');}
  const version=value?.schema==='jigsaw-daily-appearance/v2'?2:value?.schema==='jigsaw-daily-appearance/v1'?1:0;
  if(!version||!keys(value,version===2?['schema','target','date','imageId','albumId','activatedAt','configDigest','planned','source']:['schema','target','date','imageId','albumId','activatedAt','configDigest','planned'])||value.target!=='mobile-shared'||value.date!==date||!day(date)||!photoById.has(value.imageId)||!Number.isSafeInteger(value.activatedAt)||value.activatedAt>clock||dailyContentDate(value.activatedAt)!==date||typeof value.planned!=='boolean'||typeof value.configDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.configDigest)||value.planned&&!id(value.albumId)||!value.planned&&value.albumId!==null||version===2&&(!['scheduled','automatic','library'].includes(value.source)||value.planned!==(value.source!=='library')))invalid('每日出场记录格式无效。');
  return value;
 }
 function facts(clock){
  let files;try{files=readdirSync(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const today=dailyContentDate(clock);
  return files.filter(file=>/^\d{4}-\d{2}-\d{2}\.json$/.test(file)&&file.slice(0,-5)<=today).sort().map(file=>receipt(file.slice(0,-5),clock));
 }
 function tick(clock=now()){
  const config=configuration(),date=dailyContentDate(clock),old=receipt(date,clock);
  if(old){tickError=null;return old;}
  let plan=config.entries.find(entry=>entry.date===date),source=plan?'scheduled':'library',photo;
  if(!plan&&config.version===2){
   const appeared=new Set(facts(clock).map(fact=>fact.imageId)),candidates=config.automaticCandidates.filter(entry=>!appeared.has(entry.imageId));
   if(candidates.length){plan=candidates[randomInt(0,candidates.length)];source='automatic';}
   else{
    const managed=new Set([...config.entries,...config.automaticCandidates].map(entry=>entry.imageId)),pool=config.fallbackImageIds.filter(imageId=>!managed.has(imageId)||appeared.has(imageId));
    if(!pool.length)invalid('当日没有排期、未发布的自动图片或可用的相册图片。');
    photo=photoById.get(pool[randomInt(0,pool.length)]);
   }
  }
  photo??=plan?photoById.get(plan.imageId):fallback(clock);
  if(!photo||!photoById.has(photo.id))invalid('今日每日图片不可用。');
  const value={schema:config.version===2?'jigsaw-daily-appearance/v2':'jigsaw-daily-appearance/v1',target:'mobile-shared',date,imageId:photo.id,albumId:plan?.albumId??null,activatedAt:clock,configDigest:config.configDigest,planned:Boolean(plan),...(config.version===2?{source}:{})};
  try{mkdirSync(directory,{recursive:true});writeFileSync(join(directory,date+'.json'),JSON.stringify(value)+'\n',{flag:'wx'});}catch(error){if(error.code==='EEXIST'){const existing=receipt(date,clock);if(existing)return existing;}throw Object.assign(new Error('每日出场记录未能保存。'),{status:503,code:'DAILY_APPEARANCE_UNAVAILABLE',cause:error});}
  tickError=null;return value;
 }
 function albumEntriesFor(config,clock,target){
  const today=dailyContentDate(clock),first=new Map();
  for(const fact of facts(clock))if(fact.planned&&!first.has(fact.imageId))first.set(fact.imageId,fact);
  const groups=new Map();
  for(const fact of first.values()){
   const album=config.albumById.get(fact.albumId);
   if(fact.date>=today||!(target==='pc'?album?.showOnPc:album?.showOnMobile))continue;
   if(!groups.has(album.id))groups.set(album.id,{album,imageIds:[]});
   groups.get(album.id).imageIds.push(fact.imageId);
  }
  return [...groups.values()];
 }
 function albumEntries(clock=now(),target='mobile-shared'){
  return albumEntriesFor(configuration(),clock,target);
 }
 function managedImageIdsFor(config,clock){
  return new Set([...config.entries,...config.automaticCandidates].map(entry=>entry.imageId).concat(facts(clock).filter(fact=>fact.planned).map(fact=>fact.imageId)));
 }
 function managedImageIds(clock=now()){
  return managedImageIdsFor(configuration(),clock);
 }
 function releasedImageIds(clock=now()){
  const today=dailyContentDate(clock);return new Set(facts(clock).filter(fact=>fact.planned&&fact.date<today).map(fact=>fact.imageId));
 }
 function galleryPhotos(clock=now()){
  const config=configuration(),managed=managedImageIdsFor(config,clock),visible=new Set(albumEntriesFor(config,clock,'mobile-shared').flatMap(entry=>entry.imageIds));
  return [...photoById.values()].filter(photo=>visible.has(photo.id)||photo.status==='published'&&photo.galleryVisible!==false&&!managed.has(photo.id));
 }
 function start(){if(timer)return;tick(now());timer=setInterval(()=>{try{tick(now());}catch(error){tickError=error;console.error('每日配置暂不可用：'+error.message);}},30000);timer.unref();}
 return {tick,start,select(clock=now()){const fact=tick(clock);if(tickError)throw tickError;return photoById.get(fact.imageId);},albumEntries,managedImageIds,releasedImageIds,galleryPhotos,targetAlbums:()=>configuration().albums,collectiblePhotos:()=>[...photoById.values()],close(){if(timer)clearInterval(timer);timer=null;}};
}
