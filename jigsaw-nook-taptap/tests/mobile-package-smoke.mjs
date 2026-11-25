import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {TAR} from '../scripts/release-files.mjs';
import {createPackageCheckStage,finishPackageCheckStage} from '../scripts/generated-stage.mjs';
const root=realpathSync(process.cwd()),keepStage=process.env.KEEP_STAGE==='1';
const archive=resolve('releases/jigsaw-nook-mobile-v3-server.tar.gz');
const listing=spawnSync(TAR,['-tf',archive],{encoding:'utf8',maxBuffer:2*1024*1024,windowsHide:true});assert.equal(listing.status,0);
const paths=listing.stdout.trim().split(/\r?\n/);assert.ok(paths.length>100);for(const name of paths){assert.ok(!name.startsWith('/')&&!name.includes('..')&&!name.includes('\\'));assert.ok(!/(?:^|\/)(?:\.env[^/]*|node_modules|data|backups)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key)$/i.test(name));}
const stage=createPackageCheckStage(root);let child;
try{
const unpacked=spawnSync(TAR,['-xf',archive,'-C',stage],{windowsHide:true});assert.equal(unpacked.status,0);
const manifest=JSON.parse(readFileSync(resolve(stage,'release.json'),'utf8'));assert.equal(manifest.backendMode,'mobile-v3-isolated');
for(const file of manifest.files){const path=resolve(stage,file.path);assert.ok(path.startsWith(stage+sep));const bytes=readFileSync(path);assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
const runtime=resolve(stage,'runtime');mkdirSync(runtime);
const env={...process.env,H5_PORT:'0',H5_HOST:'127.0.0.1',H5_ALLOWED_ORIGINS:'https://ma-h5-al.tapimg.com',H5_PUBLIC_API_BASE:'',H5_PUBLIC_GAME_BASE:'',H5_UPSTREAM:'http://127.0.0.1:1',H5_SESSION_DB:resolve(runtime,'session.sqlite'),MOBILE_DB:resolve(runtime,'mobile.sqlite'),MOBILE_ASSET_DIR:resolve(stage,'public'),H5_AD_ASSISTANCE_ENABLED:'false'};
child=spawn(process.execPath,['server/h5-gateway.mjs'],{cwd:stage,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',b=>log+=b.toString());
 const base=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Packaged service timeout '+log)),10000);child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);no(Error('Packaged service exited '+code+' '+log));});child.stdout.on('data',b=>{log+=b.toString();const match=/H5 preview: (http:\/\/127\.0\.0\.1:\d+)\//.exec(log);if(match){clearTimeout(timer);yes(match[1]);}});});
 const call=async(path,token,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:'https://ma-h5-al.tapimg.com','Content-Type':'application/json',...(token?{'X-Jigsaw-H5-Session':token}:{})},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,`${path} ${r.status}`);return r.json();};
 assert.equal((await call('/healthz')).mode,'mobile-v3-isolated');const session=await call('/h5/session',null,{});assert.equal((await call('/h5/api/mobile/profile',session.token)).energy,50);
 const room=await call('/h5/api/rooms',session.token,{mode:'random',pieces:48,visibility:'public',requestId:randomBytes(16).toString('hex')});assert.ok(room.room.id);const lobby=await call('/h5/api/lobby',session.token);assert.ok(lobby.rooms.some(r=>r.id===room.room.id));
 const preview=JSON.parse(readFileSync(resolve(stage,'h5/asset-manifest.json'),'utf8')).find(s=>s.includes('-thumbnail-'));const image=await fetch(base+'/h5/assets'+preview,{headers:{Origin:'https://ma-h5-al.tapimg.com'}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.ok((await image.arrayBuffer()).byteLength>100);
 assert.equal((await fetch(base+'/')).status,200);assert.equal(existsSync(resolve(stage,'node_modules')),false);
 console.log(JSON.stringify({passed:true,filesVerified:manifest.files.length,nodeModulesRequired:false,isolatedRoomCreated:true,localImageServed:true,stageKept:keepStage,...(keepStage?{extractedTo:stage}:{})},null,2));
}finally{await finishPackageCheckStage(root,stage,child,{keepStage});}
