import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {contentJsonBytes,contentSha256,contentValueDigest,readManagedRelease} from '../contracts/content-release.mjs';
import {publishRelease,validatePublishTransportConfig} from '../publish-transport.mjs';

const config={host:'fixture-production',remoteRoot:'/srv/sites/jigsaw-content',targets:[{id:'web',healthUrl:'http://127.0.0.1:3100/healthz',preflightCommand:['/usr/bin/node','/srv/web/check.mjs']},{id:'mobile',healthUrl:'http://127.0.0.1:3211/healthz',preflightCommand:['/usr/bin/node','/srv/mobile/check.mjs']}]};
async function fixture(t){
 const parent=resolve(import.meta.dirname,'../work');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'qa-publish-transport-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const releaseId='release-fixture',releaseDir=join(root,'releases',releaseId);await mkdir(releaseDir,{recursive:true});
 const files=[];
 for(const [path,schema] of [['albums.json','jigsaw-albums/v1'],['daily.json','jigsaw-daily-content/v2'],['game-settings.json','jigsaw-game-settings/v1'],['task-rewards.json','jigsaw-task-rewards/v1']]){
  const document={schema};document.configDigest=contentValueDigest(document);const data=contentJsonBytes(document);await writeFile(join(releaseDir,path),data);files.push({path,bytes:data.length,sha256:contentSha256(data)});
 }
 const manifest={schema:'jigsaw-managed-release/v1',releaseId,createdAt:'2026-10-13T10:00:00.000Z',sourceVersions:{draftId:'fixture',draftRevision:1,gameRevision:1,taskRevision:1},files};
 await writeFile(join(releaseDir,'manifest.json'),contentJsonBytes(manifest));
 return readManagedRelease(root,{releaseId,strict:true});
}

test('transport rejects arbitrary remote roots, shell-like hosts, remote health URLs and missing target preflights',()=>{
 assert.equal(validatePublishTransportConfig(config).targets.length,2);
 for(const value of [{...config,remoteRoot:'/srv/sites'}, {...config,host:'host; command'}, {...config,targets:[config.targets[0]]}, {...config,targets:[config.targets[0],{...config.targets[1],healthUrl:'https://example.com/healthz'}]}, {...config,targets:[config.targets[0],{...config.targets[1],preflightCommand:['node','script']}]}])assert.throws(()=>validatePublishTransportConfig(value),{code:'INVALID_PUBLISH_CONFIG'});
 assert.equal(validatePublishTransportConfig({...config,remoteRoot:'/srv/test-content'},{allowedRemoteRoots:['/srv/test-content']}).remoteRoot,'/srv/test-content');
});

test('transport uploads only declared public release files and requires both current-version receipts',async t=>{
 const release=await fixture(t),calls=[];
 const receipt={schema:'jigsaw-content-publish-receipt/v1',releaseId:release.manifest.releaseId,ok:true,targets:[{id:'web',ok:true,contentReleaseId:release.manifest.releaseId},{id:'mobile',ok:true,contentReleaseId:release.manifest.releaseId}]};
 const result=await publishRelease(release,config,{runProcess:async(command,args)=>{calls.push({command,args});return {code:0,stdout:command==='ssh'&&args.at(-1).startsWith('python3')?JSON.stringify(receipt):'',stderr:''};}});
 assert.deepEqual(result,receipt);assert.deepEqual(calls.map(item=>item.command),['ssh','scp','ssh']);
 const scp=calls[1].args;assert.equal(scp.includes('--'),true);assert.equal(scp.filter(value=>value.endsWith('.json')).length,6);
 assert.equal(scp.some(value=>value.endsWith('.sqlite')),false);assert.equal(scp.some(value=>value.includes('game.db')),false);
 assert.equal(calls.every(item=>item.args.includes('StrictHostKeyChecking=yes')),true);
});

test('changed local content is rejected before connecting; partial remote failure remains a structured error',async t=>{
 const release=await fixture(t);let calls=0;
 const receipt={schema:'jigsaw-content-publish-receipt/v1',releaseId:release.manifest.releaseId,ok:false,code:'PUBLISH_HEALTH_FAILED',message:'已恢复先前版本。',targets:[{id:'web',ok:true},{id:'mobile',ok:false}],rollback:{attempted:true,ok:true}};
 await assert.rejects(publishRelease(release,config,{runProcess:async(command,args)=>({code:command==='ssh'&&args.at(-1).startsWith('python3')?1:0,stdout:command==='ssh'&&args.at(-1).startsWith('python3')?JSON.stringify(receipt):''})}),error=>error.code==='PUBLISH_HEALTH_FAILED'&&error.receipt.rollback.ok);
 await writeFile(join(release.releaseDir,'albums.json'),'{}');
 await assert.rejects(publishRelease(release,config,{runProcess:async()=>{calls++;return {code:0,stdout:''};}}));
 assert.equal(calls,0);
});
