import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inside } from './release-files.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const release=process.argv.includes('--release');
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
      if(existsSync(source))cpSync(source,inside(buildRoot,resolve(buildRoot,name)));
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
  cpSync(resolve(root,'drizzle'),resolve(output,'drizzle'),{recursive:true});
  for(const name of ['backup.mjs','migrate.mjs','public-room-cleanup.mjs','runtime.node.mjs','sqlite.mjs']){
    cpSync(resolve(root,'server',name),resolve(output,'server',name));
  }
  if(readFileSync(resolve(output,'dist/server/index.js'),'utf8').includes('cloudflare:workers'))throw new Error('Worker-only import remained in Node output');
  let target=output;
  if(release){
    const folder=resolve(root,'work/release-build');mkdirSync(folder,{recursive:true});
    target=inside(folder,resolve(folder,'standalone'));
    if(existsSync(target))rmSync(target,{recursive:true,force:true});
    cpSync(output,target,{recursive:true});
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
