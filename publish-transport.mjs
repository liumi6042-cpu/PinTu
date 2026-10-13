import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PUBLIC_FILES=new Set(['albums.json','daily.json','game-settings.json','task-rewards.json','assets.json']);
const ROOT_ALLOWLIST=new Set(['/srv/sites/jigsaw-content']);
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const HASH=/^[a-f0-9]{64}$/;
const ACTIVATOR=fileURLToPath(new URL('./scripts/activate-content-release.py',import.meta.url));
const fail=(code,message)=>Object.assign(new Error(message),{code});
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";

function validReleaseId(value){return typeof value==='string'&&ID.test(value)&&!value.includes('..');}
function healthUrl(value){
 let url;try{url=new URL(value);}catch{throw fail('INVALID_PUBLISH_CONFIG','发布目标健康检查地址无效。');}
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||url.username||url.password||url.hash||url.search)throw fail('INVALID_PUBLISH_CONFIG','健康检查必须使用服务器本机 HTTP 地址。');
 return url.href;
}
function healthHeaders(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('INVALID_PUBLISH_CONFIG','健康检查请求头配置无效。');
 const headers={};
 for(const [name,header] of Object.entries(value)){
  const lower=name.toLowerCase(),key=lower==='host'?'Host':lower==='x-forwarded-proto'?'X-Forwarded-Proto':null;
  if(!key||Object.hasOwn(headers,key)||typeof header!=='string')throw fail('INVALID_PUBLISH_CONFIG','健康检查只允许 Host 与 X-Forwarded-Proto 请求头。');
  if(key==='Host'){
   const parts=header.split(':'),hostname=parts[0],port=parts[1];
   if(parts.length>2||hostname.length>253||!hostname.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))||(port!==undefined&&(!/^[0-9]{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)))throw fail('INVALID_PUBLISH_CONFIG','健康检查 Host 必须是有效域名及可选端口。');
  }else if(!['http','https'].includes(header))throw fail('INVALID_PUBLISH_CONFIG','健康检查转发协议只能是 http 或 https。');
  headers[key]=header;
 }
 return headers;
}

/** Configuration is loaded by the server from a private local file, never from a browser request. */
export function validatePublishTransportConfig(input,{allowedRemoteRoots=[...ROOT_ALLOWLIST]}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('INVALID_PUBLISH_CONFIG','尚未配置正式服同步目标。');
 if(input.schema!==undefined&&input.schema!=='jigsaw-publish-transport/v1')throw fail('INVALID_PUBLISH_CONFIG','发布连接配置格式不支持。');
 const host=input.host??input.sshHost;
 if(typeof host!=='string'||!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host))throw fail('INVALID_PUBLISH_CONFIG','SSH 主机必须是明确配置的别名或主机地址。');
 const remoteRoot=input.remoteRoot;
 if(typeof remoteRoot!=='string'||!/^\/[a-zA-Z0-9/_-]+$/.test(remoteRoot)||remoteRoot.includes('//')||remoteRoot.endsWith('/')||!allowedRemoteRoots.includes(remoteRoot))throw fail('INVALID_PUBLISH_CONFIG','发布目录不在服务器允许的目录范围内。');
 const identityFile=input.identityFile;
 if(identityFile!==undefined&&(typeof identityFile!=='string'||!isAbsolute(identityFile)||/[\r\n\0]/.test(identityFile)))throw fail('INVALID_PUBLISH_CONFIG','SSH 私钥必须使用本机绝对路径。');
 const targets=input.targets;
 if(!Array.isArray(targets)||targets.length!==2||new Set(targets.map(item=>item?.id)).size!==2||targets.some(item=>!['web','mobile'].includes(item?.id)))throw fail('INVALID_PUBLISH_CONFIG','必须同时配置网页端和小程序端。');
 const normalizedTargets=targets.map(item=>{
  const command=item.preflightCommand;
  if(!Array.isArray(command)||command.length<1||command.length>16||command.some(part=>typeof part!=='string'||part.length===0||part.length>1024||/[\0\r\n]/.test(part))||!command[0].startsWith('/'))throw fail('INVALID_PUBLISH_CONFIG','每个目标都需要明确的服务器本机校验命令。');
  const headers=healthHeaders(item.healthHeaders);
  return {id:item.id,healthUrl:healthUrl(item.healthUrl),preflightCommand:[...command],...(headers===undefined?{}:{healthHeaders:headers})};
 });
 const timeoutMs=input.timeoutMs??180000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>240000)throw fail('INVALID_PUBLISH_CONFIG','发布超时时间必须在 1 秒到 4 分钟之间。');
 return {schema:'jigsaw-publish-transport/v1',host,remoteRoot,...(identityFile?{identityFile}:{}),targets:normalizedTargets,timeoutMs};
}

function runProcess(command,args,{timeoutMs}){
 return new Promise((done,reject)=>{
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):done(value);};
  const timer=setTimeout(()=>{child.kill();finish(fail('PUBLISH_TIMEOUT','同步等待超时；请检查两端当前发布状态后重试。'));},timeoutMs);
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>262144){child.kill();finish(fail('PUBLISH_OUTPUT_LIMIT','服务器校验返回内容超出限制。'));}});
  child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString();});
  child.on('error',()=>finish(fail('PUBLISH_CONNECTION_FAILED','无法启动发布连接；请检查本机 SSH 配置。')));
  child.on('close',code=>finish(null,{code,stdout,stderr}));
 });
}

/** Upload public JSON only, validate both consumers, then change a single shared pointer. */
export async function publishRelease(release,configuration,options={}){
 const config=validatePublishTransportConfig(configuration,options),run=options.runProcess??runProcess;
 const releaseDir=release?.releaseDir??release?.releaseDirectory;
 const releaseId=release?.manifest?.releaseId??release?.pointer?.releaseId;
 const manifestSha256=release?.manifestSha256??release?.pointer?.manifestSha256;
 if(typeof releaseDir!=='string'||!validReleaseId(releaseId)||!HASH.test(manifestSha256??''))throw fail('INVALID_RELEASE','待发布的内容版本无效。');
 const {readManagedRelease}=await import('./contracts/content-release.mjs');
 const verified=readManagedRelease(resolve(releaseDir,'../..'),{releaseId,strict:true});
 if(!verified||resolve(verified.releaseDir)!==resolve(releaseDir)||verified.manifestSha256!==manifestSha256)throw fail('RELEASE_CHANGED','待发布文件已经改变，请重新确认提交。');
 for(const file of verified.manifest.files){if(!PUBLIC_FILES.has(file.path))throw fail('PRIVATE_RELEASE_FILE','发布内容包含不允许上传的文件。');}
 const manifestBytes=await readFile(join(releaseDir,'manifest.json'));
 if(createHash('sha256').update(manifestBytes).digest('hex')!==manifestSha256)throw fail('RELEASE_CHANGED','待发布清单已经改变，请重新确认提交。');
 if(config.identityFile){try{await realpath(config.identityFile);}catch{throw fail('INVALID_PUBLISH_CONFIG','配置的 SSH 私钥文件不可用。');}}
 const stageName=releaseId+'-'+randomBytes(8).toString('hex'),stage=config.remoteRoot+'/.incoming/'+stageName;
 const temporary=await mkdtemp(join(resolve(releaseDir,'../..'),'.publish-'));
 const sshOptions=['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes',...(config.identityFile?['-i',config.identityFile]:[])];
 const ssh=remoteCommand=>run('ssh',[...sshOptions,'-T',config.host,remoteCommand],{timeoutMs:config.timeoutMs});
 try{
  const request={schema:'jigsaw-content-activation/v1',releaseId,manifestSha256,remoteRoot:config.remoteRoot,targets:config.targets,healthTimeoutSeconds:30,preflightTimeoutSeconds:45};
  const requestFile=join(temporary,'activation-request.json');await writeFile(requestFile,JSON.stringify(request),'utf8');
  const prepare=await ssh('umask 077 && mkdir -p -- '+quote(stage));
  if(prepare.code!==0)throw fail('PUBLISH_CONNECTION_FAILED','无法创建正式服临时发布目录；请检查 SSH 连接和目录权限。');
  const paths=[...verified.manifest.files.map(file=>join(releaseDir,file.path)),join(releaseDir,'manifest.json'),ACTIVATOR,requestFile];
  const uploaded=await run('scp',[...sshOptions,'--',...paths,config.host+':'+stage+'/'],{timeoutMs:config.timeoutMs});
  if(uploaded.code!==0)throw fail('PUBLISH_UPLOAD_FAILED','内容上传未完成，正式服当前版本未切换。');
  const activated=await ssh('python3 '+quote(stage+'/activate-content-release.py')+' --root '+quote(config.remoteRoot)+' --request '+quote(stage+'/activation-request.json'));
  let receipt;try{receipt=JSON.parse(activated.stdout.trim());}catch{throw fail('PUBLISH_RECEIPT_MISSING','服务器未返回可验证的同步结果，请检查正式服当前版本。');}
  if(receipt?.schema!=='jigsaw-content-publish-receipt/v1'||receipt.releaseId!==releaseId||!Array.isArray(receipt.targets))throw fail('PUBLISH_RECEIPT_INVALID','服务器返回的同步结果与本次提交不符。');
  if(activated.code!==0||!receipt.ok){const error=fail(receipt.code??'PUBLISH_FAILED',receipt.message??'正式服同步失败。');error.receipt=receipt;throw error;}
  if(receipt.targets.length!==2||receipt.targets.some(target=>!['web','mobile'].includes(target.id)||target.contentReleaseId!==releaseId||target.ok!==true)||new Set(receipt.targets.map(target=>target.id)).size!==2)throw fail('PUBLISH_RECEIPT_INVALID','两个目标尚未同时确认当前版本。');
  return receipt;
 }finally{await rm(temporary,{recursive:true,force:true});}
}
