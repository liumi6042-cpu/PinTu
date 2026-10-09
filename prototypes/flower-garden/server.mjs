import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initial,act,nowOf,grantDecor} from './engine.mjs';
const root=dirname(fileURLToPath(import.meta.url)),dir=resolve(root,'../../work/flower-garden-preview');mkdirSync(dir,{recursive:true});const file=resolve(dir,'states.json');let states=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
function save(){writeFileSync(file+'.next',JSON.stringify(states));renameSync(file+'.next',file);}
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.webp':'image/webp','.wav':'audio/wav'};
createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const answer=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(url.pathname==='/api/new'&&req.method==='POST'){
 if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+port)return answer(403,{error:'仅限本地测试'});
 const id=randomUUID();states[id]=grantDecor(initial());save();res.setHeader('Set-Cookie','garden_preview='+id+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000');return answer(200,{state:states[id],now:Date.now()});}
 if(url.pathname==='/api/state'){
 let id=req.headers.cookie?.match(/(?:^|; )garden_preview=([a-f0-9-]+)/)?.[1];if(!id||!states[id]){id=randomUUID();states[id]=grantDecor(initial());save();res.setHeader('Set-Cookie','garden_preview='+id+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000');}
 if(!states[id].decorTestAccess){grantDecor(states[id]);states[id].version++;save();}
 if(req.method==='POST'){if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+port)return answer(403,{error:'仅限本地测试'});let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)return answer(413,{error:'请求过长'});}try{const cmd=JSON.parse(body);const out=act(states[id],cmd);states[id]=out.state;save();return answer(200,{...out,now:nowOf(out.state,Date.now())});}catch(e){return answer(409,{error:e.message,state:states[id],now:nowOf(states[id],Date.now())});}}
 return answer(200,{state:states[id],now:nowOf(states[id],Date.now())});}
 if(req.method!=='GET')return answer(405,{error:'不支持'});const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))return answer(404,{});try{const data=readFileSync(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);}catch{answer(404,{});}
}).listen(Number(process.env.PORT||3218),'127.0.0.1',()=>console.log('Garden preview http://127.0.0.1:'+port+' PID '+process.pid));
const port=Number(process.env.PORT||3218);
