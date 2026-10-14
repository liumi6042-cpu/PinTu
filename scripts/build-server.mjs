import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inside, SERVER_RUNTIME_HELPERS, CONTENT_RUNTIME_FILES } from './release-files.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const release=process.argv.includes('--release');
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
let temporary;
try {
  const buildRoot=release ? (temporary=mkdtempSync(resolve(tmpdir(),'jigsaw-build-'))) : root;
  if(release){
    const listed=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,windowsHide:true,encoding:'utf8'});
    if(listed.error||listed.status!==0)throw new Error('Cannot list build source files');
    for(const name of new Set(listed.stdout.split('\0').filter(Boolean))){
      const source=inside(root,resolve(root,name));
      if(existsSync(source))copyFile(source,inside(buildRoot,resolve(buildRoot,name)));
    }
    symlinkSync(resolve(root,'node_modules'),resolve(buildRoot,'node_modules'),process.platform==='win32'?'junction':'dir');
  }
  const result=spawnSync(process.execPath,[resolve(root,'node_modules/vinext/dist/cli.js'),'build'],{
    cwd:buildRoot,stdio:'inherit',windowsHide:true,
    env:{...process.env,PUZZLE_TARGET:'node',PUZZLE_LOCAL_BUILD:'0'},
  });
  if(result.error||result.status!==0)throw new Error('Standalone build failed');
  const output=resolve(buildRoot,'dist/standalone');
  if(!existsSync(resolve(output,'server.js')))throw new Error('Standalone server output missing');
  copyTree(resolve(root,'drizzle'),resolve(output,'drizzle'));
  for(const name of [...SERVER_RUNTIME_HELPERS,...CONTENT_RUNTIME_FILES]){
    copyFile(resolve(root,name),resolve(output,name));
  }
  if(readFileSync(resolve(output,'dist/server/index.js'),'utf8').includes('cloudflare:workers'))throw new Error('Worker-only import remained in Node output');
  let target=output;
  if(release){
    const folder=resolve(root,'work/release-build');mkdirSync(folder,{recursive:true});
    target=inside(folder,resolve(folder,'standalone'));
    if(existsSync(target))rmSync(target,{recursive:true,force:true});
    copyTree(output,target);
  }
  console.log('Self-hosted build ready in '+target);
} finally {
  if(temporary){
    // Unlink the dependency junction explicitly; never traverse the real install.
    const dependencies=resolve(temporary,'node_modules');
    if(existsSync(dependencies))unlinkSync(dependencies);
    rmSync(inside(tmpdir(),temporary),{recursive:true,force:true});
  }
}
