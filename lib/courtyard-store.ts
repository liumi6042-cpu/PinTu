import {migrateFlowerGarden,applyFlowerAction,creditFlowerActivity,grantFlowerCheckin} from './flower-garden-model.mjs';
import {cosmeticsOf,drawCosmetic,validStyle} from '../public/cosmetics/catalog.mjs';
import {localDb} from './local-db';
import {RoomError,type Room} from './room-engine';
import {initialGarden,hatchFurniture,retireStarterFurniture,validateLayout,prices,themes} from './courtyard-model.mjs';
import {baseHatchProgress,contributionProgress,roundProgress} from './hatch-feedback';
import {pieceBand} from './piece-policy';
type Garden=Omit<ReturnType<typeof initialGarden>,'owned'|'redeemed'|'ledger'|'layout'> & {owned:Record<string,number>;redeemed:Record<string,number>;ledger:{reason:string;amount:number;at:string}[];layout:unknown[];cosmetics?:{bubbles:string[];cursors:string[];equipped:{bubble:string|null;cursor:string|null}};flowerGarden?:any;flowerMigration?:any;flowerResults?:Record<string,any>;lastHatch?:{kind?:string;item:string;requestId:string}};
const day=(now:number)=>new Date(now).toISOString().slice(0,10);
export async function gardenFor(id:string){
 const db=localDb();await db.prepare('INSERT OR IGNORE INTO puzzle_courtyards(user_id,data) SELECT id,? FROM puzzle_users WHERE id=?').bind(JSON.stringify(initialGarden()),id).run();
 for(let retry=0;retry<8;retry++){
  const row=await db.prepare('SELECT version,data FROM puzzle_courtyards WHERE user_id=?').bind(id).first<{version:number;data:string}>();if(!row)throw new RoomError('请先登录',401);
  const state=JSON.parse(row.data) as Garden;if(!retireStarterFurniture(state))return {version:row.version,state};
  const result=await db.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=? AND version=?').bind(JSON.stringify(state),id,row.version).run();
  if(result.meta.changes===1)return {version:row.version+1,state};
 }
 throw new RoomError('庭院正在同步，请稍后重试',409);
}
export async function update(id:string,op:string,kind:string,transform:(state:Garden)=>Promise<void>|void,image:string|null=null,expected?:number,eventTime?:number){
 const db=localDb();for(let n=0;n<8;n++){
 if(await db.prepare('SELECT 1 FROM puzzle_courtyard_events WHERE user_id=? AND operation=?').bind(id,op).first())return gardenFor(id);
 const current=await gardenFor(id);if(expected!==undefined&&expected!==current.version)throw new RoomError('庭院已在其他页面更新，请刷新后重试',409);
 await transform(current.state);const now=eventTime??Date.now();
 const results=await db.batch([
 db.prepare('INSERT OR IGNORE INTO puzzle_courtyard_events(user_id,operation,kind,image_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM puzzle_courtyards WHERE user_id=? AND version=?)').bind(id,op,kind,image,now,id,current.version),
 db.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=? AND version=? AND changes()=1').bind(JSON.stringify(current.state),id,current.version)
 ]);if(results[1].meta.changes===1)return gardenFor(id);
 }throw new RoomError('庭院正在同步，请稍后重试',409);
}
function addLedger(s:Garden,reason:string,amount:number){s.ledger.unshift({reason,amount,at:new Date().toISOString()});s.ledger=s.ledger.slice(0,50);}
export async function gardenAction(id:string,input:Record<string,unknown>){
 const action=String(input.action),op=input.requestId,version=input.version;
 if(typeof op!=='string'||!/^[a-f0-9]{32}$/.test(op)||!Number.isSafeInteger(version))throw new RoomError('请求格式无效');
 return update(id,op,action,s=>{const today=day(Date.now());if(s.day!==today){s.day=today;s.dailyHatches=0;}
 const item=String(input.item??'');
 switch(action){
 case 'checkin':if(s.checkinDay===today)throw new RoomError('今日已签到',409);s.checkinDay=today;s.checkins++;grantFlowerCheckin(s);{const amount=s.checkins%7===0?4:1;s.balance+=amount;addLedger(s,'签到',amount);}break;
 case 'hatch':{if(s.flowerGarden){applyFlowerAction(s,{action:'hatch',version:version as number,requestId:op});break;}const needed=s.hatched?100:50;if(s.progress<needed||s.dailyHatches>=2)throw new RoomError('进度不足或今日已孵满',409);s.progress=roundProgress(s.progress-needed);s.hatched++;s.dailyHatches++;const cosmetic=drawCosmetic(s);if(cosmetic){s.cosmetics=cosmeticsOf(s);(cosmetic.kind==='bubble'?s.cosmetics.bubbles:s.cosmetics.cursors).push(cosmetic.item);s.lastHatch={...cosmetic,requestId:op};addLedger(s,'孵化装扮:'+cosmetic.kind+':'+cosmetic.item,0);}else{const reward=hatchFurniture(s.owned);s.owned[reward]=(s.owned[reward]||0)+1;s.lastHatch={kind:'furniture',item:reward,requestId:op};addLedger(s,'孵化物品:'+reward,0);}s.eggStyle=(s.eggStyle+1+Math.floor(Math.random()*9))%10;break;}
 case 'equip':{const kind=input.kind;if(kind!=='bubble'&&kind!=='cursor')throw new RoomError('装扮类别无效');const c=cosmeticsOf(s);if(input.item!==null&&(!validStyle(input.item)||!(kind==='bubble'?c.bubbles:c.cursors).includes(input.item as string)))throw new RoomError('请先孵化解锁这款装扮',403);c.equipped[kind]=input.item===null?null:String(input.item);s.cosmetics=c;break;}
 case 'buy':{if(s.flowerGarden)throw new RoomError('请在花园兑换花种与装饰',409);if(!Object.hasOwn(prices,item))throw new RoomError('物品不存在');const price=(prices as Record<string,number>)[item];if(!price)throw new RoomError('物品不存在');if((s.redeemed[item]||0)>=10)throw new RoomError('已达到10件兑换上限',409);if(s.balance<price)throw new RoomError('碎片不足',409);s.balance-=price;s.owned[item]=(s.owned[item]||0)+1;s.redeemed[item]=(s.redeemed[item]||0)+1;addLedger(s,'兑换:'+item,-price);break;}
 case 'theme-buy':{if(s.flowerGarden)throw new RoomError('旧庭院外观已停用',409);if(!Object.hasOwn(themes,item))throw new RoomError('外观不存在');const price=(themes as Record<string,number>)[item];if(!price||s.themes.includes(item))throw new RoomError('外观已拥有或不存在',409);if(s.balance<price)throw new RoomError('碎片不足',409);s.balance-=price;s.themes.push(item);addLedger(s,'外观:'+item,-price);break;}
 case 'theme-use':if(s.flowerGarden)throw new RoomError('旧庭院外观已停用',409);if(!s.themes.includes(item))throw new RoomError('请先兑换外观',403);s.activeTheme=item;break;
 case 'layout':if(s.flowerGarden)throw new RoomError('请使用花园摆放功能',409);try{s.layout=validateLayout(input.layout,s.owned);}catch{throw new RoomError('摆放位置无效、物品重叠或库存不足');}break;
 default:throw new RoomError('不支持的操作');
 }
 },null,version as number);
}
export async function settleGarden(room:Room){
 if(!room.completedAt)return;const db=localDb(),start=await db.prepare("SELECT value FROM puzzle_courtyard_settings WHERE key='started_at'").first<number>('value');
 if(!start||room.completedAt<start||await db.prepare('SELECT 1 FROM puzzle_courtyard_settled WHERE room_id=?').bind(room.id).first())return;
 const band=pieceBand(room.puzzle.cols*room.puzzle.rows)||108;
 // Include guests and departed players in the denominator: their work is not reassigned.
 const eligible=Object.entries(room.achievements?.contributors||{}).filter(([,c])=>Number.isSafeInteger(c.count)&&c.count>0);
 const total=eligible.reduce((sum,[,c])=>sum+c.count,0);
 const date=day(room.completedAt),base=baseHatchProgress(band);
 for(const [owner,contribution] of eligible){if(!/^[a-f0-9]{32}$/.test(owner)||!await db.prepare('SELECT 1 FROM puzzle_users WHERE id=?').bind(owner).first())continue;
 await update(owner,'room:'+room.id,'completion',async s=>{
 const from=Date.parse(date+'T00:00:00Z');let gain=base;if(!await db.prepare("SELECT 1 FROM puzzle_courtyard_events WHERE user_id=? AND kind='completion' AND created_at>=? AND created_at<?").bind(owner,from,from+86400000).first()){gain+=5;s.completionDay=date;}
 if(!await db.prepare("SELECT 1 FROM puzzle_courtyard_events WHERE user_id=? AND image_id=? AND kind='completion'").bind(owner,room.puzzle.imageId).first())gain+=5;
 gain=contributionProgress(gain,contribution.count,total);
 creditFlowerActivity(s,{roomId:room.id,completedAt:room.completedAt,pieces:band,contribution:contribution.count,total});
 if(!s.firstDone){s.firstDone=true;s.balance++;addLedger(s,'首次完成',1);}s.progress=roundProgress(s.progress+gain);addLedger(s,'拼图进度 +'+gain+'%',0);
 },room.puzzle.imageId,undefined,room.completedAt);
 }
 await db.prepare('INSERT OR IGNORE INTO puzzle_courtyard_settled VALUES(?,?)').bind(room.id,room.completedAt).run();
}
export async function recoverGardenRewards(id:string){const db=localDb();const rows=await db.prepare("SELECT r.data FROM puzzle_rooms r WHERE json_extract(r.data,'$.completedAt') >= (SELECT value FROM puzzle_courtyard_settings WHERE key='started_at') AND EXISTS(SELECT 1 FROM json_each(r.data,'$.achievements.contributors') c WHERE c.key=?) AND NOT EXISTS(SELECT 1 FROM puzzle_courtyard_settled s WHERE s.room_id=r.id) ORDER BY json_extract(r.data,'$.completedAt') LIMIT 100").bind(id).all<{data:string}>();for(const r of rows.results)await settleGarden(JSON.parse(r.data));}

export async function ensureFlowerGarden(id:string){const current=await gardenFor(id);return current.state.flowerGarden?current:update(id,'flower-garden-migration-v1','migration',s=>{migrateFlowerGarden(s);});}
