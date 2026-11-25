// Convert the existing working content in place, preserving metadata and history.
import {backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {normalizeDraft,validateDraft,plannedImageVisibility} from '../model.mjs';
import {mergeDraft} from '../merge.mjs';

const root=resolve(import.meta.dirname,'../..'),work=join(root,'content-admin/work');
const source=readSource(root),store=createStore(work,source);
try {
 const current=store.draft(store.activeDraftId());
 if(current.document.schemaVersion===3&&current.sourceFingerprint===source.fingerprint) console.log('当前工作内容已采用 PC 与小程序共用相册。');
 else {
  const beforeCount=store.listDrafts().length;
  const document=validateDraft(mergeDraft(normalizeDraft(store.baseline(current.sourceFingerprint),source),normalizeDraft(current.document,source),source.baseline),source);
  assert.equal(document.schemaVersion,3); assert.equal(Object.hasOwn(document,'targets'),false);
  assert.deepEqual(document.assets,current.document.assets,'preserve all image metadata and history');
  assert.deepEqual(document.styles,current.document.styles,'preserve artwork styles');
  assert.equal(document.name,current.document.name);
  const originalIds=new Set(Object.values(current.document.targets??{}).flatMap(target=>target.albums.flatMap(album=>album.imageIds)));
  const sharedIds=new Set(document.albums.flatMap(album=>album.imageIds));
  assert.deepEqual([...sharedIds].sort(),[...originalIds].sort(),'preserve assigned images');
  const backups=join(work,'backups');mkdirSync(backups,{recursive:true});
  const backupPath=join(backups,`before-shared-albums-${Date.now()}.sqlite`);await backup(store.db,backupPath);
  const legacyPcAlbums=structuredClone(current.document.targets?.pc?.albums??[]);
  const migrationMap=legacyPcAlbums.map(album=>({id:album.id,title:album.title,imageAssignments:album.imageIds.map(imageId=>({imageId,sharedAlbumId:document.albums.find(shared=>shared.imageIds.includes(imageId))?.id??null}))}));
  const saved=store.reimport(current.id,current.revision,document,source,'local-shared-album-migration','PC 与小程序共用同一套相册；保留图片、标签、购买价和奖励，旧 PC 主题完整配置另留迁移记录。');
  assert.equal(saved.id,current.id);assert.equal(store.listDrafts().length,beforeCount);
  const result={schema:'jigsaw-shared-album-migration/v1',createdAt:new Date().toISOString(),draftId:saved.id,revision:saved.revision,backupPath,oldSourceFingerprint:current.sourceFingerprint,sourceFingerprint:source.fingerprint,existingDraftCount:beforeCount,newDraftsCreated:0,sharedAlbums:saved.document.albums.length,assigned:sharedIds.size,unassigned:Object.keys(saved.document.assets).length-sharedIds.size,plannedVisible:Object.fromEntries(['pc','mobile-shared'].map(target=>[target,plannedImageVisibility(saved.document,source,target).size])),legacyPcAlbums,migrationMap,runtimeApplied:false};
  const receiptDir=join(work,'shared-album-migration');mkdirSync(receiptDir,{recursive:true});writeFileSync(join(receiptDir,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({draftId:result.draftId,revision:result.revision,sharedAlbums:result.sharedAlbums,assigned:result.assigned,unassigned:result.unassigned,newDraftsCreated:0,plannedVisible:result.plannedVisible,backupPath}));
 }
} finally {store.close();}
