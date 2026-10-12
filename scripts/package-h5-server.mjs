import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TAR} from './release-files.mjs';
const root=realpathSync(process.cwd());
const build=JSON.parse(readFileSync('releases/h5-build.json','utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(build.backendMode!=='mobile-v3-isolated')throw Error('Build the isolated mobile frontend first');
if(digest(readFileSync('releases/jigsaw-nook-taptap-h5.zip'))!==build.sha256)throw Error('Rebuild changed H5 package');
const stage=resolve('work/mobile-v3-server-release');mkdirSync(stage,{recursive:true});
if(realpathSync(stage)!==stage)throw Error('Stage cannot be a link');
const vite=JSON.parse(readFileSync('outputs/h5/.vite/manifest.json','utf8'));
const files=new Set(['server/h5-gateway.mjs','server/mobile-service.mjs','server/daily-content.mjs','server/mobile-collection.mjs','lib/mobile-collection-catalog.json','server/mobile-economy.mjs','server/mobile-tasks.mjs','outputs/mobile/engine.mjs','h5/asset-manifest.json','outputs/h5/index.html','outputs/h5/config.js','outputs/h5/favicon.ico','outputs/h5/favicon-96.png','outputs/h5/favicon.svg','outputs/h5/apple-touch-icon.png','outputs/h5/h5-build.json']);
if(!Array.isArray(build.fontNotices)||build.fontNotices.length!==4)throw Error('Rebuild the H5 package with font license notices');
for(const path of build.fontNotices){if(!/^licenses\/fonts\/[A-Za-z0-9._-]+$/.test(path))throw Error('Unsafe font notice path');files.add('outputs/h5/'+path);}
for(const entry of Object.values(vite))for(const name of [entry.file,...(entry.css||[]),...(entry.assets||[])])files.add('outputs/h5/'+name);
for(const url of JSON.parse(readFileSync('h5/preview-assets.json','utf8')))files.add('outputs/h5'+url);
for(const url of JSON.parse(readFileSync('h5/asset-manifest.json','utf8'))){if(!url.startsWith('/')||url.includes('..')||url.includes('\\'))throw Error('Unsafe runtime asset');files.add('public'+url);}
const manifest=[];
for(const path of files){
 if(/(?:^|\/)(?:\.env[^/]*|\.git|data|backups|node_modules)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)$/i.test(path))throw Error('Private data in package');
 const source=realpathSync(resolve(path)),target=resolve(stage,path);
 if(!source.startsWith(root+sep)||!target.startsWith(stage+sep))throw Error('Unsafe package path');
 mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);const bytes=readFileSync(target);manifest.push({path,bytes:bytes.length,sha256:digest(bytes)});
}
writeFileSync(resolve(stage,'release.json'),JSON.stringify({service:'jigsaw-mobile-v3',node:'>=24.0.0',...build,files:manifest},null,2)+'\n');
const file=resolve('releases/jigsaw-nook-mobile-v3-server.tar.gz');
const listFile=resolve('work/mobile-v3-server-files.txt');writeFileSync(listFile,[...files,'release.json'].join('\0')+'\0');
const packed=spawnSync(TAR,['-czf',file,'-C',stage,'--null','-T',listFile],{stdio:'inherit',windowsHide:true});if(packed.status!==0||packed.error)throw Error('Mobile server package failed: '+(packed.error?.message??packed.status));
const sha256=digest(readFileSync(file));writeFileSync('releases/jigsaw-nook-mobile-v3-server.sha256',sha256+'  jigsaw-nook-mobile-v3-server.tar.gz\n');
console.log(JSON.stringify({file,bytes:statSync(file).size,sha256,files:files.size,backendMode:build.backendMode},null,2));
