import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {validateDraft} from '../model.mjs';
import {createDailyCoordinator} from '../daily.mjs';
import {createDailyContent} from '../../jigsaw-nook-taptap/server/daily-content.mjs';
import {PHOTOS,RESTORABLE_PHOTOS,dailyPuzzle} from '../../jigsaw-nook-taptap/outputs/mobile/engine.mjs';

test('admin plan, real runtime receipt and next-day album enrollment agree',()=>{
 const qaRoot=resolve('content-admin/work');mkdirSync(qaRoot,{recursive:true});
 const dir=mkdtempSync(join(qaRoot,'qa-daily-bridge-')),source=readSource(resolve('.'));
 const store=createStore(join(dir,'admin'),source),bridgeDir=join(dir,'bridge'),appearanceDir=join(dir,'appearances');
 let now=Date.parse('2026-10-12T06:00:00Z');
 const coordinator=createDailyCoordinator({store,getSource:()=>source,validateDocument:validateDraft,bridgeDir,appearanceDir,now:()=>now});
 let runtime;
 try {
  const before=store.draft(store.activeDraftId()),document=validateDraft(before.document,source),imageId='daily-moonlit-cherry-umbrella-v1',albumId='everyday-gallery';
  document.dailyPlans=[{id:imageId,imageId,date:'2026-10-13',albumId}];
  store.saveDraft(before.id,before.revision,validateDraft(document,source),'integration-fixture');
  coordinator.sync();
  assert.equal(store.dailyAppearances().length,0);assert.equal(store.dailyEnrollments().length,0);
  runtime=createDailyContent({configurationPath:join(bridgeDir,'configuration.json'),appearanceDir,photos:PHOTOS,fallback:dailyPuzzle,now:()=>now});
  now=Date.parse('2026-10-13T02:00:00Z');
  assert.equal(runtime.select(now).id,imageId);
  coordinator.sync();assert.equal(store.dailyAppearances().length,1);assert.equal(store.dailyEnrollments().length,0);
  assert.equal(runtime.galleryPhotos(now).some(photo=>photo.id===imageId),false);
  now=Date.parse('2026-10-13T16:00:00Z');
  coordinator.sync();const current=store.draft(before.id);
  assert.deepEqual(current.document.assets,document.assets);assert.deepEqual(current.document.styles,document.styles);
  assert.equal(current.document.albums.find(album=>album.id===albumId).imageIds.includes(imageId),true);
  assert.equal(store.dailyEnrollments().length,1);assert.equal(runtime.galleryPhotos(now).some(photo=>photo.id===imageId),true);
  assert.equal(runtime.albumEntries(now).find(entry=>entry.album.id===albumId).imageIds.includes(imageId),true);
  coordinator.sync();assert.equal(store.dailyEnrollments().length,1);assert.equal(store.draft(before.id).revision,current.revision);
 } finally {
  runtime?.close();store.close();
  assert.ok(resolve(dir).startsWith(qaRoot+sep));rmSync(dir,{recursive:true,force:true});
 }
});

test('real v2 bridge chooses manual, then undated automatic, then album library and preserves each actual day',()=>{
 const qaRoot=resolve('content-admin/work');mkdirSync(qaRoot,{recursive:true});
 const dir=mkdtempSync(join(qaRoot,'qa-daily-bridge-')),source=readSource(resolve('.'));
 const store=createStore(join(dir,'admin'),source),bridgeDir=join(dir,'bridge'),appearanceDir=join(dir,'appearances');
 let now=Date.parse('2026-10-12T06:00:00Z'),runtime;
 const coordinator=createDailyCoordinator({store,getSource:()=>source,validateDocument:validateDraft,bridgeDir,appearanceDir,now:()=>now});
 try{
  const saved=store.draft(store.activeDraftId()),document=validateDraft(saved.document,source),automaticId='daily-moonlit-cherry-umbrella-v1',manualId='daily-lantern-lake-violin-v1';
  const archivedId=RESTORABLE_PHOTOS.find(photo=>photo.status==='archived').id,albumId='everyday-gallery';
  for(const album of document.albums){album.imageIds=[];album.coverImageId=null;}
  document.albums.push({id:'daily-paid-fixture',title:'隐藏购买相册',description:'每日可试拼',imageIds:[archivedId],coverImageId:archivedId,styleGroupId:null,showOnPc:false,showOnMobile:false,purchasable:true,price:250,decorationId:null,milestones:[]});
  document.dailyPlans=[{id:automaticId,imageId:automaticId,date:null,albumId,autoPublish:true},{id:manualId,imageId:manualId,date:'2026-10-13',albumId}];
  store.saveDraft(saved.id,saved.revision,validateDraft(document,source),'integration-fixture');coordinator.sync();
  runtime=createDailyContent({configurationPath:join(bridgeDir,'configuration.json'),appearanceDir,photos:RESTORABLE_PHOTOS,fallback:dailyPuzzle,now:()=>now,randomInt:()=>0});
  now=Date.parse('2026-10-13T02:00:00Z');assert.equal(runtime.select(now).id,manualId);coordinator.sync();
  assert.equal(store.dailyAppearances()[0].source,'scheduled');assert.deepEqual(store.draft(saved.id).document.dailyPlans.find(plan=>plan.imageId===automaticId),document.dailyPlans[0]);
  now=Date.parse('2026-10-14T02:00:00Z');assert.equal(runtime.select(now).id,automaticId);coordinator.sync();
  assert.equal(store.dailyAppearances()[1].source,'automatic');assert.equal(store.dailyEnrollments()[0].imageId,manualId);
  now=Date.parse('2026-10-15T02:00:00Z');coordinator.sync();assert.equal(runtime.select(now).id,archivedId);assert.equal(runtime.select(now).id,archivedId);coordinator.sync();
  const facts=store.dailyAppearances();assert.deepEqual(facts.map(fact=>fact.source),['scheduled','automatic','library']);assert.equal(facts[2].planned,false);assert.equal(facts[2].albumId,null);
  assert.equal(store.dailyEnrollments().length,2);assert.equal(store.dailyFrozenPlans().length,2);assert.equal(store.dailyFrozenPlans().find(plan=>plan.imageId===automaticId).date,null);
  assert.equal(store.draft(saved.id).document.albums.find(album=>album.id==='daily-paid-fixture').imageIds[0],archivedId);
 }finally{runtime?.close();store.close();assert.ok(resolve(dir).startsWith(qaRoot+sep));rmSync(dir,{recursive:true,force:true});}
});
