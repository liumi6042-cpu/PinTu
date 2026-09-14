import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,mkdirSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {walk} from '../scripts/release-files.mjs';

const project=fileURLToPath(new URL('..',import.meta.url));
const archive=resolve(project,'releases/latest.tar.gz');
const published=JSON.parse(readFileSync(resolve(project,'content/puzzle-catalog.json'),'utf8')).filter(photo=>photo.status==='published');
const root=mkdtempSync(resolve(tmpdir(),'jigsaw-release-test-')),app=resolve(root,'app');mkdirSync(app);
let child,output='';
try{
  const unpack=spawnSync('tar',['-xzf',archive,'-C',app],{windowsHide:true,encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const manifest=JSON.parse(readFileSync(resolve(app,'release.json'),'utf8'));
  assert.equal(manifest.app,'jigsaw-nook');assert.equal(manifest.publicPictures,published.length);
  assert.deepEqual(walk(app),[...manifest.files.map(file=>file.path),'release.json'].sort());
  for(const file of manifest.files){const bytes=readFileSync(resolve(app,file.path));assert.equal(bytes.length,file.bytes,file.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
  assert.ok(!existsSync(resolve(app,'public')));assert.ok(!existsSync(resolve(app,'app')));
  child=spawn(process.execPath,['server.js'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'3137',VINEXT_TRUSTED_HOSTS:'jigsawnook.online',VINEXT_TRUST_PROXY:'1',PUZZLE_PUBLIC_ORIGIN:'https://jigsawnook.online',DATABASE_PATH:resolve(root,'data/puzzle.sqlite'),MIGRATIONS_DIR:resolve(app,'drizzle')}});
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const get=path=>fetch('http://127.0.0.1:3137'+path,{headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'},signal:AbortSignal.timeout(5000)});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null)throw new Error(output);
    try{const response=await get('/api/health');if(response.ok){ready=true;break;}}catch{}
    await delay(200);
  }
  assert.ok(ready,output);
  for(const path of ['/','/gallery','/lobby','/help','/api/locale']){const response=await get(path);assert.equal(response.status,200,path);await response.arrayBuffer();}
  const gallery=await (await get('/gallery')).text();for(const photo of published)assert.ok(gallery.includes(photo.id),photo.id);
  assert.equal((gallery.match(/type="radio"/g)||[]).length,6);
  for(const count of [108,300,500,1000,2000,5000])assert.ok(gallery.includes('value="'+count+'"'));
  for(const removed of ['class="picture-guidance"','class="picture-advice"','class="detail-note"','gallery-picture-details','About this puzzle'])assert.ok(!gallery.includes(removed),removed);
  for(const photo of published)assert.ok(gallery.includes('href="/puzzle/'+photo.id+'"'),photo.id);
  const creation=spawnSync(process.execPath,['--import',pathToFileURL(resolve(project,'tests/ts-register.mjs')).href,resolve(project,'tests/room-creation-http.mjs'),'http://127.0.0.1:3137'],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(creation.status,0,creation.stdout+creation.stderr);console.log(creation.stdout.trim());
  const chat=spawnSync(process.execPath,[resolve(project,'tests/room-chat-http.mjs'),'http://127.0.0.1:3137',resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(chat.status,0,chat.stdout+chat.stderr);console.log(chat.stdout.trim());
  for(const url of manifest.runtimeAssets){const response=await get(url);assert.equal(response.status,200,url);const bytes=Buffer.from(await response.arrayBuffer());const entry=manifest.files.find(file=>file.path==='dist/client'+url);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,url);}
  for(const path of ['/puzzles/emerald-river-valley.png','/.env','/README.md'])assert.equal((await get(path)).status,404,path);
  console.log(JSON.stringify({isolatedRuntime:true,files:manifest.files.length,assets:manifest.runtimeAssets.length,publicPictures:manifest.publicPictures,noProjectDependencies:true,originalsExcluded:true}));
}finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  const tempRoot=realpathSync(tmpdir());assert.ok(realpathSync(root).startsWith(tempRoot+sep));assert.ok(root.includes('jigsaw-release-test-'));
  rmSync(root,{recursive:true,force:true});
}
