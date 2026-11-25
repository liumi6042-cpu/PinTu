import fs from 'node:fs';
import promises from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

const present=path=>{try{fs.lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const describe=error=>({name:error?.name??'Error',message:String(error?.message??error),...(error?.code?{code:error.code}:{})});

// No caller-supplied deletion paths: every owned directory comes from mkdtemp
// during this invocation. Never sweep old output folders or follow a junction.
export async function withReleaseCleanup(project,operation){
  const root=fs.realpathSync(project),id=Date.now()+'-'+randomUUID();
  const owned=[];
  const parent=name=>{
    const path=resolve(root,name),rel=relative(root,path);
    if(!rel||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Release output escapes project');
    let current=root;
    for(const part of rel.split(sep)){
      current=resolve(current,part);
      if(present(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Linked release output refused: '+current);
      fs.mkdirSync(current,{recursive:true});
    }
    return path;
  };
  const receipts=parent('work/release-cleanup');
  const receiptPath=resolve(receipts,id+'.json');
  const allocate=(role,folder,prefix)=>{
    const base=parent(folder),path=fs.mkdtempSync(resolve(base,prefix));
    owned.push({role,path,base});
    return path;
  };
  const attempt={
    buildDirectory:()=>resolve(allocate('build','work/release-build','package-'),'standalone'),
    sourceDirectory:()=>allocate('source','work/release-sources','build-'),
    stageDirectory:()=>allocate('stage','releases','staging-'),
  };
  let value,failure;
  try{value=await operation(attempt);}catch(error){failure=error;}
  const report={schema:'jigsaw-release-cleanup/v1',attemptId:id,createdAt:new Date().toISOString(),operation:failure?'failed':'completed',...(failure?{error:describe(failure)}:{}),directories:[],ok:true};
  // Cleanup failures must not stop later owned directories from being checked.
  for(const entry of [...owned].reverse()){
    const result={role:entry.role,path:entry.path,removed:false,remaining:true};
    try{
      if(present(entry.path)){
        if(fs.lstatSync(entry.path).isSymbolicLink()||fs.realpathSync(entry.base)!==entry.base||fs.realpathSync(entry.path)!==entry.path)throw new Error('Owned output path changed; cleanup refused');
        // Node 24.13 on this Windows host can silently leave non-ASCII paths
        // behind with rmSync. Await the standard asynchronous API and verify it.
        await promises.rm(entry.path,{recursive:true,force:true,maxRetries:2,retryDelay:100});
      }
      result.remaining=present(entry.path);
      result.removed=!result.remaining;
      if(result.remaining)result.error={name:'Error',message:'Cleanup returned but the owned directory still exists'};
    }catch(error){result.error=describe(error);try{result.remaining=present(entry.path);}catch{result.remaining=true;}}
    if(result.error||result.remaining)report.ok=false;
    report.directories.push(result);
  }
  report.residualPaths=report.directories.filter(item=>item.remaining).map(item=>item.path);
  try{fs.writeFileSync(receiptPath,JSON.stringify(report,null,2)+'\n');}
  catch(error){report.ok=false;report.receiptError=describe(error);}
  if(!report.ok){
    const cleanupError=new Error('Release cleanup incomplete; inspect '+receiptPath+'; remaining: '+(report.residualPaths.join(', ')||'none (receipt or cleanup error)'));
    if(failure)throw new AggregateError([failure,cleanupError],'Release failed and cleanup needs attention',{cause:failure});
    throw cleanupError;
  }
  if(failure)throw failure;
  return {value,cleanup:{ok:true,receiptPath,residualPaths:[]}};
}
