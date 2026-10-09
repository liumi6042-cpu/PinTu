import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TAR} from './release-files.mjs';
const build=JSON.parse(readFileSync('releases/h5-build.json','utf8'));
const archiveBytes=readFileSync('releases/jigsaw-nook-taptap-h5.zip');
if(createHash('sha256').update(archiveBytes).digest('hex')!==build.sha256)throw Error('Rebuild changed H5 package');
const stage=resolve('work/h5-server-release');mkdirSync(stage,{recursive:true});
const assets=JSON.parse(readFileSync('outputs/h5/.vite/manifest.json','utf8'));
const files=['server/h5-gateway.mjs','h5/asset-manifest.json','outputs/h5/index.html','outputs/h5/config.js','outputs/h5/favicon.ico','outputs/h5/favicon-96.png','outputs/h5/favicon.svg','outputs/h5/apple-touch-icon.png','outputs/h5/h5-build.json'];
for(const entry of Object.values(assets))for(const name of [entry.file,...(entry.css||[]),...(entry.assets||[])])files.push('outputs/h5/'+name);
const manifest=[];
for(const path of files){const target=resolve(stage,path);if(!target.startsWith(stage+sep))throw Error('Unsafe output path');mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(path),target);const bytes=readFileSync(target);manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
writeFileSync(resolve(stage,'release.json'),JSON.stringify({service:'jigsaw-h5',...build,files:manifest},null,2)+'\n');
const file=resolve('releases/jigsaw-nook-h5-server.tar.gz');
const packed=spawnSync(TAR,['-czf',file,'-C',stage,...files,'release.json'],{stdio:'inherit',windowsHide:true});if(packed.status!==0||packed.error)throw Error('Gateway package failed');
const sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync('releases/jigsaw-nook-h5-server.sha256',sha256+'  jigsaw-nook-h5-server.tar.gz\n');
console.log(JSON.stringify({file,bytes:statSync(file).size,sha256,files:files.length},null,2));
