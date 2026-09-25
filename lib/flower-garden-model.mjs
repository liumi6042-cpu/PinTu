import {initial,act} from '../public/flower-garden/engine.mjs';
import {prices,themes} from './courtyard-model.mjs';
import {activityState,creditActivity} from '../public/flower-garden/catalog.mjs';

// Conversion and the new inventory are saved by the caller in one CAS transaction.
export function migrateFlowerGarden(s,now=Date.now()){
 if(s.flowerGarden)return false;
 const legacy={owned:structuredClone(s.owned||{}),themes:[...(s.themes||[])],layout:structuredClone(s.layout||[])};
 let amount=0;
 for(const [id,n] of Object.entries(legacy.owned))if(Object.hasOwn(prices,id)&&Number.isSafeInteger(n)&&n>0)amount+=prices[id]*n;
 for(const id of new Set(legacy.themes))if(Object.hasOwn(themes,id))amount+=themes[id];
 const g=initial();g.coins=0;g.offset=0;g.activity={id:'woodland-seven-v1',startedAt:now,days:[],claimed:0,lastClaimDay:'',dismissed:false};
 s.flowerGarden=g;s.flowerMigration={version:1,at:now,amount,legacy};s.balance+=amount;s.owned={};s.redeemed={};s.layout=[];s.themes=['wood'];s.activeTheme='wood';
 s.ledger.unshift({reason:'旧庭院资产折算',amount,at:new Date(now).toISOString()});s.ledger=s.ledger.slice(0,50);return true;
}
export function flowerState(s,version=0){
 const g=structuredClone(s.flowerGarden);
 return {...g,version,coins:s.balance,eggStyle:s.eggStyle,progress:s.progress,hatched:s.hatched,hatchDay:s.day,dailyHatches:s.dailyHatches,day:s.checkinDay,cosmetics:structuredClone(s.cosmetics||{bubbles:[],cursors:[],equipped:{bubble:null,cursor:null}}),migration:s.flowerMigration?{amount:s.flowerMigration.amount}:null};
}
const allowed=new Set(['buySeed','plant','harvest','expand','rotate','move','place','store','buyDecor','hatch','activityDismiss','activityClaim']);
export function applyFlowerAction(s,input,now=Date.now(),random=Math.random){
 if(!allowed.has(input.action))throw Error('不支持的花园操作');
 migrateFlowerGarden(s,now);
 const g=flowerState(s,input.version),out=act(g,input,now,random),n=out.state;
 s.balance=n.coins;s.progress=n.progress;s.hatched=n.hatched;s.day=n.hatchDay;s.dailyHatches=n.dailyHatches;s.cosmetics=n.cosmetics;
 const {coins,progress,hatched,hatchDay,dailyHatches,day,cosmetics,migration,...garden}=n;s.flowerGarden=garden;
 if(input.action==='hatch'){s.eggStyle=(s.eggStyle+1+Math.floor(random()*9))%10;s.lastHatch={kind:out.result.kind,item:out.result.type,requestId:input.requestId};}
 if(out.result?.text){s.ledger.unshift({reason:out.result.text,amount:n.coins-g.coins,at:new Date(now).toISOString()});s.ledger=s.ledger.slice(0,50);}
 // Keep a bounded response receipt, so retrying a lost response shows the same reward.
 s.flowerResults??={};s.flowerResults[input.requestId]=out.result;
 const keys=Object.keys(s.flowerResults);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete s.flowerResults[key];
 return out.result;
}
export function creditFlowerActivity(s,completion){if(!s.flowerGarden)return false;return creditActivity(s.flowerGarden,completion);}
export function grantFlowerCheckin(s,random=Math.random){if(s.flowerGarden){const id='f'+Math.floor(random()*20);s.flowerGarden.seeds[id]=(s.flowerGarden.seeds[id]||0)+3;}}
