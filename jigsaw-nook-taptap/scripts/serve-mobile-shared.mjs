import http from 'node:http';
import {createReadStream,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const base=process.env.SHARED_PREVIEW_OUTPUT?resolve(process.env.SHARED_PREVIEW_OUTPUT):resolve(import.meta.dirname,'../outputs/shared-web');
const port=Number(process.env.SHARED_PREVIEW_PORT||3213),backend=Number(process.env.MOBILE_BACKEND_PORT||3211);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg'};
export function createSharedMobilePreview({outputDir=base,backendPort=backend}={}){
 const localBase=resolve(outputDir),tunnels=new Set();
 const server=http.createServer((req,res)=>{
 if(req.url==='/h5'||req.url.startsWith('/h5/')){
  const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+backendPort,origin:'http://127.0.0.1:'+backendPort}},result=>{res.writeHead(result.statusCode,result.headers);result.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'本地游戏后端尚未启动'}));});req.pipe(upstream);return;
 }
 try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(localBase,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(localBase+sep)||!statSync(file).isFile())throw Error('Not found');res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end('Not found');}
 });
 server.on('upgrade',(req,socket,head)=>{
  const previewPort=server.address()?.port,source=req.headers.origin;
  if(req.url!=='/h5/realtime'||source&&!['http://127.0.0.1:'+previewPort,'http://localhost:'+previewPort].includes(source)){
   socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
  }
  let remote,upgraded=false;
  const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:'/h5/realtime',method:'GET',headers:{...req.headers,host:'127.0.0.1:'+backendPort,origin:'http://127.0.0.1:'+backendPort}});
  const dispose=()=>{tunnels.delete(socket);socket.destroy();remote?.destroy();upstream.destroy();};
  tunnels.add(socket);socket.on('error',dispose);socket.on('close',dispose);
  upstream.on('error',()=>{if(!upgraded&&!socket.destroyed)socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');else dispose();});
  upstream.setTimeout(5000,()=>upstream.destroy(Error('Local realtime handshake timed out')));
  upstream.on('response',response=>{response.resume();if(!socket.destroyed)socket.end('HTTP/1.1 '+response.statusCode+' '+response.statusMessage+'\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  upstream.on('upgrade',(response,upstreamSocket,upstreamHead)=>{
   remote=upstreamSocket;upgraded=true;upstream.setTimeout(0);socket.setTimeout(0);remote.setTimeout(0);
   remote.on('error',dispose);remote.on('close',dispose);
   if(socket.destroyed){dispose();return;}
   const headers=[];for(let index=0;index<response.rawHeaders.length;index+=2)headers.push(response.rawHeaders[index]+': '+response.rawHeaders[index+1]);
   socket.write('HTTP/1.1 '+response.statusCode+' '+response.statusMessage+'\r\n'+headers.join('\r\n')+'\r\n\r\n');
   if(head.length)remote.write(head);if(upstreamHead.length)socket.write(upstreamHead);
   socket.pipe(remote);remote.pipe(socket);
  });
  upstream.end();
 });
 server.closeRealtimeTunnels=()=>{for(const socket of tunnels)socket.destroy();tunnels.clear();};
 server.once('close',server.closeRealtimeTunnels);
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)createSharedMobilePreview().listen(port,'127.0.0.1',()=>console.log('Shared game preview: http://127.0.0.1:'+port));
