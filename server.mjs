import {createServer} from 'node:http';
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore,problem} from './store.mjs';
import {createAuth} from './auth.mjs';
import {readSource,previewFile,verifyDelivery} from './source.mjs';
import {validateDraft,analyzeDraft,buildCandidate,normalizeDraft} from './model.mjs';
import {mergeDraft} from './merge.mjs';

const appRoot=dirname(fileURLToPath(import.meta.url));
function inputFields(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw problem(400,'请求中包含无效字段');return input;}
function revision(value){if(!Number.isSafeInteger(value)||value<1)throw problem(400,'草稿版本无效');return value;}
function reason(value){if(typeof value!=='string'||value.trim().length<4||value.trim().length>500)throw problem(400,'请填写 4–500 个字符的操作原因');return value.trim();}
function title(value,fallback){if(value===undefined)return fallback;if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw problem(400,'名称需为 1–100 个字符');return value.trim();}
async function jsonBody(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw problem(415,'此操作需要 JSON 数据');let size=0,parts=[];for await(const part of req){size+=part.length;if(size>2*1024*1024)throw problem(413,'内容过大，请分批整理');parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw problem(400,'请求数据无法读取');}}
function response(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
const ID=/^[a-f0-9]{32}$/;

export function createAdminServer({projectRoot=resolve(appRoot,'..'),dataDir=join(appRoot,'work'),source:providedSource}={}){
 let source=providedSource??readSource(projectRoot);const store=createStore(dataDir,source),auth=createAuth(store);
 // Older saved drafts remain intact. Present new source entries through the
 // existing three-way merge and persist only when the administrator saves.
 function mergeSourceDraft(draft,document=draft.document){return validateDraft(mergeDraft(normalizeDraft(store.baseline(draft.sourceFingerprint),source),normalizeDraft(document,source),source.baseline),source);}
 function currentDraft(id){const draft=store.draft(id);if(draft.sourceFingerprint===source.fingerprint)return {...draft,document:validateDraft(draft.document,source)};return {...draft,document:mergeSourceDraft(draft),sourceNeedsMerge:true};}
 function checkHistorical(latest){const missing=store.historicalIds().filter(id=>!Object.hasOwn(latest.baseline.assets,id));if(missing.length)throw problem(409,'来源缺少已导入的历史图片 ID，请先恢复归档条目：'+missing.slice(0,5).join('、'),'HISTORICAL_ID_MISSING');}
 const routes=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/bulk-assets.js','bulk-assets.js'],['/style.css','style.css']]);
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
   if(path==='/api/bootstrap'&&method==='GET')return response(res,200,{source:{fingerprint:source.fingerprint,stats:source.stats,assets:source.assets},drafts:store.listDrafts(),versions:store.listVersions(),audit:store.listAudit(),activeDraftId:store.activeDraftId()});
   if(path==='/api/audit'&&method==='GET')return response(res,200,{audit:store.listAudit()});
   if(path==='/api/versions'&&method==='GET')return response(res,200,{versions:store.listVersions()});
   if(path==='/api/drafts'&&method==='POST'){
    const input=inputFields(await jsonBody(req),['name','fromDraftId']);let document=structuredClone(source.baseline),fingerprint=source.fingerprint;
    if(input.fromDraftId!==undefined){if(!ID.test(input.fromDraftId))throw problem(400,'原草稿无效');const base=currentDraft(input.fromDraftId);document=base.document;fingerprint=source.fingerprint;}
    document.name=title(input.name,'新的内容草稿');return response(res,201,{draft:store.createDraft(document,fingerprint,current.username)});
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
    if(!operation&&method==='GET')return response(res,200,currentDraft(id));
    if(!operation&&method==='PUT'){
     const input=inputFields(await jsonBody(req),['revision','document']),saved=store.draft(id),rev=revision(input.revision);
     if(saved.sourceFingerprint!==source.fingerprint){const doc=mergeSourceDraft(saved,input.document);return response(res,200,store.reimport(id,rev,doc,source,current.username,'保存时合并相册内容与新登记素材，保留已有编辑'));}
     const doc=validateDraft(input.document,source);return response(res,200,store.saveDraft(id,rev,doc,current.username));
    }
    if(operation&&method==='POST'){
     const input=inputFields(await jsonBody(req),operation==='analyze'?['revision']:operation==='reimport'?['revision','password','reason']:['revision','password','reason','label','target','kind']);
     const draft=store.draft(id);if(draft.revision!==revision(input.revision))throw problem(409,'草稿已变化，请重新保存或载入','REVISION_CONFLICT');
     if(operation==='reimport'){
      const why=reason(input.reason);auth.verifyPassword(current,input.password);const latest=providedSource??readSource(projectRoot);
      checkHistorical(latest);
      if(Object.keys(draft.document.assets).some(id=>!latest.baseline.assets[id]))throw problem(409,'来源删除了历史图片 ID；请先在原项目恢复归档条目后再导入','HISTORICAL_ID_MISSING');
      const merged=validateDraft(mergeDraft(normalizeDraft(store.baseline(draft.sourceFingerprint),latest),normalizeDraft(draft.document,latest),latest.baseline),latest);
      const updated=store.reimport(id,draft.revision,merged,latest,current.username,why);source=latest;return response(res,200,{draft:updated});
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
     return response(res,201,{draft:store.restore(id,title(input.name,'从历史版本恢复的草稿'),current.username,why)});
    }
   }
   throw problem(404,'此页面或内容不存在','NOT_FOUND');
  }catch(e){const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:500;response(res,status,{error:status===500?'后台未能完成操作，请重试':e.message,code:e.code??'SERVER_ERROR',...(e.analysis?{analysis:e.analysis}:{})});}
 });
 server.requestTimeout=30_000;server.headersTimeout=15_000;
 return {server,store,get source(){return source;},close:()=>new Promise((done,reject)=>server.close(error=>{store.close();error?reject(error):done();}))};
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const port=Number(process.env.CONTENT_ADMIN_PORT??3214);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local admin port');
 const app=createAdminServer();app.server.listen(port,'127.0.0.1',()=>console.log(`拼图内容后台：http://127.0.0.1:${port}\n${app.store.hasAdmin()?'使用内容管理员账号登录。':'首次访问请创建内容管理员。'}\n数据仅写入本后台 work 目录。`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
