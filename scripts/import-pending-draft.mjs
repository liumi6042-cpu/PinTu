// Explicit local import only. Makes a new planning draft and a private SQLite
// backup; existing drafts, versions and administrator credentials are preserved.
import {backup} from 'node:sqlite';
import {mkdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {mergeDraft} from '../merge.mjs';
import {validateDraft} from '../model.mjs';

const root=realpathSync(resolve(import.meta.dirname,'../..'));
const source=readSource(root),pending=source.assets.filter(asset=>asset.lifecycle==='pending');
if(!pending.length)throw new Error('没有已登记的新素材。');
const work=join(root,'content-admin/work'),store=createStore(work,source);
try{
 const original=store.draft(store.activeDraftId());
 if(original.sourceFingerprint===source.fingerprint&&pending.every(asset=>original.document.assets[asset.id]))throw new Error('当前草稿已包含该批素材，请勿重复导入。');
 const document=mergeDraft(store.baseline(original.sourceFingerprint),original.document,source.baseline);
 document.name=`新图整理 · ${new Date().toISOString().slice(0,10)}（${pending.length}张）`;
 const validated=validateDraft(document,source),backupDir=join(work,'backups');
 mkdirSync(backupDir,{recursive:true});
 const backupPath=join(backupDir,`before-new-art-${Date.now()}.sqlite`);
 await backup(store.db,backupPath);
 const draft=store.importPendingDraft(original.id,original.revision,validated,source,`导入引用会话成品 ${pending.length} 张；保留原草稿，待整理后接入游戏。`);
 const result={schema:'jigsaw-local-import-result/v1',createdAt:new Date().toISOString(),newDraftId:draft.id,newDraftName:draft.name,fromDraftId:original.id,fromDraftRevision:original.revision,backupPath,sourceFingerprint:source.fingerprint,retainedImages:source.assets.length-pending.length,pendingImages:pending.length,newIds:pending.map(a=>a.id),runtimeApplied:false};
 writeFileSync(join(work,'import-audit/import-result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({draftName:draft.name,total:source.assets.length,pending:pending.length,previousDraftPreserved:true,administratorPreserved:store.hasAdmin()}));
}finally{store.close();}
