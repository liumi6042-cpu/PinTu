import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {basename,isAbsolute,join,relative,resolve,sep} from 'node:path';

const ASSET_ROOT='/srv/sites/jigsaw-content/assets';
const REMOTE_TOOL=ASSET_ROOT+'/tools/apply-assets.py';
const PUZZLE_URL=/^\/puzzles\/[A-Za-z0-9._-]+$/;
const HASH=/^[a-f0-9]{64}$/;
// Runtime photo objects swap src to optimizedSrc before serving, so the original
// PNG never exists on a server and must not be treated as a delivery file.
const URL_FIELDS=['playSrc','thumbSrc','optimizedSrc'];
const RECEIPT_SCHEMA='jigsaw-asset-upload-receipt/v1';

const failure=(message,code='ASSET_DELIVERY_FAILED',status=409)=>Object.assign(new Error(message),{code,status});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonFile=value=>JSON.stringify(value,null,2)+'\n';

function run(command,args,{timeoutMs=900000}={}){
 return new Promise((done,reject)=>{
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):done(value);};
  const timer=setTimeout(()=>{child.kill();finish(failure('图片上传等待超时。请检查服务器连接后重试。','ASSET_DELIVERY_TIMEOUT'));},timeoutMs);
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>1048576){child.kill();finish(failure('服务器返回内容超出限制。'));}});
  child.stderr.on('data',chunk=>{if(stderr.length<16384)stderr+=chunk.toString();});
  child.on('error',()=>finish(failure('无法启动上传连接；请检查本机 SSH。','ASSET_DELIVERY_CONNECTION')));
  child.on('close',code=>finish(null,{code,stdout,stderr}));
 });
}

function quote(value){return "'"+String(value).replaceAll("'","'\\''")+"'";}

/** Private delivery transport: reuses the admin publish host and key only. */
function readTransport(configPath){
 let input;
 try{input=JSON.parse(readFileSync(configPath,'utf8'));}
 catch{throw failure('尚未配置正式服连接，无法上传图片。','INVALID_PUBLISH_CONFIG',409);}
 const host=input?.host??input?.sshHost;
 if(typeof host!=='string'||!host)throw failure('正式服连接缺少 SSH 主机。','INVALID_PUBLISH_CONFIG');
 if(input?.identityFile!==undefined&&(typeof input.identityFile!=='string'||!isAbsolute(input.identityFile)))throw failure('SSH 私钥路径无效。','INVALID_PUBLISH_CONFIG');
 return {host,identityFile:input?.identityFile??null,bindAddress:input?.bindAddress??null};
}

/** Local artwork directory holding every catalog file; the Web worktree is canonical. */
function puzzleRoot(projectRoot,override){
 const candidate=override??join(projectRoot,'work/dual-managed-release-20261014/public/puzzles');
 if(!existsSync(candidate))throw failure('本地素材目录不存在：'+candidate,'ASSET_SOURCE_MISSING');
 return realpathSync(candidate);
}

function readCatalog(projectRoot){
 const file=join(projectRoot,'work/dual-managed-release-20261014/content/puzzle-catalog.json');
 const guidanceFile=join(projectRoot,'work/dual-managed-release-20261014/content/puzzle-guidance.json');
 let catalog,guidance;
 try{catalog=JSON.parse(readFileSync(file,'utf8'));guidance=JSON.parse(readFileSync(guidanceFile,'utf8'));}
 catch{throw failure('本地图库或尺寸记录无法读取。','ASSET_SOURCE_MISSING');}
 if(!Array.isArray(catalog))throw failure('本地图库不是数组。','ASSET_SOURCE_MISSING');
 return {catalog,guidance,catalogPath:file,guidancePath:guidanceFile};
}

/** Every runtime file a catalog entry needs, in the order the games request them. */
export function catalogFiles(catalog,root){
 const items=new Map();
 for(const photo of catalog){
  if(!photo||typeof photo.id!=='string')throw failure('图库条目缺少图片 ID。','ASSET_SOURCE_MISSING');
  for(const field of URL_FIELDS){
   const url=photo[field];
   if(url===undefined||url===null)continue;
   if(!PUZZLE_URL.test(url))throw failure('图库引用了不允许上传的路径：'+url,'ASSET_SOURCE_MISSING');
   if(items.has(url))continue;
   const file=join(root,url.slice('/puzzles/'.length));
   if(!existsSync(file)||!lstatSync(file).isFile())throw failure('本地缺少图库文件：'+url,'ASSET_SOURCE_MISSING');
   const size=statSync(file).size;
   items.set(url,{url,file,bytes:size,field});
  }
 }
 return [...items.values()];
}

export function createAssetDelivery({projectRoot,dataDir,configPath,localPuzzles,now=Date.now,runner=run}={}){
 const root=resolve(projectRoot??join(import.meta.dirname,'..'));
 const workDir=resolve(dataDir??join(root,'content-admin/work'));
 const config=configPath??join(workDir,'publish-config.json');
 // Resolved lazily: constructing the server must not depend on local artwork.
 const puzzleDir=()=>puzzleRoot(root,localPuzzles);

 function sshOptions(){
  const {host,identityFile,bindAddress}=readTransport(config);
  const options=['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes'];
  if(bindAddress)options.push('-o','BindAddress='+bindAddress);
  if(identityFile)options.push('-i',identityFile);
  return {host,options};
 }
 async function remote(command,timeoutMs=180000){
  const {host,options}=sshOptions();
  const result=await runner('ssh',[...options,'-T',host,command],{timeoutMs});
  if(result.code!==0)throw failure('服务器操作失败：'+(result.stderr.trim()||result.stdout.trim()||'未知错误'));
  return result.stdout;
 }
 async function remoteJson(command){
  const text=await remote(command);
  const line=text.trim().split('\n').filter(Boolean).at(-1);
  try{return JSON.parse(line);}catch{throw failure('服务器未返回可读取的交付结果。');}
 }
 async function remoteState(){
  const state=await remoteJson('python3 '+quote(REMOTE_TOOL)+' --list-existing');
  if(!state?.ok)throw failure('无法读取服务器现有素材。');
  return {existing:new Set(state.puzzles??[]),catalog:state.catalog===true,guidance:state.guidance===true};
 }

 /** Compare the saved catalog with the server; nothing is uploaded here. */
 async function plan(){
  const {catalog,guidance,catalogPath,guidancePath}=readCatalog(root);
  const files=catalogFiles(catalog,puzzleDir());
  let state={existing:new Set(),catalog:false,guidance:false},reachable=true,reason='';
  try{state=await remoteState();}catch(error){reachable=false;reason=error.message;}
  const missing=files.filter(item=>!state.existing.has(basename(item.file)));
  const catalogBytes=readFileSync(catalogPath),guidanceBytes=readFileSync(guidancePath);
  const remoteCatalog=await (async()=>{
   if(!reachable)return '';
   try{return await remote('sha256sum '+quote(ASSET_ROOT+'/catalog.json')+' '+quote(ASSET_ROOT+'/guidance.json')+' 2>/dev/null || true');}catch{return '';}
  })();
  const remoteHashes={};
  for(const line of String(remoteCatalog??'').split('\n')){
   const match=line.trim().match(/^([a-f0-9]{64})\s+(\S+)$/);
   if(match)remoteHashes[match[2]]=match[1];
  }
  const catalogChanged=reachable&&remoteHashes[ASSET_ROOT+'/catalog.json']!==sha(catalogBytes);
  const guidanceChanged=reachable&&remoteHashes[ASSET_ROOT+'/guidance.json']!==sha(guidanceBytes);
  return {
   reachable,reason,
   configured:true,
   totalFiles:files.length,
   missing:missing.map(({url,bytes})=>({url,bytes})),
   missingBytes:missing.reduce((total,item)=>total+item.bytes,0),
   catalogChanged,guidanceChanged,
   catalogEntries:catalog.length,
   catalogSha256:sha(catalogBytes),
   guidanceSha256:sha(guidanceBytes),
  };
 }

 /** Upload only missing artwork plus changed registry documents, then verify remotely. */
 async function deliver({actor='admin'}={}){
  const planResult=await plan();
  if(!planResult.reachable)throw failure(planResult.reason||'服务器不可连接，无法上传图片。','ASSET_DELIVERY_CONNECTION');
  if(!planResult.missing.length&&!planResult.catalogChanged&&!planResult.guidanceChanged){
   const delivered=recordDelivered({catalog:readCatalog(root).catalog,plan:planResult});
   return {skipped:true,...planResult,delivered,actor};
  }
  const {catalog,catalogPath,guidancePath}=readCatalog(root);
  const files=catalogFiles(catalog,puzzleDir());
  const missingNames=new Set(planResult.missing.map(item=>basename(item.url)));
  const upload=files.filter(item=>missingNames.has(basename(item.file)));
  const {host,options}=sshOptions();
  const batchId='batch-'+new Date(now()).toISOString().replace(/[-:.]/g,'')+'-'+randomUUID().slice(0,8);
  const staging=join(workDir,'asset-upload-staging',batchId);
  mkdirSync(join(staging,'assets'),{recursive:true});
  const manifest={schema:'jigsaw-asset-batch/v1',createdAt:new Date(now()).toISOString(),
   files:upload.map(item=>({url:item.url,bytes:item.bytes,sha256:sha(readFileSync(item.file))})),
   mobileManifest:true};
  if(planResult.catalogChanged){manifest.catalog='catalog.json';writeFileSync(join(staging,'catalog.json'),readFileSync(catalogPath));}
  if(planResult.guidanceChanged){manifest.guidance='guidance.json';writeFileSync(join(staging,'guidance.json'),readFileSync(guidancePath));}
  writeFileSync(join(staging,'manifest.json'),jsonFile(manifest));
  for(const item of upload)writeFileSync(join(staging,'assets',basename(item.file)),readFileSync(item.file));
  try{
   const remoteDir=ASSET_ROOT+'/.incoming/'+batchId;
   const prepare=await runner('ssh',[...options,'-T',host,'umask 077 && mkdir -p -- '+quote(remoteDir)+' '+quote(remoteDir+'/assets')],{timeoutMs:60000});
   if(prepare.code!==0)throw failure('无法创建服务器上传目录。');
   const documents=[join(staging,'manifest.json')];
   if(manifest.catalog)documents.push(join(staging,'catalog.json'));
   if(manifest.guidance)documents.push(join(staging,'guidance.json'));
   const uploadedDocs=await runner('scp',[...options,'--',...documents,host+':'+remoteDir+'/'],{timeoutMs:600000});
   if(uploadedDocs.code!==0)throw failure('图库索引上传未完成：'+(uploadedDocs.stderr.trim()||'连接中断'));
   if(upload.length){
    const uploaded=await runner('scp',[...options,'--',...upload.map(item=>join(staging,'assets',basename(item.file))),host+':'+remoteDir+'/assets/'],{timeoutMs:1800000});
    if(uploaded.code!==0)throw failure('图片上传未完成：'+(uploaded.stderr.trim()||'连接中断'));
   }
   const applied=await remoteJson('python3 '+quote(REMOTE_TOOL)+' --batch '+quote(remoteDir)+' --apply --restart');
   if(!applied?.ok)throw failure(applied?.message??'服务器未接受这批图片。');
   await runner('ssh',[...options,'-T',host,'rm -rf -- '+quote(remoteDir)],{timeoutMs:60000});
   const delivered=recordDelivered({catalog,plan:planResult,applied,actor});
   recordReceipt({batchId,plan:planResult,applied,actor,delivered});
   return {skipped:false,batchId,...planResult,applied,delivered,actor};
  }finally{
   try{rmSync(staging,{recursive:true,force:true});}catch{}
  }
 }

 /** Artwork that is now on both runtimes also becomes "delivered" for release previews. */
 function recordDelivered({catalog,plan}){
  const receiptFile=join(workDir,'delivered-assets.json');
  let receipt,registry;
  try{receipt=JSON.parse(readFileSync(receiptFile,'utf8'));}catch{return 0;}
  if(receipt?.schema!=='jigsaw-delivered-assets/v1'||!Array.isArray(receipt.images))return 0;
  try{registry=JSON.parse(readFileSync(join(workDir,'pending-assets/registry.json'),'utf8'));}catch{return 0;}
  const byId=new Map((registry.assets??[]).map(asset=>[asset.id,asset]));
  const missing=new Set(plan.missing.map(item=>item.url));
  const known=new Set(receipt.images.map(image=>image.id));
  const kinds=['thumbnail','play','optimized'];
  const added=[];
  for(const photo of catalog){
   if(known.has(photo.id))continue;
   const asset=byId.get(photo.id);
   if(!asset?.delivery)continue;
   const files=kinds.map(kind=>({url:'/puzzles/'+basename(asset.delivery[kind].path),bytes:asset.delivery[kind].bytes,sha256:asset.delivery[kind].sha256}));
   if(files.some(item=>missing.has(item.url)))continue;
   if(photo.thumbSrc!==files[0].url||photo.playSrc!==files[1].url||photo.optimizedSrc!==files[2].url)continue;
   added.push({id:photo.id,sourceSha256:asset.source.sha256,files});
  }
  if(!added.length)return 0;
  const next={...receipt,images:[...receipt.images,...added],verifiedAt:new Date(now()).toISOString()};
  writeFileSync(receiptFile,jsonFile(next));
  return added.length;
 }

 function recordReceipt(entry){
  const file=join(workDir,'asset-uploads.json');
  let receipt={schema:RECEIPT_SCHEMA,entries:[]};
  try{const parsed=JSON.parse(readFileSync(file,'utf8'));if(parsed?.schema===RECEIPT_SCHEMA&&Array.isArray(parsed.entries))receipt=parsed;}catch{}
  receipt.entries=[...receipt.entries,{at:new Date(now()).toISOString(),batchId:entry.batchId,actor:entry.actor,
   uploaded:entry.plan.missing.length,uploadedBytes:entry.plan.missingBytes,
   catalogChanged:entry.plan.catalogChanged,guidanceChanged:entry.plan.guidanceChanged,
   catalogSha256:entry.plan.catalogSha256,files:entry.applied.files,restarted:Array.isArray(entry.applied.services),
   markedDelivered:entry.delivered??0}].slice(-200);
  writeFileSync(file,jsonFile(receipt));
 }
 return {plan,deliver};
}
