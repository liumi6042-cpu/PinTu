import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {createGameSettingsCoordinator} from '../game-settings.mjs';
import {isRetiredDecoration} from '../decoration-policy.mjs';

// Explicit user-requested retirement; never writes player databases or publishes.
const root=resolve(import.meta.dirname,'../..'),work=join(root,'content-admin/work');
const store=createStore(work,readSource(root));
try{
 const coordinator=createGameSettingsCoordinator({store,bridgeDir:join(work,'game-settings')});
 const before=store.gameSettings(),albums=store.draft(store.activeDraftId()),tasks=store.taskRewards();
 const next=structuredClone(before.document),ids=[];
 for(const item of next.decorations)if(isRetiredDecoration(item.id)){ids.push(item.id);item.enabled=false;}
 assert.deepEqual(ids.slice().sort(),['berry-spark','honey-star']);
 const backupDir=join(work,'backups');mkdirSync(backupDir,{recursive:true});
 const backup=join(backupDir,'before-retire-decorations-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 writeFileSync(backup,JSON.stringify({gameSettings:before,albums,tasks},null,2)+'\n',{flag:'wx',mode:0o600});
 const saved=(()=>{
  const result=coordinator.save(before.revision,next,'user-request:retire-duplicate-decorations');
  assert.deepEqual(store.draft(albums.id),albums);
  assert.deepEqual(store.taskRewards(),tasks);
  const protectedDocument=structuredClone(result.document);
  for(const item of protectedDocument.decorations)if(isRetiredDecoration(item.id))item.enabled=before.document.decorations.find(previous=>previous.id===item.id).enabled;
  assert.deepEqual(protectedDocument,before.document);
  store.audit('user-request','retire-duplicate-decorations','game-settings','移除莓色星光与蜜糖流星旧样式；保留历史标识和持有记录，其余设置不变');
  return result;
 })();
 console.log(JSON.stringify({retired:ids,revision:saved.revision,backup,albumsPreserved:true,tasksPreserved:true,growthPreserved:true,published:false}));
}finally{store.close();}
