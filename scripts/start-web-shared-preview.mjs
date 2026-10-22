import {existsSync,mkdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {buildMobileShared} from './build-mobile-shared.mjs';

const root=resolve(import.meta.dirname,'..');process.chdir(root);
if(Number(process.versions.node.split('.')[0])<24)throw Error('Shared Web preview requires Node.js 24 or newer');
const port=Number(process.env.WEB_SHARED_PORT||3223),backend=Number(process.env.WEB_SHARED_BACKEND_PORT||3221);
if(![port,backend].every(value=>Number.isInteger(value)&&value>=1024&&value<=65535)||port===backend)throw Error('Choose two different local preview ports');
const localOrigin=value=>'http://127.0.0.1:'+value;
const available=port=>new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
await available(backend);await available(port);

// This preview never inherits a published release pointer or a live player DB.
const data=resolve('data/shared-web-preview');mkdirSync(data,{recursive:true});
const env={...process.env,H5_PORT:String(backend),H5_HOST:'127.0.0.1',
 H5_ALLOWED_ORIGINS:[localOrigin(backend),localOrigin(port),'http://localhost:'+port].join(','),
 H5_PUBLIC_API_BASE:'/h5',H5_PUBLIC_GAME_BASE:'/',H5_UPSTREAM:localOrigin(backend),H5_UPSTREAM_ORIGIN:localOrigin(backend),
 H5_SESSION_DB:resolve(data,'sessions.sqlite'),MOBILE_DB:resolve(data,'players.sqlite'),
 MOBILE_ASSET_DIR:resolve('public'),MOBILE_RUNTIME_PROFILE:'web',MOBILE_ALBUM_TARGET:'pc',
 MOBILE_DAILY_APPEARANCES:resolve(data,'daily-appearances'),H5_AD_ASSISTANCE_ENABLED:'false',H5_REWARDED_AD_UNIT:'',
 SHARED_PREVIEW_PORT:String(port),MOBILE_BACKEND_PORT:String(backend),SHARED_PREVIEW_OUTPUT:resolve('outputs/shared-desktop-web')};
for(const name of ['JIGSAW_CONTENT_DIR','MOBILE_DAILY_CONFIG','MOBILE_TASK_REWARDS_CONFIG','MOBILE_GAME_SETTINGS_CONFIG','MOBILE_ALBUMS_CONFIG'])delete env[name];
const admin=resolve('../content-admin/work');
for(const [name,path] of Object.entries({MOBILE_DAILY_CONFIG:'daily-bridge/configuration.json',MOBILE_TASK_REWARDS_CONFIG:'task-rewards/configuration.json',MOBILE_GAME_SETTINGS_CONFIG:'game-settings/configuration.json',MOBILE_ALBUMS_CONFIG:'albums/configuration.json'})){
 const file=resolve(admin,path);if(existsSync(file))env[name]=file;
}
if(!existsSync('outputs/mobile/engine.mjs')){
 const result=spawnSync(process.execPath,['scripts/build-mobile-server.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)throw Error('Could not prepare the shared game engine');
}
await buildMobileShared({platforms:['web'],prepareAssets:false,env:{...env,JIGSAW_SHARED_API_BASE:localOrigin(port)+'/h5',JIGSAW_SHARED_ASSET_BASE:localOrigin(port)+'/h5/assets',JIGSAW_SHARED_GAME_BASE:localOrigin(port)+'/'}});

const children=[];let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;for(const child of children)if(child.exitCode===null)child.kill();};
const run=script=>{const child=spawn(process.execPath,[script],{cwd:root,env,stdio:'inherit',windowsHide:true});children.push(child);child.once('error',error=>{console.error(error.message);process.exitCode=1;stop();});child.once('exit',code=>{if(!stopping){process.exitCode=code||1;stop();}});return child;};
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',stop);
run('server/h5-gateway.mjs');
let ready=false;
for(let attempt=0;attempt<50&&!stopping;attempt++){
 try{const response=await fetch(localOrigin(backend)+'/healthz',{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,100));
}
if(!ready){stop();throw Error('The isolated Web preview backend did not become ready');}
run('scripts/serve-mobile-shared.mjs');
console.log('Desktop preview uses isolated local guests and player progress: '+localOrigin(port)+'/');
console.log('Saved admin configuration is read only; this preview cannot publish content or migrate accounts.');
