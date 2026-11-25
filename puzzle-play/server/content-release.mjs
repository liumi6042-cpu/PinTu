// This contract is deliberately self-contained: game services may vendor it.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

export const CONTENT_POINTER_SCHEMA='jigsaw-content-pointer/v1';
export const CONTENT_RELEASE_SCHEMA='jigsaw-managed-release/v1';
export const CONTENT_RELEASE_FILES=Object.freeze({
 albums:'albums.json',daily:'daily.json',gameSettings:'game-settings.json',
 taskRewards:'task-rewards.json',assets:'assets.json',
});
const SCHEMAS=Object.freeze({
 albums:['jigsaw-albums/v1'],daily:['jigsaw-daily-content/v1','jigsaw-daily-content/v2'],
 gameSettings:['jigsaw-game-settings/v1'],taskRewards:['jigsaw-task-rewards/v1'],
 assets:['jigsaw-content-assets/v1'],
});
const REQUIRED=['albums','daily','gameSettings','taskRewards'];
const HASH=/^[a-f0-9]{64}$/;
const RELEASE_ID=/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/;
const WINDOWS_DEVICE=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const VERSION_FIELDS=['draftId','draftRevision','gameRevision','taskRevision'];
const MAX_DOCUMENT_BYTES=32*1024*1024;
const MAX_MANIFEST_BYTES=64*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

export function contentReleaseError(message,code='INVALID_CONTENT_RELEASE',status=400){
 return Object.assign(new Error(message),{code,status});
}
function invalid(message){throw contentReleaseError(message);}
function fields(value,required,optional=[]){
 if(!plain(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))invalid('内容发布格式包含缺失或未知字段。');
}
export function contentSha256(value){return createHash('sha256').update(value).digest('hex');}
export function stableContentValue(value){
 if(Array.isArray(value))return value.map(stableContentValue);
 if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableContentValue(value[key])]));
 return value;
}
export const contentValueDigest=value=>contentSha256(JSON.stringify(stableContentValue(value)));
export function contentJsonBytes(value){return Buffer.from(JSON.stringify(stableContentValue(value),null,2)+'\n','utf8');}
export function validContentReleaseId(value){return typeof value==='string'&&RELEASE_ID.test(value)&&!WINDOWS_DEVICE.test(value);}
export function freezeContent(value){
 if(value&&typeof value==='object'){Object.values(value).forEach(freezeContent);Object.freeze(value);}return value;
}

export function validateContentSourceVersions(value){
 fields(value,VERSION_FIELDS);
 if(typeof value.draftId!=='string'||!value.draftId||value.draftId.length>150)invalid('相册内容来源标识无效。');
 for(const name of VERSION_FIELDS.filter(name=>name!=='draftId')){
  if(!Number.isSafeInteger(value[name])||value[name]<1)invalid('内容发布来源版本无效。');
 }
 return structuredClone(value);
}

export function validateContentPointer(value){
 fields(value,['schema','releaseId','manifestSha256']);
 if(value.schema!==CONTENT_POINTER_SCHEMA||!validContentReleaseId(value.releaseId)||!HASH.test(value.manifestSha256))invalid('当前内容发布指针无效。');
 return structuredClone(value);
}

/** Only public configuration documents are allowed in a managed release. */
export function validatePublicReleaseDocument(key,document){
 if(!Object.hasOwn(CONTENT_RELEASE_FILES,key)||!plain(document)||!SCHEMAS[key].includes(document.schema))invalid('内容发布包含不支持的公开配置。');
 const {configDigest,...content}=document;
 if(typeof configDigest!=='string'||!HASH.test(configDigest)||contentValueDigest(content)!==configDigest)invalid(CONTENT_RELEASE_FILES[key]+' 的配置校验不匹配。');
 if(key==='assets'){
  fields(document,['schema','images','configDigest']);
  if(!Array.isArray(document.images)||document.images.length>100000)invalid('图片交付清单无效。');
  const seen=new Set();
  for(const item of document.images){
   fields(item,['id','available']);
   if(typeof item.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(item.id)||seen.has(item.id)||typeof item.available!=='boolean')invalid('图片交付清单仅能包含图片标识和是否可用。');
   seen.add(item.id);
  }
 }
 return structuredClone(document);
}

/** If an asset delivery inventory is supplied, pending artwork cannot leak into playable lists. */
export function validateReleaseAssetReferences(documents){
 if(!documents.assets)return;
 const delivered=new Set(documents.assets.images.filter(item=>item.available).map(item=>item.id));
 const referenced=new Set([
  ...(documents.albums.albums??[]).flatMap(album=>album.imageIds??[]),
  ...(documents.daily.entries??[]).map(item=>item.imageId),
  ...(documents.daily.automaticCandidates??[]).map(item=>item.imageId),
  ...(documents.daily.fallbackImageIds??[]),
 ]);
 if([...referenced].some(id=>!delivered.has(id)))invalid('发布配置引用了尚未交付的图片，请先完成素材接入。');
}

export function validateContentManifest(value){
 fields(value,['schema','releaseId','createdAt','sourceVersions','files']);
 if(value.schema!==CONTENT_RELEASE_SCHEMA||!validContentReleaseId(value.releaseId))invalid('内容发布版本标识无效。');
 if(typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt)invalid('内容发布时间无效。');
 validateContentSourceVersions(value.sourceVersions);
 if(!Array.isArray(value.files)||value.files.length<REQUIRED.length||value.files.length>Object.keys(CONTENT_RELEASE_FILES).length)invalid('内容发布文件列表无效。');
 const paths=new Set();
 for(const file of value.files){
  fields(file,['path','bytes','sha256']);
  if(!Object.values(CONTENT_RELEASE_FILES).includes(file.path)||paths.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX_DOCUMENT_BYTES||typeof file.sha256!=='string'||!HASH.test(file.sha256))invalid('内容发布包含无效路径、重复文件或错误校验信息。');
  paths.add(file.path);
 }
 if(REQUIRED.some(key=>!paths.has(CONTENT_RELEASE_FILES[key])))invalid('内容发布缺少必要配置。');
 return structuredClone(value);
}

function readJson(path,limit,observe){
 const info=lstatSync(path,{bigint:true});observe?.(path,info);
 if(!info.isFile()||info.isSymbolicLink()||info.size>limit)invalid('内容发布文件不安全或超过大小限制。');
 const bytes=readFileSync(path);
 if(bytes.length>limit)invalid('内容发布文件超过大小限制。');
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{invalid('内容发布文件不是有效 JSON。');}
 return {value,bytes};
}
function checkedChildDirectory(parent,name,observe){
 const path=join(parent,name),info=lstatSync(path,{bigint:true});observe?.(path,info);
 if(!info.isDirectory()||info.isSymbolicLink())invalid('内容发布目录不可使用符号链接。');
 const resolved=realpathSync(path);
 if(!resolved.startsWith(parent+sep))invalid('内容发布目录超出配置位置。');
 return resolved;
}

/**
 * Read the pointer exactly once, then validate and freeze that entire release.
 * Keep this returned object for the duration of a request/game operation.
 * Missing current.json means legacy fallback only when strict is false.
 * Corrupt releases always fail closed; they never fall back to unrelated files.
 */
export function readManagedRelease(root,options={}){return loadManagedRelease(root,options);}
function loadManagedRelease(root,{releaseId,strict=false}={},observe){
 if(!root){if(!strict&&!releaseId)return null;throw contentReleaseError('未配置统一内容发布目录。','CONTENT_RELEASE_UNAVAILABLE',503);}
 let directory;
 try{const requested=resolve(root);observe?.(requested,lstatSync(requested,{bigint:true}));directory=realpathSync(requested);observe?.(directory,lstatSync(directory,{bigint:true}));}
 catch(error){if(error.code==='ENOENT'&&!strict&&!releaseId)return null;throw contentReleaseError('统一内容发布目录暂时不可用。','CONTENT_RELEASE_UNAVAILABLE',503);}
 let pointer;
 if(releaseId===undefined){
  try{pointer=validateContentPointer(readJson(join(directory,'current.json'),MAX_MANIFEST_BYTES,observe).value);}
  catch(error){if(error.code==='ENOENT'&&!strict)return null;throw error;}
  releaseId=pointer.releaseId;
 }else if(!validContentReleaseId(releaseId))invalid('内容发布版本标识无效。');
 const releases=checkedChildDirectory(directory,'releases',observe),releaseDir=checkedChildDirectory(releases,releaseId,observe);
 const rawManifest=readJson(join(releaseDir,'manifest.json'),MAX_MANIFEST_BYTES,observe),manifest=validateContentManifest(rawManifest.value);
 const manifestSha256=contentSha256(rawManifest.bytes);
 if(manifest.releaseId!==releaseId||pointer&&pointer.manifestSha256!==manifestSha256)invalid('内容发布清单与当前版本不匹配。');
 if(!pointer)pointer={schema:CONTENT_POINTER_SCHEMA,releaseId,manifestSha256};
 const documents={};
 for(const file of manifest.files){
  const {value,bytes}=readJson(join(releaseDir,file.path),MAX_DOCUMENT_BYTES,observe);
  if(bytes.length!==file.bytes||contentSha256(bytes)!==file.sha256)invalid(file.path+' 的文件校验不匹配。');
  const key=Object.keys(CONTENT_RELEASE_FILES).find(name=>CONTENT_RELEASE_FILES[name]===file.path);
  documents[key]=validatePublicReleaseDocument(key,value);
 }
 validateReleaseAssetReferences(documents);
 return freezeContent({pointer,manifest,manifestSha256,releaseDir,documents,files:manifest.files});
}

const fileSignature=info=>[info.dev,info.ino,info.mode,info.size,info.mtimeNs,info.ctimeNs].join(':');
const signaturesMatch=signatures=>[...signatures].every(([path,signature])=>fileSignature(lstatSync(path,{bigint:true}))===signature);

/** One bounded, fully validated snapshot per service; the pure reader above stays uncached.
 * Every hit checks filesystem identities, including caller-supplied asset dependencies.
 * Changed/deleted inputs fail closed on the next read. A full hash/typed validation is
 * also repeated at least every 30 seconds, even when all stat signatures stay equal.
 */
export function createManagedReleaseReader(root,{strict=false,validate=release=>release,watchPaths=()=>[],maxAgeMs=30000,now=Date.now}={}){
 const lifetime=Math.max(0,Math.min(30000,Number.isFinite(maxAgeMs)?maxAgeMs:30000));let cached=null;
 return {read(){
  try{
   const clock=now();
   if(cached&&clock>=cached.validatedAt&&clock-cached.validatedAt<lifetime&&signaturesMatch(cached.signatures))return cached.value;
   cached=null;
   const signatures=new Map(),observe=(path,info)=>signatures.set(path,fileSignature(info));
   const release=loadManagedRelease(root,{strict},observe);if(!release)return null;
   // Capture dependencies before typed validation, so replacement during validation
   // cannot associate an unchecked new file with an old cached validation result.
   for(const path of new Set(watchPaths(release)))observe(path,lstatSync(path,{bigint:true}));
   const value=freezeContent(validate(release));
   if(signaturesMatch(signatures))cached={key:release.pointer.releaseId+':'+release.manifestSha256,value,signatures,validatedAt:clock};
   return value;
  }catch(error){cached=null;throw error;}
 },clear(){cached=null;}};
}

/** Files referenced by this release only; no directory scans or daily selection. */
export function contentReleaseImageIds(release){
 const {albums,daily}=release.documents;
 return new Set([...(albums.albums??[]).flatMap(album=>album.imageIds??[]),...(daily.entries??[]).map(entry=>entry.imageId),...(daily.automaticCandidates??[]).map(entry=>entry.imageId),...(daily.fallbackImageIds??[])]);
}
