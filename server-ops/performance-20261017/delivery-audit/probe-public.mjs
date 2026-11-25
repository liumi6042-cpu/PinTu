import {request} from 'node:https';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('server-ops/performance-20261017/delivery-audit');mkdirSync(out,{recursive:true});
const read=(path,encoding='identity')=>new Promise((done,fail)=>{const started=performance.now();const r=request('https://jigsawnook.online'+path,{method:'GET',headers:{'Accept-Encoding':encoding,'User-Agent':'Jigsaw-Delivery-Audit/1.0'}},res=>{let chunks=[],n=0;res.on('data',c=>{n+=c.length;chunks.push(c);if(n>8*1024*1024)r.destroy(Error('Response budget exceeded'));});res.on('end',()=>done({path,encoding,status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([k])=>['cache-control','content-encoding','content-length','content-type','etag','last-modified','vary','server','age','cf-cache-status','location','x-cache'].includes(k))),bytes:n,elapsedMs:Math.round(performance.now()-started),body:Buffer.concat(chunks)}));});r.setTimeout(20000,()=>r.destroy(Error('Request timeout')));r.on('error',fail);r.end();});
const html=await read('/play'),text=html.body.toString(),scripts=[...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]);
let shared=scripts.find(x=>/^\/shared-client\/[a-f0-9]{16}\/game\.js$/.test(x))??text.match(/\/shared-client\/[a-f0-9]{16}\/game\.js/)?.[0];
if(!shared){const chunk=scripts.find(x=>/^\/_next\/static\/chunks\/shared-game-/.test(x));if(chunk){const r=await read(chunk);shared=r.body.toString().match(/\/shared-client\/[a-f0-9]{16}\/game\.js/)?.[0];writeFileSync(resolve(out,'public-shared-wrapper.js'),r.body);}}
if(!shared)throw Error('Could not identify the live shared client script');
const results=[{...html,body:undefined}],paths=[shared,shared?.replace(/game\.js$/,'assets/fonts/jigsaw-ui-sc.woff2'),'/puzzles/painted-glasshouse-workbench-v1-optimized-81f63049cb3a.webp','/api/health'].filter(Boolean);
for(const path of paths)for(const enc of path==='/api/health'?['gzip']:['identity','gzip','br']){const r=await read(path,enc);results.push({...r,body:undefined});}
const report={checkedAt:new Date().toISOString(),shared,scripts,icpMention:/备案|beian\.miit/.test(text),results};writeFileSync(resolve(out,'public-delivery-before.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
