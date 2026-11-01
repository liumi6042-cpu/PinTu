// 团子去旅行: 团子 packs a bag, leaves when the player has been away for a while, mails postcards (puzzles) and comes
// home with souvenirs. Everything is computed lazily from a seed fixed at departure — no timers, no pushes, nothing
// expires. Only players who have opened the nook (a tuanzi_state row) are ever written to, so old packages and players
// who never unlock it see no change. All writes run inside the service's IMMEDIATE transaction.
import {readFileSync} from 'node:fs';
import defaults from '../config/tuanzi-travel.json' with {type:'json'};
import imageRegions from '../config/tuanzi-image-regions.json' with {type:'json'};

const MINUTE=60000,HOUR=3600000;
const reject=(status,code,message,extra={})=>{throw Object.assign(new Error(message),{status,code,...extra});};
const invalid=why=>{throw new TypeError('Invalid tuanzi configuration: '+why);};
const ident=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const share=value=>typeof value==='number'&&value>=0&&value<=1;
const text=(value,max=60)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const span=value=>Array.isArray(value)&&value.length===2&&value.every(n=>typeof n==='number'&&n>=0)&&value[0]<=value[1];
/** Beijing calendar day of a timestamp (postmarks, the daily story-fish cap). */
export const beijingDay=time=>new Date(time+8*HOUR).toISOString().slice(0,10);
/** Small deterministic generator for trip plans (mulberry32). */
export function seeded(seed){let a=seed>>>0;return ()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const pick=(list,r)=>list[Math.min(list.length-1,Math.floor(r()*list.length))];
function weighted(entries,r){const total=entries.reduce((n,[,w])=>n+w,0);let x=r()*total;for(const [value,w]of entries){if((x-=w)<0)return value;}return entries.at(-1)?.[0];}

export function readTuanziConfiguration(config){
 const value=structuredClone(config??(process.env.MOBILE_TUANZI_CONFIG?JSON.parse(readFileSync(process.env.MOBILE_TUANZI_CONFIG,'utf8')):defaults));
 if(value?.schema!=='jigsaw-tuanzi/v1')invalid('schema');
 if(typeof value.unlockLevelId!=='string')invalid('unlockLevelId');
 const regions=value.regions;if(!Array.isArray(regions)||regions.length!==4||!regions.every(r=>ident(r?.id)&&text(r.title,8)))invalid('regions');
 const regionIds=new Set(regions.map(r=>r.id));if(!regionIds.has('town')||!share(value.townShare))invalid('town');
 const items=[...value.foods??[],...value.tools??[],...value.charms??[]];
 if(new Set(items.map(item=>item.id)).size!==items.length||!items.every(item=>ident(item.id)&&text(item.title,12)&&positive(item.price)))invalid('shop');
 for(const food of value.foods){if(!span(food.hours)||food.hours[0]<1||!span(food.cards)||food.cards[0]<1||!value.postcardPieces.includes(food.pieces)||!share(food.souvenirChance))invalid('food '+food.id);}
 for(const tool of value.tools)if(!regionIds.has(tool.region))invalid('tool '+tool.id);
 for(const charm of value.charms)if(!['rare-double','souvenir-sure'].includes(charm.effect))invalid('charm '+charm.id);
 const fish=value.fish;if(![fish?.daily,fish?.level,fish?.levelDailyCap,fish?.postcard,fish?.welcome,fish?.duplicate,fish?.sill?.everyMinutes,fish?.sill?.amount,fish?.sill?.stack].every(positive)||!['48','108','300','500'].every(key=>positive(fish.rooms?.[key]))||!value.foods.some(food=>food.id===fish.welcomeItem))invalid('fish');
 if(!positive(value.departure?.idleMinutes)||!span(value.departure.delayMinutes)||!positive(value.firstTrip?.minutes)||!regionIds.has(value.firstTrip.region)||!positive(value.firstCard?.afterMinutes)||!share(value.firstCard.beforeShare))invalid('timing');
 if(!Number.isInteger(value.nightCardBeijingHour)||value.nightCardBeijingHour<0||value.nightCardBeijingHour>23||!share(value.rareChance)||!share(value.collectedWeight))invalid('chances');
 if(!Array.isArray(value.stickers)||value.stickers.length!==6||!value.stickers.every(s=>ident(s.id)&&text(s.title,8)))invalid('stickers');
 for(const region of regionIds){if(!Array.isArray(value.places?.[region])||!value.places[region].length||!value.places[region].every(p=>text(p,12))||!Array.isArray(value.lines?.[region])||value.lines[region].length<5||!value.lines[region].every(l=>text(l,40)))invalid('words '+region);}
 if(!Array.isArray(value.souvenirs)||!value.souvenirs.every(s=>ident(s.id)&&text(s.title,8)&&regionIds.has(s.region))||[...regionIds].some(region=>value.souvenirs.filter(s=>s.region===region).length!==4))invalid('souvenirs');
 const art=card=>ident(card?.id)&&text(card.title,12)&&regionIds.has(card.region)&&/^\/puzzles\/tuanzi-card-[a-z0-9-]+\.webp$/.test(card.src)&&/^\/puzzles\/tuanzi-card-[a-z0-9-]+\.webp$/.test(card.thumbSrc)&&positive(card.width)&&positive(card.height);
 if(!Array.isArray(value.rare)||value.rare.length!==12||!value.rare.every(art)||[...regionIds].some(region=>value.rare.filter(card=>card.region===region).length!==3))invalid('rare');
 if(!Array.isArray(value.special)||!value.special.every(card=>art(card)&&text(card.place,12)&&text(card.line,40))||!value.special.some(card=>card.id===value.firstTrip.cardId))invalid('special');
 if(!Array.isArray(value.rewards?.total)||!value.rewards.total.every(reward=>positive(reward.at)&&(positive(reward.fish)||ident(reward.decorationId)||ident(reward.itemId)))||!positive(value.rewards.region?.at)||!Array.isArray(value.rewards.rare?.itemIds))invalid('rewards');
 return value;
}

/** Image id → region, read from the content config; anything unlisted (or unsure) is 小镇. */
export function readImageRegions(map){
 const value=map??(process.env.MOBILE_TUANZI_REGIONS?JSON.parse(readFileSync(process.env.MOBILE_TUANZI_REGIONS,'utf8')):imageRegions);
 if(!value||typeof value!=='object'||value.schema!=='jigsaw-tuanzi-regions/v1'||typeof value.images!=='object')invalid('regions map');
 return new Map(Object.entries(value.images).filter(([,region])=>['water','street','wild','town'].includes(region)));
}

/**
 * db: the service SQLite handle. cleared(owner): has the owner cleared the unlock level. pool(now): postcard pictures
 * ({id,title,src,thumbSrc,width,height}) — gallery pictures without story ones. albumOf(imageId,now): {id,title,paid}|null.
 * grid(picture,pieces): {cols,rows}|null. grantDecoration(owner,id,now): cursor rewards. randomInt(min,max): trip seeds.
 */
export function createMobileTuanzi({db,config,regions,cleared,pool,albumOf,grid,grantDecoration,randomInt}){
 const cfg=readTuanziConfiguration(config),regionOf=readImageRegions(regions);
 const foods=new Map(cfg.foods.map(item=>[item.id,item])),tools=new Map(cfg.tools.map(item=>[item.id,item])),charms=new Map(cfg.charms.map(item=>[item.id,item]));
 const shop=new Map([...cfg.foods.map(item=>[item.id,{...item,slot:'food'}]),...cfg.tools.map(item=>[item.id,{...item,slot:'tool'}]),...cfg.charms.map(item=>[item.id,{...item,slot:'charm'}])]);
 const rareById=new Map(cfg.rare.map(card=>[card.id,card])),specialById=new Map(cfg.special.map(card=>[card.id,card])),regionTitle=new Map(cfg.regions.map(r=>[r.id,r.title]));
 db.exec(`
 CREATE TABLE IF NOT EXISTS tuanzi_state(owner TEXT PRIMARY KEY,status TEXT NOT NULL,fish INTEGER NOT NULL DEFAULT 0,pack TEXT,trip TEXT,trips INTEGER NOT NULL DEFAULT 0,sill_at INTEGER NOT NULL,active_at INTEGER NOT NULL,unlocked_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tuanzi_items(owner TEXT NOT NULL,item_id TEXT NOT NULL,count INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,item_id));
 CREATE TABLE IF NOT EXISTS tuanzi_fish_ledger(owner TEXT NOT NULL,request_id TEXT NOT NULL,amount INTEGER NOT NULL,source TEXT NOT NULL,day TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,request_id));
 CREATE INDEX IF NOT EXISTS tuanzi_fish_ledger_source ON tuanzi_fish_ledger(owner,source,day);
 CREATE TABLE IF NOT EXISTS tuanzi_postcards(owner TEXT NOT NULL,card_id TEXT NOT NULL,kind TEXT NOT NULL,image_id TEXT,rare_id TEXT,region TEXT NOT NULL,place TEXT NOT NULL,date TEXT NOT NULL,sticker TEXT NOT NULL,line TEXT NOT NULL,pieces INTEGER NOT NULL,trip_id TEXT,arrived_at INTEGER NOT NULL,read_at INTEGER,completed_at INTEGER,room_id TEXT,PRIMARY KEY(owner,card_id));
 CREATE TABLE IF NOT EXISTS tuanzi_souvenirs(owner TEXT NOT NULL,souvenir_id TEXT NOT NULL,count INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,PRIMARY KEY(owner,souvenir_id));
 `);
 const stateRow=db.prepare('SELECT * FROM tuanzi_state WHERE owner=?');
 const readState=owner=>{const row=stateRow.get(owner);return row?{...row,pack:row.pack?JSON.parse(row.pack):null,trip:row.trip?JSON.parse(row.trip):null}:null;};
 const writeState=(s,now)=>db.prepare('UPDATE tuanzi_state SET status=?,pack=?,trip=?,trips=?,sill_at=?,active_at=?,updated_at=? WHERE owner=?').run(s.status,s.pack?JSON.stringify(s.pack):null,s.trip?JSON.stringify(s.trip):null,s.trips,s.sill_at,s.active_at,now,s.owner);
 const fishOf=owner=>Number(db.prepare('SELECT fish FROM tuanzi_state WHERE owner=?').get(owner)?.fish??0);
 /** Ledger keys are unique per owner, so every grant happens once whatever retries it. */
 function credit(owner,key,amount,source,now){
  if(!amount)return false;
  const inserted=db.prepare('INSERT OR IGNORE INTO tuanzi_fish_ledger VALUES(?,?,?,?,?,?)').run(owner,key,amount,source,beijingDay(now),now).changes===1;
  if(inserted)db.prepare('UPDATE tuanzi_state SET fish=fish+?,updated_at=? WHERE owner=?').run(amount,now,owner);
  return inserted;
 }
 const itemCount=(owner,itemId)=>Number(db.prepare('SELECT count FROM tuanzi_items WHERE owner=? AND item_id=?').get(owner,itemId)?.count??0);
 const addItem=(owner,itemId,n,now)=>db.prepare('INSERT INTO tuanzi_items VALUES(?,?,?,?) ON CONFLICT(owner,item_id) DO UPDATE SET count=count+excluded.count,updated_at=excluded.updated_at').run(owner,itemId,n,now);
 const takeItem=(owner,itemId,now)=>{if(itemCount(owner,itemId)<1)reject(409,'TUANZI_ITEM_MISSING','背包里没有这件东西，先去杂货铺看看');db.prepare('UPDATE tuanzi_items SET count=count-1,updated_at=? WHERE owner=? AND item_id=?').run(now,owner,itemId);};
 const owned=(owner,itemId)=>itemCount(owner,itemId)>0;
 const cards=owner=>db.prepare('SELECT * FROM tuanzi_postcards WHERE owner=? ORDER BY arrived_at DESC, card_id').all(owner);

 /** First visit after the unlock level: a state row, 10 小鱼干 and one free 饭团. */
 function ensure(owner,now){
  let state=readState(owner);if(state)return state;
  if(!cleared(owner))return null;
  db.prepare('INSERT OR IGNORE INTO tuanzi_state(owner,status,fish,pack,trip,trips,sill_at,active_at,unlocked_at,updated_at) VALUES(?,\'home\',0,NULL,NULL,0,?,?,?,?)').run(owner,now,now,now,now);
  if(credit(owner,'welcome',cfg.fish.welcome,'welcome',now))addItem(owner,cfg.fish.welcomeItem,1,now);
  return readState(owner);
 }

 // ---------------------------------------------------------------- trips
 const nextBeijingHour=(time,hour)=>{const day=Date.parse(beijingDay(time)+'T00:00:00+08:00')+hour*HOUR;return day>time?day:day+24*HOUR;};
 function chooseCard(owner,region,r,rareBoost,taken,now){
  const have=new Set(cards(owner).map(row=>row.kind==='rare'?'rare:'+row.rare_id:'image:'+row.image_id));
  const weight=key=>have.has(key)?cfg.collectedWeight:1;
  if(r()<cfg.rareChance*rareBoost){
   const choices=cfg.rare.filter(card=>card.region===region&&!taken.has('rare:'+card.id)).map(card=>[card,weight('rare:'+card.id)]);
   if(choices.length){const card=weighted(choices,r);return {kind:'rare',rareId:card.id,key:'rare:'+card.id};}
  }
  const pictures=pool(now).filter(photo=>!taken.has('image:'+photo.id)),local=pictures.filter(photo=>(regionOf.get(photo.id)??'town')===region);
  const list=(local.length?local:pictures).map(photo=>[photo,weight('image:'+photo.id)]);
  if(!list.length)return null;
  const photo=weighted(list,r);return {kind:'gallery',imageId:photo.id,key:'image:'+photo.id};
 }
 function plan(state,at,first){
  const seed=randomInt(0,2**31-1),r=seeded(seed),tripId='t'+at.toString(36)+seed.toString(36);
  const pack=state.pack??{};
  if(first){
   const special=specialById.get(cfg.firstTrip.cardId),minutes=cfg.firstTrip.minutes;
   return {id:tripId,seed,first:true,food:pack.food??null,tool:pack.tool??null,charm:pack.charm??null,region:special.region,departedAt:at,returnAt:at+minutes*MINUTE,
    cards:[{id:'first-trip',at:at+Math.round(minutes*.6)*MINUTE,kind:'special',specialId:special.id,region:special.region,place:special.place,line:special.line,sticker:'wave',pieces:24}],souvenir:null};
  }
  const food=foods.get(pack.food),tool=tools.get(pack.tool),charm=charms.get(pack.charm);
  const region=tool?tool.region:r()<cfg.townShare?'town':pick(cfg.regions.map(x=>x.id).filter(id=>id!=='town'),r);
  const duration=Math.round((food.hours[0]+(food.hours[1]-food.hours[0])*r())*HOUR),returnAt=at+duration;
  const count=food.cards[0]+Math.floor(r()*(food.cards[1]-food.cards[0]+1));
  // The first postcard comes between an hour after leaving and 60% of the trip; a night trip that runs past
  // 07:00 Beijing always has one in the mailbox by 07:00.
  const early=at+cfg.firstCard.afterMinutes*MINUTE,late=Math.max(early,at+duration*cfg.firstCard.beforeShare);
  let firstAt=Math.round(early+(late-early)*r());
  const morning=nextBeijingHour(at,cfg.nightCardBeijingHour);
  if(returnAt>morning&&firstAt>morning&&morning>=early)firstAt=Math.round(morning-Math.min(HOUR,morning-early)*r());
  const times=[firstAt];if(count>1)times.push(Math.round(firstAt+(returnAt-firstAt)*(.3+.6*r())));
  const taken=new Set(),rareBoost=charm?.effect==='rare-double'?2:1,list=[];
  times.forEach((time,n)=>{
   const chosen=chooseCard(state.owner,region,r,rareBoost,taken,at);if(!chosen)return;taken.add(chosen.key);
   list.push({id:tripId+'-'+(n+1),at:time,kind:chosen.kind,...(chosen.imageId?{imageId:chosen.imageId}:{rareId:chosen.rareId}),region,place:pick(cfg.places[region],r),line:pick(cfg.lines[region],r),sticker:pick(cfg.stickers,r).id,pieces:food.pieces});
  });
  const souvenirChance=charm?.effect==='souvenir-sure'?1:food.souvenirChance,regional=cfg.souvenirs.filter(s=>s.region===region);
  const souvenir=r()<souvenirChance?pick(regional,r).id:null;
  return {id:tripId,seed,first:false,food:food.id,tool:tool?.id??null,charm:charm?.id??null,region,departedAt:at,returnAt,cards:list,souvenir};
 }
 function depart(state,at,first,now){
  state.trip=plan(state,at,first);state.status='away';state.pack=null;state.trips++;writeState(state,now);
 }
 /** Delivers postcards that have arrived and brings 团子 home once the trip is over. */
 function advance(state,now){
  if(!state||state.status!=='away'||!state.trip)return state;
  const trip=state.trip;let changed=false;
  for(const card of trip.cards){
   if(card.delivered||card.at>now)continue;
   const existing=card.kind==='rare'?db.prepare('SELECT 1 FROM tuanzi_postcards WHERE owner=? AND rare_id=?').get(state.owner,card.rareId):card.kind==='gallery'?db.prepare('SELECT 1 FROM tuanzi_postcards WHERE owner=? AND image_id=?').get(state.owner,card.imageId):db.prepare('SELECT 1 FROM tuanzi_postcards WHERE owner=? AND card_id=?').get(state.owner,card.id);
   if(existing){card.duplicate=true;credit(state.owner,'duplicate:'+card.id,cfg.fish.duplicate,'duplicate',card.at);}
   else db.prepare('INSERT OR IGNORE INTO tuanzi_postcards(owner,card_id,kind,image_id,rare_id,region,place,date,sticker,line,pieces,trip_id,arrived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(state.owner,card.id,card.kind,card.imageId??null,card.rareId??card.specialId??null,card.region,card.place,beijingDay(card.at),card.sticker,card.line,card.pieces,trip.id,card.at);
   card.delivered=true;changed=true;
  }
  if(now>=trip.returnAt){
   if(trip.souvenir)db.prepare('INSERT INTO tuanzi_souvenirs VALUES(?,?,1,?,?) ON CONFLICT(owner,souvenir_id) DO UPDATE SET count=count+1,last_at=excluded.last_at').run(state.owner,trip.souvenir,trip.returnAt,trip.returnAt);
   state.status='home';trip.returned=true;changed=true;
  }
  if(changed){writeState(state,now);rewards(state.owner,now);}
  return state;
 }
 /** Every request from a nook owner: notice when they come back after being away and let 团子 leave in their absence. */
 function activity(owner,now){
  const state=readState(owner);if(!state)return;
  advance(state,now);
  const idle=cfg.departure.idleMinutes*MINUTE,gap=now-state.active_at;
  if(state.status==='home'&&state.pack?.food&&state.trips>0&&gap>=idle){
   const r=seeded(Number.parseInt(state.owner.slice(0,8),16)^state.active_at),delay=(cfg.departure.delayMinutes[0]+(cfg.departure.delayMinutes[1]-cfg.departure.delayMinutes[0])*r())*MINUTE;
   const at=Math.round(state.active_at+idle+delay);
   if(at<=now){depart(state,at,false,now);advance(state,now);}
  }
  if(now-state.active_at>=MINUTE||state.status==='away'&&state.active_at<now-MINUTE){state.active_at=now;db.prepare('UPDATE tuanzi_state SET active_at=? WHERE owner=?').run(now,owner);}
 }

 // ---------------------------------------------------------------- rewards
 const rewardTaken=(owner,key)=>owned(owner,'reward-'+key);
 function rewards(owner,now){
  const rows=cards(owner),total=rows.length,mark=key=>addItem(owner,'reward-'+key,1,now);
  for(const reward of cfg.rewards.total){
   if(total<reward.at||rewardTaken(owner,'total-'+reward.at))continue;mark('total-'+reward.at);
   if(reward.fish)credit(owner,'reward:total-'+reward.at,reward.fish,'reward',now);
   if(reward.decorationId)grantDecoration(owner,reward.decorationId,now);
   if(reward.itemId)addItem(owner,reward.itemId,1,now);
  }
  for(const region of cfg.regions){
   const n=new Set(rows.filter(row=>row.region===region.id).map(row=>row.card_id)).size;
   if(n>=cfg.rewards.region.at&&!rewardTaken(owner,'region-'+region.id)){mark('region-'+region.id);addItem(owner,cfg.rewards.region.itemPrefix+region.id,1,now);}
  }
  const rares=new Set(rows.filter(row=>row.kind==='rare').map(row=>row.rare_id)).size;
  if(rares>=cfg.rare.length&&!rewardTaken(owner,'rare-all')){mark('rare-all');for(const itemId of cfg.rewards.rare.itemIds)addItem(owner,itemId,1,now);}
 }

 // ---------------------------------------------------------------- player actions
 function buy(owner,itemId,requestId,now){
  const item=shop.get(itemId);if(!item)reject(400,'TUANZI_ITEM_INVALID','杂货铺没有这件东西');
  if(fishOf(owner)<item.price)reject(409,'TUANZI_FISH_SHORT','小鱼干不够，拼一张图再来吧',{fish:fishOf(owner),price:item.price});
  credit(owner,'buy:'+requestId,-item.price,'shop:'+item.id,now);addItem(owner,item.id,1,now);
  return {itemId:item.id,price:item.price};
 }
 function pack(owner,input,now){
  const state=readState(owner);if(state.status==='away')reject(409,'TUANZI_AWAY','团子在外面旅行，回来再装包吧');
  const wanted={food:input.food??null,tool:input.tool??null,charm:input.charm??null};
  if(wanted.food!==null&&!foods.has(wanted.food)||wanted.tool!==null&&!tools.has(wanted.tool)||wanted.charm!==null&&!charms.has(wanted.charm))reject(400,'TUANZI_PACK_INVALID','布包里放的东西不对');
  // Unchanged slots stay in the bag; changed ones go back to the shelf before the new ones come out.
  const old=state.pack??{food:null,tool:null,charm:null};
  for(const slot of ['food','tool','charm'])if(old[slot]&&old[slot]!==wanted[slot])addItem(owner,old[slot],1,now);
  for(const slot of ['food','tool','charm'])if(wanted[slot]&&old[slot]!==wanted[slot])takeItem(owner,wanted[slot],now);
  state.pack=wanted.food||wanted.tool||wanted.charm?wanted:null;state.active_at=now;
  // The very first trip leaves straight away (a 20-minute walk and the 「第一次出门」 card) so the loop is seen at once.
  if(state.trips===0&&wanted.food){depart(state,now,true,now);return {departed:true};}
  writeState(state,now);return {departed:false};
 }
 const sillView=(state,now)=>{
  const every=cfg.fish.sill.everyMinutes*MINUTE,portions=Math.min(cfg.fish.sill.stack,Math.floor(Math.max(0,now-state.sill_at)/every));
  return {portions,fish:portions*cfg.fish.sill.amount,stack:cfg.fish.sill.stack,amount:cfg.fish.sill.amount,nextAt:portions>=cfg.fish.sill.stack?null:state.sill_at+(portions+1)*every};
 };
 function sill(owner,now){
  const state=readState(owner),view=sillView(state,now);if(!view.portions)reject(409,'TUANZI_SILL_EMPTY','窗台上还没有晒好的小鱼干',{nextAt:view.nextAt});
  credit(owner,'sill:'+state.sill_at,view.fish,'sill',now);
  state.sill_at=view.portions>=cfg.fish.sill.stack?now:state.sill_at+view.portions*cfg.fish.sill.everyMinutes*MINUTE;writeState(state,now);
  return {fish:view.fish};
 }
 function read(owner,cardIds,now){
  if(!Array.isArray(cardIds)||cardIds.length>200||!cardIds.every(id=>typeof id==='string'&&id.length<=64))reject(400,'TUANZI_CARDS_INVALID','明信片编号无效');
  const statement=db.prepare('UPDATE tuanzi_postcards SET read_at=? WHERE owner=? AND card_id=? AND read_at IS NULL');let marked=0;
  for(const id of cardIds)marked+=Number(statement.run(now,owner,id).changes);return {marked};
 }
 const cardRow=(owner,cardId)=>{const row=db.prepare('SELECT * FROM tuanzi_postcards WHERE owner=? AND card_id=?').get(owner,cardId);if(!row)reject(404,'TUANZI_CARD_NOT_FOUND','没有这张明信片');return row;};
 /** A postcard finished on the phone (solo, local) or in a private room: +2 小鱼干 once per card. */
 function completeCard(owner,cardId,now,roomId=null){
  const row=cardRow(owner,cardId);
  if(row.completed_at===null)db.prepare('UPDATE tuanzi_postcards SET completed_at=?,room_id=COALESCE(room_id,?) WHERE owner=? AND card_id=?').run(now,roomId,owner,cardId);
  const fish=credit(owner,'postcard:'+cardId,cfg.fish.postcard,'postcard',now)?cfg.fish.postcard:0;
  return {cardId,fish};
 }

 // ---------------------------------------------------------------- completion hooks (contributors who own a nook)
 const hasState=owner=>!!stateRow.get(owner);
 /** Called from settle() once a room completes. owners: identities with a contribution. */
 function roomCompleted(room,owners,now){
  const mode=room.mobileMode,pieces=room.mobilePieces;
  if(mode==='postcard'&&room.tuanziCard){
   if(hasState(room.tuanziCard.owner))try{completeCard(room.tuanziCard.owner,room.tuanziCard.cardId,now,room.id);}catch{}
   for(const owner of owners)if(owner!==room.tuanziCard.owner&&hasState(owner))credit(owner,'postcard-room:'+room.id,cfg.fish.postcard,'postcard',now);
   return;
  }
  if(mode==='level'){if(owners.includes(room.ownerId))levelClear(room.ownerId,'room:'+room.id,now);return;}
  const amount=mode==='daily'?cfg.fish.daily:cfg.fish.rooms[String(pieces)];
  if(!amount)return;
  for(const owner of owners)if(hasState(owner))credit(owner,'room:'+room.id,amount,mode==='daily'?'daily':'room',now);
 }
 /** Story clears pay 2 小鱼干, at most five times a Beijing day. */
 function levelClear(owner,key,now){
  if(!hasState(owner))return false;
  const today=beijingDay(now),used=Number(db.prepare("SELECT COUNT(*) n FROM tuanzi_fish_ledger WHERE owner=? AND source='level' AND day=?").get(owner,today).n);
  return used<cfg.fish.levelDailyCap&&credit(owner,key,cfg.fish.level,'level',now);
 }

 // ---------------------------------------------------------------- views
 function cardView(row,now){
  const base={id:row.card_id,kind:row.kind,region:row.region,regionTitle:regionTitle.get(row.region),place:row.place,date:row.date,sticker:row.sticker,line:row.line,pieces:row.pieces,arrivedAt:row.arrived_at,read:row.read_at!==null,completed:row.completed_at!==null};
  if(row.kind==='gallery'){
   const photo=pool(now,true).find(item=>item.id===row.image_id);if(!photo)return {...base,title:'一张明信片',imageId:row.image_id,unavailable:true};
   const fitted=grid(photo,row.pieces),album=albumOf(row.image_id,now);
   return {...base,title:photo.title,imageId:photo.id,src:photo.src,thumbSrc:photo.thumbSrc,width:photo.width,height:photo.height,cols:fitted?.cols??null,rows:fitted?.rows??null,...(album?{album}:{}),roomable:!!fitted};
  }
  const art=row.kind==='rare'?rareById.get(row.rare_id):specialById.get(row.rare_id);if(!art)return {...base,title:'一张明信片',unavailable:true};
  const fitted=grid(art,row.pieces);
  return {...base,title:art.title,rareId:art.id,src:art.src,thumbSrc:art.thumbSrc,width:art.width,height:art.height,cols:fitted?.cols??null,rows:fitted?.rows??null,roomable:false};
 }
 function tripView(trip,now){
  if(!trip)return null;
  const sent=trip.cards.filter(card=>card.at<=now&&!card.duplicate).length;
  return {id:trip.id,first:trip.first,food:trip.food,tool:trip.tool,charm:trip.charm,departedAt:trip.departedAt,returned:trip.returned===true,
   ...(trip.returned?{returnAt:trip.returnAt,region:trip.region,souvenir:trip.souvenir,cardsSent:trip.cards.length}:{cardsSent:sent}),
   duplicates:trip.cards.filter(card=>card.duplicate).length};
 }
 function view(owner,now){
  if(!stateRow.get(owner)&&!cleared(owner))return {locked:true,unlockLevelId:cfg.unlockLevelId};
  const state=advance(ensure(owner,now),now),rows=cards(owner);
  const inventory=Object.fromEntries(db.prepare("SELECT item_id,count FROM tuanzi_items WHERE owner=? AND count>0 AND item_id NOT LIKE 'reward-%'").all(owner).map(row=>[row.item_id,row.count]));
  const souvenirs=db.prepare('SELECT souvenir_id,count,first_at FROM tuanzi_souvenirs WHERE owner=? ORDER BY first_at').all(owner).map(row=>({id:row.souvenir_id,count:row.count,firstAt:row.first_at}));
  const regionCounts=Object.fromEntries(cfg.regions.map(region=>[region.id,rows.filter(row=>row.region===region.id).length]));
  const welcome=db.prepare("SELECT created_at FROM tuanzi_fish_ledger WHERE owner=? AND request_id='welcome'").get(owner);
  return {locked:false,status:state.status,fish:fishOf(owner),pack:state.pack,trips:state.trips,trip:tripView(state.trip,now),inventory,
   sill:sillView(state,now),welcome:{fish:cfg.fish.welcome,itemId:cfg.fish.welcomeItem,at:welcome?.created_at??null},
   postcards:rows.map(row=>cardView(row,now)),unread:rows.filter(row=>row.read_at===null).length,souvenirs,
   album:{total:rows.length,regions:regionCounts,rare:new Set(rows.filter(row=>row.kind==='rare').map(row=>row.rare_id)).size,rareTotal:cfg.rare.length,
    rewards:[...cfg.rewards.total.map(reward=>({key:'total-'+reward.at,at:reward.at,...reward,taken:rewardTaken(owner,'total-'+reward.at)})),
     ...cfg.regions.map(region=>({key:'region-'+region.id,region:region.id,at:cfg.rewards.region.at,title:cfg.rewards.region.title.replace('{region}',region.title),taken:rewardTaken(owner,'region-'+region.id)})),
     {key:'rare-all',at:cfg.rare.length,title:cfg.rewards.rare.title,taken:rewardTaken(owner,'rare-all')}]},
   catalog:catalogView(),serverTime:now};
 }
 let catalogCache=null;
 function catalogView(){
  return catalogCache??=Object.freeze({regions:cfg.regions,shop:[...shop.values()].map(({id,title,price,slot,hours,cards:count,pieces,region,effect})=>({id,title,price,slot,...(hours?{hours,cards:count,pieces}:{}),...(region?{region}:{}),...(effect?{effect}:{})})),
   stickers:cfg.stickers,souvenirs:cfg.souvenirs,rare:cfg.rare.map(({id,title,region,thumbSrc})=>({id,title,region,thumbSrc})),firstTripMinutes:cfg.firstTrip.minutes,idleMinutes:cfg.departure.idleMinutes,postcardFish:cfg.fish.postcard,sill:cfg.fish.sill});
 }
 /** A card the owner may open a private room for (gallery pictures only: rare art is not a catalogue picture). */
 function roomCard(owner,cardId,now){
  const row=cardRow(owner,cardId);if(row.kind!=='gallery')reject(409,'TUANZI_CARD_SOLO','这张明信片只能自己拼');
  const photo=pool(now,true).find(item=>item.id===row.image_id);if(!photo)reject(409,'TUANZI_CARD_UNAVAILABLE','这张图暂时不能拼');
  return {row,photo};
 }
 const unread=owner=>Number(db.prepare('SELECT COUNT(*) n FROM tuanzi_postcards WHERE owner=? AND read_at IS NULL').get(owner)?.n??0);
 return {config:cfg,ensure,readState,activity,advance:(owner,now)=>advance(readState(owner),now),view,buy,pack,sill,read,completeCard,roomCompleted,levelClear,roomCard,unread,hasState,fish:fishOf};
}
