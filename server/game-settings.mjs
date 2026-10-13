import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import defaults from '../config/game-settings-defaults.json' with {type:'json'};

const SCHEMA='jigsaw-game-settings/v1';
const originals=new Map(defaults.decorations.map(item=>[item.id,item]));
export const GAME_DECORATION_ART_KEYS=Object.freeze([...new Set(defaults.decorations.map(item=>item.artKey))]);
const invalid=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_GAME_SETTINGS'});};
function keys(value,allowed,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||allowed.some(key=>!Object.hasOwn(value,key)))invalid(label+'格式无效。');
}
function integer(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)invalid(label+'必须是 '+min+'～'+max+' 的整数。');return value;}
function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)invalid(label+'必须是 '+min+'～'+max+' 的数值。');return value;}
function boolean(value,label){if(typeof value!=='boolean')invalid(label+'必须选择开启或关闭。');return value;}
function string(value,min,max,label){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)invalid(label+'需为 '+min+'～'+max+' 个字符。');return value.trim();}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const gameConfigurationDigest=document=>createHash('sha256').update(JSON.stringify(stable(document))).digest('hex');

/** Public game values only; decoration rights retain their original identities. */
export function validateGameSettings(document){
 keys(document,['schema','progression','energy','collection','milestones','decorations'],'游戏设置');
 if(document.schema!==SCHEMA)invalid('游戏设置版本不支持。');
 const p=document.progression,e=document.energy,c=document.collection;
 keys(p,['earlyXp','laterXpStep','laterXpMaximum'],'升级经验');
 if(!Array.isArray(p.earlyXp)||p.earlyXp.length!==10)invalid('前十级需要逐级填写十个经验数值。');
 const earlyXp=p.earlyXp.map(value=>integer(value,1,1000000,'升级经验'));
 const progression={earlyXp,laterXpStep:integer(p.laterXpStep,0,1000000,'后续每级经验增加值'),laterXpMaximum:integer(p.laterXpMaximum,earlyXp[9],1000000,'每级经验上限')};
 keys(e,['initial','baseCap','capPerLevel','maximumCap','contributionCost','contributionXp','naturalRecoveryMinutes','firstRoomFree','upgradeRefill','upgradeEnergy','completionPools'],'体力与拼合奖励');
 const baseCap=integer(e.baseCap,1,100000,'初始体力上限'),maximumCap=integer(e.maximumCap,baseCap,100000,'最高体力上限');
 if(!['full','fixed','none'].includes(e.upgradeRefill))invalid('升级补充体力方式无效。');
 keys(e.completionPools,['48','108','300','500'],'完图体力奖励');
 const energy={initial:integer(e.initial,0,baseCap,'新玩家初始体力'),baseCap,capPerLevel:integer(e.capPerLevel,0,100000,'每级增加体力上限'),maximumCap,contributionCost:integer(e.contributionCost,0,100000,'每次拼合消耗体力'),contributionXp:integer(e.contributionXp,0,100000,'每次拼合经验'),naturalRecoveryMinutes:number(e.naturalRecoveryMinutes,0,10080,'恢复一点体力的分钟数'),firstRoomFree:boolean(e.firstRoomFree,'首局免体力'),upgradeRefill:e.upgradeRefill,upgradeEnergy:integer(e.upgradeEnergy,0,100000,'升级补充体力'),completionPools:Object.fromEntries(['48','108','300','500'].map(count=>[count,integer(e.completionPools[count],0,100000,'完图体力奖励')]))};
 keys(c,['contributionCoins','completionCoinRatio','fragmentContributionStep','completionFragmentMinimum','completionFragmentMaximum','catalogMinimumContributions'],'收藏奖励');
 const completionFragmentMinimum=integer(c.completionFragmentMinimum,0,100000,'完图最少碎片');
 const collection={contributionCoins:integer(c.contributionCoins,0,100000,'每次拼合金币'),completionCoinRatio:number(c.completionCoinRatio,0,1000,'完图金币系数'),fragmentContributionStep:integer(c.fragmentContributionStep,1,100000,'每份碎片需要拼合次数'),completionFragmentMinimum,completionFragmentMaximum:integer(c.completionFragmentMaximum,completionFragmentMinimum,100000,'完图最多碎片'),catalogMinimumContributions:integer(c.catalogMinimumContributions,1,100000,'图鉴收录最低拼合次数')};
 if(!Array.isArray(document.milestones)||document.milestones.length>20)invalid('相册里程碑最多设置二十项。');
 const targets=new Set(),milestoneIds=new Set(),milestones=document.milestones.map(item=>{
  keys(item,['id','target','coins','albumDecoration'],'相册里程碑');
  if(typeof item.id!=='string'||!/^[a-z][a-z0-9-]{1,63}$/.test(item.id)||milestoneIds.has(item.id))invalid('里程碑标识无效或重复。');milestoneIds.add(item.id);
  const target=integer(item.target,1,10000,'里程碑所需图片数');if(targets.has(target))invalid('里程碑图片数不能重复。');targets.add(target);
  return {id:item.id,target,coins:integer(item.coins,0,100000,'里程碑金币'),albumDecoration:boolean(item.albumDecoration,'里程碑装饰奖励')};
 }).sort((a,b)=>a.target-b.target);
 if(!Array.isArray(document.decorations)||document.decorations.length!==originals.size)invalid('装饰列表不完整。');
 const seen=new Set(),decorations=new Map();
 for(const item of document.decorations){
  const original=originals.get(item?.id);if(!original||seen.has(item.id))invalid('装饰标识无效或重复。');seen.add(item.id);
  keys(item,['id','title','description','kind','artKey','color','cost','source','enabled',...(Object.hasOwn(original,'albumId')?['albumId']:[])],'装饰');
  if(item.source!==original.source||item.kind!==original.kind||item.albumId!==original.albumId)invalid('装饰来源、类型和所属相册需保留原值。');
  if(!GAME_DECORATION_ART_KEYS.includes(item.artKey))invalid('请选择现有装饰图案。');
  if(typeof item.color!=='string'||!/^#[a-f0-9]{6}$/i.test(item.color))invalid('装饰颜色需为六位颜色值。');
  decorations.set(item.id,{id:item.id,title:string(item.title,1,40,'装饰名称'),description:string(item.description,0,300,'装饰说明'),kind:original.kind,artKey:item.artKey,color:item.color.toLowerCase(),cost:integer(item.cost,0,100000,'装饰碎片价格'),source:original.source,...(original.albumId?{albumId:original.albumId}:{}),enabled:boolean(item.enabled,'装饰是否开放')});
 }
 return {schema:SCHEMA,progression,energy,collection,milestones,decorations:[...originals.keys()].map(id=>decorations.get(id))};
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const defaultGameSettings=()=>validateGameSettings(structuredClone(defaults));
export const DEFAULT_GAME_SETTINGS=freeze(defaultGameSettings());
export function buildGameConfiguration(document){const content=validateGameSettings(document);return {...content,configDigest:gameConfigurationDigest(content)};}
export function validateGameConfiguration(configuration){
 if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))invalid('游戏配置无效。');
 const {configDigest,...content}=configuration,document=validateGameSettings(content);
 if(typeof configDigest!=='string'||!/^[a-f0-9]{64}$/.test(configDigest)||gameConfigurationDigest(document)!==configDigest)invalid('游戏配置校验不匹配。');
 return document;
}
/** Read one immutable configuration per operation; malformed updates stop payouts. */
export function createGameSettings({configurationPath}={}){
 let signature,settings=DEFAULT_GAME_SETTINGS;
 return {read(){
  if(!configurationPath)return settings;
  try{
   const info=statSync(configurationPath,{bigint:true}),next=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
   if(next!==signature){settings=freeze(validateGameConfiguration(JSON.parse(readFileSync(configurationPath,'utf8'))));signature=next;}
   return settings;
  }catch(error){throw Object.assign(new Error('游戏设置暂时无法读取，请稍后重试。'),{status:503,code:'GAME_SETTINGS_UNAVAILABLE',cause:error});}
 }};
}
