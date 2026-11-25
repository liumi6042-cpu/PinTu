import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// TapTap v53.3 and older break on WebViews before Chrome 93 (Array.prototype.at in solo-local drops, Object.hasOwn in
// WebSocket action replies; 2026-11-02). The real gateway entry turns solo-local play off in /config for such a
// User-Agent, logs each distinct User-Agent once an hour, and MOBILE_LEGACY_WEBVIEW=off stops the gate.
const ORIGIN='https://ma-h5-al.tapimg.com';
const OLD='Mozilla/5.0 (Linux; Android 10; ABR-AL00 Build/ABR-AL00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/88.0.4324.93 Mobile Safari/537.36';
const NEW='Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36';
const HARMONY='Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 Mobile Safari/537.36';
async function gateway(extraEnv={}){
 const stage=mkdtempSync(resolve(tmpdir(),'jigsaw-legacy-webview-'));
 const env={...process.env,H5_PORT:'0',H5_HOST:'127.0.0.1',H5_UPSTREAM:'http://127.0.0.1:1',H5_ALLOWED_ORIGINS:ORIGIN,H5_SESSION_DB:resolve(stage,'sessions.sqlite'),MOBILE_DB:resolve(stage,'mobile.sqlite'),MOBILE_DAILY_APPEARANCES:resolve(stage,'appearances'),H5_AD_ASSISTANCE_ENABLED:'false',...extraEnv};
 for(const name of ['MOBILE_DAILY_CONFIG','JIGSAW_CONTENT_DIR','MOBILE_GAME_SETTINGS_CONFIG','MOBILE_TASK_REWARDS_CONFIG','MOBILE_ALBUMS_CONFIG','MOBILE_RUNTIME_PROFILE',...['MOBILE_LEGACY_WEBVIEW','MOBILE_LEGACY_UA_TOKENS'].filter(name=>extraEnv[name]===undefined)])delete env[name];
 const child=spawn(process.execPath,['server/h5-gateway.mjs'],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('gateway startup timeout '+log)),30000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('gateway exit '+code+' '+log));});child.stderr.on('data',bytes=>log+=bytes);child.stdout.on('data',bytes=>{log+=bytes;const match=/H5 preview: (http:\/\/127\.0\.0\.1:\d+)\//.exec(log);if(match){clearTimeout(timer);resolve(match[1]+'/h5');}});});
 const config=async ua=>{const response=await fetch(base+'/config',{headers:{Origin:ORIGIN,'User-Agent':ua}});assert.equal(response.status,200);return (await response.json()).capabilities;};
 const close=async()=>{if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:200});};
 return {config,close,log:()=>log};
}

test('an old WebView gets solo-local play off in /config; others keep it; each User-Agent is logged once',async()=>{
 const g=await gateway();
 try{
  assert.equal((await g.config(NEW)).soloLocalPlay,true);
  assert.equal((await g.config(OLD)).soloLocalPlay,false);
  assert.equal((await g.config(HARMONY)).soloLocalPlay,false,'HarmonyOS/HUAWEI tokens count as old');
  assert.equal((await g.config('')).soloLocalPlay,true,'no User-Agent: unchanged');
  await g.config(OLD);await g.config(OLD);
  const lines=g.log().split('\n').filter(line=>line.includes('"client_ua"')).map(line=>JSON.parse(line));
  assert.equal(lines.filter(line=>line.ua===OLD).length,1,'one line per distinct User-Agent and hour');
  assert.deepEqual(lines.find(line=>line.ua===OLD),{event:'client_ua',kind:'config',legacy:true,probe:false,ua:OLD});
 }finally{await g.close();}
});

test('MOBILE_LEGACY_WEBVIEW=off stops the gate; MOBILE_LEGACY_UA_TOKENS empty leaves only the Chrome version rule',async()=>{
 const off=await gateway({MOBILE_LEGACY_WEBVIEW:'off'});
 try{assert.equal((await off.config(OLD)).soloLocalPlay,true);assert.match(off.log(),/"legacy":false/);}finally{await off.close();}
 const versionOnly=await gateway({MOBILE_LEGACY_UA_TOKENS:''});
 try{assert.equal((await versionOnly.config(HARMONY)).soloLocalPlay,true);assert.equal((await versionOnly.config(OLD)).soloLocalPlay,false);}finally{await versionOnly.close();}
});
