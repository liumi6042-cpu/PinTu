import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {validateDraft} from '../model.mjs';
import {createDailyCoordinator} from '../daily.mjs';
import {createDailyContent} from '../../jigsaw-nook-taptap/server/daily-content.mjs';
import {PHOTOS,dailyPuzzle} from '../../jigsaw-nook-taptap/outputs/mobile/engine.mjs';

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
