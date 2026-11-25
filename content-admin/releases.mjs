import {randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {
 CONTENT_POINTER_SCHEMA,CONTENT_RELEASE_SCHEMA,CONTENT_RELEASE_FILES,contentJsonBytes,
 contentReleaseError,contentSha256,contentValueDigest,readManagedRelease,
 validateContentSourceVersions,validatePublicReleaseDocument,validateReleaseAssetReferences,validContentReleaseId,
} from './contracts/content-release.mjs';

const clone=structuredClone;
const required=['albums','daily','gameSettings','taskRewards'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const error=(message,code,status=409)=>{throw contentReleaseError(message,code,status);};

function writeNew(path,bytes){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
}
function atomicJson(path,value){
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{writeNew(temporary,contentJsonBytes(value));renameSync(temporary,path);}
 finally{try{unlinkSync(temporary);}catch(cause){if(cause.code!=='ENOENT')throw cause;}}
}
function readOptional(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch(cause){if(cause.code==='ENOENT')return null;throw cause;}}
function safeSummary(value){
 if(value===undefined)return {};
 if(!plain(value)||Buffer.byteLength(JSON.stringify(value))>64*1024)error('发布预览信息无效。','INVALID_RELEASE_SNAPSHOT',400);
 return clone(value);
}
function normalizeSnapshot(value){
 if(!plain(value)||!plain(value.documents)||Object.keys(value.documents).some(key=>!Object.hasOwn(CONTENT_RELEASE_FILES,key))||required.some(key=>!Object.hasOwn(value.documents,key)))error('发布快照缺少公开配置。','INVALID_RELEASE_SNAPSHOT',400);
 const sourceVersions=validateContentSourceVersions(value.sourceVersions),documents={};
 for(const key of Object.keys(CONTENT_RELEASE_FILES))if(Object.hasOwn(value.documents,key))documents[key]=validatePublicReleaseDocument(key,value.documents[key]);
 validateReleaseAssetReferences(documents);
 const files=Object.entries(documents).map(([key,document])=>{const bytes=contentJsonBytes(document);return {key,path:CONTENT_RELEASE_FILES[key],bytes:bytes.length,sha256:contentSha256(bytes),content:bytes};});
 const sourceDigest=contentValueDigest({sourceVersions,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256}))});
 const albums=documents.albums.albums??[],imageIds=new Set(albums.flatMap(album=>album.imageIds??[]));
 const summary={albumCount:albums.length,playableImageCount:imageIds.size,pcAlbumCount:albums.filter(album=>album.showOnPc).length,mobileAlbumCount:albums.filter(album=>album.showOnMobile).length,...safeSummary(value.summary)};
 return {sourceVersions,documents,files,sourceDigest,summary};
}
function metadata(release,prepared){return {releaseId:release.manifest.releaseId,manifestSha256:release.manifestSha256,createdAt:release.manifest.createdAt,sourceVersions:release.manifest.sourceVersions,summary:prepared?.summary??{},files:release.files};}

/**
 * readSnapshot must return one consistent saved snapshot, not browser edits:
 * {sourceVersions,documents:{albums,daily,gameSettings,taskRewards,assets?},summary?}.
 * validate(snapshot) may throw for application-specific checks (pending images,
 * full schemas, delivery readiness). publish(release,actor) handles both remote
 * targets and must reject unless both are activated or safely rolled back.
 * No database is read or changed here. Only confirm changes current.json.
 */
export function createReleaseCoordinator({releaseDir,readSnapshot,validate,publish,now=Date.now}={}){
 if(!releaseDir||typeof readSnapshot!=='function')throw new TypeError('releaseDir and readSnapshot are required');
 const root=resolve(releaseDir),releasesDir=join(root,'releases'),preparedDir=join(root,'prepared'),auditDir=join(root,'audit');
 let busy=false;
 function folders(){for(const path of [root,releasesDir,preparedDir,auditDir])mkdirSync(path,{recursive:true});}
 async function snapshot(){
  // Clone immediately so a caller cannot mutate the prepared snapshot later.
  const value=clone(await readSnapshot());if(validate)await validate(value);
  return normalizeSnapshot(value);
 }
 function audit(kind,details,actor){
  const entry={schema:'jigsaw-content-publish-audit/v1',kind,at:new Date(now()).toISOString(),actor:typeof actor==='string'?actor:'system',...details};
  writeNew(join(auditDir,now()+'-'+randomUUID()+'.json'),contentJsonBytes(entry));return entry;
 }
 async function exclusive(action){
  if(busy)error('已有内容正在准备或发布，请稍后重试。','CONTENT_RELEASE_BUSY');busy=true;
  try{return await action();}finally{busy=false;}
 }
 return {
  async preview(){const value=await snapshot();return {sourceVersions:value.sourceVersions,sourceDigest:value.sourceDigest,summary:value.summary,files:value.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))};},
  async prepare(actor){return exclusive(async()=>{
   const value=await snapshot();folders();
   const createdAt=new Date(now()).toISOString(),releaseId='release-'+createdAt.replace(/[-:.]/g,'')+'-'+randomUUID().slice(0,8);
   const temporary=join(releasesDir,'.prepare-'+randomUUID()),destination=join(releasesDir,releaseId);
   mkdirSync(temporary);
   try{
    for(const file of value.files)writeNew(join(temporary,file.path),file.content);
    const manifest={schema:CONTENT_RELEASE_SCHEMA,releaseId,createdAt,sourceVersions:value.sourceVersions,files:value.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))};
    writeNew(join(temporary,'manifest.json'),contentJsonBytes(manifest));
    // A completed directory only appears after every file has been written.
    if(existsSync(destination))error('发布版本已存在。','CONTENT_RELEASE_EXISTS');renameSync(temporary,destination);
   }finally{
    if(existsSync(temporary)){if(!resolve(temporary).startsWith(releasesDir+sep))throw new Error('Unsafe staging cleanup');rmSync(temporary,{recursive:true});}
   }
   const release=readManagedRelease(root,{releaseId,strict:true});
   const prepared={schema:'jigsaw-content-prepared/v1',releaseId,manifestSha256:release.manifestSha256,sourceDigest:value.sourceDigest,summary:value.summary,preparedAt:createdAt};
   writeNew(join(preparedDir,releaseId+'.json'),contentJsonBytes(prepared));
   audit('prepared',{releaseId,manifestSha256:release.manifestSha256,sourceVersions:value.sourceVersions},actor);
   return metadata(release,prepared);
  });},
  async confirm(input,actor){return exclusive(async()=>{
   if(!plain(input)||!validContentReleaseId(input.releaseId)||typeof input.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.manifestSha256))error('请先生成发布预览。','INVALID_CONTENT_CONFIRMATION',400);
   folders();
   const prepared=readOptional(join(preparedDir,input.releaseId+'.json'));
   if(!prepared||prepared.manifestSha256!==input.manifestSha256)error('发布预览不存在或已变化，请重新准备。','CONTENT_PREVIEW_MISMATCH');
   const release=readManagedRelease(root,{releaseId:input.releaseId,strict:true});
   if(release.manifestSha256!==input.manifestSha256)error('发布文件已变化，请重新准备。','CONTENT_PREVIEW_MISMATCH');
   const current=readManagedRelease(root),alreadyCurrent=current?.pointer.releaseId===input.releaseId&&current.pointer.manifestSha256===input.manifestSha256;
   const value=await snapshot();
   if(value.sourceDigest!==prepared.sourceDigest)error('预览后已有新的保存，请重新准备再确认发布。','CONTENT_SOURCE_CHANGED');
   const snapshotDigest=contentValueDigest({sourceVersions:release.manifest.sourceVersions,files:release.files});
   if(snapshotDigest!==prepared.sourceDigest)error('发布快照校验不匹配，请重新准备。','CONTENT_PREVIEW_MISMATCH');
   // Record intent before calling an external publisher, keeping failures visible.
   audit('publishing',{releaseId:input.releaseId,manifestSha256:input.manifestSha256,previousReleaseId:current?.manifest.releaseId??null},actor);
   let targets=null;
   try{
    if(publish)targets=await publish(release,actor);
    // A process may save while network publishing is in flight. Such edits are
    // a new draft, never silently added to this already-confirmed fixed release.
    // The local pointer is not proof that remote services still use this
    // release. Repeated confirmation must obtain a fresh publisher receipt,
    // but must not replace the real rollback point with the current version.
    if(!alreadyCurrent){
     if(current)atomicJson(join(root,'previous.json'),current.pointer);
     atomicJson(join(root,'current.json'),{schema:CONTENT_POINTER_SCHEMA,releaseId:input.releaseId,manifestSha256:input.manifestSha256});
    }
   }catch(cause){audit('failed',{releaseId:input.releaseId,manifestSha256:input.manifestSha256,message:cause.message,code:cause.code??null,...(cause.receipt?{receipt:cause.receipt}:{})},actor);throw cause;}
   const result={...metadata(release,prepared),status:'published',alreadyCurrent,targets:targets??null,publishedAt:new Date(now()).toISOString()};
   atomicJson(join(root,'last-publish.json'),result);
   audit('published',{releaseId:input.releaseId,manifestSha256:input.manifestSha256,previousReleaseId:current?.manifest.releaseId??null},actor);
   return result;
  });},
  async status(){
   const current=readManagedRelease(root),previous=readOptional(join(root,'previous.json')),lastPublish=readOptional(join(root,'last-publish.json'));
   let audits=[];try{audits=readdirSync(auditDir).filter(name=>/^\d+-[a-f0-9-]+\.json$/.test(name)).sort().slice(-30).map(name=>readOptional(join(auditDir,name)));}catch(cause){if(cause.code!=='ENOENT')throw cause;}
   return {current:current?metadata(current,readOptional(join(preparedDir,current.manifest.releaseId+'.json'))):null,previous,lastPublish,audits,busy};
  },
 };
}
