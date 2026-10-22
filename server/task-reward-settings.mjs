import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import defaults from '../config/task-reward-defaults.json' with {type:'json'};

const SCHEMA='jigsaw-task-rewards/v1';
export const TASK_REWARD_IDS=Object.freeze(defaults.tasks.map(task=>task.id));
const invalid=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_TASK_REWARDS'});};
const keys=(value,allowed,label,optional=[])=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||allowed.some(key=>!optional.includes(key)&&!Object.hasOwn(value,key)))invalid(label+'格式无效。');
};
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)invalid(label+'必须是 '+min+'～'+max+' 的整数。');return value;};
const coins=value=>integer(value===undefined?0:value,0,100000,'任务金币');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const taskRewardConfigurationDigest=document=>createHash('sha256').update(JSON.stringify(stable(document))).digest('hex');

/** Public values only. Conditions and stable receipt identities are not configurable. */
export function validateTaskRewardSettings(document){
 keys(document,['schema','tasks','invitationShare','invitationFriend','tenGrid'],'任务奖励');
 if(document.schema!==SCHEMA)invalid('任务奖励版本不支持。');
 if(!Array.isArray(document.tasks)||document.tasks.length!==TASK_REWARD_IDS.length)invalid('任务列表不完整。');
 const tasks=new Map();
 for(const task of document.tasks){
  keys(task,['id','energy','xp','coins'],'任务',['coins']);
  if(!TASK_REWARD_IDS.includes(task.id)||tasks.has(task.id))invalid('任务标识无效或重复。');
  tasks.set(task.id,{id:task.id,energy:integer(task.energy,0,10000,'任务体力'),xp:integer(task.xp,0,10000,'任务经验'),coins:coins(task.coins)});
 }
 keys(document.invitationShare,['energy','xp','dailyLimit','coins'],'分享邀请',['coins']);
 keys(document.invitationFriend,['effect','xp','coins'],'好友加入',['coins']);
 if(document.invitationFriend.effect!=='full-energy')invalid('好友加入礼包须保留补满体力效果。');
 keys(document.tenGrid,['energyMin','energyMaxByTier','xp','coins'],'十格小礼',['coins']);
 const energyMin=integer(document.tenGrid.energyMin,1,1000,'小礼最低体力');
 if(!Array.isArray(document.tenGrid.energyMaxByTier)||document.tenGrid.energyMaxByTier.length!==3)invalid('小礼需要三个等级档。');
 return {schema:SCHEMA,tasks:TASK_REWARD_IDS.map(id=>tasks.get(id)),invitationShare:{energy:integer(document.invitationShare.energy,0,10000,'分享体力'),xp:integer(document.invitationShare.xp,0,10000,'分享经验'),dailyLimit:integer(document.invitationShare.dailyLimit,1,20,'分享每日次数'),coins:coins(document.invitationShare.coins)},invitationFriend:{effect:'full-energy',xp:integer(document.invitationFriend.xp,0,10000,'好友加入经验'),coins:coins(document.invitationFriend.coins)},tenGrid:{energyMin,energyMaxByTier:document.tenGrid.energyMaxByTier.map(value=>integer(value,energyMin,1000,'小礼最高体力')),xp:integer(document.tenGrid.xp,0,10000,'小礼经验'),coins:coins(document.tenGrid.coins)}};
}
export const defaultTaskRewardSettings=()=>validateTaskRewardSettings(structuredClone(defaults));
export const DEFAULT_TASK_REWARD_SETTINGS=Object.freeze(defaultTaskRewardSettings());
export function buildTaskRewardConfiguration(document){const content=validateTaskRewardSettings(document);return {...content,configDigest:taskRewardConfigurationDigest(content)};}
export function validateTaskRewardConfiguration(configuration){
 if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))invalid('任务奖励配置无效。');
 const {configDigest,...content}=configuration,document=validateTaskRewardSettings(content);
 // Keep the digest of legacy complete files valid without silently signing new values.
 const digestDocument=structuredClone(document);
 for(const task of digestDocument.tasks)if(!Object.hasOwn(content.tasks.find(item=>item.id===task.id),'coins'))delete task.coins;
 for(const key of ['invitationShare','invitationFriend','tenGrid'])if(!Object.hasOwn(content[key],'coins'))delete digestDocument[key].coins;
 if(typeof configDigest!=='string'||!/^[a-f0-9]{64}$/.test(configDigest)||taskRewardConfigurationDigest(digestDocument)!==configDigest)invalid('任务奖励配置校验不匹配。');
 return document;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
/** Each service operation checks the atomic file; only changed content is parsed. */
export function createTaskRewardSettings({configurationPath}={}){
 let signature,settings=freeze(defaultTaskRewardSettings());
 return {read(){
  if(!configurationPath)return settings;
  try{
   const info=statSync(configurationPath,{bigint:true}),next=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
   if(next!==signature){const document=validateTaskRewardConfiguration(JSON.parse(readFileSync(configurationPath,'utf8')));settings=freeze(document);signature=next;}
   return settings;
  }catch(error){throw Object.assign(new Error('任务奖励设置暂时无法读取，请稍后重试。'),{status:503,code:'TASK_REWARDS_UNAVAILABLE',cause:error});}
 }};
}
export const tenGridReward=(settings,level)=>({energyMin:settings.tenGrid.energyMin,energyMax:settings.tenGrid.energyMaxByTier[level>=50?2:level>=20?1:0],xp:settings.tenGrid.xp,coins:settings.tenGrid.coins??0,tierMaximum:level>=50?7:level>=20?6:5});
