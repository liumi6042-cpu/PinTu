import {randomBytes} from 'node:crypto';
import {applyExperience,effectiveEnergyCap,inviteCapBonus} from './mobile-economy.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS,tenGridReward} from './task-reward-settings.mjs';
import {DEFAULT_GAME_SETTINGS} from './game-settings.mjs';

export const INVITATION_SHARE_DAILY_LIMIT=3;
export const INVITATION_SHARE_REWARD=Object.freeze({energy:20,xp:10,coins:0});
export const BEGINNER_TASKS=Object.freeze([10,50,100].map(target=>Object.freeze({id:'beginner-'+target,kind:'beginner-'+target,group:'beginner',title:'累计拼合'+target+'次',target,energy:0,xp:0,coins:target})));
export const TASK_REWARDS=[
 {id:'cooperation-10',group:'cooperation',title:'小试身手',target:10,energy:10,xp:2,coins:0},
 {id:'cooperation-30',group:'cooperation',title:'渐入佳境',target:30,energy:15,xp:5,coins:0},
 {id:'cooperation-60',group:'cooperation',title:'心手相合',target:60,energy:20,xp:8,coins:0},
 {id:'friend-10',group:'friend',title:'好友相伴',target:10,energy:5,xp:2,coins:0},
 {id:'friend-30',group:'friend',title:'好友默契',target:30,energy:10,xp:5,coins:0},
];
const KINDS=new Map([
 ...[5,6,7].map(max=>['ten-'+max,{title:'十格小礼',energyMin:1,energyMax:max,xp:0,coins:0}]),
 ...TASK_REWARDS.map(t=>[t.id,{title:t.title+'礼包',energyMin:t.energy,energyMax:t.energy,xp:t.xp,coins:0}]),
 // Keep historical fixed-reward gifts readable and openable; only new grants use refills.
 ['invite-friend',{title:'邀友见面礼',energyMin:10,energyMax:10,xp:2,coins:0}],
 ['invite-refill',{title:'补满体力包',effect:'full-energy',energyMin:0,energyMax:0,xp:0,coins:0}],
]);
export const mobileTaskDay=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const reject=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

/** Called only from the service's IMMEDIATE transaction, with verified identities. */
export function createMobileTasks({db,readProfile,saveProfile,areFriends=()=>false,readSettings=()=>DEFAULT_TASK_REWARD_SETTINGS,readGameSettings=()=>DEFAULT_GAME_SETTINGS,energyEnabled=true,readInviteCapBonus=owner=>inviteCapBonus(db,owner),invalidateInviteCapBonus=()=>{},awardCoins=(_owner,_source,coins)=>{if(coins)throw new Error('Task coin wallet unavailable');return 0;}}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_task_events(owner TEXT NOT NULL,room_id TEXT NOT NULL,request_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,room_id,request_id));
 CREATE INDEX IF NOT EXISTS mobile_task_activity ON mobile_task_events(room_id,created_at,owner);
 CREATE INDEX IF NOT EXISTS mobile_task_owner ON mobile_task_events(owner);
 CREATE TABLE IF NOT EXISTS mobile_beginner_rewards(owner TEXT NOT NULL,task_id TEXT NOT NULL,coins INTEGER NOT NULL,awarded_at INTEGER NOT NULL,PRIMARY KEY(owner,task_id));
 CREATE TABLE IF NOT EXISTS mobile_task_daily(owner TEXT NOT NULL,day TEXT NOT NULL,cooperation INTEGER NOT NULL DEFAULT 0,friend INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,day));
 CREATE TABLE IF NOT EXISTS mobile_task_gifts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,energy INTEGER NOT NULL,xp INTEGER NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,opened_at INTEGER,opened_request TEXT,UNIQUE(owner,source));
 CREATE INDEX IF NOT EXISTS mobile_task_inventory ON mobile_task_gifts(owner,opened_at,kind,created_at);
 CREATE TABLE IF NOT EXISTS mobile_task_gift_rewards(gift_id TEXT PRIMARY KEY,metadata TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_invitation_codes(owner TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS mobile_invitation_bindings(invitee TEXT PRIMARY KEY,inviter TEXT NOT NULL,bound_at INTEGER NOT NULL,contributions INTEGER NOT NULL DEFAULT 0,qualified_at INTEGER,reward_day TEXT,reward_status TEXT NOT NULL DEFAULT 'pending');
 CREATE INDEX IF NOT EXISTS mobile_invitation_rewards ON mobile_invitation_bindings(inviter,reward_day);
 CREATE INDEX IF NOT EXISTS mobile_invitation_cap ON mobile_invitation_bindings(inviter,qualified_at);
 CREATE TABLE IF NOT EXISTS mobile_invitation_shares(owner TEXT NOT NULL,day TEXT NOT NULL,ordinal INTEGER NOT NULL,request_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,day,ordinal),UNIQUE(owner,request_id));
 `);
 const bonusFor=p=>energyEnabled?readInviteCapBonus(p.id).count:0;
 const giftCount=owner=>Number(db.prepare('SELECT COUNT(*) n FROM mobile_task_gifts WHERE owner=? AND opened_at IS NULL').get(owner).n);
 function rewardFor(kind,settings){
  const baseline=KINDS.get(kind);if(!baseline)throw new Error('Unknown gift kind');
  const task=settings.tasks.find(task=>task.id===kind);
  if(task)return {...baseline,energyMin:task.energy,energyMax:task.energy,xp:task.xp,coins:task.coins??0};
  if(kind==='invite-refill')return {...baseline,xp:settings.invitationFriend.xp,coins:settings.invitationFriend.coins??0};
  if(kind.startsWith('ten-')){const tier=Number(kind.slice(4)),reward=tenGridReward(settings,tier===7?50:tier===6?20:0);return {...baseline,energyMin:reward.energyMin,energyMax:reward.energyMax,xp:reward.xp,coins:reward.coins};}
  return baseline;
 }
 function grant(owner,kind,source,now,energy,override){
  const configured=override??rewardFor(kind,readSettings()),reward={...configured,coins:configured.coins??0},giftId=randomBytes(16).toString('hex');
  const added=Number(db.prepare('INSERT OR IGNORE INTO mobile_task_gifts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(giftId,owner,kind,energy??reward.energyMin,reward.xp,source,now).changes);
  if(added)db.prepare('INSERT INTO mobile_task_gift_rewards VALUES(?,?)').run(giftId,JSON.stringify(reward));
  return added;
 }
 function invitationCode(owner){
  const existing=db.prepare('SELECT code FROM mobile_invitation_codes WHERE owner=?').get(owner);if(existing)return existing.code;
  for(;;){const code=randomBytes(6).toString('hex');const inserted=db.prepare('INSERT OR IGNORE INTO mobile_invitation_codes VALUES(?,?)').run(owner,code);if(inserted.changes)return code;}
 }
 function isLinked(a,b){return !!db.prepare('SELECT 1 FROM mobile_invitation_bindings WHERE (invitee=? AND inviter=?) OR (invitee=? AND inviter=?)').get(a,b,b,a);}
 function beginner(owner,now){
  const issued=new Set(db.prepare('SELECT task_id FROM mobile_beginner_rewards WHERE owner=?').all(owner).map(row=>row.task_id));
  if(BEGINNER_TASKS.every(task=>issued.has(task.id)))return {tasks:[],coins:0};
  // 复用有效落片流水，兼容已有进度；最多读100条，不按经验或拖动请求推算。
  const progress=Number(db.prepare('SELECT COUNT(*) n FROM (SELECT 1 FROM mobile_task_events WHERE owner=? LIMIT 100)').get(owner).n);let coins=0;
  for(const task of BEGINNER_TASKS)if(!issued.has(task.id)&&progress>=task.target){
   const added=db.prepare('INSERT OR IGNORE INTO mobile_beginner_rewards VALUES(?,?,?,?)').run(owner,task.id,task.coins,now);
   if(added.changes)coins+=awardCoins(owner,task.id,task.coins,now);
   issued.add(task.id);
  }
  return {tasks:BEGINNER_TASKS.filter(task=>!issued.has(task.id)).map(task=>({...task,progress:Math.min(progress,task.target),earned:false})),coins};
 }
 function view(p,now){
  const settings=readSettings(),day=mobileTaskDay(now),daily=db.prepare('SELECT cooperation,friend FROM mobile_task_daily WHERE owner=? AND day=?').get(p.id,day)??{cooperation:0,friend:0};
  const gifts=db.prepare(`SELECT g.kind,COUNT(*) count,
   MIN(CASE WHEN r.metadata IS NOT NULL THEN json_extract(r.metadata,'$.energyMin') WHEN g.kind LIKE 'ten-%' THEN 1 ELSE g.energy END) energyMin,
   MAX(CASE WHEN r.metadata IS NOT NULL THEN json_extract(r.metadata,'$.energyMax') WHEN g.kind LIKE 'ten-%' THEN CAST(substr(g.kind,5) AS INTEGER) ELSE g.energy END) energyMax,
   MIN(g.xp) xpMin,MAX(g.xp) xpMax,
   MIN(COALESCE(json_extract(r.metadata,'$.coins'),0)) coinsMin,MAX(COALESCE(json_extract(r.metadata,'$.coins'),0)) coinsMax
   FROM mobile_task_gifts g LEFT JOIN mobile_task_gift_rewards r ON r.gift_id=g.id WHERE g.owner=? AND g.opened_at IS NULL GROUP BY g.kind`).all(p.id);
  const inventory=[...KINDS].flatMap(([kind,baseline])=>{
   const gift=gifts.find(row=>row.kind===kind);if(!gift)return [];
   return [{kind,title:baseline.title,...(baseline.effect?{effect:baseline.effect}:{}),energyMin:gift.energyMin,energyMax:gift.energyMax,xp:gift.xpMin,...(gift.xpMin!==gift.xpMax?{xpMin:gift.xpMin,xpMax:gift.xpMax}:{}),coins:gift.coinsMin,...(gift.coinsMin!==gift.coinsMax?{coinsMin:gift.coinsMin,coinsMax:gift.coinsMax}:{}),count:Number(gift.count)}];
  });
  const bound=db.prepare('SELECT inviter FROM mobile_invitation_bindings WHERE invitee=?').get(p.id);
  const aggregate=db.prepare("SELECT COUNT(*) joined,SUM(CASE WHEN qualified_at IS NOT NULL THEN 1 ELSE 0 END) qualified,SUM(CASE WHEN reward_day=? THEN 1 ELSE 0 END) today FROM mobile_invitation_bindings WHERE inviter=?").get(day,p.id);
  const todayRewarded=Number(aggregate.today??0),tasks=TASK_REWARDS.map(t=>{
   const issued=db.prepare("SELECT g.energy,g.xp,COALESCE(json_extract(r.metadata,'$.coins'),0) coins FROM mobile_task_gifts g LEFT JOIN mobile_task_gift_rewards r ON r.gift_id=g.id WHERE g.owner=? AND g.source=?").get(p.id,'daily:'+day+':'+t.id),reward=issued??settings.tasks.find(reward=>reward.id===t.id);
   return {...t,...reward,coins:reward.coins??0,kind:t.id,progress:Math.min(t.target,daily[t.group]),earned:!!issued};
  });
  const todayShared=Number(db.prepare('SELECT COUNT(*) n FROM mobile_invitation_shares WHERE owner=? AND day=?').get(p.id,day).n);
  tasks.push({id:'share-invitation',kind:'share-invitation',group:'sharing',title:'观看 TapTap 广告',target:settings.invitationShare.dailyLimit,progress:Math.min(settings.invitationShare.dailyLimit,todayShared),earned:todayShared>=settings.invitationShare.dailyLimit,energy:settings.invitationShare.energy,xp:settings.invitationShare.xp,coins:settings.invitationShare.coins??0});
  tasks.push({id:'invite-friend',kind:'invite-refill',effect:'full-energy',group:'invitation',title:'邀请好友加入',target:3,progress:todayRewarded,earned:todayRewarded>=3,energy:0,xp:settings.invitationFriend.xp,coins:settings.invitationFriend.coins??0});
  tasks.unshift(...beginner(p.id,now).tasks);
  const tenReward=tenGridReward(settings,p.level);
  return {day,giftProgress:p.giftProgress,giftMinimum:tenReward.energyMin,giftMaximum:tenReward.energyMax,giftXp:tenReward.xp,giftCoins:tenReward.coins,giftCount:giftCount(p.id),tasks,inventory,invitation:{code:invitationCode(p.id),bound:!!bound,boundToName:bound?readProfile(bound.inviter,now).name:null,joinedCount:Number(aggregate.joined),qualifiedCount:Number(aggregate.qualified??0),...(energyEnabled?{capBonus:bonusFor(p),capBonusMaximum:readInviteCapBonus(p.id).maximum}:{}),todayRewarded,dailyLimit:3,requiredContributions:3,overflowPolicy:'no-carryover',shareDailyLimit:settings.invitationShare.dailyLimit,todayShared},serverTime:now};
 }
 function share(p,input,now){
  const settings=readSettings(),day=mobileTaskDay(now),count=Number(db.prepare('SELECT COUNT(*) n FROM mobile_invitation_shares WHERE owner=? AND day=?').get(p.id,day).n);
  if(count>=settings.invitationShare.dailyLimit)return {energy:0,xp:0,coins:0,levels:0,alreadyRewarded:true};
  db.prepare('INSERT INTO mobile_invitation_shares VALUES(?,?,?,?,?)').run(p.id,day,count+1,input.requestId,now);
  const gameSettings=readGameSettings(),inviteBonus=bonusFor(p),xp=settings.invitationShare.xp,energy=energyEnabled?settings.invitationShare.energy:0,levels=applyExperience(p,xp,now,gameSettings,{energyEnabled,inviteBonus});p.energy+=energy;if(energyEnabled&&p.energy>=effectiveEnergyCap(p.level,gameSettings,inviteBonus))p.energyAt=now;
  const coins=awardCoins(p.id,'share:'+input.requestId,settings.invitationShare.coins??0,now);
  p.lastReward={type:'invitation-share',energy,xp,coins,levels,giftsAdded:0,gift:0,energySpent:0,autoUsed:false,at:now};
  return {energy,xp,coins,levels,alreadyRewarded:false};
 }
 function accept(p,input,now){
  if(typeof input.code!=='string'||!/^[a-f0-9]{12}$/i.test(input.code.trim()))reject(400,'INVALID_INVITATION','请输入12位好友邀请码');
  const code=input.code.trim().toLowerCase(),inviter=db.prepare('SELECT owner FROM mobile_invitation_codes WHERE code=?').get(code)?.owner;
  if(!inviter)reject(404,'INVITATION_NOT_FOUND','好友邀请码不存在');
  if(inviter===p.id)reject(409,'SELF_INVITATION','不能使用自己的邀请码');
  const old=db.prepare('SELECT inviter FROM mobile_invitation_bindings WHERE invitee=?').get(p.id);
  if(old&&old.inviter!==inviter)reject(409,'INVITATION_ALREADY_BOUND','已经绑定过另一位好友的邀请');
  if(!old)db.prepare('INSERT INTO mobile_invitation_bindings(invitee,inviter,bound_at) VALUES(?,?,?)').run(p.id,inviter,now);
  return {alreadyBound:!!old,inviterName:readProfile(inviter,now).name};
 }
 function record(p,room,requestId,pendingGift,now,onlineMs){
  const inserted=db.prepare('INSERT OR IGNORE INTO mobile_task_events VALUES(?,?,?,?)').run(p.id,room.id,requestId,now);if(!inserted.changes)return 0;
  let giftsAdded=0;
  if(pendingGift)giftsAdded+=grant(p.id,'ten-'+pendingGift.maximum,'ten:'+pendingGift.sequence,now,pendingGift.energy,{title:'十格小礼',energyMin:pendingGift.energyMin??1,energyMax:pendingGift.energyMax??pendingGift.maximum,xp:pendingGift.xp??0,coins:pendingGift.coins??0});
  const active=new Set(db.prepare('SELECT DISTINCT owner FROM mobile_task_events WHERE room_id=? AND created_at>=? AND created_at<=? AND owner<>?').all(room.id,now-120000,now,p.id).map(r=>r.owner));
  const partners=room.members.filter(m=>m.guestId!==p.id&&!m.bot&&m.guestId&&now-m.lastSeen<onlineMs&&active.has(m.guestId));
  // Invite bindings retain their historical rules; accepted social friendships are checked live.
  // Merely accepting a request never creates an event or an invitation qualification.
  const friend=partners.some(m=>isLinked(p.id,m.guestId)||areFriends(p.id,m.guestId)===true)?1:0,day=mobileTaskDay(now);
  db.prepare('INSERT INTO mobile_task_daily VALUES(?,?,?,?) ON CONFLICT(owner,day) DO UPDATE SET cooperation=cooperation+excluded.cooperation,friend=friend+excluded.friend').run(p.id,day,1,friend);
  const daily=db.prepare('SELECT cooperation,friend FROM mobile_task_daily WHERE owner=? AND day=?').get(p.id,day);
  for(const task of TASK_REWARDS)if(daily[task.group]>=task.target)giftsAdded+=grant(p.id,task.id,'daily:'+day+':'+task.id,now);
  const binding=db.prepare('SELECT * FROM mobile_invitation_bindings WHERE invitee=?').get(p.id);
  if(binding&&binding.qualified_at===null){
   const count=binding.contributions+1;
   db.prepare('UPDATE mobile_invitation_bindings SET contributions=? WHERE invitee=?').run(count,p.id);
   if(count>=3){
    const used=Number(db.prepare('SELECT COUNT(*) n FROM mobile_invitation_bindings WHERE inviter=? AND reward_day=?').get(binding.inviter,day).n),eligible=used<3;
    db.prepare('UPDATE mobile_invitation_bindings SET qualified_at=?,reward_day=?,reward_status=? WHERE invitee=? AND qualified_at IS NULL').run(now,eligible?day:null,eligible?'awarded':'daily-limit',p.id);
    invalidateInviteCapBonus(binding.inviter);
    if(eligible&&grant(binding.inviter,'invite-refill','invite:'+p.id,now)){
     const inviter=readProfile(binding.inviter,now);inviter.lastReward={type:'invitation-gift',giftsAdded:1,xp:0,energySpent:0,gift:0,levels:0,autoUsed:false,at:now};saveProfile(inviter);
    }
   }
  }
  return giftsAdded;
 }
 function open(p,input,now){
  if(typeof input.kind!=='string'||!KINDS.has(input.kind))reject(400,'INVALID_GIFT_KIND','礼包种类无效');
  if(!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>20)reject(400,'INVALID_GIFT_QUANTITY','每次可开启1～20份礼包');
  const effect=KINDS.get(input.kind).effect;
  if(effect==='full-energy'&&input.quantity!==1)reject(400,'INVALID_GIFT_QUANTITY','补满体力包每次只能开启1份');
  const gifts=db.prepare("SELECT g.id,g.energy,g.xp,COALESCE(json_extract(r.metadata,'$.coins'),0) coins FROM mobile_task_gifts g LEFT JOIN mobile_task_gift_rewards r ON r.gift_id=g.id WHERE g.owner=? AND g.kind=? AND g.opened_at IS NULL ORDER BY g.created_at,g.id LIMIT ?").all(p.id,input.kind,input.quantity);
  if(gifts.length!==input.quantity)reject(409,'GIFT_EMPTY','剩余礼包数量不足，请刷新后重试');
  const gameSettings=readGameSettings(),inviteBonus=bonusFor(p);
  if(energyEnabled&&effect==='full-energy'&&p.energy>=effectiveEnergyCap(p.level,gameSettings,inviteBonus))reject(409,'ENERGY_FULL','体力已满，补满体力包已为你保留');
  const xp=gifts.reduce((sum,g)=>sum+g.xp,0),levels=applyExperience(p,xp,now,gameSettings,{energyEnabled,inviteBonus}),energy=!energyEnabled?0:effect==='full-energy'?Math.max(0,effectiveEnergyCap(p.level,gameSettings,inviteBonus)-p.energy):gifts.reduce((sum,g)=>sum+g.energy,0);
  const effectResult=effect?{effect}:{};
  let coins=0;
  for(const gift of gifts){const change=db.prepare('UPDATE mobile_task_gifts SET opened_at=?,opened_request=? WHERE id=? AND owner=? AND opened_at IS NULL').run(now,input.requestId,gift.id,p.id);if(change.changes!==1)reject(409,'GIFT_EMPTY','礼包已经开启，请刷新后重试');coins+=awardCoins(p.id,'gift:'+gift.id,gift.coins,now);}
  p.energy+=energy;if(energyEnabled&&p.energy>=effectiveEnergyCap(p.level,gameSettings,inviteBonus))p.energyAt=now;
  p.lastReward={type:'gift-open',...effectResult,quantity:input.quantity,energy,xp,coins,levels,gift:0,giftsAdded:0,energySpent:0,autoUsed:false,at:now};
  return {kind:input.kind,...effectResult,quantity:input.quantity,energy,xp,coins,levels};
 }
 return {view,accept,record,open,share,giftCount,beginner};
}
