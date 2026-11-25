/** Mobile-only economy. Gameplay rewards may exceed capacity; refills never erase them. */
import {DEFAULT_TASK_REWARD_SETTINGS,tenGridReward} from './task-reward-settings.mjs';
import {DEFAULT_GAME_SETTINGS} from './game-settings.mjs';
export const MOBILE_COUNTS=[48,108,300,500];
export const COMPLETION_POOLS={48:10,108:25,300:60,500:100};
export const xpForLevel=(level,settings=DEFAULT_GAME_SETTINGS)=>level<=10?settings.progression.earlyXp[Math.max(0,level-1)]:Math.min(settings.progression.laterXpMaximum,settings.progression.earlyXp[9]+settings.progression.laterXpStep*(level-10));
export const energyCap=(level,settings=DEFAULT_GAME_SETTINGS)=>Math.min(settings.energy.maximumCap,settings.energy.baseCap+settings.energy.capPerLevel*level);
// null counts all history; a timestamp limits eligibility to qualifications at/after it.
export const INVITE_CAP_BONUS=Object.freeze({perFriend:1,maximum:5,countBefore:null});
export function inviteCapBonus(db,ownerId){
 const {perFriend,maximum,countBefore}=INVITE_CAP_BONUS;
 const qualified=Number((countBefore===null
  ?db.prepare('SELECT COUNT(*) n FROM mobile_invitation_bindings WHERE inviter=? AND qualified_at IS NOT NULL').get(ownerId)
  :db.prepare('SELECT COUNT(*) n FROM mobile_invitation_bindings WHERE inviter=? AND qualified_at>=?').get(ownerId,countBefore)).n);
 return {count:Math.min(maximum,qualified*perFriend),maximum};
}
export const effectiveEnergyCap=(level,settings=DEFAULT_GAME_SETTINGS,inviteBonus=0)=>energyCap(level,settings)+inviteBonus;
export const giftMaximum=level=>level>=50?7:level>=20?6:5;
export function newProfile(id,now,settings=DEFAULT_GAME_SETTINGS,{creationTickets=0}={}){return {id,name:'拼图朋友',level:0,xp:0,totalXp:0,energy:settings.energy.initial,energyAt:now,giftProgress:0,supply:{energy:0,create:Math.max(0,Math.min(3,Number(creationTickets)||0))},autoSupply:false,createdAt:now,firstRoomId:null,firstRoomCompleted:false,starterSelectionAvailable:false,lastReward:null};}
export function restoreEnergy(profile,now,settings=DEFAULT_GAME_SETTINGS,{inviteBonus=0}={}){
 const cap=effectiveEnergyCap(profile.level,settings,inviteBonus),interval=settings.energy.naturalRecoveryMinutes*60000;
 if(profile.energy>=cap){profile.energyAt=now;return;}
 if(!interval){profile.energyAt=now;return;}
 const count=Math.floor(Math.max(0,now-profile.energyAt)/interval);
 if(count){profile.energy=Math.min(cap,profile.energy+count);profile.energyAt=profile.energy>=cap?now:profile.energyAt+count*interval;}
}
export const adEligible=(profile,now)=>now-profile.createdAt>=60000&&profile.firstRoomCompleted;
/** Experience from gifts never invokes contribution counters or spends energy. */
export function applyExperience(profile,xp,now,settings=DEFAULT_GAME_SETTINGS,{energyEnabled=true,inviteBonus=0}={}){
 if(!Number.isSafeInteger(xp)||xp<0)throw new TypeError('Invalid experience');
 if(!xp)return 0;
 profile.totalXp+=xp;profile.xp+=xp;let levels=0;
 while(profile.xp>=xpForLevel(profile.level+1,settings)){
  profile.xp-=xpForLevel(profile.level+1,settings);profile.level++;levels++;
  if(energyEnabled&&settings.energy.upgradeRefill==='full'){profile.energy=Math.max(profile.energy,effectiveEnergyCap(profile.level,settings,inviteBonus));profile.energyAt=now;}
  else if(energyEnabled&&settings.energy.upgradeRefill==='fixed'){profile.energy+=settings.energy.upgradeEnergy;if(settings.energy.upgradeEnergy>0)profile.energyAt=now;}
 }
 return levels;
}
export function applyContribution(profile,{protectedRoom=false,freeRoom=false,now,randomInt,taskRewards=DEFAULT_TASK_REWARD_SETTINGS,gameSettings=DEFAULT_GAME_SETTINGS,energyEnabled=true,inviteBonus=0}){
 if(energyEnabled)restoreEnergy(profile,now,gameSettings,{inviteBonus});let autoUsed=false;
 const cap=effectiveEnergyCap(profile.level,gameSettings,inviteBonus);
 const free=!energyEnabled||freeRoom||protectedRoom&&gameSettings.energy.firstRoomFree,cost=free?0:gameSettings.energy.contributionCost;
 if(profile.energy<cost&&profile.autoSupply&&profile.supply.energy>0&&cap>=cost){profile.supply.energy--;profile.energy=Math.max(profile.energy,cap);profile.energyAt=now;autoUsed=true;}
 if(profile.energy<cost)return null;
 if(cost){if(profile.energy>=cap)profile.energyAt=now;profile.energy-=cost;}
 const levels=applyExperience(profile,gameSettings.energy.contributionXp,now,gameSettings,{energyEnabled,inviteBonus});profile.giftProgress++;let pendingGift=null;
 if(profile.giftProgress>=10){profile.giftProgress-=10;profile.giftSequence=(profile.giftSequence??0)+1;const reward=tenGridReward(taskRewards,profile.level);pendingGift={energy:randomInt(reward.energyMin,reward.energyMax+1),maximum:reward.tierMaximum,energyMin:reward.energyMin,energyMax:reward.energyMax,xp:reward.xp,coins:reward.coins,sequence:profile.giftSequence};}
 const reward={xp:gameSettings.energy.contributionXp,energySpent:cost,gift:0,giftsAdded:0,levels,autoUsed,at:now};profile.lastReward=reward;return {...reward,pendingGift};
}
export function completionDistribution(contributions,pieces,settings=DEFAULT_GAME_SETTINGS){
 const entries=Object.entries(contributions).filter(([,n])=>Number.isSafeInteger(n)&&n>0).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)return [];
 const configured=settings.energy.completionPools[pieces]??settings.energy.completionPools[48];
 if(configured===0)return entries.map(([id,contribution])=>({id,contribution,energy:0}));
 const pool=Math.max(configured,entries.length),remaining=pool-entries.length,total=entries.reduce((n,[,q])=>n+q,0);
 const awards=entries.map(([id,q])=>{const numerator=remaining*q;return {id,contribution:q,energy:1+Math.floor(numerator/total),remainder:numerator%total};});
 let rest=pool-awards.reduce((n,r)=>n+r.energy,0);
 for(const award of [...awards].sort((a,b)=>b.remainder-a.remainder||a.id.localeCompare(b.id))){if(rest--<=0)break;award.energy++;}
 return awards.map(({remainder:_remainder,...award})=>award);
}
