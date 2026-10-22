import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {contentJsonBytes,contentSha256,contentValueDigest,CONTENT_RELEASE_FILES} from '../server/content-release.mjs';
import {createMobileManagedContent} from '../server/mobile-managed-content.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
import {createManagedDailyContent} from '../server/managed-daily-content.mjs';
import {defaultGameSettings,buildGameConfiguration} from '../server/game-settings.mjs';
import {defaultTaskRewardSettings,buildTaskRewardConfiguration} from '../server/task-reward-settings.mjs';
import {RESTORABLE_PHOTOS,GALLERY_VISIBLE_PHOTOS,dailyPuzzle} from '../outputs/mobile/engine.mjs';

const work=resolve(import.meta.dirname,'../work'),owner='a'.repeat(64),requestId=()=>randomBytes(16).toString('hex'),sign=value=>({...value,configDigest:contentValueDigest(value)});
const ordinary=GALLERY_VISIBLE_PHOTOS[0],dailyPhotos=RESTORABLE_PHOTOS.filter(photo=>photo.dailyOnly).slice(0,2);assert.equal(dailyPhotos.length,2);
function docs(label){
 const second=label==='B',album={id:'runtime-album',title:label,description:label,imageIds:[ordinary.id,...dailyPhotos.map(photo=>photo.id)],coverImageId:ordinary.id,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]},{imageIds:_ids,coverImageId:_cover,...dailyAlbum}=album;
 const games=defaultGameSettings(),tasks=defaultTaskRewardSettings();games.energy.baseCap=second?80:50;games.energy.maximumCap=1000;games.collection.contributionCoins=second?7:2;tasks.invitationShare.coins=second?8:3;tasks.tasks[0].coins=second?18:13;
 return{albums:sign({schema:'jigsaw-albums/v1',albums:[album]}),daily:sign({schema:'jigsaw-daily-content/v2',timezone:'Asia/Shanghai',entries:['2026-10-13','2026-10-14'].map(date=>({date,imageId:dailyPhotos[second?1:0].id,albumId:album.id})),automaticCandidates:[],fallbackImageIds:[ordinary.id],albums:[dailyAlbum]}),gameSettings:buildGameConfiguration(games),taskRewards:buildTaskRewardConfiguration(tasks)};
}
function fixture(){
 mkdirSync(work,{recursive:true});const directory=mkdtempSync(join(work,'managed-runtime-test-')),publication=join(directory,'content'),databasePath=join(directory,'mobile.sqlite'),appearanceDir=join(directory,'persistent','daily-appearances');mkdirSync(join(publication,'releases'),{recursive:true});let now=Date.parse('2026-10-13T04:00:00Z'),service=null,db=null;
 const publish=(releaseId,documents)=>{const releaseDir=join(publication,'releases',releaseId);mkdirSync(releaseDir);const files=Object.entries(documents).map(([key,value])=>{const bytes=contentJsonBytes(value),path=CONTENT_RELEASE_FILES[key];writeFileSync(join(releaseDir,path),bytes);return{path,bytes:bytes.length,sha256:contentSha256(bytes)};}),manifest={schema:'jigsaw-managed-release/v1',releaseId,createdAt:'2026-10-13T12:00:00.000Z',sourceVersions:{draftId:'runtime-test',draftRevision:1,gameRevision:1,taskRevision:1},files},bytes=contentJsonBytes(manifest);writeFileSync(join(releaseDir,'manifest.json'),bytes);return{releaseId,manifestSha256:contentSha256(bytes)};};
 const a=publish('release-a',docs('A')),b=publish('release-b',docs('B')),point=release=>writeFileSync(join(publication,'current.json'),contentJsonBytes({schema:'jigsaw-content-pointer/v1',...release}));point(a);
 const reader=createMobileManagedContent({directory:publication,photos:RESTORABLE_PHOTOS});
 const start=extra=>{service=createMobileService({contentDirectory:publication,databasePath,dailyAppearanceDir:appearanceDir,deferDailyStart:true,now:()=>now,...extra});db=new DatabaseSync(databasePath);return service;};
 const call=(url,body,identity=owner)=>service.handle({identity,url,method:body===undefined?'GET':'POST',body});
 const ok=(url,body)=>{const result=call(url,body);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
 const databaseSnapshot=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+name).all()}));
 return{directory,publication,databasePath,appearanceDir,a,b,point,publish,reader,start,call,ok,databaseSnapshot,get now(){return now;},set now(value){now=value;},get db(){return db;},close(serviceAlreadyClosed=false){db?.close();if(service&&!serviceAlreadyClosed)service.close();assert.ok(directory.startsWith(work+sep));rmSync(directory,{recursive:true,force:true});}};
}

test('one handle pins albums, game, task and repeated daily calls; the next handle sees the new release without repricing paid receipts',()=>{
 const f=fixture();let reads=0,flip=false;
 try{
  f.start({managedContent:{read(){reads++;const snapshot=f.reader.read();if(flip){flip=false;f.point(f.b);}return snapshot;}}});reads=0;flip=true;
  const a=f.ok('/api/mobile/collection');assert.equal(reads,1,'repeated daily calls in collection view and profile summary share the handle snapshot');assert.equal(a.albums[0].title,'A');assert.equal(a.tuning.contributionCoins,2);assert.equal(a.profile.energyCap,50);assert.ok(!a.albums[0].images.some(photo=>photo.id===dailyPhotos[0].id));assert.ok(a.albums[0].images.some(photo=>photo.id===dailyPhotos[1].id));
  const b=f.ok('/api/mobile/collection');assert.equal(reads,2);assert.equal(b.albums[0].title,'B');assert.equal(b.tuning.contributionCoins,7);assert.equal(b.profile.energyCap,80);assert.ok(!b.albums[0].images.some(photo=>photo.id===dailyPhotos[1].id));assert.ok(b.albums[0].images.some(photo=>photo.id===dailyPhotos[0].id));
  f.point(f.a);flip=true;const input={requestId:requestId()},shared=f.ok('/api/mobile/invitations/share',input);assert.equal(reads,3);assert.equal(shared.shared.coins,3);assert.equal(shared.profile.energyCap-shared.profile.level,50,'share XP uses the same A growth/energy configuration');assert.equal(shared.tasks[0].coins,13);
  assert.deepEqual(f.ok('/api/mobile/invitations/share',input),shared,'an A reward replay retains its exact original snapshot after B is published');const next=f.ok('/api/mobile/invitations/share',{requestId:requestId()});assert.equal(next.shared.coins,8);assert.equal(next.profile.collection.coins,11);assert.equal(next.tasks[0].coins,18);
 }finally{f.close();}
});

test('a correctly signed but typed-invalid publication rejects before player, social-rate or reward writes',()=>{
 const f=fixture();try{
  f.start();f.ok('/api/mobile/profile');const before=f.databaseSnapshot(),bad=docs('B'),{configDigest:_digest,...games}=bad.gameSettings;games.energy.initial=games.energy.baseCap+1;bad.gameSettings=sign(games);f.point(f.publish('bad-typed',bad));
  for(const [url,body]of [['/api/mobile/social/search?code=123456789',undefined],['/api/mobile/invitations/share',{requestId:requestId()}]]){const result=f.call(url,body,'b'.repeat(64));assert.equal(result.status,503);assert.equal(result.data.code,'CONTENT_RELEASE_UNAVAILABLE');}
  assert.deepEqual(f.databaseSnapshot(),before,'no profile/social player/rate/ledger/request side effects occur');assert.equal(existsSync(f.appearanceDir),false,'invalid configuration cannot create a daily fact');
 }finally{f.close();}
});

test('existing health endpoint reads actual new release IDs and rejects corruption without player creation or path disclosure',async()=>{
 const f=fixture();let server;
 try{
  const service=f.start(),before=f.databaseSnapshot();server=createH5Gateway({upstream:'http://127.0.0.1:3216',allowedOrigins:['http://127.0.0.1:3216'],databasePath:':memory:',mobileService:service});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/healthz',appearance=join(f.appearanceDir,'2026-10-13.json'),startupFact=readFileSync(appearance,'utf8');
  for(const release of [f.a,f.b]){f.point(release);assert.deepEqual(service.contentStatus(),{contentReleaseId:release.releaseId});const response=await fetch(url),value=await response.json();assert.equal(response.status,200);assert.equal(value.contentReleaseId,release.releaseId);assert.deepEqual(Object.keys(value).sort(),['contentReleaseId','mode','ok','service']);assert.equal(JSON.stringify(value).includes(f.directory),false);}
  writeFileSync(join(f.publication,'current.json'),'broken');const failed=await fetch(url),value=await failed.json();assert.equal(failed.status,503);assert.equal(value.contentReleaseId,null);assert.equal(value.code,'CONTENT_RELEASE_UNAVAILABLE');assert.equal(JSON.stringify(value).includes(f.directory),false);assert.deepEqual(f.databaseSnapshot(),before);assert.equal(readFileSync(appearance,'utf8'),startupFact,'health checks do not rewrite the fact created by the normal startup daily tick');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close(!!server);}
});

test('request daily reads and the independent 30-second tick share durable facts while the next day uses the latest release',t=>{
 const f=fixture();let requestSnapshot,reads=0,timer,content;
 t.mock.method(globalThis,'setInterval',(callback,delay)=>{timer={callback,delay,unref(){}};return timer;});t.mock.method(globalThis,'clearInterval',()=>{});
 try{
  const a=f.reader.read();f.point(f.b);requestSnapshot=a;
  content=createManagedDailyContent({readSnapshot:()=>{if(requestSnapshot!==undefined)return requestSnapshot;reads++;return f.reader.read();},photos:RESTORABLE_PHOTOS,galleryPhotos:GALLERY_VISIBLE_PHOTOS,fallback:dailyPuzzle,appearanceDir:f.appearanceDir,now:()=>f.now});
  assert.equal(content.select(f.now).id,dailyPhotos[0].id,'an in-flight A request retains its own daily schedule');const path=join(f.appearanceDir,'2026-10-13.json'),original=readFileSync(path,'utf8');requestSnapshot=undefined;
  content.start();assert.equal(timer.delay,30000);assert.equal(reads,1);assert.equal(readFileSync(path,'utf8'),original,'publishing B does not rewrite today\'s recorded A appearance');timer.callback();assert.equal(reads,2);assert.equal(readFileSync(path,'utf8'),original);
  f.now=Date.parse('2026-10-14T04:00:00Z');timer.callback();assert.equal(reads,3);const next=JSON.parse(readFileSync(join(f.appearanceDir,'2026-10-14.json'),'utf8'));assert.equal(next.imageId,dailyPhotos[1].id);assert.equal(next.configDigest,docs('B').daily.configDigest);assert.equal(content.select(f.now).id,dailyPhotos[1].id);assert.equal(readFileSync(path,'utf8'),original);
 }finally{content?.close();f.close();}
});
