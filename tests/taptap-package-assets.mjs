import assert from 'node:assert/strict';
import http from 'node:http';
import {existsSync,readFileSync,statSync,createReadStream} from 'node:fs';
import {extname,resolve} from 'node:path';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

// Package-local smoke check. TapTap still needs one final QR scan, but this
// catches missing UI atlases and a broken package base before uploading.
const root=resolve(process.env.TAPTAP_PACKAGE_ROOT||'outputs/shared-web');
const required=[
 ['index.html', 'text/html'],
 ['game.js', 'text/javascript'],
 ['assets/ui/b2-core-icons23.png', 'image/png'],
 ['assets/ui/b2-card-icons1023.png', 'image/png'],
 ['assets/ui/b2-task-icons23.png', 'image/png'],
 ['art/b2-pixel-atlas.png', 'image/png'],
 ['art/b2-supply-scenes.png', 'image/png'],
 ['assets/fonts/jigsaw-ui-sc.woff2', 'font/woff2'],
];
for(const [file] of required){const path=resolve(root,file);assert.ok(path.startsWith(root),`unsafe package path: ${file}`);assert.ok(existsSync(path),`missing package file: ${file}`);assert.ok(statSync(path).size>0,`empty package file: ${file}`);}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.woff2':'font/woff2','.wav':'audio/wav','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=resolve(root,'.'+(pathname==='/wrapper/index.html'?'/index.html':pathname));
 if(!file.startsWith(root)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});createReadStream(file).pipe(res);
});
await new Promise(resolveServer=>server.listen(0,'127.0.0.1',resolveServer));
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:844,height:390}});
 const assetResponses=new Map();
 page.on('response',response=>{if(/(?:assets\/ui|art)\//.test(response.url()))assetResponses.set(response.url(),response.status());});
 await page.goto(`${base}/wrapper/index.html`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 const decoded=await page.evaluate(async scriptUrl=>{
  const files=['assets/ui/b2-card-icons1023.png','assets/ui/b2-core-icons23.png','assets/ui/b2-task-icons23.png','art/b2-pixel-atlas.png','art/b2-supply-scenes.png'];
  const results=[];
  for(const file of files){const image=new Image();const done=new Promise(resolve=>{image.onload=()=>resolve({file,ok:true,width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({file,ok:false,width:image.naturalWidth,height:image.naturalHeight});});image.src=new URL(file,scriptUrl).href;results.push(await done);}
  return {base:document.baseURI,scriptUrl,results};
 },`${base}/game.js`);
 for(const item of decoded.results){assert.equal(item.ok,true,`cannot decode ${item.file}`);assert.ok(item.width>0&&item.height>0,`invalid dimensions ${item.file}`);}
 const uniqueStatuses=[...assetResponses.values()];assert.ok(uniqueStatuses.every(status=>status===200),`package asset response failed: ${JSON.stringify([...assetResponses])}`);
 console.log(JSON.stringify({passed:true,packageRoot:root,decoded:decoded.results,assetResponses:[...assetResponses]},null,2));
}finally{await browser.close();server.close();}
