import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TAR} from './release-files.mjs';

const root=resolve(import.meta.dirname,'..'),release=process.argv[2]??'20261015-artwork40';
assert.match(release,/^\d{8}-[a-z0-9-]{2,32}$/);
const targetRoot=resolve(root,'work/mobile-backend-releases',release),beforePath=resolve(root,'../content-admin/work/collection-ui-release-20261015/mobile/stage/release.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const beforeBytes=readFileSync(beforePath),before=JSON.parse(beforeBytes),targetBytes=readFileSync(resolve(targetRoot,'release.json')),target=JSON.parse(targetBytes);
assert.equal(target.packageKind,'full');assert.equal(before.release,target.baseRelease);assert.equal(sha(beforeBytes),target.baseManifestSha256);
const previous=new Map(before.files.map(file=>[file.path,file]));
const changed=target.files.filter(file=>{const old=previous.get(file.path);return !old||old.bytes!==file.bytes||old.sha256!==file.sha256;});
const reused=target.files.filter(file=>!changed.includes(file));
const stage=resolve(root,'work/mobile-sparse-transfer',release),archive=resolve(root,'releases/jigsaw-mobile-sparse-'+release+'.tar.gz');
assert(!existsSync(stage)&&!existsSync(archive),'Sparse preparation needs a fresh output');mkdirSync(stage,{recursive:true});
for(const file of changed){const bytes=readFileSync(resolve(targetRoot,file.path));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);const path=resolve(stage,file.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(resolve(targetRoot,file.path),path);}
writeFileSync(resolve(stage,'release.json'),targetBytes);
const descriptor={schema:'jigsaw-mobile-sparse-transfer/v1',baseRelease:before.release,baseManifestSha256:sha(beforeBytes),release:target.release,manifestSha256:sha(targetBytes),payload:changed.map(file=>file.path),reusedFiles:reused.length};
writeFileSync(resolve(stage,'sparse-transfer.json'),JSON.stringify(descriptor,null,2)+'\n');
const list=resolve(root,'work/mobile-sparse-transfer',release+'.files'),files=['sparse-transfer.json','release.json',...changed.map(file=>file.path)];writeFileSync(list,files.join('\0')+'\0');
const packed=spawnSync(TAR,['-czf',archive,'-C',stage,'--null','-T',list],{windowsHide:true,stdio:'inherit'});assert.equal(packed.status,0);
const bytes=readFileSync(archive),report={release:target.release,archive,sha256:sha(bytes),bytes:bytes.length,manifestSha256:sha(targetBytes),baseRelease:before.release,baseManifestSha256:sha(beforeBytes),payloadFiles:changed.length,reusedFiles:reused.length,newArtworkFiles:target.artworkOverlay.files,fullyVerifiedTargetFiles:target.files.length};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
