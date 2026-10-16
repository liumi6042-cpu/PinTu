import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, SERVER_RUNTIME_HELPERS, CONTENT_RUNTIME_FILES, runtimeAssets, selectRuntimeFiles } from './release-files.mjs';
import { stageBuildSource, materializeRuntimeAssets } from './release-staging.mjs';
import { withReleaseCleanup } from './release-cleanup.mjs';
import { prepareNodeRealtime } from './build-room-realtime.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const release=process.argv.includes('--release');
const requestedOutput=process.argv.find(value=>value.startsWith('--output='))?.slice(9);
if(requestedOutput&&!release)throw new Error('--output is only allowed with --release');
// Recursive fs.cpSync terminates the process on the Windows build host, so copy
// trees with plain per-entry primitives that work wherever this is built.
const copyTree=(from,to)=>{
  mkdirSync(to,{recursive:true});
  for(const entry of readdirSync(from,{withFileTypes:true})){
    const source=resolve(from,entry.name),next=resolve(to,entry.name);
    if(entry.isDirectory())copyTree(source,next);
    else copyFileSync(source,next);
  }
};
const copyFile=(from,to)=>{
  mkdirSync(dirname(to),{recursive:true});
  copyFileSync(from,to);
};
// Vinext's CLI always cleans cwd/dist. Build a release in a disposable source
// copy so it cannot remove the running local preview or load private .env files.
const buildServer=async attempt=>{
 let temporary;
 try {
  const buildRoot=release ? (temporary=attempt.sourceDirectory()) : root;
  if(release){
    const listed=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,windowsHide:true,encoding:'utf8'});
    if(listed.error||listed.status!==0)throw new Error('Cannot list build source files');
    stageBuildSource(root,buildRoot,listed.stdout.split('\0').filter(Boolean));
    symlinkSync(resolve(root,'node_modules'),resolve(buildRoot,'node_modules'),process.platform==='win32'?'junction':'dir');
  }
  const result=spawnSync(process.execPath,[resolve(root,'node_modules/vinext/dist/cli.js'),'build'],{
    cwd:buildRoot,stdio:'inherit',windowsHide:true,
    env:{...process.env,PUZZLE_TARGET:'node',PUZZLE_LOCAL_BUILD:'0',PUZZLE_RELEASE_BUILD:release?'1':'0'},
  });
  if(result.error||result.status!==0)throw new Error('Standalone build failed');
  const output=resolve(buildRoot,'dist/standalone');
  if(!existsSync(resolve(output,'server.js')))throw new Error('Standalone server output missing');
  copyTree(resolve(root,'drizzle'),resolve(output,'drizzle'));
  for(const name of [...SERVER_RUNTIME_HELPERS,...CONTENT_RUNTIME_FILES]){
    if(name==='server/room-realtime.node.mjs')continue; // generated with its portable dependencies below
    copyFile(resolve(root,name),resolve(output,name));
  }
  await prepareNodeRealtime(output);
  if(readFileSync(resolve(output,'dist/server/index.js'),'utf8').includes('cloudflare:workers'))throw new Error('Worker-only import remained in Node output');
  let target=output;
  if(release){
    const folder=resolve(root,'work/release-build');mkdirSync(folder,{recursive:true});
    target=inside(folder,requestedOutput?resolve(requestedOutput):resolve(folder,'standalone-'+Date.now()));
    if(existsSync(target))throw new Error('Release output already exists; choose a new output directory');
    const assets=runtimeAssets(JSON.parse(readFileSync(resolve(root,'content/puzzle-catalog.json'),'utf8')),JSON.parse(readFileSync(resolve(root,'config/runtime-assets.json'),'utf8')));
    materializeRuntimeAssets(root,output,assets);
    const files=selectRuntimeFiles(output,assets);
    // Copy only the complete verified runtime, excluding standalone's extra
    // public/ tree and PNGs. The final result is independent of source hardlinks.
    mkdirSync(target);
    for(const name of files)copyFile(resolve(output,name),resolve(target,name));
  }
  return target;
 } finally {
  if(temporary){
    // Unlink the dependency junction explicitly; never traverse the real install.
    const dependencies=resolve(temporary,'node_modules');
    if(existsSync(dependencies))unlinkSync(dependencies);
  }
 }
};
const {value:target}=release?await withReleaseCleanup(root,buildServer):{value:await buildServer()};
console.log('Self-hosted build ready in '+target);
