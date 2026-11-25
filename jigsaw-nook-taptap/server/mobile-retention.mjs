import {readFileSync} from 'node:fs';
import defaults from '../config/retention-rewards.json' with {type:'json'};
import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};
import {mobileTaskDay} from './mobile-tasks.mjs';

const positive=value=>Number.isSafeInteger(value)&&value>0;
const invalid=()=>{throw new TypeError('Invalid retention configuration');};
const reject=(code,message)=>{throw Object.assign(new Error(message),{status:409,code});};
const previousDay=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);

export function readRetentionConfiguration(config){
 const value=structuredClone(config??(process.env.MOBILE_RETENTION_CONFIG?JSON.parse(readFileSync(process.env.MOBILE_RETENTION_CONFIG,'utf8')):defaults));
 if(value?.schema!=='jigsaw-retention/v1'||!Array.isArray(value.weeklyGift?.days)||value.weeklyGift.days.length!==7)invalid();
 for(const [index,reward]of value.weeklyGift.days.entries()){
  if(reward?.day!==index+1)invalid();
  if(['energy-pack','create-ticket'].includes(reward.kind)){if(!positive(reward.amount)||!positive(reward.fallbackCoins))invalid();}
  else if(reward.kind==='coins'){if(!positive(reward.amount))invalid();}
  else if(reward.kind==='decoration'){if(!positive(reward.coins)||!catalog.rewardDecorations.some(item=>item.id===reward.decorationId))invalid();}
  else invalid();
 }
 const streak=value.dailyStreak;
 if(!positive(streak?.cycle)||!Array.isArray(streak.milestones))invalid();
 const seen=new Set();
 for(const milestone of streak.milestones){
  if(!positive(milestone?.at)||milestone.at>streak.cycle||!positive(milestone.coins)||seen.has(milestone.at))invalid();
  seen.add(milestone.at);
 }
 streak.milestones.sort((a,b)=>a.at-b.at);
 return value;
}

/** Mutations run in the service's IMMEDIATE transaction, including profile saves. */
export function createMobileRetention({db,config,awardCoins,grantDecoration}){
 const {weeklyGift:{days},dailyStreak:{cycle,milestones}}=readRetentionConfiguration(config);
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_weekly_gift(owner TEXT PRIMARY KEY,login_days INTEGER NOT NULL,last_login_day TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,last_claim_day TEXT,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_weekly_gift_claims(owner TEXT NOT NULL,day INTEGER NOT NULL,claimed_on TEXT NOT NULL,reward TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,day));
 CREATE TABLE IF NOT EXISTS mobile_daily_streak(owner TEXT PRIMARY KEY,count INTEGER NOT NULL,last_day TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_daily_streak_awards(owner TEXT NOT NULL,day TEXT NOT NULL,streak INTEGER NOT NULL,coins INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,day));
 `);
 const weeklyRow=db.prepare('SELECT * FROM mobile_weekly_gift WHERE owner=?');
 // One owner lookup for each summary; the latest award uses the existing owner/day index.
 const streakRow=db.prepare(`SELECT s.*, (SELECT json_object('day',a.day,'streak',a.streak,'coins',a.coins,'at',a.created_at) FROM mobile_daily_streak_awards a WHERE a.owner=s.owner ORDER BY a.day DESC LIMIT 1) AS last_award FROM mobile_daily_streak s WHERE s.owner=?`);
 const giftState=(row,now)=>{const claimed=row?.claimed??0,available=claimed<7&&row?.last_claim_day!==mobileTaskDay(now);return {claimed,available};};
 function login(owner,now){
  db.prepare(`INSERT INTO mobile_weekly_gift(owner,login_days,last_login_day,updated_at) VALUES(?,1,?,?) ON CONFLICT(owner) DO UPDATE SET login_days=login_days+1,last_login_day=excluded.last_login_day,updated_at=excluded.updated_at WHERE last_login_day<>excluded.last_login_day`).run(owner,mobileTaskDay(now),now);
 }
 function weeklyView(owner,now){
  const row=weeklyRow.get(owner),{claimed,available}=giftState(row,now),next=(available?claimed+1:claimed)+1;
  return {days:days.map(({fallbackCoins,...reward})=>({...reward,state:reward.day<=claimed?'claimed':reward.day===claimed+1&&available?'today':'future'})),claimed,loginDays:row?.login_days??0,available,done:claimed>=7,tomorrowDay:next>7?null:next};
 }
 function streakState(row,today){
  return {count:row&&row.last_day>=previousDay(today)?row.count:0,todayDone:row?.last_day===today,lastAward:row?.last_award?JSON.parse(row.last_award):null};
 }
 function dailyView(owner,today){
  const state=streakState(streakRow.get(owner),today),position=state.count?(state.todayDone?((state.count-1)%cycle)+1:state.count%cycle):0;
  const milestone=milestones.find(item=>item.at>position);
  return {...state,day:today,next:milestone?{...milestone,in:milestone.at-position}:null};
 }
 function summary(owner,now,today){
  return {weeklyGiftAvailable:giftState(weeklyRow.get(owner),now).available,dailyStreak:streakState(streakRow.get(owner),today)};
 }
 function claim(p,now){
  login(p.id,now);
  const {claimed,available}=giftState(weeklyRow.get(p.id),now);
  if(claimed>=7)reject('WEEKLY_GIFT_DONE','七日礼已经全部领完');
  if(!available)reject('WEEKLY_GIFT_UNAVAILABLE','今天的礼物已经领过了');
  const reward=days[claimed],granted={day:reward.day,kind:reward.kind,amount:0,coins:0,fallback:false};
  if(reward.kind==='coins')granted.coins=reward.amount;
  else if(reward.kind==='decoration'){
   grantDecoration(p.id,reward.decorationId,now);granted.decorationId=reward.decorationId;granted.coins=reward.coins;
  }else{
   const supply=reward.kind==='energy-pack'?'energy':'create';
   if(p.supply[supply]>=3){granted.coins=reward.fallbackCoins;granted.fallback=true;}
   else {granted.amount=Math.min(reward.amount,3-p.supply[supply]);p.supply[supply]+=granted.amount;}
  }
  if(granted.coins)awardCoins(p.id,'weekly-gift:'+reward.day,granted.coins,now);
  db.prepare('INSERT INTO mobile_weekly_gift_claims VALUES(?,?,?,?,?)').run(p.id,reward.day,mobileTaskDay(now),JSON.stringify(granted),now);
  db.prepare('UPDATE mobile_weekly_gift SET claimed=?,last_claim_day=?,updated_at=? WHERE owner=?').run(reward.day,mobileTaskDay(now),now,p.id);
  return granted;
 }
 function dailyMerge(owner,today,now){
  // Roll back a partially paid retention award without undoing a valid puzzle merge.
  db.exec('SAVEPOINT retention_daily');
  try{
   const old=db.prepare('SELECT count,last_day FROM mobile_daily_streak WHERE owner=?').get(owner);
   if(!old||old.last_day<today){
    const count=old?.last_day===previousDay(today)?old.count+1:1,milestone=milestones.find(item=>item.at===((count-1)%cycle)+1);
    if(milestone){
     awardCoins(owner,'daily-streak:'+today,milestone.coins,now);
     db.prepare('INSERT INTO mobile_daily_streak_awards VALUES(?,?,?,?,?)').run(owner,today,count,milestone.coins,now);
    }
    db.prepare('INSERT INTO mobile_daily_streak VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET count=excluded.count,last_day=excluded.last_day,updated_at=excluded.updated_at').run(owner,count,today,now);
   }
   db.exec('RELEASE retention_daily');
  }catch(error){db.exec('ROLLBACK TO retention_daily; RELEASE retention_daily');throw error;}
 }
 return {login,claim,dailyMerge,summary,view:(owner,now,today)=>({weeklyGift:weeklyView(owner,now),dailyStreak:dailyView(owner,today)})};
}
