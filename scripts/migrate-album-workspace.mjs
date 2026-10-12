// Migrates the existing working document in place. Older documents, saved
// versions, credentials and image records remain available in private storage.
import {backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {normalizeDraft,validateDraft,plannedImageVisibility} from '../model.mjs';
import {mergeDraft} from '../merge.mjs';

const root=resolve(import.meta.dirname,'../..'),work=join(root,'content-admin/work'),source=readSource(root),store=createStore(work,source);
try{
 const current=store.draft(store.activeDraftId());
 if(current.document.schemaVersion===2&&current.sourceFingerprint===source.fingerprint){console.log('当前内容已采用相册模式，无需重复转换。');process.exitCode=0;}
 else{
  const beforeCount=store.listDrafts().length,normalized=normalizeDraft(current.document,source);
  const merged=mergeDraft(normalizeDraft(store.baseline(current.sourceFingerprint),source),normalized,source.baseline);
  const document=validateDraft(merged,source);document.name='相册工作内容';
  assert.deepEqual(document.assets,current.document.assets,'image metadata and target history must survive');
  const backups=join(work,'backups');mkdirSync(backups,{recursive:true});const backupPath=join(backups,`before-album-mode-${Date.now()}.sqlite`);await backup(store.db,backupPath);
  const saved=store.reimport(current.id,current.revision,document,source,'local-album-migration','合并图包与图鉴为相册；保留原工作ID、成员、价格、标签和历史副本。');
  assert.equal(saved.id,current.id);assert.equal(store.listDrafts().length,beforeCount,'do not create another working draft');
  const targets=Object.fromEntries(['pc','mobile-shared'].map(target=>{const albums=saved.document.targets[target].albums,assigned=new Set(albums.flatMap(a=>a.imageIds));return [target,{albums:albums.length,purchasable:albums.filter(a=>a.purchasable).length,assigned:assigned.size,unassigned:source.assets.length-assigned.size,plannedVisible:plannedImageVisibility(saved.document,source,target).size}];}));
  const result={schema:'jigsaw-album-migration/v1',createdAt:new Date().toISOString(),draftId:saved.id,revision:saved.revision,backupPath,existingDraftCount:beforeCount,newDraftsCreated:0,targets,runtimeApplied:false};
  mkdirSync(join(work,'album-migration'),{recursive:true});writeFileSync(join(work,'album-migration/result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }
}finally{store.close();}
