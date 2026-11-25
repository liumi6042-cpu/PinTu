import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';

const SCHEMA='jigsaw-albums/v1';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const invalid=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_ALBUM_CONFIGURATION'});};
const identifier=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
function shape(value,fields,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))invalid(label+'格式无效。');}
function amount(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)invalid(label+'数值无效。');return value;}
function text(value,max,label){if(typeof value!=='string'||value.length>max)invalid(label+'格式无效。');return value;}
const ids=values=>values?new Set(values.map(value=>typeof value==='string'?value:value.id)):null;
export const albumConfigurationDigest=document=>createHash('sha256').update(JSON.stringify(stable(document))).digest('hex');

/** Album membership and rewards are public configuration, never player ownership. */
export function validateAlbumDocument(document,{photos,decorations}={}){
 shape(document,['schema','albums'],'相册配置');if(document.schema!==SCHEMA)invalid('相册配置版本不支持。');
 if(!Array.isArray(document.albums)||document.albums.length>1000)invalid('相册列表无效。');
 const photoIds=ids(photos),decorationIds=ids(decorations),albumIds=new Set();
 const decoration=value=>{if(value!==null&&(!identifier(value)||decorationIds&&!decorationIds.has(value)))invalid('相册奖励装饰不可用。');return value;};
 const albums=document.albums.map(album=>{
  shape(album,['id','title','description','imageIds','coverImageId','showOnPc','showOnMobile','purchasable','price','decorationId','milestones'],'相册');
  if(!identifier(album.id)||albumIds.has(album.id))invalid('相册标识无效或重复。');albumIds.add(album.id);
  if(!Array.isArray(album.imageIds)||album.imageIds.length>10000)invalid('相册图片列表无效。');
  const seenImages=new Set();for(const id of album.imageIds){if(!identifier(id)||seenImages.has(id)||photoIds&&!photoIds.has(id))invalid('相册图片不可用或重复。');seenImages.add(id);}
  if(album.coverImageId!==null&&!seenImages.has(album.coverImageId))invalid('相册封面需要属于当前相册。');
  for(const key of ['showOnPc','showOnMobile','purchasable'])if(typeof album[key]!=='boolean')invalid('相册显示或购买设置无效。');
  if(!Array.isArray(album.milestones)||album.milestones.length>100)invalid('相册里程碑列表无效。');
  const seen=new Set(),targets=new Set(),milestones=album.milestones.map(item=>{
   shape(item,['id','target','coins','decorationId'],'相册里程碑');if(!identifier(item.id)||seen.has(item.id))invalid('相册里程碑标识无效或重复。');seen.add(item.id);
   const target=amount(item.target,1,10000,'相册里程碑图片数');if(targets.has(target))invalid('相册里程碑图片数不能重复。');targets.add(target);
   return {id:item.id,target,coins:amount(item.coins,0,100000,'相册里程碑金币'),decorationId:decoration(item.decorationId)};
  }).sort((a,b)=>a.target-b.target);
  const title=text(album.title,180,'相册名称');if(!title.trim())invalid('相册名称不能为空。');
  return {id:album.id,title,description:text(album.description,1500,'相册说明'),imageIds:[...album.imageIds],coverImageId:album.coverImageId,showOnPc:album.showOnPc,showOnMobile:album.showOnMobile,purchasable:album.purchasable,price:amount(album.price,0,Number.MAX_SAFE_INTEGER,'相册价格'),decorationId:decoration(album.decorationId),milestones};
 });return {schema:SCHEMA,albums};
}
export function buildAlbumConfiguration(document,options){const content=validateAlbumDocument(document,options);return {...content,configDigest:albumConfigurationDigest(content)};}
export function validateAlbumConfiguration(configuration,options){
 if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))invalid('相册配置无效。');
 const {configDigest,...content}=configuration,document=validateAlbumDocument(content,options);
 if(typeof configDigest!=='string'||!/^[a-f0-9]{64}$/.test(configDigest)||albumConfigurationDigest(document)!==configDigest)invalid('相册配置校验不匹配。');return document;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
/** The service pins this result once per operation, as it does game settings. */
export function createAlbumContent({configurationPath,photos,readSettings}={}){
 let signature,document=null;
 return {read(){
  if(!configurationPath)return null;
  try{
   const info=statSync(configurationPath,{bigint:true}),next=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
   if(next!==signature){document=freeze(validateAlbumConfiguration(JSON.parse(readFileSync(configurationPath,'utf8')),{photos,decorations:readSettings?.().decorations}));signature=next;}
   return document;
  }catch(error){throw Object.assign(new Error('相册设置暂时无法读取，请稍后重试。'),{status:503,code:'ALBUM_CONFIGURATION_UNAVAILABLE',cause:error});}
 }};
}
