import { createServer,request as proxyRequest,Agent } from 'node:http';
import { createHash,randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function routeName(method,pathname){
  if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))method='OTHER';
  const room=pathname.match(/^\/api\/rooms\/[a-f0-9]{32}(\/(?:join|cursors|record))?$/);
  if(room)return method+' /api/rooms/:id'+(room[1]||'');
  if(/^\/api\/member-rooms\/[a-f0-9]{32}$/.test(pathname))return method+' /api/member-rooms/:id';
  if(/^\/api\/feedback(?:\/|$)/.test(pathname))return method+' /api/feedback';
  if(/^\/api\/(?:rooms|lobby|leaderboard|achievements|membership|member-rooms|my-rooms|guest|connection|auth\/(?:login|register|logout|me|security|recover))$/.test(pathname))return method+' '+pathname;
  return pathname.startsWith('/api/')?method+' /api/other':'assets/pages';
}
export class TokenBuckets{
  constructor({maxKeys=12000}={}){this.buckets=new Map();this.maxKeys=maxKeys;this.prunedAt=0;}
  take(key,rate,capacity,now=Date.now()){
    if(now-this.prunedAt>60000){for(const [k,b] of this.buckets)if(now-b.at>300000)this.buckets.delete(k);this.prunedAt=now;}
    let b=this.buckets.get(key);if(!b){if(this.buckets.size>=this.maxKeys)return 5;b={tokens:capacity,at:now};this.buckets.set(key,b);}
    b.tokens=Math.min(capacity,b.tokens+Math.max(0,now-b.at)*rate/1000);b.at=now;
    if(b.tokens<1)return Math.max(1,Math.ceil((1-b.tokens)/rate));b.tokens--;return 0;
  }
}
export class GatewayMetrics{
  constructor(){this.startedAt=Date.now();this.requests=0;this.errors5xx=0;this.limited=0;this.active=0;this.peakActive=0;this.rows=new Map();this.recent=[];}
  begin(){this.active++;this.peakActive=Math.max(this.active,this.peakActive);}
  finish(route,status,ms){this.active--;this.requests++;if(status>=500)this.errors5xx++;if(status===429)this.limited++;let row=this.rows.get(route);if(!row){row={requests:0,errors5xx:0,limited:0,samples:[]};this.rows.set(route,row);}row.requests++;if(status>=500)row.errors5xx++;if(status===429)row.limited++;row.samples.push(ms);if(row.samples.length>2048)row.samples.shift();this.recent.push({at:Date.now(),status,ms});if(this.recent.length>10000)this.recent.shift();}
  snapshot(){const now=Date.now(),recent=this.recent.filter(r=>now-r.at<60000);const percentile=(a,q)=>a.length?Math.round([...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*q))]):null;return {startedAt:this.startedAt,updatedAt:now,requests:this.requests,errors5xx:this.errors5xx,limited:this.limited,active:this.active,peakActive:this.peakActive,lastMinute:{requests:recent.length,errors5xx:recent.filter(r=>r.status>=500).length,p50Ms:percentile(recent.map(r=>r.ms),.5),p95Ms:percentile(recent.map(r=>r.ms),.95)},routes:Object.fromEntries([...this.rows].map(([key,row])=>[key,{requests:row.requests,errors5xx:row.errors5xx,limited:row.limited,p95Ms:percentile(row.samples,.95)}]))};}
}
export function createGateway({upstreamPort,limiter=new TokenBuckets(),metrics=new GatewayMetrics(),maxActive=256}){
  const agent=new Agent({keepAlive:true,maxSockets:maxActive,maxFreeSockets:32}),salt=randomBytes(16).toString('hex');
  const server=createServer({maxHeaderSize:16384,requestTimeout:30000,headersTimeout:10000,keepAliveTimeout:5000},(req,res)=>{
    const begin=performance.now();let pathname;try{pathname=new URL(req.url,'http://local').pathname;}catch{res.writeHead(400).end();return;}
    const route=routeName(req.method,pathname),api=pathname.startsWith('/api/');metrics.begin();let counted=false;
    const complete=()=>{if(counted)return;counted=true;metrics.finish(route,res.writableFinished?res.statusCode:499,performance.now()-begin);};res.once('finish',complete);res.once('close',complete);
    const reject=(status,error,retry)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})});res.end(JSON.stringify({error}));req.resume();};
    if(!req.url.startsWith('/')||req.url.startsWith('//')){reject(400,'请求地址无效');return;}
    if(req.url.length>8192){reject(414,'请求地址过长');return;}
    if(metrics.active>maxActive){reject(503,'服务器繁忙，请稍后再试',2);return;}
    // Socket addresses are authoritative here. Never trust caller-supplied forwarded IP headers.
    const ip=req.socket.remoteAddress||'unknown';let wait=limiter.take('global',1800,3600)||limiter.take('ip:'+ip,800,1600);
    if(api&&!wait){
      const auth=/^Bearer [a-f0-9]{32}$/.test(req.headers.authorization||'')?req.headers.authorization:null;
      const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)(?:puzzle_session|puzzle_guest)=([a-f0-9]{64})(?:;|$)/)?.[1];
      const identity=auth||cookie,client=identity?createHash('sha256').update(salt+identity).digest('hex'):'ip:'+ip;
      let rate=4,burst=20;
      if(route.endsWith('/cursors')){rate=8;burst=20;}
      else if(route==='GET /api/rooms/:id'){rate=10;burst=30;}
      else if(route==='POST /api/rooms/:id'){rate=30;burst=90;}
      else if(route==='POST /api/rooms'){rate=1;burst=12;}
      else if(route==='POST /api/user-images'){rate=.1;burst=3;}
      if(/^\/api\/auth\/(?:login|register|security|recover)$/.test(pathname))wait=limiter.take('auth:'+ip,.5,20);
      else if(pathname==='/api/guest')wait=limiter.take('guest:'+ip,3,96);
      else if(pathname.endsWith('/join'))wait=limiter.take('join:'+ip,3,96);
      else wait=limiter.take(route+':'+client,rate,burst);
      if(!wait)wait=limiter.take('api-ip:'+ip,600,1200);
    }
    if(wait){reject(429,'操作太频繁，请稍后再试',wait);return;}
    const maxBody=pathname.startsWith('/api/feedback')?16*1024*1024:pathname==='/api/user-images'?2*1024*1024:4096;
    if(api&&Number(req.headers['content-length']||0)>maxBody){reject(413,'请求内容过长');return;}
    const headers={...req.headers};delete headers['x-forwarded-for'];delete headers['x-real-ip'];delete headers.forwarded;delete headers['x-puzzle-country'];delete headers['cf-ipcountry'];
    // Preserve Host and Origin so the existing CSRF checks see the public LAN URL.
    const upstream=proxyRequest({host:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers,agent},incoming=>{
      if(res.writableEnded){incoming.resume();return;}res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);incoming.on('error',()=>res.destroy());
    });
    upstream.setTimeout(30000,()=>upstream.destroy(new Error('upstream timeout')));
    upstream.on('error',()=>{if(!res.headersSent)reject(502,'本地服务暂时不可用，请稍后重试',2);else if(!res.writableEnded)res.destroy();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
    let size=0;req.on('data',chunk=>{size+=chunk.length;if(api&&size>maxBody){req.unpipe(upstream);if(!res.headersSent)reject(413,'请求内容过长');upstream.destroy();}});
    req.pipe(upstream);
  });
  server.maxConnections=1024;server.on('clientError',(_,socket)=>{socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
  server.on('close',()=>agent.destroy());return {server,metrics,limiter};
}
