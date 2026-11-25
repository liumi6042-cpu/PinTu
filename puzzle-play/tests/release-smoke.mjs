import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,mkdirSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {walk,runtimeAssets,TAR} from '../scripts/release-files.mjs';
import {isPublishedPlayable} from '../scripts/image-origin.mjs';
import {isolatedGet,assertSharedEntry} from './isolated-game-entry.mjs';

const freePort=async(start)=>{for(let port=start;port<start+40;port++){const taken=await new Promise(resolve=>{const probe=createServer();probe.once('error',()=>resolve(true));probe.once('listening',()=>probe.close(()=>resolve(false)));probe.listen(port,'127.0.0.1');});if(!taken)return port;}throw new Error('No free port near '+start);};
const project=fileURLToPath(new URL('..',import.meta.url));
const archive=resolve(project,'releases/latest.tar.gz');
const catalog=JSON.parse(readFileSync(resolve(project,'content/puzzle-catalog.json'),'utf8'));
const published=catalog.filter(isPublishedPlayable);
const expectedAssets=runtimeAssets(catalog,JSON.parse(readFileSync(resolve(project,'config/runtime-assets.json'),'utf8')));
const root=mkdtempSync(resolve(tmpdir(),'jigsaw-release-test-')),app=resolve(root,'app');mkdirSync(app);
let child,output='';
try{
  const unpack=spawnSync(TAR,['-xzf',archive,'-C',app],{windowsHide:true,encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const manifest=JSON.parse(readFileSync(resolve(app,'release.json'),'utf8'));
  assert.equal(manifest.app,'jigsaw-nook');assert.equal(manifest.publicPictures,published.length);
  assert.deepEqual(manifest.runtimeAssets,expectedAssets,'the release must contain every current and archived runtime asset');
  assert.deepEqual(walk(app),[...manifest.files.map(file=>file.path),'release.json'].sort());
  for(const file of manifest.files){const bytes=readFileSync(resolve(app,file.path));assert.equal(bytes.length,file.bytes,file.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
  assert.ok(!existsSync(resolve(app,'public')));assert.ok(!existsSync(resolve(app,'app')));
  // The disposable smoke server must not be capped by the public beta capacity.
  // Opening a public room takes a seat that lives 22s, and these HTTP suites open
  // one room per 厚涂/平涂 picture (each twice), so the demand grows every time the
  // gallery does. At the 24-seat default this suite started failing with 429 once
  // the catalogue reached 16 such pictures. The beta cap is a product limit for real
  // visitors, not something these tests mean to exercise.
const port=await freePort(3137);
  child=spawn(process.execPath,['server.js'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),VINEXT_TRUSTED_HOSTS:'jigsawnook.online',VINEXT_TRUST_PROXY:'1',PUZZLE_PUBLIC_ORIGIN:'https://jigsawnook.online',PUZZLE_BETA_CAPACITY:'200',DATABASE_PATH:resolve(root,'data/puzzle.sqlite'),MIGRATIONS_DIR:resolve(app,'drizzle')}});
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const get=isolatedGet('http://127.0.0.1:'+port,{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null)throw new Error(output);
    try{const response=await get('/api/health');if(response.ok){ready=true;break;}}catch{}
    await delay(200);
  }
  assert.ok(ready,output);
  for(const path of ['/','/gallery','/lobby','/help','/api/locale']){const response=await get(path);assert.equal(response.status,200,path);await response.arrayBuffer();}
  const sharedPage=await (await get('/play')).text();assert.ok(sharedPage.includes('id="game"'));assert.ok(sharedPage.includes('shared-game-host'));
  const sharedConfig=await (await get('/api/shared/config')).json();assert.equal(sharedConfig.identityMode,'web-cookie');assert.equal(sharedConfig.capabilities.energy,false);assert.ok(sharedConfig.uiBase.startsWith('/shared-client/'));
  for(const [path,lang] of [['/','en'],['/zh','zh-CN']]){
    const response=await get(path,false);assert.equal(response.status,200,path);
    assert.match(response.headers.get('x-robots-tag'),/^index, follow/);
    const html=await response.text();assert.ok(html.includes(`lang="${lang}"`)&&html.includes('web-home-hero')&&html.includes('href="/play"'),path);
  }
  for(const path of ['/lobby','/zh/lobby','/gallery','/zh/gallery','/albums','/tasks','/decorations','/personal','/personal/images','/achievements','/leaderboard','/courtyard','/wardrobe'])await assertSharedEntry(get,path);
  await assertSharedEntry(get,'/zh?invite=qa-code','/play?invite=qa-code');
  await assertSharedEntry(get,'/zh/lobby?invite=qa-code','/play?invite=qa-code');
  for(const path of ['/account','/account/security','/account/recover','/privacy','/terms','/feedback'])assert.equal((await get(path)).status,200,path);
  const post=async(body,cookie='')=>fetch('http://127.0.0.1:'+port+'/api/rooms',{method:'POST',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https',Origin:'https://jigsawnook.online','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  for(const imageId of ['seaside-native-v2','custom-'+'a'.repeat(32)]){
    const response=await post({visibility:'solo',imageId,pieces:108});assert.equal(response.status,410);assert.match((await response.json()).error,/独自拼图已下线/);
  }
  console.log('Legacy game entries lead to the shared UI; account services and retired solo creation policy remain intact.');
  const journey=spawnSync(process.execPath,[resolve(project,'tests/journey-node-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(journey.status,0,journey.stdout+journey.stderr);console.log(journey.stdout.trim());
  const cosmetics=spawnSync(process.execPath,[resolve(project,'tests/cosmetics-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(cosmetics.status,0,cosmetics.stdout+cosmetics.stderr);console.log(cosmetics.stdout.trim());
  const welcome=spawnSync(process.execPath,[resolve(project,'tests/welcome-gift-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(welcome.status,0,welcome.stdout+welcome.stderr);console.log(welcome.stdout.trim());
  const retention=spawnSync(process.execPath,[resolve(project,'tests/retention-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(retention.status,0,retention.stdout+retention.stderr);console.log(retention.stdout.trim());
  for(const path of ['/flower-garden/index.html','/courtyard/index.html']){
    const response=await get(path);assert.equal(response.status,200,path);
    const html=await response.text();assert.ok(html.includes('正在开发'),path);
    for(const tag of ['<iframe','<canvas','<footer','<button'])assert.ok(!html.includes(tag),path+' hides '+tag);
  }
  const creation=spawnSync(process.execPath,['--import',pathToFileURL(resolve(project,'tests/ts-register.mjs')).href,resolve(project,'tests/room-creation-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(creation.status,0,creation.stdout+creation.stderr);console.log(creation.stdout.trim());
  const access=spawnSync(process.execPath,['--import',pathToFileURL(resolve(project,'tests/ts-register.mjs')).href,resolve(project,'tests/access-assistance-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(access.status,0,access.stdout+access.stderr);console.log(access.stdout.trim());
  const chat=spawnSync(process.execPath,[resolve(project,'tests/room-chat-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(chat.status,0,chat.stdout+chat.stderr);console.log(chat.stdout.trim());
  const anime=spawnSync(process.execPath,[resolve(project,'tests/anime-gallery-http.mjs'),'http://127.0.0.1:'+port,resolve(root,'data/puzzle.sqlite')],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(anime.status,0,anime.stdout+anime.stderr);console.log(anime.stdout.trim());
  const painted=spawnSync(process.execPath,[resolve(project,'tests/painted-cel-gallery-http.mjs'),'http://127.0.0.1:'+port],{cwd:project,windowsHide:true,encoding:'utf8'});
  assert.equal(painted.status,0,painted.stdout+painted.stderr);console.log(painted.stdout.trim());
  for(const url of manifest.runtimeAssets){const response=await get(url);assert.equal(response.status,200,url);const bytes=Buffer.from(await response.arrayBuffer());const entry=manifest.files.find(file=>file.path==='dist/client'+url);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,url);}
  for(const path of ['/puzzles/emerald-river-valley.png','/.env','/README.md'])assert.equal((await get(path)).status,404,path);
  console.log(JSON.stringify({isolatedRuntime:true,files:manifest.files.length,assets:manifest.runtimeAssets.length,publicPictures:manifest.publicPictures,noProjectDependencies:true,originalsExcluded:true}));
}finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  const tempRoot=realpathSync(tmpdir());assert.ok(realpathSync(root).startsWith(tempRoot+sep));assert.ok(root.includes('jigsaw-release-test-'));
  rmSync(root,{recursive:true,force:true});
}
