import {createServer} from 'node:http';
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createStore,problem} from './store.mjs';
import {createAuth} from './auth.mjs';
import {readSource,previewFile,verifyDelivery} from './source.mjs';
import {validateDraft,analyzeDraft,buildCandidate,normalizeDraft} from './model.mjs';
import {mergeDraft} from './merge.mjs';
import {buildDailyConfiguration,createDailyCoordinator} from './daily.mjs';
import {createTaskRewardCoordinator} from './task-rewards.mjs';
import {createGameSettingsCoordinator} from './game-settings.mjs';
import {buildPublicAlbumDocument,createAlbumCoordinator} from './albums.mjs';
import {buildAlbumConfiguration} from '../jigsaw-nook-taptap/server/album-content.mjs';
import {buildGameConfiguration} from '../jigsaw-nook-taptap/server/game-settings.mjs';
import {buildTaskRewardConfiguration} from '../jigsaw-nook-taptap/server/task-reward-settings.mjs';
import {createReleaseCoordinator} from './releases.mjs';
import {publishRelease,validatePublishTransportConfig} from './publish-transport.mjs';
import {contentValueDigest,validContentReleaseId} from './contracts/content-release.mjs';

const appRoot=dirname(fileURLToPath(import.meta.url));
function inputFields(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw problem(400,'请求中包含无效字段');return input;}
function revision(value){if(!Number.isSafeInteger(value)||value<1)throw problem(400,'草稿版本无效');return value;}
function reason(value){if(typeof value!=='string'||value.trim().length<4||value.trim().length>500)throw problem(400,'请填写 4–500 个字符的操作原因');return value.trim();}
function title(value,fallback){if(value===undefined)return fallback;if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw problem(400,'名称需为 1–100 个字符');return value.trim();}
async function jsonBody(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw problem(415,'此操作需要 JSON 数据');let size=0,parts=[];for await(const part of req){size+=part.length;if(size>2*1024*1024)throw problem(413,'内容过大，请分批整理');parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw problem(400,'请求数据无法读取');}}
function response(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
const ID=/^[a-f0-9]{32}$/;
const PUBLISH_MESSAGES={
 PUBLISH_NOT_CONFIGURED:'正式服同步尚未配置；可以先生成并检查发布预览。',
 INVALID_PUBLISH_CONFIG:'正式服同步配置暂时不可用，请检查服务器连接配置。',
 PUBLISH_CONNECTION_FAILED:'无法连接正式服，请检查服务器连接和目录权限。',
 PUBLISH_UPLOAD_FAILED:'内容上传未完成，正式服当前版本未切换。',
 PUBLISH_TIMEOUT:'同步等待超时，请检查两端当前发布状态后重试。',
 PUBLISH_PREFLIGHT_FAILED:'两端内容预检未全部通过，正式服当前版本未切换。',
 PUBLISH_HEALTH_FAILED:'同步检查未通过，已恢复先前版本。',
 PUBLISH_ROLLBACK_UNVERIFIED:'同步检查未通过；回退状态仍需检查。',
 PUBLISH_RECEIPT_INVALID:'两个目标尚未返回可验证的同一内容版本。',
 PUBLISH_RECEIPT_MISSING:'服务器未返回可验证的同步结果，请检查正式服当前版本。',
 PUBLISH_FAILED:'正式服同步未完成，请检查两端发布状态后重试。',
};
const releaseIdentity=value=>validContentReleaseId(value)?value:null;
const publishCode=value=>typeof value==='string'&&Object.hasOwn(PUBLISH_MESSAGES,value)?value:'PUBLISH_FAILED';
function publicPublishReceipt(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const targets=items=>Array.isArray(items)?items.filter(item=>['web','mobile'].includes(item?.id)).map(item=>({id:item.id,ok:item.ok===true,contentReleaseId:releaseIdentity(item.contentReleaseId)})):[];
 const code=value.code===undefined?undefined:publishCode(value.code);
 return {schema:'jigsaw-content-publish-receipt/v1',releaseId:releaseIdentity(value.releaseId),ok:value.ok===true,
  ...(releaseIdentity(value.previousReleaseId)?{previousReleaseId:value.previousReleaseId}:{}),
  ...(['preflight','active','rolled-back','rollback-unverified'].includes(value.phase)?{phase:value.phase}:{}),
  ...(code?{code,message:PUBLISH_MESSAGES[code]}:{}),targets:targets(value.targets),
  ...(value.rollback&&typeof value.rollback==='object'?{rollback:{attempted:value.rollback.attempted===true,...(typeof value.rollback.ok==='boolean'?{ok:value.rollback.ok}:{}),releaseId:releaseIdentity(value.rollback.releaseId),targets:targets(value.rollback.targets)}}:{}),
 };
}

export function createAdminServer({projectRoot=resolve(appRoot,'..'),dataDir=join(appRoot,'work'),source:providedSource,bridgeDir=join(dataDir,'daily-bridge'),taskRewardBridgeDir=join(dataDir,'task-rewards'),gameSettingsBridgeDir=join(dataDir,'game-settings'),albumBridgeDir=join(dataDir,'albums'),releaseDir=join(dataDir,'content-releases'),publishConfigPath=join(dataDir,'publish-config.json'),publisher=publishRelease,appearanceDir=join(projectRoot,'jigsaw-nook-taptap/work/daily-appearances'),now=Date.now}={}){
 let source=providedSource??readSource(projectRoot);const store=createStore(dataDir,source),auth=createAuth(store);
 const taskRewards=createTaskRewardCoordinator({store,bridgeDir:taskRewardBridgeDir,now});taskRewards.sync();
 const gameSettings=createGameSettingsCoordinator({store,bridgeDir:gameSettingsBridgeDir,now});gameSettings.sync();
 const daily=createDailyCoordinator({store,getSource:()=>source,validateDocument:validateDraft,bridgeDir,appearanceDir,now});
 const albums=createAlbumCoordinator({store,getSource:()=>source,bridgeDir:albumBridgeDir,getDocument:currentDraft});
 function syncContent(){const status=daily.sync();albums.sync();return status;}
 syncContent();
 const dailyTimer=setInterval(()=>{try{syncContent();}catch{/* A later request retries without replacing a concurrent edit. */}},30_000);dailyTimer.unref();
 // Older saved drafts remain intact. Present new source entries through the
 // existing three-way merge and persist only when the administrator saves.
 function preparedDocument(document,previous,latest=source){return validateDraft(daily.resolveDates(normalizeDraft(document,latest),previous),latest);}
 function mergeSourceDraft(draft,document=draft.document){return preparedDocument(mergeDraft(normalizeDraft(store.baseline(draft.sourceFingerprint),source),normalizeDraft(document,source),source.baseline),draft.document);}
 function comparisonDocument(input){
  const document=daily.resolveDates(normalizeDraft(input,source),input);
  for(const album of document.albums)for(const milestone of album.milestones)milestone.id??='milestone-'+milestone.target;
  return document;
 }
 function currentDraft(id){const draft=store.draft(id);if(draft.sourceFingerprint===source.fingerprint)return {...draft,document:validateDraft(draft.document,source)};const document=mergeSourceDraft(draft);return {...draft,document,sourceNeedsMerge:!isDeepStrictEqual(comparisonDocument(document),comparisonDocument(draft.document))};}
 function checkHistorical(latest){const missing=store.historicalIds().filter(id=>!Object.hasOwn(latest.baseline.assets,id));if(missing.length)throw problem(409,'来源缺少已导入的历史图片 ID，请先恢复归档条目：'+missing.slice(0,5).join('、'),'HISTORICAL_ID_MISSING');}
 function publishConfiguration(){
  try{return {configured:true,configuration:validatePublishTransportConfig(JSON.parse(readFileSync(publishConfigPath,'utf8'))),configurationMessage:'已配置网页端和小程序端同步。'};}
  catch(cause){const code=cause.code==='ENOENT'?'PUBLISH_NOT_CONFIGURED':'INVALID_PUBLISH_CONFIG';return {configured:false,code,configurationMessage:PUBLISH_MESSAGES[code]};}
 }
 function savedReleaseSnapshot(){
  // The normal daily reconciliation runs first. The release then captures only
  // persisted rows; browser edits and read-time source merges never enter it.
  syncContent();
  const draft=store.draft(store.activeDraftId());
  if(currentDraft(draft.id).sourceNeedsMerge)throw problem(409,'来源素材有待合并的内容，请先保存相册后再生成发布预览。','CONTENT_SOURCE_NEEDS_SAVE');
  const document=validateDraft(draft.document,source),tasks=taskRewards.sync(),game=gameSettings.sync();
  const retained=source.assets.filter(asset=>asset.lifecycle==='retained'),images=source.assets.map(asset=>({id:asset.id,available:asset.lifecycle==='retained'}));
  const assetDocument={schema:'jigsaw-content-assets/v1',images};
  const documents={
   albums:buildAlbumConfiguration(buildPublicAlbumDocument(document,source),{photos:retained,decorations:game.document.decorations}),
   daily:buildDailyConfiguration(document,source),gameSettings:buildGameConfiguration(game.document),taskRewards:buildTaskRewardConfiguration(tasks.document),
   assets:{...assetDocument,configDigest:contentValueDigest(assetDocument)},
  };
  return {sourceVersions:{draftId:draft.id,draftRevision:draft.revision,gameRevision:game.revision,taskRevision:tasks.revision},documents,
   summary:{totalImageCount:source.assets.length,retainedImageCount:retained.length,pendingImageCount:source.assets.length-retained.length,assignedImageCount:new Set(document.albums.flatMap(album=>album.imageIds)).size}};
 }
 const releases=createReleaseCoordinator({releaseDir,readSnapshot:savedReleaseSnapshot,now,publish:async(release,actor)=>{
  const state=publishConfiguration();if(!state.configured)throw problem(503,state.configurationMessage,state.code);
  try{
   const receipt=publicPublishReceipt(await publisher(release,state.configuration,{actor}));
   if(!receipt?.ok||receipt.releaseId!==release.manifest.releaseId||receipt.targets.length!==2||new Set(receipt.targets.map(target=>target.id)).size!==2||receipt.targets.some(target=>!target.ok||target.contentReleaseId!==release.manifest.releaseId))throw problem(503,PUBLISH_MESSAGES.PUBLISH_RECEIPT_INVALID,'PUBLISH_RECEIPT_INVALID');
   return receipt;
  }catch(cause){const code=publishCode(cause.code),failure=problem(503,PUBLISH_MESSAGES[code],code);const receipt=publicPublishReceipt(cause.receipt);if(receipt)failure.receipt=receipt;throw failure;}
 }});
 async function releaseStatus(){
  const state=publishConfiguration(),status=await releases.status();
  return {configured:state.configured,configurationMessage:state.configurationMessage,...status,
   previous:status.previous?{releaseId:releaseIdentity(status.previous.releaseId),manifestSha256:/^[a-f0-9]{64}$/.test(status.previous.manifestSha256)?status.previous.manifestSha256:null}:null,
   lastPublish:status.lastPublish?{...status.lastPublish,targets:publicPublishReceipt(status.lastPublish.targets)}:null,
   audits:status.audits.map(item=>({kind:item.kind,at:item.at,actor:item.actor,releaseId:releaseIdentity(item.releaseId),...(item.previousReleaseId?{previousReleaseId:releaseIdentity(item.previousReleaseId)}:{}),...(item.code?{code:publishCode(item.code),message:PUBLISH_MESSAGES[publishCode(item.code)]}:{}),...(item.receipt?{receipt:publicPublishReceipt(item.receipt)}:{})})),
  };
 }
 const routes=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/bulk-assets.js','bulk-assets.js'],['/album-drag.js','album-drag.js'],['/album-recovery.js','album-recovery.js'],['/daily-state.js','daily-state.js'],['/task-rewards-ui.js','task-rewards-ui.js'],['/game-settings-ui.js','game-settings-ui.js'],['/album-rewards-ui.js','album-rewards-ui.js'],['/release-ui.js','release-ui.js'],['/style.css','style.css']]);
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");
  try{
   const localPort=server.address()?.port;
   if(req.headers.host!==`127.0.0.1:${localPort}`&&req.headers.host!==`localhost:${localPort}`)throw problem(403,'请使用本机后台地址访问','HOST_REJECTED');
   const url=new URL(req.url,`http://${req.headers.host}`),path=url.pathname,method=req.method;
   if(!['GET','POST','PUT'].includes(method))throw problem(405,'此操作方式不支持');
   if(method!=='GET'&&req.headers.origin!==url.origin)throw problem(403,'操作来源不匹配，请在后台页面重试','ORIGIN_REJECTED');
   if(routes.has(path)&&method==='GET'){
    const filename=routes.get(path),bytes=readFileSync(join(appRoot,'public',filename)),type=filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'text/javascript':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(bytes);return;
   }
   if(path==='/api/session'&&method==='GET')return response(res,200,auth.state(req));
   if((path==='/api/setup'||path==='/api/login')&&method==='POST'){
    const input=inputFields(await jsonBody(req),['username','password']);return response(res,200,path.endsWith('setup')?auth.setup(req,res,input):auth.login(req,res,input));
   }
   const current=auth.requireSession(req);
   if(method!=='GET')auth.verifyCsrf(req,current);
   if(path==='/api/logout'&&method==='POST'){inputFields(await jsonBody(req),[]);return response(res,200,auth.logout(req,res));}
   if(path==='/api/bootstrap'&&method==='GET'){const status=syncContent();return response(res,200,{source:{fingerprint:source.fingerprint,stats:source.stats,assets:source.assets},drafts:store.listDrafts(),versions:store.listVersions(),audit:store.listAudit(),activeDraftId:store.activeDraftId(),daily:status,taskRewards:taskRewards.sync(),gameSettings:gameSettings.sync()});}
   if(path==='/api/daily/status'&&method==='GET'){const status=syncContent();return response(res,200,{daily:status,draftRevision:store.draft(store.activeDraftId()).revision});}
   if(path==='/api/task-rewards'&&method==='GET')return response(res,200,taskRewards.sync());
   if(path==='/api/task-rewards'&&method==='PUT'){const input=inputFields(await jsonBody(req),['revision','document']);return response(res,200,taskRewards.save(input.revision,input.document,current.username));}
   if(path==='/api/game-settings'&&method==='GET')return response(res,200,gameSettings.sync());
   if(path==='/api/game-settings'&&method==='PUT'){const input=inputFields(await jsonBody(req),['revision','document']);return response(res,200,gameSettings.save(input.revision,input.document,current.username));}
   if(path.startsWith('/api/releases/')){
    if([...url.searchParams.keys()].length)throw problem(400,'发布请求不接受额外参数');
    if(path==='/api/releases/status'&&method==='GET')return response(res,200,await releaseStatus());
    if(path==='/api/releases/prepare'&&method==='POST'){inputFields(await jsonBody(req),[]);return response(res,201,await releases.prepare(current.username));}
    if(path==='/api/releases/confirm'&&method==='POST'){const input=inputFields(await jsonBody(req),['releaseId','manifestSha256']);return response(res,200,await releases.confirm(input,current.username));}
   }
   if(path==='/api/audit'&&method==='GET')return response(res,200,{audit:store.listAudit()});
   if(path==='/api/versions'&&method==='GET')return response(res,200,{versions:store.listVersions()});
   if(path==='/api/drafts'&&method==='POST'){
    const input=inputFields(await jsonBody(req),['name','fromDraftId']);let document=structuredClone(source.baseline),fingerprint=source.fingerprint;
    if(input.fromDraftId!==undefined){if(!ID.test(input.fromDraftId))throw problem(400,'原草稿无效');const base=currentDraft(input.fromDraftId);document=base.document;fingerprint=source.fingerprint;}
    const previous=store.draft(store.activeDraftId()).document;document.name=title(input.name,'新的内容草稿');document=preparedDocument(document,document);daily.assertChanges(previous,document);const created=store.createDraft(document,fingerprint,current.username);syncContent();return response(res,201,{draft:created});
   }
   const imageMatch=/^\/api\/images\/([a-z0-9-]+)$/.exec(path);
   if(imageMatch&&method==='GET'){
    if([...url.searchParams.keys()].some(k=>k!=='kind'))throw problem(400,'图片参数无效');const kind=url.searchParams.get('kind')??'thumbnail';
    if(!['thumbnail','preview'].includes(kind))throw problem(400,'只能读取已登记的预览图','IMAGE_KIND_REJECTED');
    const file=previewFile(source,imageMatch[1],kind),bytes=readFileSync(file);res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length});res.end(bytes);return;
   }
   const draftMatch=/^\/api\/drafts\/([a-f0-9]{32})(?:\/(analyze|publish|reimport))?$/.exec(path);
   if(draftMatch){
    const [,id,operation]=draftMatch;
    if(!operation&&method==='GET'){syncContent();return response(res,200,currentDraft(id));}
    if(!operation&&method==='PUT'){
     const input=inputFields(await jsonBody(req),['revision','document']);syncContent();const saved=store.draft(id),rev=revision(input.revision);
     if(saved.revision!==rev)throw problem(409,'工作内容已更新；请保留当前编辑，重新加载后合并','REVISION_CONFLICT');
     if(saved.sourceFingerprint!==source.fingerprint){const doc=mergeSourceDraft(saved,input.document);daily.assertChanges(saved.document,doc);const updated=store.reimport(id,rev,doc,source,current.username,'保存时合并相册内容与新登记素材，保留已有编辑');syncContent();return response(res,200,updated);}
     const doc=preparedDocument(input.document,saved.document);daily.assertChanges(saved.document,doc);const updated=store.saveDraft(id,rev,doc,current.username);syncContent();return response(res,200,updated);
    }
    if(operation&&method==='POST'){
     const input=inputFields(await jsonBody(req),operation==='analyze'?['revision']:operation==='reimport'?['revision','password','reason']:['revision','password','reason','label','target','kind']);
     const draft=store.draft(id);if(draft.revision!==revision(input.revision))throw problem(409,'草稿已变化，请重新保存或载入','REVISION_CONFLICT');
     if(operation==='reimport'){
      const why=reason(input.reason);auth.verifyPassword(current,input.password);const latest=providedSource??readSource(projectRoot);
      checkHistorical(latest);
      if(Object.keys(draft.document.assets).some(id=>!latest.baseline.assets[id]))throw problem(409,'来源删除了历史图片 ID；请先在原项目恢复归档条目后再导入','HISTORICAL_ID_MISSING');
      const merged=preparedDocument(mergeDraft(normalizeDraft(store.baseline(draft.sourceFingerprint),latest),normalizeDraft(draft.document,latest),latest.baseline),draft.document,latest);
      daily.assertChanges(draft.document,merged,false);const updated=store.reimport(id,draft.revision,merged,latest,current.username,why);source=latest;syncContent();return response(res,200,{draft:updated});
     }
     const analysis=analyzeDraft(draft.document,source);
     if(operation==='analyze')return response(res,200,analysis);
     const why=reason(input.reason);auth.verifyPassword(current,input.password);
     if(!['snapshot','candidate'].includes(input.kind))throw problem(400,'请选择规划快照或发布候选');
     if(input.kind==='candidate'&&!['pc','mobile-shared'].includes(input.target))throw problem(400,'请选择内容目标');
     if(input.kind==='snapshot'&&input.target!=null)throw problem(400,'规划快照保存两个目标的完整草稿');
     // Refresh disk facts immediately before exporting; never write over another chat's work.
     const latest=providedSource??readSource(projectRoot);
     checkHistorical(latest);
     if(latest.fingerprint!==draft.sourceFingerprint||latest.fingerprint!==source.fingerprint)throw problem(409,'来源内容已变化，请重新导入并合并草稿后再生成版本','SOURCE_CHANGED');
     let files=[];
     if(input.kind==='candidate'){
      if(!analysis.compatibleTargets.includes(input.target)){const e=problem(422,'此目标有兼容阻断项，请保存规划快照并处理后再生成候选','COMPATIBILITY_BLOCKED');e.analysis=analysis;throw e;}
      const publicationSource=source;await verifyDelivery(publicationSource);
      const afterCheck=providedSource??readSource(projectRoot);
      checkHistorical(afterCheck);
      if(afterCheck.fingerprint!==draft.sourceFingerprint||source.fingerprint!==publicationSource.fingerprint)throw problem(409,'校验期间来源内容已变化，请重新检查后再生成候选','SOURCE_CHANGED');
      const candidate=buildCandidate(draft.document,publicationSource,input.target);files=candidate.files;
     }
     const version=store.publish(draft,{kind:input.kind,target:input.kind==='snapshot'?null:input.target,label:title(input.label,input.kind==='snapshot'?'内容规划快照':'内容发布候选'),reason:why},files,analysis,current.username);
     return response(res,201,{version,analysis});
    }
   }
   const versionMatch=/^\/api\/versions\/([a-f0-9]{32})(?:\/(download|restore))?$/.exec(path);
   if(versionMatch){
    const [,id,operation]=versionMatch;
    if(method==='GET'&&!operation){const {version,files,document}=store.version(id);return response(res,200,{version,files,...(version.kind==='snapshot'?{document}:{})});}
    if(method==='GET'&&operation==='download'){
     const saved=store.version(id),payload={schema:'jigsaw-content-admin/export-v1',version:saved.version,files:saved.files,...(saved.version.kind==='snapshot'?{document:saved.document}:{}),notice:'本地内容规划/候选，不自动部署；不包含原件、来源私有记录、玩家档案、数据库或密钥'};
     res.setHeader('Content-Disposition',`attachment; filename="jigsaw-content-${id}.json"`);return response(res,200,payload);
    }
    if(method==='POST'&&operation==='restore'){
     const input=inputFields(await jsonBody(req),['password','reason','name']),why=reason(input.reason);auth.verifyPassword(current,input.password);
     const saved=store.version(id),previous=store.draft(store.activeDraftId()).document;
     const restored=saved.version.sourceFingerprint===source.fingerprint?preparedDocument(saved.document,saved.document):mergeSourceDraft({sourceFingerprint:saved.version.sourceFingerprint,document:saved.document});
     daily.assertChanges(previous,restored);const result=store.restore(id,title(input.name,'从历史版本恢复的草稿'),current.username,why,restored);syncContent();return response(res,201,{draft:result});
    }
   }
   throw problem(404,'此页面或内容不存在','NOT_FOUND');
  }catch(e){const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:500;response(res,status,{error:status===500?'后台未能完成操作，请重试':e.message,code:e.code??'SERVER_ERROR',...(e.analysis?{analysis:e.analysis}:{}),...(e.receipt?{receipt:publicPublishReceipt(e.receipt)}:{})});}
 });
 server.requestTimeout=30_000;server.headersTimeout=15_000;
 return {server,store,daily,albums,taskRewards,gameSettings,releases,get source(){return source;},close:()=>new Promise((done,reject)=>{clearInterval(dailyTimer);server.close(error=>{store.close();error?reject(error):done();});})};
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const port=Number(process.env.CONTENT_ADMIN_PORT??3214);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local admin port');
 const app=createAdminServer();app.server.listen(port,'127.0.0.1',()=>console.log(`拼图内容后台：http://127.0.0.1:${port}\n${app.store.hasAdmin()?'使用内容管理员账号登录。':'首次访问请创建内容管理员。'}\n数据仅写入本后台 work 目录。`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
