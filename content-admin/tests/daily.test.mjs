
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {readSource} from '../source.mjs';
import {validateDraft} from '../model.mjs';
import {createStore} from '../store.mjs';
import {assertDailyPlanChanges,beijingDate,buildDailyConfiguration,configurationDigest,createDailyCoordinator,dailyReadiness,resolveAutomaticDailyDates,writeDailyConfiguration} from '../daily.mjs';
import {createAdminServer} from '../server.mjs';
const source=readSource(),copy=value=>structuredClone(value);
const dailyImage=source.assets.find(asset=>asset.lifecycle==='retained'&&asset.targets['mobile-shared'].dailyOnly).id;
const secondImage=source.assets.find(asset=>asset.lifecycle==='retained'&&!asset.targets['mobile-shared'].dailyOnly).id;
const thirdImage=source.assets.find(asset=>asset.lifecycle==='retained'&&![dailyImage,secondImage].includes(asset.id)).id;
const emptyAlbum=id=>({id,title:'预选相册',description:'保持设置',imageIds:[],coverImageId:null,styleGroupId:null,showOnPc:false,showOnMobile:false,purchasable:false,price:0,decorationId:null,milestones:[]});
const plan=(imageId=dailyImage,date='2030-05-02',albumId='daily-destination')=>({id:imageId,imageId,date,albumId});
const automatic=(imageId=dailyImage)=>({...plan(imageId,null),autoPublish:true});
function document(){const draft=copy(source.baseline);draft.albums.push(emptyAlbum('daily-destination'),emptyAlbum('daily-origin'));return draft;}
function fixture(t){
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'jigsaw-daily-test-')),store=createStore(join(root,'admin'),source),bridgeDir=join(root,'bridge'),appearanceDir=join(root,'appearances');
 let at=Date.parse('2030-05-01T12:00:00+08:00'),currentSource=source;
 const coordinator=createDailyCoordinator({store,getSource:()=>currentSource,validateDocument:validateDraft,bridgeDir,appearanceDir,now:()=>at});
 t.after(()=>{store.close();const exact=realpathSync(root);assert.equal(dirname(exact),parent);assert.match(basename(exact),/^jigsaw-daily-test-/);rmSync(exact,{recursive:true});});
 return {root,store,bridgeDir,appearanceDir,coordinator,setNow:value=>at=Date.parse(value),setSource:value=>currentSource=value,
 save(value,raw=false){const current=store.draft(store.activeDraftId());return store.saveDraft(current.id,current.revision,raw?value:validateDraft(value,source),'test');},
 configuration(){return JSON.parse(readFileSync(join(bridgeDir,'configuration.json'),'utf8'));},
 receipt(value={}){mkdirSync(appearanceDir,{recursive:true});const cfg=this.configuration(),kind=value.source??'scheduled',entry=kind==='automatic'?cfg.automaticCandidates[0]:cfg.entries[0];
 const fact={schema:'jigsaw-daily-appearance/v2',target:'mobile-shared',date:beijingDate(at),imageId:entry?.imageId,albumId:kind==='library'?null:entry?.albumId,activatedAt:at,configDigest:cfg.configDigest,planned:kind!=='library',source:kind,...value};writeFileSync(join(appearanceDir,fact.date+'.json'),JSON.stringify(fact));return fact;}
 };
}
test('undated automatic candidates coexist with manual dates and legacy reservations migrate',()=>{
 const draft=document();draft.dailyPlans=[automatic(),automatic(secondImage),plan(thirdImage)];
 assert.deepEqual(validateDraft(draft,source).dailyPlans,draft.dailyPlans);
 assert.deepEqual(resolveAutomaticDailyDates({...draft,dailyPlans:[{...plan(),autoDate:true},{...plan(secondImage,null),autoDate:true},plan(thirdImage)]}).dailyPlans,draft.dailyPlans);
 assert.doesNotThrow(()=>assertDailyPlanChanges(document(),draft,[],Date.parse('2030-05-01T12:00:00+08:00')));
 for(const invalid of [null,[plan(dailyImage,'2030-02-29')],[plan(),plan(secondImage)],[automatic(),automatic()],[plan('not-an-image')],[plan(dailyImage,'2030-05-02','missing-album')],[{...automatic(),date:'2030-05-02'}],[{...automatic(),autoPublish:'true'}]])
 assert.throws(()=>validateDraft({...draft,dailyPlans:invalid},source),error=>error.code==='INVALID_DRAFT');
 assert.throws(()=>assertDailyPlanChanges(document(),{...draft,dailyPlans:[plan(dailyImage,'2030-05-01')]},[],Date.parse('2030-05-01T12:00:00+08:00')),error=>error.code==='DAILY_PLAN_DATE_PAST');
});
test('v2 bridge fallback includes mobile-visible archived and purchase albums; omits PC-only, hidden, pending and unassigned',()=>{
 const draft=document(),archived=source.assets.find(asset=>asset.targets['mobile-shared'].status==='archived');
 const pending=source.assets.find(asset=>asset.lifecycle==='pending')??source.assets.find(asset=>asset.lifecycle==='retained'&&![dailyImage,secondImage,thirdImage,archived.id].includes(asset.id));
 const pcOnlyImage=source.assets.find(asset=>asset.lifecycle==='retained'&&![dailyImage,secondImage,thirdImage,archived.id,pending.id].includes(asset.id)).id;
 const destination=draft.albums.find(album=>album.id==='daily-destination'),pcOnly=draft.albums.find(album=>album.id==='daily-origin');
 const testSource=Object.defineProperty({...source,assets:source.assets.map(asset=>asset.id===pending.id?{...asset,runtimeAvailable:false}:asset)},'_private',{value:source._private});
 destination.showOnMobile=true;destination.purchasable=true;destination.price=250;destination.imageIds=[archived.id];destination.coverImageId=archived.id;
 pcOnly.showOnPc=true;pcOnly.showOnMobile=false;pcOnly.imageIds=[pcOnlyImage];pcOnly.coverImageId=pcOnlyImage;
 for(const album of draft.albums)if(![destination.id,pcOnly.id].includes(album.id)){album.imageIds=album.imageIds.filter(id=>![archived.id,pcOnlyImage,thirdImage].includes(id));if(!album.imageIds.includes(album.coverImageId))album.coverImageId=album.imageIds[0]??null;}
 draft.dailyPlans=[plan(),automatic(secondImage),plan(pending.id,'2030-05-03')];
 const validated=validateDraft(draft,testSource),cfg=buildDailyConfiguration(validated,testSource);
 assert.equal(cfg.schema,'jigsaw-daily-content/v2');assert.equal(configurationDigest(cfg),cfg.configDigest);
 assert.deepEqual(cfg.entries,[{date:'2030-05-02',imageId:dailyImage,albumId:destination.id}]);assert.deepEqual(cfg.automaticCandidates,[{imageId:secondImage,albumId:destination.id}]);
 assert.equal(cfg.fallbackImageIds.includes(archived.id),true);assert.equal(cfg.fallbackImageIds.includes(pcOnlyImage),false);assert.equal(cfg.fallbackImageIds.includes(thirdImage),false);assert.equal(cfg.fallbackImageIds.includes(pending.id),false);
 assert.equal(dailyReadiness(validated,testSource)[0].ready,true);assert.equal(dailyReadiness(validated,testSource)[2].ready,false);assert.equal(cfg.albums[0].purchasable,true);assert.equal(cfg.albums[0].showOnMobile,true);
 for(const forbidden of ['sourceFingerprint','_private','password','salt','src','rightsStatement','sourceDescription','imageIds'])assert.equal(Object.hasOwn(cfg,forbidden),false);
});
test('story-level, ad-unlock and mobile-hidden albums keep their pictures out of the daily fallback pool',()=>{
 const draft=document(),level={...emptyAlbum('shiguang-ch9'),showOnMobile:true};draft.albums.push(level);
 for(const album of draft.albums){album.imageIds=album.imageIds.filter(id=>id!==thirdImage);if(!album.imageIds.includes(album.coverImageId))album.coverImageId=album.imageIds[0]??null;}
 level.imageIds=[thirdImage];level.coverImageId=thirdImage;
 const before=buildDailyConfiguration(validateDraft(draft,source),source);
 assert.equal(before.fallbackImageIds.includes(thirdImage),false);assert.ok(before.fallbackImageIds.length>0);
 level.id='story-extra';assert.equal(buildDailyConfiguration(validateDraft(draft,source),source).fallbackImageIds.includes(thirdImage),true);
 level.showOnMobile=false;assert.equal(buildDailyConfiguration(validateDraft(draft,source),source).fallbackImageIds.includes(thirdImage),false);
 level.showOnMobile=true;level.id='healing-time';
 const existingHealing=draft.albums.find(album=>album.id==='healing-time'&&album!==level);
 if(existingHealing){existingHealing.showOnMobile=true;existingHealing.imageIds=[...existingHealing.imageIds,thirdImage];draft.albums=draft.albums.filter(album=>album!==level);}
 assert.equal(buildDailyConfiguration(validateDraft(draft,source),source).fallbackImageIds.includes(thirdImage),false);
});
test('automatic receipt freezes undated mode and enrolls once next Beijing day with CAS and no metadata loss',t=>{
 const f=fixture(t),draft=document();draft.dailyPlans=[automatic()];const origin=draft.albums.find(album=>album.id==='daily-origin');origin.imageIds=[dailyImage];origin.coverImageId=dailyImage;
 f.save(draft);f.coordinator.sync();const before=f.store.draft(f.store.activeDraftId());
 f.setNow('2030-05-04T10:00:00+08:00');f.receipt({source:'automatic'});let status=f.coordinator.sync();
 assert.equal(status.appearances[0].date,'2030-05-04');assert.equal(status.appearances[0].source,'automatic');assert.equal(status.appearances[0].planned,true);assert.equal(status.enrollments.length,0);
 assert.deepEqual(f.store.dailyFrozenPlans(),[automatic()]);assert.deepEqual(f.store.draft(before.id).document.dailyPlans,[automatic()]);
 assert.throws(()=>f.coordinator.assertChanges(draft,{...draft,dailyPlans:[]}),error=>error.code==='DAILY_PLAN_LOCKED');
 assert.throws(()=>f.coordinator.assertChanges(draft,{...draft,dailyPlans:[plan(dailyImage,'2030-05-04')]}),error=>error.code==='DAILY_PLAN_LOCKED');
 f.setNow('2030-05-04T23:59:59.999+08:00');f.coordinator.sync();assert.equal(f.store.dailyEnrollments().length,0);
 f.setNow('2030-05-05T00:00:00+08:00');status=f.coordinator.sync();const after=f.store.draft(before.id),target=after.document.albums.find(album=>album.id==='daily-destination');
 assert.deepEqual(target.imageIds,[dailyImage]);assert.equal(target.coverImageId,dailyImage);assert.equal(status.enrollments[0].firstAppearanceDate,'2030-05-04');
 assert.deepEqual(after.document.albums.find(album=>album.id===origin.id).imageIds,[]);assert.deepEqual(after.document.assets,before.document.assets);assert.deepEqual(after.document.styles,before.document.styles);
 assert.equal(after.revision,before.revision+1);assert.throws(()=>f.store.saveDraft(before.id,before.revision,before.document,'stale-tab'),error=>error.code==='REVISION_CONFLICT');
 const manual=copy(after.document);manual.albums.find(album=>album.id===target.id).imageIds=[];manual.albums.find(album=>album.id===target.id).coverImageId=null;manual.albums.find(album=>album.id===origin.id).imageIds=[dailyImage];manual.albums.find(album=>album.id===origin.id).coverImageId=dailyImage;
 f.save(manual);const revision=f.store.draft(before.id).revision;f.coordinator.sync();f.coordinator.sync();assert.equal(f.store.draft(before.id).revision,revision);assert.equal(f.store.dailyEnrollments().length,1);
});
test('repeated library appearances record publication history without fabricating plans or enrollment',t=>{
 const f=fixture(t),draft=document();f.save(draft);f.coordinator.sync();const imageId=f.configuration().fallbackImageIds[0],before=f.store.draft(f.store.activeDraftId());
 f.receipt({source:'library',imageId});f.coordinator.sync();f.setNow('2030-05-02T10:00:00+08:00');f.receipt({source:'library',imageId});const status=f.coordinator.sync();
 assert.equal(status.appearances.length,2);assert.equal(status.appearances.every(fact=>fact.albumId===null&&fact.planned===false&&fact.source==='library'),true);
 assert.deepEqual(f.store.dailyFrozenPlans(),[]);assert.deepEqual(f.store.dailyEnrollments(),[]);assert.deepEqual(f.store.draft(before.id).document,before.document);assert.equal(f.store.draft(before.id).revision,before.revision);
 const next=copy(draft);next.dailyPlans=[automatic(imageId)];assert.doesNotThrow(()=>f.coordinator.assertChanges(draft,next));f.save(next);f.coordinator.sync();assert.equal(f.configuration().automaticCandidates[0].imageId,imageId);
});
test('trusted old v1 snapshots preserve actual days and automatic mode; invalid facts and source drift do not enroll',t=>{
 const f=fixture(t),legacy=document();legacy.dailyPlans=[{...plan(),autoDate:true}];f.save(legacy,true);
 const v1={schema:'jigsaw-daily-content/v1',timezone:'Asia/Shanghai',entries:[{date:'2030-05-02',imageId:dailyImage,albumId:'daily-destination'}],albums:[emptyAlbum('daily-destination')]};
 const cfg={...v1,configDigest:configurationDigest(v1)};writeDailyConfiguration(f.bridgeDir,cfg);
 f.setNow('2030-05-02T10:00:00+08:00');mkdirSync(f.appearanceDir,{recursive:true});const file=join(f.appearanceDir,'2030-05-02.json'),fact={schema:'jigsaw-daily-appearance/v1',target:'mobile-shared',date:'2030-05-02',imageId:dailyImage,albumId:'daily-destination',activatedAt:Date.parse('2030-05-02T10:00:00+08:00'),configDigest:cfg.configDigest,planned:true};
 writeFileSync(file,JSON.stringify({...fact,configDigest:'a'.repeat(64)}));f.coordinator.sync();assert.equal(f.store.dailyAppearances().length,0);
 writeFileSync(file,JSON.stringify(fact));f.setSource({...source,fingerprint:'changed-source'});assert.equal(f.coordinator.sync().readiness[0].ready,false);assert.equal(f.store.dailyAppearances().length,0);
 f.setSource(source);f.coordinator.sync();assert.deepEqual(f.store.dailyFrozenPlans(),[automatic()]);assert.deepEqual(f.store.draft(f.store.activeDraftId()).document.dailyPlans,[automatic()]);
 unlinkSync(file);f.setNow('2030-05-03T00:00:00+08:00');f.coordinator.sync();assert.equal(f.store.dailyEnrollments()[0].firstAppearanceDate,'2030-05-02');
});
test('daily status authenticated; auto null dates save with manual dates and frozen restore is rejected',{timeout:30000},async t=>{
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'jigsaw-daily-test-'));let at=Date.parse('2030-05-01T12:00:00+08:00');
 const app=createAdminServer({source,dataDir:join(root,'admin'),bridgeDir:join(root,'bridge'),appearanceDir:join(root,'appearances'),now:()=>at});
 t.after(async()=>{await app.close();const exact=realpathSync(root);assert.equal(dirname(exact),parent);assert.match(basename(exact),/^jigsaw-daily-test-/);rmSync(exact,{recursive:true});});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(path,method='GET',body){const headers={cookie};if(body)Object.assign(headers,{'content-type':'application/json',origin,'x-csrf-token':csrf});const response=await fetch(origin+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:response.status,payload:await response.json(),response};}
 assert.equal((await request('/api/daily/status')).status,401);const setup=await request('/api/setup','POST',{username:'daily-test',password:'Daily-fixture-password-123'});assert.equal(setup.status,200);
 cookie=setup.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');csrf=setup.payload.csrfToken||(await request('/api/session')).payload.csrfToken;
 const current=app.store.draft(app.store.activeDraftId()),draft=document(),version=app.store.publish(current,{kind:'snapshot',target:null,label:'未排期备份',reason:'聚焦验证'},[],{changes:[],blockers:[],warnings:[],compatibleTargets:[]},'test');
 draft.dailyPlans=[plan(dailyImage,'2030-05-01')];let result=await request('/api/drafts/'+current.id,'PUT',{revision:current.revision,document:draft});assert.equal(result.payload.code,'DAILY_PLAN_DATE_PAST');
 draft.dailyPlans=[automatic(),plan(secondImage)];result=await request('/api/drafts/'+current.id,'PUT',{revision:current.revision,document:draft});assert.equal(result.status,200,JSON.stringify(result.payload));assert.deepEqual(result.payload.document.dailyPlans,draft.dailyPlans);
 const stale=await request('/api/drafts/'+current.id,'PUT',{revision:current.revision,document:draft});assert.equal(stale.payload.code,'REVISION_CONFLICT');
 const cfg=JSON.parse(readFileSync(join(root,'bridge/configuration.json'),'utf8'));at=Date.parse('2030-05-03T10:00:00+08:00');mkdirSync(join(root,'appearances'),{recursive:true});
 writeFileSync(join(root,'appearances/2030-05-03.json'),JSON.stringify({schema:'jigsaw-daily-appearance/v2',target:'mobile-shared',date:'2030-05-03',imageId:dailyImage,albumId:'daily-destination',activatedAt:at,configDigest:cfg.configDigest,planned:true,source:'automatic'}));
 const status=await request('/api/daily/status');assert.equal(status.status,200);assert.equal(status.payload.daily.appearances[0].source,'automatic');
 const saved=app.store.draft(current.id),changed=copy(saved.document);changed.dailyPlans=[];
 result=await request('/api/drafts/'+current.id,'PUT',{revision:saved.revision,document:changed});assert.equal(result.payload.code,'DAILY_PLAN_LOCKED');
 result=await request('/api/versions/'+version.id+'/restore','POST',{password:'Daily-fixture-password-123',reason:'验证旧备份不可覆盖实际出场档案'});assert.equal(result.payload.code,'DAILY_PLAN_LOCKED');assert.equal(app.store.listDrafts().length,1);
});
