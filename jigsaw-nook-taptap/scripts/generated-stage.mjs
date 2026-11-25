import {lstatSync,mkdirSync,mkdtempSync,readdirSync,realpathSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {relative,resolve,sep} from 'node:path';

const fixedStages=new Set(['work/h5-shell-public','work/h5-platform-zip','work/mobile-v3-server-release','outputs/h5']);
const packageCheck=/^work\/mobile-package-check\/run-[A-Za-z0-9]+$/;
const statIfPresent=path=>{try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};

export function checkedGeneratedStage(root,path){
 const workspace=realpathSync(resolve(root)),target=resolve(workspace,path);
 const name=relative(workspace,target).split(sep).join('/');
 if(!fixedStages.has(name)&&!packageCheck.test(name))throw Error('Not an allowed generated stage: '+target);
 let ancestor=workspace;
 for(const part of name.split('/')){
  ancestor=resolve(ancestor,part);const stat=statIfPresent(ancestor);
  if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(ancestor)!==ancestor))throw Error('Generated stage cannot contain a linked or non-directory path: '+ancestor);
 }
 return target;
}

export async function removeGeneratedStage(root,path){
 const target=checkedGeneratedStage(root,path);
 if(!statIfPresent(target))return;
 const check=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
  const child=resolve(directory,entry.name);
  if(entry.isSymbolicLink())throw Error('Generated stage contains a link; retained: '+child);
  if(entry.isDirectory()){if(realpathSync(child)!==child)throw Error('Generated stage contains a linked directory; retained: '+child);check(child);}
 }};
 // Native rmSync in older Node 24 builds silently leaves non-ASCII Windows
 // paths behind (nodejs/node#56049). Use fs.rm and verify the result.
 check(target);await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 if(statIfPresent(target))throw Error('Generated stage was not removed: '+target);
}

export async function resetGeneratedStage(root,path){
 const target=checkedGeneratedStage(root,path);await removeGeneratedStage(root,target);mkdirSync(target,{recursive:true});return target;
}

export function createPackageCheckStage(root){
 const marker=checkedGeneratedStage(root,'work/mobile-package-check/run-new');
 const parent=resolve(marker,'..');mkdirSync(parent,{recursive:true});
 return checkedGeneratedStage(root,mkdtempSync(resolve(parent,'run-')));
}

export async function finishPackageCheckStage(root,stage,child,{keepStage=process.env.KEEP_STAGE==='1'}={}){
 if(child?.pid&&child.exitCode===null&&child.signalCode===null){
  await new Promise((done,fail)=>{
   const cleanup=()=>{clearTimeout(timer);child.off('exit',exited);child.off('error',errored);};
   const exited=()=>{cleanup();done();},errored=error=>{cleanup();fail(error);};
   const timer=setTimeout(()=>{cleanup();fail(Error('Test service did not exit; stage retained: '+stage));},10000);
   child.once('exit',exited);child.once('error',errored);child.kill();
  });
 }
 checkedGeneratedStage(root,stage);
 if(!keepStage)await removeGeneratedStage(root,stage);
 return {stageKept:keepStage};
}
