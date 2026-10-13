import {mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {problem} from './store.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS,validateTaskRewardSettings,buildTaskRewardConfiguration} from '../jigsaw-nook-taptap/server/task-reward-settings.mjs';

function validateDocument(document){
 try{return validateTaskRewardSettings(document);}
 catch(error){throw problem(400,error.message,'INVALID_TASK_REWARDS');}
}

function inheritMissingCoins(input,saved){
 const document=structuredClone(input);
 if(!document||typeof document!=='object'||Array.isArray(document))return document;
 if(Array.isArray(document.tasks))for(const task of document.tasks){
  if(task&&typeof task==='object'&&!Array.isArray(task)&&!Object.hasOwn(task,'coins'))
   task.coins=saved.tasks.find(item=>item.id===task.id)?.coins??0;
 }
 for(const key of ['invitationShare','invitationFriend','tenGrid']){
  const reward=document[key];
  if(reward&&typeof reward==='object'&&!Array.isArray(reward)&&!Object.hasOwn(reward,'coins'))reward.coins=saved[key]?.coins??0;
 }
 return document;
}

// This file contains public reward values only. It never reads player records
// and remains separate from picture drafts and their unsaved browser edits.
export function writeTaskRewardConfiguration(bridgeDir,document){
 const configuration=buildTaskRewardConfiguration(document),bytes=JSON.stringify(configuration,null,2)+'\n';
 mkdirSync(bridgeDir,{recursive:true});const path=join(bridgeDir,'configuration.json');
 try{if(readFileSync(path,'utf8')===bytes)return configuration;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=join(bridgeDir,'.configuration-'+randomUUID()+'.tmp');
 try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,path);}
 finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return configuration;
}

export function createTaskRewardCoordinator({store,bridgeDir,now=Date.now}){
 store.initializeTaskRewards(validateDocument(structuredClone(DEFAULT_TASK_REWARD_SETTINGS)),now());
 function sync(){
  const settings=store.taskRewards(),document=validateDocument(settings.document);
  // Old documents gain zero-valued coin fields only in the read view. Preserve
  // the saved reward values and revision until the administrator explicitly saves.
  writeTaskRewardConfiguration(bridgeDir,document);return {...settings,document};
 }
 return {
  sync,
  save(revision,document,actor){
   if(!Number.isSafeInteger(revision)||revision<1)throw problem(400,'任务奖励版本无效','INVALID_TASK_REWARDS');
   const current=store.taskRewards();
   // Older browser forms omit coin fields. At the same saved revision, retain
   // those values; a new form's explicit zero is still an intentional reset.
   const input=current.revision===revision?inheritMissingCoins(document,current.document):document;
   const validated=validateDocument(input),settings=store.saveTaskRewards(revision,validated,actor,now());
   try{writeTaskRewardConfiguration(bridgeDir,validated);}
   catch{throw problem(503,'奖励已保存，但游戏配置暂未更新，请重新载入任务奖励后重试','TASK_REWARD_BRIDGE_FAILED');}
   return settings;
  },
 };
}
