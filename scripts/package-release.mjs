import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash, inside, inventory, runtimeAssets, selectRuntimeFiles, TAR } from './release-files.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const run=(command,args,options={})=>{const result=spawnSync(command,args,{cwd:root,windowsHide:true,stdio:'inherit',...options});if(result.error||result.status!==0)throw new Error('Command failed: '+command);return result;};
const git=args=>run('git',args,{stdio:'pipe',encoding:'utf8'}).stdout.trim();
const commit=git(['rev-parse','HEAD']),dirty=!!git(['status','--porcelain']);
if(dirty&&!process.argv.includes('--allow-dirty'))throw new Error('Commit the source before creating an uploadable release. Use --allow-dirty only for local validation.');
run(process.execPath,['scripts/build-server.mjs','--release']);
const build=resolve(root,'work/release-build/standalone');
const catalog=JSON.parse(readFileSync('content/puzzle-catalog.json','utf8'));
const assets=runtimeAssets(catalog,JSON.parse(readFileSync('config/runtime-assets.json','utf8')));
const files=selectRuntimeFiles(build,assets);
const releases=resolve(root,'releases');mkdirSync(releases,{recursive:true});
const stage=inside(releases,resolve(releases,'staging-'+Date.now()));
if(existsSync(stage))rmSync(stage,{recursive:true,force:true});
mkdirSync(stage);
try{
  for(const name of files)cpSync(resolve(build,name),resolve(stage,name));
  const manifest={schema:1,app:'jigsaw-nook',createdAt:new Date().toISOString(),gitCommit:commit,dirty,nodeMajor:Number(process.versions.node.split('.')[0]),buildPlatform:process.platform,platform:'portable-no-native-binaries',publicPictures:catalog.filter(p=>p.status==='published').length,runtimeAssets:assets,files:inventory(stage,files)};
  writeFileSync(resolve(stage,'release.json'),JSON.stringify(manifest,null,2)+'\n');
  const archive=inside(releases,resolve(releases,'next.tar.gz'));
  run(TAR,['-czf',archive,'-C',stage,'.']);
  const bytes=readFileSync(archive),sha256=hash(bytes);
  const report={schema:1,app:'jigsaw-nook',file:'latest.tar.gz',bytes:bytes.length,sha256,gitCommit:commit,dirty,verified:false,files:files.length,uncompressedBytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),nodeMajor:manifest.nodeMajor};
  const latest=inside(releases,resolve(releases,'latest.tar.gz'));
  // Replaces only the previous generated local release, never source or runtime data.
  if(existsSync(latest))rmSync(latest);
  renameSync(archive,latest);
  writeFileSync(resolve(releases,'latest.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(releases,'latest.sha256'),`${sha256}  latest.tar.gz\n`);
  run(process.execPath,['tests/release-smoke.mjs']);
  // Recheck Git after building so concurrent edits cannot produce an uploadable
  // archive that claims to represent a different source revision.
  if(git(['rev-parse','HEAD'])!==commit||(!dirty&&git(['status','--porcelain'])))throw new Error('Source changed during the build. Rebuild the current commit.');
  report.verified=true;
  writeFileSync(resolve(releases,'latest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{
  rmSync(stage,{recursive:true,force:true});
  // Keep only latest, not an additional unpacked copy with raw public assets.
  rmSync(inside(root,build),{recursive:true,force:true});
}
