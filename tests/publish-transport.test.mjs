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

test('health headers accept only a strict host and forwarded protocol',()=>{
 const withHeaders=headers=>({...config,targets:[{...config.targets[0],healthHeaders:headers},config.targets[1]]});
 assert.deepEqual(validatePublishTransportConfig(withHeaders({host:'jigsawnook.online:443','x-forwarded-proto':'https'})).targets[0].healthHeaders,{Host:'jigsawnook.online:443','X-Forwarded-Proto':'https'});
 assert.equal(Object.hasOwn(validatePublishTransportConfig(config).targets[1],'healthHeaders'),false);
 for(const headers of [null,[],{Authorization:'fixture'},{Cookie:'fixture'},{constructor:'https'},{Host:'example.com\r\nCookie: fixture'},{Host:'bad host'},{Host:'https://example.com'},{Host:'-bad.example'},{Host:'example.com:65536'},{Host:'example.com',host:'second.example'},{'X-Forwarded-Proto':'https\r\nCookie: fixture'},{'X-Forwarded-Proto':'ftp'}])assert.throws(()=>validatePublishTransportConfig(withHeaders(headers)),{code:'INVALID_PUBLISH_CONFIG'});
});

test('optional local bind address accepts only literal IP addresses',()=>{
 assert.equal(Object.hasOwn(validatePublishTransportConfig(config),'bindAddress'),false);
 for(const bindAddress of ['10.0.0.195','::1'])assert.equal(validatePublishTransportConfig({...config,bindAddress}).bindAddress,bindAddress);
 for(const bindAddress of [null,42,'','ethernet','localhost','999.0.0.1','[::1]','10.0.0.195 -o ProxyCommand=example','10.0.0.195\nProxyCommand=example'])assert.throws(()=>validatePublishTransportConfig({...config,bindAddress}),{code:'INVALID_PUBLISH_CONFIG'});
});

test('SSH and SCP share the optional bind option while the default adds none',async t=>{
 const release=await fixture(t),receipt={schema:'jigsaw-content-publish-receipt/v1',releaseId:release.manifest.releaseId,ok:true,targets:[{id:'web',ok:true,contentReleaseId:release.manifest.releaseId},{id:'mobile',ok:true,contentReleaseId:release.manifest.releaseId}]};
 for(const bindAddress of [undefined,'10.0.0.195','::1']){
  const calls=[];
  await publishRelease(release,{...config,...(bindAddress?{bindAddress}:{})},{runProcess:async(command,args)=>{calls.push({command,args});return{code:0,stdout:command==='ssh'&&args.at(-1).startsWith('python3')?JSON.stringify(receipt):'',stderr:''};}});
  assert.deepEqual(calls.map(call=>call.command),['ssh','scp','ssh']);
  for(const call of calls){
   const options=call.args.filter(value=>value.startsWith('BindAddress='));
   assert.deepEqual(options,bindAddress?['BindAddress='+bindAddress]:[]);
   if(bindAddress)assert.equal(call.args[call.args.indexOf('BindAddress='+bindAddress)-1],'-o');
   assert.ok(call.args.includes('StrictHostKeyChecking=yes'));
  }
 }
});

test('transport uploads only declared public release files and requires both current-version receipts',async t=>{
 const release=await fixture(t),calls=[];let activationRequest;
 const withHeaders={...config,targets:[{...config.targets[0],healthHeaders:{Host:'jigsawnook.online','X-Forwarded-Proto':'https'}},config.targets[1]]};
 const receipt={schema:'jigsaw-content-publish-receipt/v1',releaseId:release.manifest.releaseId,ok:true,targets:[{id:'web',ok:true,contentReleaseId:release.manifest.releaseId},{id:'mobile',ok:true,contentReleaseId:release.manifest.releaseId}]};
 const result=await publishRelease(release,withHeaders,{runProcess:async(command,args)=>{calls.push({command,args});if(command==='scp')activationRequest=JSON.parse(await readFile(args.find(value=>value.endsWith('activation-request.json')),'utf8'));return {code:0,stdout:command==='ssh'&&args.at(-1).startsWith('python3')?JSON.stringify(receipt):'',stderr:''};}});
 assert.deepEqual(result,receipt);assert.deepEqual(calls.map(item=>item.command),['ssh','scp','ssh']);
 assert.deepEqual(activationRequest.targets[0].healthHeaders,withHeaders.targets[0].healthHeaders);assert.equal(Object.hasOwn(activationRequest.targets[1],'healthHeaders'),false);
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
