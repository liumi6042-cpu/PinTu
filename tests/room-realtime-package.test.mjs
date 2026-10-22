import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';

test('bundled mobile realtime starts and subscribes outside the project without node_modules',async()=>{
 const root=process.cwd(),stage=mkdtempSync(resolve(tmpdir(),'jigsaw-ws-runtime-')),copied=new Set();let child,ws;
 const copy=path=>{const source=resolve(root,path);if(copied.has(source))return;copied.add(source);const destination=resolve(stage,relative(root,source));assert.ok(destination.startsWith(stage));mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination);if(source.endsWith('.mjs')){const text=readFileSync(source,'utf8');for(const match of text.matchAll(/\b(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g))copy(relative(root,resolve(dirname(source),match[1])));}};
 try{
  copy('server/h5-gateway.mjs');mkdirSync(resolve(stage,'h5'),{recursive:true});writeFileSync(resolve(stage,'h5/asset-manifest.json'),'[]');
  assert.equal(existsSync(resolve(stage,'node_modules')),false);assert.ok(copied.has(resolve(root,'outputs/mobile/room-realtime.mjs')));
  const env={...process.env,H5_PORT:'0',H5_HOST:'127.0.0.1',H5_UPSTREAM:'http://127.0.0.1:1',H5_ALLOWED_ORIGINS:'https://ma-h5-al.tapimg.com',H5_SESSION_DB:resolve(stage,'runtime/sessions.sqlite'),MOBILE_DB:resolve(stage,'runtime/mobile.sqlite'),H5_AD_ASSISTANCE_ENABLED:'false'};
  for(const name of ['MOBILE_DAILY_CONFIG','JIGSAW_CONTENT_DIR','MOBILE_GAME_SETTINGS_CONFIG','MOBILE_TASK_REWARDS_CONFIG','MOBILE_ALBUMS_CONFIG'])delete env[name];
  child=spawn(process.execPath,['server/h5-gateway.mjs'],{cwd:stage,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Isolated bundled startup timeout '+log)),5000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Isolated bundled runtime exit '+code+' '+log));});child.stderr.on('data',bytes=>log+=bytes);child.stdout.on('data',bytes=>{log+=bytes;const match=/H5 preview: (http:\/\/127\.0\.0\.1:\d+)\//.exec(log);if(match){clearTimeout(timer);resolve(match[1]);}});});
  const call=async(path,session,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:'https://ma-h5-al.tapimg.com','Content-Type':'application/json',...(session?{'X-Jigsaw-H5-Session':session}:{})},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,path+' '+response.status);return response.json();};
  assert.deepEqual((await call('/h5/config')).realtime,{version:1});const session=await call('/h5/session',null,{}),ticket=await call('/h5/api/rooms',session.token,{mode:'random',pieces:48,visibility:'public',requestId:randomBytes(16).toString('hex')});
  ws=new WebSocket(base.replace('http:','ws:')+'/h5/realtime',{headers:{Origin:'https://ma-h5-al.tapimg.com'}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Bundled WS subscribe timeout')),3000);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'subscribe',roomId:ticket.room.id,token:ticket.token,session:session.token})));ws.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='error')reject(Error(message.error));if(message.type==='room'){assert.equal(message.data.id,ticket.room.id);clearTimeout(timer);resolve();}});});
  console.log(JSON.stringify({runtimeFiles:copied.size,nodeModulesRequired:false,bundledBytes:readFileSync(resolve(stage,'outputs/mobile/room-realtime.mjs')).length,realWebSocketSubscribed:true}));
 }finally{
  ws?.terminate();if(child?.exitCode===null&&child?.signalCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
  await rm(stage,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
});
