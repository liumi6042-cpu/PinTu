import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createRoomRealtimeHub} from '../outputs/mobile/room-realtime.mjs';

// Local-only credentials may be supplied through .env.local during development.
// This file is ignored by Git and is never bundled into the client package.
const localEnvPath=resolve('.env.local');
if(existsSync(localEnvPath)&&typeof process.loadEnvFile==='function')process.loadEnvFile(localEnvPath);

const digest=value=>createHash('sha256').update(value).digest('hex');
const SESSION_MS=30*86400000;
const MAX_BODY=2*1024*1024+128*1024;
const allowedApi=/^\/api\/[a-zA-Z0-9/_-]+$/;
const mediaPath=/^\/api\/user-images\/custom-[a-f0-9]{32}$/;
const tokenPattern=/^[a-f0-9]{64}$/;
const json=(response,status,body,headers={})=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});response.end(JSON.stringify(body));};
async function readBody(request,max=MAX_BODY){
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>max)throw Object.assign(Error('请求内容过长'),{status:413});chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function parseJson(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch{throw Object.assign(Error('请求格式无效'),{status:400});}}
function updateCookies(cookies,lines){
  const values=new Map(cookies.split('; ').map(value=>value.split('=')));
  for(const line of lines){
    const match=/^(puzzle_session|puzzle_guest)=([a-f0-9]*)/.exec(line);
    if(!match)continue;
    if(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(line)||!match[2])values.delete(match[1]);
    else if(tokenPattern.test(match[2]))values.set(match[1],match[2]);
  }
  return [...values].map(([k,v])=>k+'='+v).join('; ');
}
// TapTap v53.3 and older call built-ins that WebViews before Chrome 93 lack: Array.prototype.at in every solo-local
// drop and Object.hasOwn in each WebSocket action reply. On those phones pieces looked placed at 0 / 12 and drags were
// cancelled (2026-11-02, Huawei P50 Pro). Such a WebView gets solo-local play off in /config and no WebSocket actions on
// its realtime connection, so it plays with HTTP drags. One log line per distinct User-Agent, kind and hour.
export const LEGACY_UA_TOKENS=/HarmonyOS|OpenHarmony|ArkWeb|HUAWEI|HMSCore/i;
export function legacyWebView(userAgent,tokens=LEGACY_UA_TOKENS){
  if(typeof userAgent!=='string'||!userAgent)return false;
  const chrome=/\b(?:Chrome|Chromium)\/(\d+)\./.exec(userAgent);
  return !!chrome&&Number(chrome[1])<93||!!tokens&&tokens.test(userAgent);
}
export function createH5Gateway(options){
  const target=new URL(options.upstream??'http://127.0.0.1');
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.pathname!=='/')throw Error('Invalid upstream origin');
  if(target.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw Error('Upstream requires HTTPS');
  const origin=new URL(options.upstreamOrigin??options.upstream).origin;
  const origins=new Set(options.allowedOrigins.map(value=>new URL(value).origin));
  if(!origins.size)throw Error('Explicit H5 origins are required');
  const databasePath=options.databasePath??':memory:';
  if(databasePath!==':memory:'){mkdirSync(dirname(resolve(databasePath)),{recursive:true,mode:0o700});}
  const db=new DatabaseSync(databasePath);
  if(databasePath!==':memory:')chmodSync(databasePath,0o600);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS h5_sessions(token_hash TEXT PRIMARY KEY,cookies TEXT NOT NULL,expires_at INTEGER NOT NULL);');
  db.exec('CREATE TABLE IF NOT EXISTS h5_ad_watches(token TEXT PRIMARY KEY,session_key TEXT NOT NULL,context TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,auth_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0); CREATE UNIQUE INDEX IF NOT EXISTS h5_ad_request ON h5_ad_watches(session_key,context,request_id); CREATE TABLE IF NOT EXISTS h5_help(session_key TEXT NOT NULL,context TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,grant_json TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(session_key,context,request_id));');
  const adsEnabled=options.adAssistanceEnabled===true&&Boolean(options.rewardedAdUnitId);
  const tickets=new Map(),limits=new Map(),deniedOrigins=new Map();
  const logDeniedOrigin=source=>{
    if(!options.logBlockedOrigins)return;
    let origin;
    if(source==='null')origin='null';
    else try{const parsed=new URL(source);if(source.length>256||parsed.origin!==source||!['http:','https:'].includes(parsed.protocol))return;origin=parsed.origin;}catch{return;}
    const now=Date.now(),previous=deniedOrigins.get(origin);if(previous&&now-previous<600000)return;
    for(const [key,time]of deniedOrigins)if(now-time>=600000)deniedOrigins.delete(key);
    if(deniedOrigins.size>=64)return;
    deniedOrigins.set(origin,now);console.warn(JSON.stringify({event:'h5_origin_denied',origin}));
  };
  const saved=db.prepare('SELECT cookies,expires_at FROM h5_sessions WHERE token_hash=?');
  const insert=db.prepare('INSERT INTO h5_sessions VALUES(?,?,?)');
  const update=db.prepare('UPDATE h5_sessions SET cookies=? WHERE token_hash=?');
  const cleanup=db.prepare('DELETE FROM h5_sessions WHERE expires_at<=?');
  const sessionOf=(request)=>{
    const token=request.headers['x-jigsaw-h5-session'];
    if(typeof token!=='string'||!tokenPattern.test(token))return null;
    const key=digest(token),row=saved.get(key),now=Date.now();
    if(!row||row.expires_at<=now)return null;
    // Active mobile guests retain their opaque credential; refresh at most hourly.
    if(options.mobileService&&row.expires_at<now+SESSION_MS-3600000){row.expires_at=now+SESSION_MS;db.prepare('UPDATE h5_sessions SET expires_at=? WHERE token_hash=?').run(row.expires_at,key);}
    return {key,...row};
  };
  const clientAddress=request=>{
    const peer=(request.socket.remoteAddress||'unknown').replace(/^::ffff:/,'');
    const supplied=request.headers['x-jigsaw-client-ip'];
    return options.trustLoopbackProxy&&['127.0.0.1','::1'].includes(peer)&&typeof supplied==='string'&&isIP(supplied)?supplied:peer;
  };
  const legacyGate=options.legacyWebView?.gate!==false,legacyTokens=options.legacyWebView?.tokens===undefined?LEGACY_UA_TOKENS:options.legacyWebView.tokens;
  let uaHour=-1;const uaSeen=new Set();
  const clientWebView=(request,kind)=>{
    const ua=String(request?.headers?.['user-agent']??'').slice(0,300),legacy=legacyGate&&legacyWebView(ua,legacyTokens),hour=Math.floor(Date.now()/3600000);
    if(hour!==uaHour){uaHour=hour;uaSeen.clear();}
    const key=kind+'|'+legacy+'|'+ua;
    if(!uaSeen.has(key)&&uaSeen.size<1000){uaSeen.add(key);console.log(JSON.stringify({event:'client_ua',kind,legacy,probe:!!request?.headers?.['x-jigsaw-artwork-snapshot'],ua}));}
    return legacy;
  };
  const requestLimit=(request,kind,max)=>{
    const ip=clientAddress(request),key=kind+':'+ip,now=Date.now();
    if(limits.size>10000)for(const [k,v]of limits)if(v.until<now)limits.delete(k);
    const state=limits.get(key);if(!state||state.until<now){limits.set(key,{until:now+60000,count:1});return true;}
    return ++state.count<=max;
  };
  const fetchUpstream=async(request,session,path,body)=>{
    const headers=new Headers({'Host':new URL(origin).host,'X-Forwarded-Host':new URL(origin).host,'X-Forwarded-Proto':new URL(origin).protocol.slice(0,-1),'Origin':origin,'Cookie':session.cookies,'Accept':request.headers.accept||'*/*'});
    if(request.headers.authorization)headers.set('Authorization',request.headers.authorization);
    if(request.headers['content-type'])headers.set('Content-Type',request.headers['content-type']);
    if(request.headers['x-jigsaw-artwork-snapshot']==='1')headers.set('X-Jigsaw-Artwork-Snapshot','1');
    // Only the socket peer is forwarded. Arbitrary client proxy headers are not trusted.
    headers.set('cf-connecting-ip',clientAddress(request));
    const upstream=await fetch(new URL(path,target),{method:request.method,headers,body:body?.length?body:undefined,redirect:'manual',signal:AbortSignal.timeout(65000)});
    const cookies=updateCookies(session.cookies,upstream.headers.getSetCookie());
    if(cookies!==session.cookies)update.run(cookies,session.key);
    return upstream;
  };
  const proxy=async(request,response,session,path,body)=>{
    const upstream=await fetchUpstream(request,session,path,body);
    const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
    for(const key of ['content-type','retry-after'])if(upstream.headers.has(key))headers[key]=upstream.headers.get(key);
    // Never relay Set-Cookie, upstream redirects or credentials to the H5 origin.
    if(upstream.status>=300&&upstream.status<400){json(response,502,{error:'接口暂时无法连接'});return;}
    response.writeHead(upstream.status,headers);
    if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),response);else response.end();
  };
  const grantsFor=(session,context)=>db.prepare('SELECT grant_json FROM h5_help WHERE session_key=? AND context=? AND expires_at>? ORDER BY rowid').all(session.key,context,Date.now()).map(row=>JSON.parse(row.grant_json));
  const helpError=(message,status=400)=>Object.assign(Error(message),{status});
  const roomSnapshot=async(request,session,context)=>{
    if(context.startsWith('local/'))return null;
    const get={method:'GET',headers:request.headers,socket:request.socket},path='/api/rooms/'+context.slice(5);
    // The existing help endpoint verifies admission and the room bearer ticket.
    const permission=await fetchUpstream(get,session,path+'/assistance');
    if(!permission.ok)throw helpError('请先重新加入房间',permission.status);
    await permission.body?.cancel();
    const response=await fetchUpstream(get,session,path);
    if(!response.ok)throw helpError('房间暂时无法读取',response.status);
    const snapshot=await response.json();
    if(!snapshot.puzzle?.groups)throw helpError('房间暂时无法读取',502);
    return snapshot;
  };
  const serveHelp=async(request,response,session,context)=>{
    const snapshot=await roomSnapshot(request,session,context),grants=grantsFor(session,context),now=Date.now();
    if(request.method==='GET'){json(response,200,{grants,serverTime:now});return;}
    if(request.method!=='POST')throw helpError('请求方式无效',405);
    if(!adsEnabled)throw helpError('广告暂未开放，请继续正常拼图',503);
    const input=parseJson(await readBody(request));
    const watch=db.prepare('SELECT * FROM h5_ad_watches WHERE token=?').get(input.rewardToken||'');
    if(!watch||watch.session_key!==session.key||watch.context!==context||watch.kind!==input.kind||watch.request_id!==input.requestId||watch.auth_hash!==digest(request.headers.authorization||''))throw helpError('请先完整观看广告',403);
    const existing=db.prepare('SELECT grant_json FROM h5_help WHERE session_key=? AND context=? AND request_id=?').get(session.key,context,input.requestId);
    if(existing){json(response,200,{grants:[...grants.filter(g=>g.requestId!==input.requestId),JSON.parse(existing.grant_json)],serverTime:now});return;}
    if(watch.used||watch.expires_at<=now||input.completed!==true)throw helpError('本次广告机会已失效，请重新观看',403);
    if(grants.some(g=>g.kind===input.kind&&g.expiresAt>now))throw helpError('该功能正在生效，请结束后再试',409);
    let pieceIds=[];
    if(input.kind==='hint'&&snapshot){
      const previous=new Set(grants.flatMap(g=>g.pieceIds)),held=new Set(Object.keys(snapshot.leases||{}).map(Number));
      const available=snapshot.puzzle.groups.filter(g=>!g.locked&&!held.has(g.id)).flatMap(g=>g.pieces);
      pieceIds=[...available.filter(id=>!previous.has(id)),...available.filter(id=>previous.has(id))].slice(0,3);
      if(!pieceIds.length)throw helpError('暂时没有可提示的拼块，请稍后再试',409);
    }
    const grant={requestId:input.requestId,kind:input.kind,pieceIds,expiresAt:now+30000};
    // No await between consumption and insertion: concurrent callbacks cannot grant twice.
    db.exec('BEGIN IMMEDIATE');
    try{
      const consumed=db.prepare('UPDATE h5_ad_watches SET used=1 WHERE token=? AND used=0').run(watch.token);
      if(consumed.changes!==1)throw helpError('本次广告机会已使用',409);
      db.prepare('INSERT INTO h5_help VALUES(?,?,?,?,?,?)').run(session.key,context,input.requestId,input.kind,JSON.stringify(grant),grant.expiresAt);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    json(response,200,{grants:[...grants,grant],serverTime:now});
  };
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://gateway.invalid'),source=request.headers.origin;
      if(source&&(!origins.has(source)||source==='null')){logDeniedOrigin(source);json(response,403,{error:'来源未获允许'});return;}
      if(source){response.setHeader('Access-Control-Allow-Origin',source);response.setHeader('Vary','Origin');}
      if(request.method==='OPTIONS'){
        if(!source){json(response,403,{error:'来源未获允许'});return;}
        const method=request.headers['access-control-request-method'];
        const requested=(request.headers['access-control-request-headers']||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(!['GET','POST','DELETE','PATCH'].includes(method)||requested.some(x=>!['content-type','authorization','x-jigsaw-h5-session','x-jigsaw-artwork-snapshot'].includes(x))){json(response,403,{error:'请求未获允许'});return;}
        response.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, DELETE, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Jigsaw-H5-Session, X-Jigsaw-Artwork-Snapshot','Access-Control-Max-Age':'600','Cache-Control':'no-store'});response.end();return;
      }
      response.setHeader('Access-Control-Expose-Headers','Retry-After, X-Jigsaw-H5-Session-Expired');
      if(url.pathname==='/config.js'&&request.method==='GET'){
        response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        response.end('window.JIGSAW_H5_CONFIG='+JSON.stringify({apiBase:options.publicApiBase||'/h5',gameBase:options.publicGameBase||'/'})+';');return;
      }
      if(url.pathname.startsWith('/h5/assets/')&&request.method==='GET'){
        const asset='/'+url.pathname.slice('/h5/assets/'.length);
        if(!options.assetPaths?.includes(asset)){json(response,404,{error:'资源不存在'});return;}
        if(options.mobileService){
          if(!options.assetDir){json(response,404,{error:'独立资源未配置'});return;}
          const base=resolve(options.assetDir),file=resolve(base,'.'+asset);
          if(!file.startsWith(base+sep)||!existsSync(file)||!statSync(file).isFile()){json(response,404,{error:'图片不存在'});return;}
          const type={'.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg'}[extname(file)]||'application/octet-stream';
          response.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=86400','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff'});response.end(readFileSync(file));return;
        }
        const upstream=await fetch(new URL(asset,target),{headers:{Host:new URL(origin).host,'X-Forwarded-Host':new URL(origin).host,'X-Forwarded-Proto':new URL(origin).protocol.slice(0,-1)},redirect:'manual',signal:AbortSignal.timeout(30000)});
        if(!upstream.ok){json(response,upstream.status,{error:'资源暂不可用'});return;}
        response.writeHead(200,{'Content-Type':upstream.headers.get('Content-Type')||'application/octet-stream','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
        response.end(Buffer.from(await upstream.arrayBuffer()));return;
      }
      if(url.pathname==='/healthz'){
        try{const status=options.mobileService?.contentStatus?.()??{contentReleaseId:null};json(response,200,{ok:true,service:'jigsaw-h5-gateway',mode:options.mobileService?.mode??'legacy-proxy',contentReleaseId:status.contentReleaseId});}
        catch{json(response,503,{ok:false,service:'jigsaw-h5-gateway',mode:options.mobileService?.mode??'legacy-proxy',contentReleaseId:null,code:'CONTENT_RELEASE_UNAVAILABLE'});}return;
      }
      if(url.pathname==='/h5/config'&&request.method==='GET'){
        const capabilities=options.mobileService?.capabilities??{energy:true,ads:adsEnabled,albumTarget:'mobile-shared'},available=adsEnabled&&capabilities.ads!==false;
        // 横屏/竖屏激励位为新增字段，旧客户端只读 rewardedAdUnitId。
        const orientationUnits=available?{...(options.rewardedAdUnitIdPortrait?{rewardedAdUnitIdPortrait:options.rewardedAdUnitIdPortrait}:{}),...(options.rewardedAdUnitIdLandscape?{rewardedAdUnitIdLandscape:options.rewardedAdUnitIdLandscape}:{})}:{};
        const legacy=clientWebView(request,'config');
        json(response,200,{rewardedAdUnitId:available?options.rewardedAdUnitId||'':'',...orientationUnits,adRewardEnabled:available,mobileMode:options.mobileService?.mode??null,...(options.mobileService?.realtime?{realtime:{version:1}}:{}),capabilities:{...capabilities,ads:available,...(legacy?{soloLocalPlay:false}:{})}});return;
      }
      if(url.pathname==='/h5/session'&&request.method==='POST'){
        if(!requestLimit(request,'session',30)){json(response,429,{error:'请稍后再试'},{'Retry-After':'60'});return;}
        await readBody(request);cleanup.run(Date.now());
        db.prepare('DELETE FROM h5_ad_watches WHERE expires_at<?').run(Date.now()-86400000);
        db.prepare('DELETE FROM h5_help WHERE expires_at<?').run(Date.now()-86400000);
        if(db.prepare('SELECT COUNT(*) n FROM h5_sessions').get().n>=10000){json(response,503,{error:'暂时无法连接，请稍后再试'});return;}
        const token=randomBytes(32).toString('hex');
        insert.run(digest(token),'puzzle_guest='+randomBytes(32).toString('hex'),Date.now()+SESSION_MS);
        json(response,201,{token});return;
      }
      if(options.mobileService&&url.pathname==='/h5/rewarded/challenge'&&request.method==='POST'){
        const session=sessionOf(request);if(!session){json(response,401,{error:'连接凭证已过期',code:'IDENTITY_REQUIRED'},{'X-Jigsaw-H5-Session-Expired':'1'});return;}
        if(!requestLimit(request,'ad:'+session.key,20)){json(response,429,{error:'请稍后再试'});return;}
        const result=options.mobileService.handle({identity:session.key,method:'POST',url:'/api/rewarded/challenge',body:await readBody(request),authorization:request.headers.authorization});json(response,result.status,result.data);return;
      }
      if(options.mobileService&&(url.pathname==='/h5/media-ticket'||url.pathname.startsWith('/h5/media/')||url.pathname.startsWith('/h5/assistance/local/'))){json(response,404,{error:'独立手游暂不支持该接口'});return;}
      if(url.pathname==='/h5/rewarded/challenge'&&request.method==='POST'){
        const session=sessionOf(request);if(!session)throw helpError('连接凭证已过期',401);
        if(!adsEnabled)throw helpError('广告暂未开放，请继续正常拼图',503);
        if(!requestLimit(request,'ad:'+session.key,20))throw helpError('请稍后再试',429);
        const {context,kind,requestId}=parseJson(await readBody(request));
        if(typeof context!=='string'||!/^room\/[a-f0-9]{32}$|^local\/[a-f0-9]{64}$/.test(context)||!['hint','underlay'].includes(kind)||!/^[a-f0-9]{32}$/.test(requestId))throw helpError('请求格式无效');
        const snapshot=await roomSnapshot(request,session,context);
        if(grantsFor(session,context).some(g=>g.kind===kind&&g.expiresAt>Date.now()))throw helpError('该功能正在生效，请结束后再试',409);
        if(kind==='hint'&&snapshot&&!snapshot.puzzle.groups.some(g=>!g.locked&&!snapshot.leases?.[g.id]))throw helpError('暂时没有可提示的拼块，请稍后再试',409);
        const existing=db.prepare('SELECT * FROM h5_ad_watches WHERE session_key=? AND context=? AND request_id=?').get(session.key,context,requestId);
        if(existing&&existing.kind!==kind)throw helpError('请求格式无效');
        if(existing&&!existing.used&&existing.expires_at>Date.now()){
          if(existing.auth_hash!==digest(request.headers.authorization||''))throw helpError('请重新观看广告',403);
          json(response,200,{rewardToken:existing.token});return;
        }
        if(existing)throw helpError('本次广告机会已失效，请重新观看',409);
        const rewardToken=randomBytes(32).toString('hex');
        db.prepare('INSERT INTO h5_ad_watches(token,session_key,context,kind,request_id,auth_hash,expires_at) VALUES(?,?,?,?,?,?,?)').run(rewardToken,session.key,context,kind,requestId,digest(request.headers.authorization||''),Date.now()+600000);
        json(response,201,{rewardToken});return;
      }
      if(/^\/h5\/assistance\/local\/[a-f0-9]{64}$/.test(url.pathname)){
        const session=sessionOf(request);if(!session)throw helpError('连接凭证已过期',401);
        if(!requestLimit(request,'help:'+session.key,120))throw helpError('请稍后再试',429);
        await serveHelp(request,response,session,'local/'+url.pathname.split('/').at(-1));return;
      }
      if(url.pathname==='/h5/media-ticket'&&request.method==='POST'){
        const session=sessionOf(request);if(!session){json(response,401,{error:'连接凭证已过期'},{'X-Jigsaw-H5-Session-Expired':'1'});return;}
        if(!requestLimit(request,'media:'+session.key,600)){json(response,429,{error:'请稍后再试'},{'Retry-After':'60'});return;}
        const {path}=parseJson(await readBody(request));
        if(typeof path!=='string'||!path.startsWith('/api/user-images/')){json(response,400,{error:'图片地址无效'});return;}
        const image=new URL(path,'https://image.invalid');
        if(!mediaPath.test(image.pathname)||image.origin!=='https://image.invalid'||[...image.searchParams.keys()].some(x=>!['room','preview'].includes(x))||
          (image.searchParams.has('room')&&!/^[a-f0-9]{32}$/.test(image.searchParams.get('room')))|| (image.searchParams.has('preview')&&image.searchParams.get('preview')!=='1')){
          json(response,400,{error:'图片地址无效'});return;
        }
        const now=Date.now();for(const [k,t]of tickets)if(t.until<now)tickets.delete(k);
        if(tickets.size>=4096){json(response,503,{error:'图片服务忙，请稍后重试'});return;}
        const ticket=randomBytes(24).toString('hex'),expiresAt=now+120000;
        tickets.set(ticket,{sessionKey:session.key,path:image.pathname+image.search,until:expiresAt});
        json(response,200,{url:'media/'+ticket,expiresAt});return;
      }
      if(/^\/h5\/media\/[a-f0-9]{48}$/.test(url.pathname)&&request.method==='GET'){
        const ticket=tickets.get(url.pathname.split('/').at(-1)),row=ticket&&saved.get(ticket.sessionKey);
        if(!ticket||ticket.until<Date.now()||!row||row.expires_at<Date.now()){json(response,401,{error:'图片连接已过期，请重试'});return;}
        await proxy(request,response,{key:ticket.sessionKey,...row},ticket.path);return;
      }
      if(url.pathname.startsWith('/h5/api/')){
        if(!['GET','POST','DELETE','PATCH'].includes(request.method)){json(response,405,{error:'请求方式无效'});return;}
        const path=url.pathname.slice(3);
        if(!allowedApi.test(path)||path.includes('//')||path.startsWith('/api/internal/')){json(response,404,{error:'接口不存在'});return;}
        const session=sessionOf(request);
        if(!session){json(response,401,{error:'连接凭证已过期'},{'X-Jigsaw-H5-Session-Expired':'1'});return;}
        if(!requestLimit(request,'api:'+session.key,4000)){json(response,429,{error:'请稍后再试'},{'Retry-After':'60'});return;}
        if(path.startsWith('/api/auth/')&&request.method==='POST'&&!requestLimit(request,'auth',20)){json(response,429,{error:'请稍后再试'},{'Retry-After':'60'});return;}
        if(options.mobileService?.bindTapTap&&path==='/api/taptap/bind'&&request.method==='POST'){
          if(!requestLimit(request,'taptap-bind:'+session.key,12)){json(response,429,{error:'TapTap登录尝试过于频繁，请稍后再试'},{'Retry-After':'60'});return;}
          const input=parseJson(await readBody(request,64*1024));
          const result=await options.mobileService.bindTapTap({identity:session.key,code:input.code,nickname:input.nickname});json(response,result.status,result.data);return;
        }
        if(options.mobileService){
          const result=options.mobileService.handle({identity:session.key,method:request.method,url:path+url.search,body:request.method==='GET'?undefined:await readBody(request),authorization:request.headers.authorization,artworkSnapshot:request.headers['x-jigsaw-artwork-snapshot']==='1'});json(response,result.status,result.data);return;
        }
        const assistance=/^\/api\/rooms\/([a-f0-9]{32})\/assistance$/.exec(path);
        if(assistance){await serveHelp(request,response,session,'room/'+assistance[1]);return;}
        await proxy(request,response,session,path+url.search,request.method==='GET'?undefined:await readBody(request,path.startsWith('/api/feedback')?16*1024*1024:MAX_BODY));return;
      }
      if(options.staticDir&&request.method==='GET'){
        const base=resolve(options.staticDir),relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html',file=resolve(base,relative);
        if(file!==base&&!file.startsWith(base+sep)){json(response,404,{error:'文件不存在'});return;}
        if(existsSync(file)&&statSync(file).isFile()){
          const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.wav':'audio/wav','.mp3':'audio/mpeg'};
          response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':relative==='config.js'||relative==='index.html'?'no-store':'public, max-age=3600','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
          response.end(readFileSync(file));return;
        }
      }
      json(response,404,{error:'接口不存在'});
    }catch(error){if(!response.headersSent)json(response,error.status??502,{error:error.status?error.message:'暂时无法连接，请稍后重试'});else response.end();}
  });
  let realtime,unwatch;
  if(options.mobileService?.realtime){
    const service=options.mobileService.realtime;
    const requireSession=(request,token)=>{
      const session=sessionOf({headers:{'x-jigsaw-h5-session':token}});
      if(!session)throw Object.assign(Error('连接凭证已过期'),{status:401,code:'IDENTITY_REQUIRED'});
      return session;
    };
    const legacyRealtime=context=>context&&typeof context==='object'?Object.assign(context,{legacyWebView:true}):context;
    realtime=createRoomRealtimeHub({server,path:'/h5/realtime',addressOf:clientAddress,
      allowOrigin:source=>!source||origins.has(source)&&source!=='null',
      subscribe(request,message){
        if(!requestLimit(request,'realtime',60))throw Object.assign(Error('请稍后再试'),{status:429,code:'REALTIME_RATE_LIMIT'});
        const session=requireSession(request,message.session);
        const legacy=clientWebView(request,'realtime'),context=service.subscribe({roomId:message.roomId,identity:session.key,authorization:'Bearer '+message.token,artworkSnapshot:true,sessionToken:message.session});
        return !legacy?context:context&&typeof context.then==='function'?context.then(legacyRealtime):legacyRealtime(context);
      },
      validate(context){requireSession(null,context.sessionToken);return service.validate(context);},
      readRoom(context,since){requireSession(null,context.sessionToken);return service.readRoom(context,since);},
      readCursors:context=>service.readCursors(context),writeCursor:(context,input)=>service.writeCursor(context,input),
      ...(typeof service.readCheers==='function'?{readCheers:(context,after)=>service.readCheers(context,after)}:{}),
      ...(typeof service.writeCheer==='function'?{writeCheer(context,input){requireSession(null,context.sessionToken);return service.writeCheer(context,input);}}:{}),
      actionCapabilities:context=>context?.legacyWebView===true&&context.room?.diagnostic!==true?{version:1,diagnosticOnly:true}:service.actionCapabilities?.(context),
      writeAction(context,input){requireSession(null,context.sessionToken);return service.writeAction(context,input);},
      ...options.realtimeOptions,
      onDisconnect(context){service.disconnectActions?.(context);options.realtimeOptions?.onDisconnect?.(context);},
    });
    unwatch=service.onChange((roomId,kind)=>realtime.notify(roomId,kind));
    server.realtime=realtime;
  }
  const cleanTimer=setInterval(()=>{
    cleanup.run(Date.now());db.prepare('DELETE FROM h5_ad_watches WHERE expires_at<?').run(Date.now()-86400000);
    db.prepare('DELETE FROM h5_help WHERE expires_at<?').run(Date.now()-86400000);
  },60000);cleanTimer.unref();
  server.once('listening',()=>options.mobileService?.startDaily?.());
  server.on('close',()=>{clearInterval(cleanTimer);unwatch?.();realtime?.close();db.close();options.mobileService?.close();});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.env.H5_PORT||3211),host=process.env.H5_HOST||'127.0.0.1';
  const {createMobileService}=await import('./mobile-service.mjs');
  let dailyContent;
  if(process.env.MOBILE_DAILY_CONFIG){
    const {createDailyContent}=await import('./daily-content.mjs');
    const engine=await import('../outputs/mobile/engine.mjs');
    dailyContent=createDailyContent({configurationPath:process.env.MOBILE_DAILY_CONFIG,appearanceDir:process.env.MOBILE_DAILY_APPEARANCES||resolve('work/daily-appearances'),photos:engine.RESTORABLE_PHOTOS,fallback:engine.dailyPuzzle});
  }
  // Free-text 私信 between mutual friends; MOBILE_PRIVATE_MESSAGES=false turns them off (history and room invites stay).
  // Custom names stay off on mobile (no customNames here, so the service keeps its safe default).
  const mobileService=createMobileService({databasePath:process.env.MOBILE_DB||resolve('data/mobile-v3.sqlite'),runtimeProfile:process.env.MOBILE_RUNTIME_PROFILE==='web'?'web':'mobile',adEnabled:process.env.H5_AD_ASSISTANCE_ENABLED==='true'&&Boolean(process.env.H5_REWARDED_AD_UNIT),tapTap:{appId:process.env.TAPTAP_APP_ID,secret:process.env.TAPTAP_APP_SECRET,endpoint:process.env.TAPTAP_CODE2SESSION_URL},taskRewardConfigurationPath:process.env.MOBILE_TASK_REWARDS_CONFIG,gameConfigurationPath:process.env.MOBILE_GAME_SETTINGS_CONFIG,albumConfigurationPath:process.env.MOBILE_ALBUMS_CONFIG,albumTarget:process.env.MOBILE_ALBUM_TARGET==='pc'?'pc':'mobile-shared',contentDirectory:process.env.JIGSAW_CONTENT_DIR,assetDir:process.env.MOBILE_ASSET_DIR||resolve('public'),dailyAppearanceDir:process.env.MOBILE_DAILY_APPEARANCES||resolve('work/daily-appearances'),dailyContent,deferDailyStart:true,publicTestPolicy:{privateMessages:process.env.MOBILE_PRIVATE_MESSAGES!=='false'}});
  // MOBILE_LEGACY_WEBVIEW=off stops the old-WebView gate (the User-Agent log stays); MOBILE_LEGACY_UA_TOKENS replaces the
  // token pattern (empty: Chrome < 93 only).
  let legacyTokens;
  if(process.env.MOBILE_LEGACY_UA_TOKENS!==undefined){try{legacyTokens=process.env.MOBILE_LEGACY_UA_TOKENS?new RegExp(process.env.MOBILE_LEGACY_UA_TOKENS,'i'):null;}catch{console.warn(JSON.stringify({event:'legacy_ua_tokens_invalid'}));}}
  const server=createH5Gateway({
    legacyWebView:{gate:process.env.MOBILE_LEGACY_WEBVIEW!=='off',...(legacyTokens!==undefined?{tokens:legacyTokens}:{})},
    publicApiBase:process.env.H5_PUBLIC_API_BASE,publicGameBase:process.env.H5_PUBLIC_GAME_BASE,
    mobileService,assetDir:process.env.MOBILE_ASSET_DIR||resolve('public'),
    upstream:process.env.H5_UPSTREAM||'https://jigsawnook.online',
    upstreamOrigin:process.env.H5_UPSTREAM_ORIGIN,
    allowedOrigins:(process.env.H5_ALLOWED_ORIGINS||'http://127.0.0.1:3211,http://localhost:3211').split(',').map(x=>x.trim()).filter(Boolean),
    databasePath:process.env.H5_SESSION_DB||resolve('data/h5-sessions.sqlite'),
    logBlockedOrigins:process.env.H5_LOG_BLOCKED_ORIGINS==='true',adAssistanceEnabled:process.env.H5_AD_ASSISTANCE_ENABLED==='true',trustLoopbackProxy:process.env.H5_TRUST_LOOPBACK_PROXY==='true',staticDir:resolve('outputs/h5'),assetPaths:JSON.parse(readFileSync(resolve('h5/asset-manifest.json'),'utf8')),rewardedAdUnitId:process.env.H5_REWARDED_AD_UNIT||'',rewardedAdUnitIdPortrait:process.env.H5_REWARDED_AD_UNIT_PORTRAIT||'',rewardedAdUnitIdLandscape:process.env.H5_REWARDED_AD_UNIT_LANDSCAPE||'',
  });
  server.listen(port,host,()=>console.log('H5 preview: http://'+host+':'+server.address().port+'/#/zh/lobby'));
}
