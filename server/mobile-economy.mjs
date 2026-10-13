/** Mobile-only economy. Gameplay rewards may exceed capacity; refills never erase them. */
import {DEFAULT_TASK_REWARD_SETTINGS,tenGridReward} from './task-reward-settings.mjs';
export const MOBILE_COUNTS=[48,108,300,500];
export const COMPLETION_POOLS={48:10,108:25,300:60,500:100};
const EARLY=[1,5,10,18,28,40,55,70,90,110];
export const xpForLevel=level=>level<=10?EARLY[Math.max(0,level-1)]:Math.min(300,110+10*(level-10));
export const energyCap=level=>Math.min(100,50+level);
export const giftMaximum=level=>level>=50?7:level>=20?6:5;
export function newProfile(id,now){return {id,name:'拼图朋友',level:0,xp:0,totalXp:0,energy:50,energyAt:now,giftProgress:0,supply:{energy:0,create:0},autoSupply:false,createdAt:now,firstRoomId:null,firstRoomCompleted:false,starterSelectionAvailable:true,lastReward:null};}
export function restoreEnergy(profile,now){
 const cap=energyCap(profile.level);
 if(profile.energy>=cap){profile.energyAt=now;return;}
 const count=Math.floor(Math.max(0,now-profile.energyAt)/300000);
 if(count){profile.energy=Math.min(cap,profile.energy+count);profile.energyAt=profile.energy>=cap?now:profile.energyAt+count*300000;}
}
export const adEligible=(profile,now)=>now-profile.createdAt>=60000&&profile.firstRoomCompleted;
/** Experience from gifts never invokes contribution counters or spends energy. */
export function applyExperience(profile,xp,now){
 if(!Number.isSafeInteger(xp)||xp<0)throw new TypeError('Invalid experience');
 profile.totalXp+=xp;profile.xp+=xp;let levels=0;
 while(profile.xp>=xpForLevel(profile.level+1)){profile.xp-=xpForLevel(profile.level+1);profile.level++;levels++;profile.energy=Math.max(profile.energy,energyCap(profile.level));profile.energyAt=now;}
 return levels;
}
export function applyContribution(profile,{protectedRoom=false,now,randomInt,taskRewards=DEFAULT_TASK_REWARD_SETTINGS}){
 restoreEnergy(profile,now);let autoUsed=false;
 if(!protectedRoom&&profile.energy<1&&profile.autoSupply&&profile.supply.energy>0){profile.supply.energy--;profile.energy=energyCap(profile.level);profile.energyAt=now;autoUsed=true;}
 if(!protectedRoom&&profile.energy<1)return null;
 if(!protectedRoom){if(profile.energy>=energyCap(profile.level))profile.energyAt=now;profile.energy--;}
 const levels=applyExperience(profile,1,now);profile.giftProgress++;let pendingGift=null;
 if(profile.giftProgress>=10){profile.giftProgress-=10;profile.giftSequence=(profile.giftSequence??0)+1;const reward=tenGridReward(taskRewards,profile.level);pendingGift={energy:randomInt(reward.energyMin,reward.energyMax+1),maximum:reward.tierMaximum,energyMin:reward.energyMin,energyMax:reward.energyMax,xp:reward.xp,sequence:profile.giftSequence};}
 const reward={xp:1,energySpent:protectedRoom?0:1,gift:0,giftsAdded:0,levels,autoUsed,at:now};profile.lastReward=reward;return {...reward,pendingGift};
}
export function completionDistribution(contributions,pieces){
 const entries=Object.entries(contributions).filter(([,n])=>Number.isSafeInteger(n)&&n>0).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)return [];
 const pool=Math.max(COMPLETION_POOLS[pieces]??10,entries.length),remaining=pool-entries.length,total=entries.reduce((n,[,q])=>n+q,0);
 const awards=entries.map(([id,q])=>{const numerator=remaining*q;return {id,contribution:q,energy:1+Math.floor(numerator/total),remainder:numerator%total};});
 let rest=pool-awards.reduce((n,r)=>n+r.energy,0);
 for(const award of [...awards].sort((a,b)=>b.remainder-a.remainder||a.id.localeCompare(b.id))){if(rest--<=0)break;award.energy++;}
 return awards.map(({remainder:_remainder,...award})=>award);
}
