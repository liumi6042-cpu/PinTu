/** Web assets are independent of legacy garden/wardrobe assets. No stamina state. */
import {isRetiredDecoration,availableDecorationId} from './decoration-policy.mjs';
export const TASK_DEFINITIONS=Object.freeze([
 {id:'cooperation-10',group:'cooperation',title:'伙伴初遇',target:10},
 {id:'cooperation-30',group:'cooperation',title:'伙伴默契',target:30},
 {id:'cooperation-60',group:'cooperation',title:'伙伴同心',target:60},
 {id:'friend-10',group:'friend',title:'好友相伴',target:10},
 {id:'friend-30',group:'friend',title:'好友默契',target:30},
]);
export const managedDay=now=>new Date(now+8*3600000).toISOString().slice(0,10);
export const BEGINNER_TASKS=Object.freeze([10,50,100].map(target=>Object.freeze({id:'beginner-'+target,kind:'beginner-'+target,group:'beginner',title:'累计拼合'+target+'次',target,energy:0,xp:0,coins:target})));
// contributionTotal is the existing committed-snap accumulator, independent of
// XP, room completion and partner presence. No unbounded history scan is needed.
export function managedBeginnerTasks(state,settings,now){
 const progress=Math.min(100,state.contributionTotal);
 for(const task of BEGINNER_TASKS)if(progress>=task.target)managedReward(state,'task:'+task.id,{coins:task.coins},settings,now);
 return BEGINNER_TASKS.filter(task=>!state.receipts['task:'+task.id]).map(task=>({...task,progress:Math.min(progress,task.target),earned:false}));
}
const reject=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function newManagedProfile(){return {schema:1,level:0,xp:0,totalXp:0,coins:0,fragments:0,contributionTotal:0,giftProgress:0,giftSequence:0,ownedAlbums:{},ownedImages:{},decorations:[],equipped:null,artworks:{},rooms:{},daily:{},gifts:{},milestones:{},receipts:{},invitation:null,settlements:{}};}
export const xpForManagedLevel=(level,settings)=>level<=10?settings.progression.earlyXp[Math.max(0,level-1)]:Math.min(settings.progression.laterXpMaximum,settings.progression.earlyXp[9]+settings.progression.laterXpStep*(level-10));
function safeAmount(value){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid managed reward amount');return value;}
export function applyManagedExperience(state,amount,settings){
 safeAmount(amount);state.totalXp+=amount;state.xp+=amount;
 if(!Number.isSafeInteger(state.totalXp))throw new TypeError('Experience overflow');
 while(state.xp>=xpForManagedLevel(state.level+1,settings)){state.xp-=xpForManagedLevel(state.level+1,settings);state.level++;}
}
export function managedReward(state,source,reward,settings,now){
 if(state.receipts[source])return false;
 const coins=reward.coins??0,fragments=reward.fragments??0,xp=reward.xp??0;
 safeAmount(Math.abs(coins));safeAmount(Math.abs(fragments));safeAmount(xp);
 if(state.coins+coins<0)reject('金币不足，继续拼图即可积累');
 if(state.fragments+fragments<0)reject('装饰碎片不足，完成拼图后可以获得');
 if(!Number.isSafeInteger(state.coins+coins)||!Number.isSafeInteger(state.fragments+fragments))throw new TypeError('Wallet overflow');
 state.coins+=coins;state.fragments+=fragments;applyManagedExperience(state,xp,settings);
 state.receipts[source]={coins,fragments,xp,at:now};return true;
}
export function managedGift(state,id,{source,kind,title,coins=0,xp=0},now){
 if(state.gifts[id])return false;safeAmount(coins);safeAmount(xp);
 state.gifts[id]={id,source,kind,title,coins,xp,createdAt:now,openedAt:null};return true;
}
export function claimManagedGift(state,id,settings,now){
 const gift=state.gifts[id];if(!gift)reject('奖励不存在',404);if(gift.openedAt)return false;
 managedReward(state,'gift:'+id,gift,settings,now);gift.openedAt=now;return true;
}
export function purchaseManagedAlbum(state,album,settings,now){
 if(!album?.purchasable||album.showOnPc===false||!album.imageIds.length)reject('相册暂未开放购买',404);
 if(state.ownedAlbums[album.id])return false;
 managedReward(state,'buy:'+album.id,{coins:-album.price},settings,now);
 state.ownedAlbums[album.id]={imageIds:[...album.imageIds],price:album.price,at:now};
 for(const id of album.imageIds)state.ownedImages[id]=true;return true;
}
export function craftManagedDecoration(state,item,settings,now){
 if(!item)reject('装饰不存在',404);if(isRetiredDecoration(item.id))reject('这件装饰已移除，正在重新制作');if(item.source==='default'||state.decorations.includes(item.id))return false;
 if(item.enabled===false)reject('这件装饰暂未开放');if(item.source!=='craft')reject('集齐对应相册即可获得这件装饰');
 managedReward(state,'craft:'+item.id,{fragments:-item.cost},settings,now);state.decorations.push(item.id);return true;
}
export function awardManagedMilestones(state,albums,settings,now){
 const collected=new Set(Object.keys(state.artworks));
 for(const album of albums){
  const count=album.imageIds.filter(id=>collected.has(id)).length;
  for(const milestone of album.milestones??[]){
   if(count<milestone.target||state.milestones[album.id]?.[milestone.id])continue;
   const decorationId=availableDecorationId(milestone.decorationId),snapshot={target:milestone.target,coins:milestone.coins,decorationId,at:now};
   (state.milestones[album.id]??={})[milestone.id]=snapshot;
   managedReward(state,'album:'+album.id+':'+milestone.id,{coins:milestone.coins},settings,now);
   if(decorationId&&!state.decorations.includes(decorationId))state.decorations.push(decorationId);
  }
 }
}
/** Only a server-committed successful snap advances this watermark.
 * @param {any} state
 * @param {any} room
 * @param {any} options
 */
export function recordManagedRoom(state,room,options){
 const {baseline=0,cooperation=false,friend=false,invitation=null,albums=[],settings,rewards,now,pieces,availableImage=false,activationAt=0}=options;
 const count=room.count;if(!Number.isSafeInteger(count)||count<0)throw new TypeError('Invalid committed contribution');
 const watermark=state.rooms[room.id]??={count:baseline,rewarded:0,completed:false};
 const delta=Math.max(0,count-watermark.count);watermark.count=Math.max(watermark.count,count);
 if(delta){
  watermark.rewarded+=delta;watermark.lastEventAt=now;state.contributionTotal+=delta;
  managedReward(state,'snap:'+room.id+':'+count,{coins:delta*settings.collection.contributionCoins,xp:delta*settings.energy.contributionXp},settings,now);
  const day=managedDay(now),daily=state.daily[day]??={cooperation:0,friend:0,shares:[]};
  if(cooperation)daily.cooperation+=delta;if(friend)daily.friend+=delta;
  for(let i=0;i<delta;i++){state.giftProgress++;if(state.giftProgress>=10){state.giftProgress-=10;state.giftSequence++;managedGift(state,'ten:'+state.giftSequence,{source:'ten:'+state.giftSequence,kind:'ten-grid',title:'十格小礼',coins:rewards.tenGrid.coins??0,xp:rewards.tenGrid.xp},now);}}
  for(const task of TASK_DEFINITIONS)if(daily[task.group]>=task.target){const reward=rewards.tasks.find(item=>item.id===task.id);if(!reward)throw new TypeError('Missing task reward');const id='daily:'+day+':'+task.id;managedGift(state,id,{source:id,kind:task.id,title:task.title,coins:reward.coins??0,xp:reward.xp},now);}
  if(invitation){
   if(!state.invitation||state.invitation.inviter!==invitation.inviter)state.invitation={inviter:invitation.inviter,boundAt:invitation.bound_at,contributions:0,qualifiedAt:null};
   if(!state.invitation.qualifiedAt&&now>=invitation.bound_at){state.invitation.contributions+=delta;if(state.invitation.contributions>=3){state.invitation.qualifiedAt=now;state.invitation.reward={coins:rewards.invitationFriend.coins??0,xp:rewards.invitationFriend.xp};}}
  }
 }
 if(room.completedAt&&!watermark.completed){
  watermark.completed=true;
  if(room.completedAt>=activationAt&&watermark.rewarded>0){
   const tuning=settings.collection,n=watermark.rewarded;
   managedReward(state,'completion:'+room.id,{coins:Math.ceil(n*tuning.completionCoinRatio),fragments:Math.min(tuning.completionFragmentMaximum,Math.max(tuning.completionFragmentMinimum,Math.floor(n/tuning.fragmentContributionStep)))},settings,now);
   if(availableImage&&n>=tuning.catalogMinimumContributions){const levels=state.artworks[room.imageId]??=[];if(!levels.includes(pieces))levels.push(pieces);awardManagedMilestones(state,albums,settings,now);}
  }
 }
 if(delta)managedBeginnerTasks(state,settings,now);
 return delta;
}
export function shareManagedInvitation(state,requestId,settings,rewards,now){
 const day=managedDay(now),daily=state.daily[day]??={cooperation:0,friend:0,shares:[]};
 // A request ID remains a stable receipt across Beijing day boundaries.
 if(state.receipts['share:'+requestId]||daily.shares.length>=rewards.invitationShare.dailyLimit)return false;
 daily.shares.push(requestId);return managedReward(state,'share:'+requestId,rewards.invitationShare,settings,now);
}
