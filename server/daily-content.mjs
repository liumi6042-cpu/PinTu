import {createHash} from 'node:crypto';
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

/** Public configuration and appearance receipts only. No account or database access. */
export function createDailyContent({configurationPath,appearanceDir,photos,fallback,now=Date.now}){
 const filename=resolve(configurationPath),directory=resolve(appearanceDir),photoById=new Map(photos.filter(photo=>photo.status==='published').map(photo=>[photo.id,photo]));
 let timer=null,tickError=null;
 function configuration(){
  let input;try{input=JSON.parse(readFileSync(filename,'utf8'));}catch{invalid('每日配置无法读取。');}
  if(!keys(input,['schema','timezone','entries','albums','configDigest'])||input.schema!=='jigsaw-daily-content/v1'||input.timezone!=='Asia/Shanghai'||!Array.isArray(input.entries)||!Array.isArray(input.albums))invalid('每日配置格式无效。');
  const {configDigest,...content}=input;
  if(typeof configDigest!=='string'||!/^[a-f0-9]{64}$/.test(configDigest)||dailyConfigurationDigest(content)!==configDigest)invalid('每日配置校验不匹配。');
  const albums=new Map(),dates=new Set();
  for(const album of input.albums){
   if(!keys(album,['id','title','description','showOnPc','showOnMobile','purchasable','price','decorationId','milestones'])||!id(album.id)||albums.has(album.id)||typeof album.title!=='string'||typeof album.description!=='string'||typeof album.showOnPc!=='boolean'||typeof album.showOnMobile!=='boolean'||typeof album.purchasable!=='boolean'||!Number.isSafeInteger(album.price)||album.price<0||!album.purchasable&&album.price!==0||!(album.decorationId===null||id(album.decorationId))||!Array.isArray(album.milestones))invalid('每日归属相册格式无效。');
   albums.set(album.id,album);
  }
  for(const entry of input.entries){
   if(!keys(entry,['date','imageId','albumId'])||!day(entry.date)||dates.has(entry.date)||!photoById.has(entry.imageId)||!id(entry.albumId)||!albums.has(entry.albumId))invalid('每日排期包含不可用图片、重复日期或相册。');
   dates.add(entry.date);
  }
  return {...input,albumById:albums};
 }
 function receipt(date,clock){
  let value;try{value=JSON.parse(readFileSync(join(directory,date+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;invalid('每日出场记录无法读取。');}
  if(!keys(value,['schema','target','date','imageId','albumId','activatedAt','configDigest','planned'])||value.schema!=='jigsaw-daily-appearance/v1'||value.target!=='mobile-shared'||value.date!==date||!day(date)||!photoById.has(value.imageId)||!Number.isSafeInteger(value.activatedAt)||value.activatedAt>clock||dailyContentDate(value.activatedAt)!==date||typeof value.planned!=='boolean'||typeof value.configDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.configDigest)||value.planned&&!id(value.albumId)||!value.planned&&value.albumId!==null)invalid('每日出场记录格式无效。');
  return value;
 }
 function facts(clock){
  let files;try{files=readdirSync(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  return files.filter(file=>/^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().map(file=>receipt(file.slice(0,-5),clock));
 }
 function tick(clock=now()){
  const config=configuration(),date=dailyContentDate(clock),old=receipt(date,clock);
  if(old){tickError=null;return old;}
  const plan=config.entries.find(entry=>entry.date===date),photo=plan?photoById.get(plan.imageId):fallback(clock);
  if(!photo||!photoById.has(photo.id))invalid('今日每日图片不可用。');
  const value={schema:'jigsaw-daily-appearance/v1',target:'mobile-shared',date,imageId:photo.id,albumId:plan?.albumId??null,activatedAt:clock,configDigest:config.configDigest,planned:Boolean(plan)};
  try{mkdirSync(directory,{recursive:true});writeFileSync(join(directory,date+'.json'),JSON.stringify(value)+'\n',{flag:'wx'});}catch(error){if(error.code==='EEXIST'){const existing=receipt(date,clock);if(existing)return existing;}throw Object.assign(new Error('每日出场记录未能保存。'),{status:503,code:'DAILY_APPEARANCE_UNAVAILABLE',cause:error});}
  tickError=null;return value;
 }
 function albumEntries(clock=now()){
  const config=configuration(),today=dailyContentDate(clock),first=new Map();
  for(const fact of facts(clock))if(fact.planned&&!first.has(fact.imageId))first.set(fact.imageId,fact);
  const groups=new Map();
  for(const fact of first.values()){
   const album=config.albumById.get(fact.albumId);
   if(fact.date>=today||!album?.showOnMobile)continue;
   if(!groups.has(album.id))groups.set(album.id,{album,imageIds:[]});
   groups.get(album.id).imageIds.push(fact.imageId);
  }
  return [...groups.values()];
 }
 function managedImageIds(clock=now()){
  return new Set([...configuration().entries.map(entry=>entry.imageId),...facts(clock).filter(fact=>fact.planned).map(fact=>fact.imageId)]);
 }
 function galleryPhotos(clock=now()){
  const managed=managedImageIds(clock),visible=new Set(albumEntries(clock).flatMap(entry=>entry.imageIds));
  return [...photoById.values()].filter(photo=>visible.has(photo.id)||photo.galleryVisible!==false&&!managed.has(photo.id));
 }
 function start(){if(timer)return;tick(now());timer=setInterval(()=>{try{tick(now());}catch(error){tickError=error;console.error('每日配置暂不可用：'+error.message);}},30000);timer.unref();}
 return {tick,start,select(clock=now()){const fact=tick(clock);if(tickError)throw tickError;return photoById.get(fact.imageId);},albumEntries,managedImageIds,galleryPhotos,targetAlbums:()=>configuration().albums,collectiblePhotos:()=>[...photoById.values()],close(){if(timer)clearInterval(timer);timer=null;}};
}
