import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createPackageCheckStage,finishPackageCheckStage,removeGeneratedStage,resetGeneratedStage} from '../scripts/generated-stage.mjs';

function fixture(t){
 const base=resolve('work/generated-stage-tests');mkdirSync(base,{recursive:true});
 const root=realpathSync(mkdtempSync(resolve(base,'fixture-'))),links=[];
 t.after(async()=>{
  for(const path of links)if(existsSync(path)||(()=>{try{return lstatSync(path).isSymbolicLink();}catch{return false;}})())unlinkSync(path);
  assert.ok(root.startsWith(realpathSync(base)+sep));assert.equal(realpathSync(root),root);await rm(root,{recursive:true,force:true});
 });
 return {root,link:(target,path)=>{symlinkSync(target,path,process.platform==='win32'?'junction':'dir');links.push(path);}};
}

test('fixed generated stages replace stale files and reject source, parent and linked paths',async t=>{
 const {root,link}=fixture(t),stage=await resetGeneratedStage(root,'work/h5-shell-public');
 writeFileSync(resolve(stage,'stale.txt'),'old');await resetGeneratedStage(root,stage);assert.equal(existsSync(resolve(stage,'stale.txt')),false);
 const source=resolve(root,'source');mkdirSync(source);writeFileSync(resolve(source,'keep.txt'),'keep');
 for(const path of [root,'work','data','../outside','work/h5-shell-public/../source'])await assert.rejects(()=>resetGeneratedStage(root,path),/allowed generated stage/);
 const target=resolve(root,'work/h5-platform-zip');link(source,target);await assert.rejects(()=>resetGeneratedStage(root,target),/linked/);
 const nested=resolve(stage,'linked');link(source,nested);await assert.rejects(()=>removeGeneratedStage(root,stage),/link/);
 assert.equal(readFileSync(resolve(source,'keep.txt'),'utf8'),'keep');
});

test('package test stage cleanup waits for actual process exit, handles exited processes and removes failed setup',async t=>{
 const {root}=fixture(t),stage=createPackageCheckStage(root);
 writeFileSync(resolve(stage,'fixture.sqlite'),'synthetic');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:stage,windowsHide:true,stdio:'ignore'});
 await finishPackageCheckStage(root,stage,child,{keepStage:false});
 assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(existsSync(stage),false);
 const exitedStage=createPackageCheckStage(root),exited=spawn(process.execPath,['-e',''],{cwd:exitedStage,windowsHide:true,stdio:'ignore'});
 await once(exited,'exit');await finishPackageCheckStage(root,exitedStage,exited,{keepStage:false});assert.equal(existsSync(exitedStage),false);
 const failedStage=createPackageCheckStage(root);await finishPackageCheckStage(root,failedStage,undefined,{keepStage:false});assert.equal(existsSync(failedStage),false);
});

test('explicit KEEP_STAGE preservation retains only the owned stage and rejects a linked work parent',async t=>{
 const {root,link}=fixture(t),stage=createPackageCheckStage(root);
 assert.deepEqual(await finishPackageCheckStage(root,stage,undefined,{keepStage:true}),{stageKept:true});assert.equal(existsSync(stage),true);
 await removeGeneratedStage(root,stage);
 const other=resolve(root,'other');mkdirSync(other);const work=resolve(root,'work');assert.equal(realpathSync(work),work);assert.ok(work.startsWith(root+sep));await rm(work,{recursive:true,force:true});link(other,work);
 assert.throws(()=>createPackageCheckStage(root),/linked/);assert.equal(existsSync(resolve(other,'mobile-package-check')),false);
});
