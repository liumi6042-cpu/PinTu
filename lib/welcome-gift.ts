import {localDb} from './local-db';
import {gardenFor} from './courtyard-store';
import {RoomError,type Room} from './room-engine';
type GiftRow={owner_id:string;item:string;claimed_by:string|null};
export async function welcomeGift(accountId?:string,guestId?:string){
 const db=localDb();
 // An account's receipt always wins over another browser's pending gift.
 if(accountId){const claimed=await db.prepare('SELECT owner_id,item,claimed_by FROM puzzle_welcome_gifts WHERE claimed_by=?').bind(accountId).first<GiftRow>();if(claimed)return claimed;}
 for(const owner of [accountId,guestId])if(owner){const row=await db.prepare('SELECT owner_id,item,claimed_by FROM puzzle_welcome_gifts WHERE owner_id=? AND claimed_by IS NULL').bind(owner).first<GiftRow>();if(row)return row;}
 return null;
}
export async function offerWelcomeGift(owner:string,room:Room,accountId?:string,guestId?:string){
 const previous=await welcomeGift(accountId,guestId);if(previous)return previous;
 if(!((room.achievements?.contributors[owner]?.count||0)>0))throw new RoomError('成功拼合一次后即可领取见面礼',403);
 const owned=accountId?(await gardenFor(accountId)).state.owned:{};
 const pool=['fern','cushion','blueVase'],unowned=pool.filter(id=>!owned[id]),choices=unowned.length?unowned:pool;
 const item=choices[Math.floor(Math.random()*choices.length)];
 await localDb().prepare('INSERT OR IGNORE INTO puzzle_welcome_gifts(owner_id,item,created_at) VALUES(?,?,?)').bind(owner,item,Date.now()).run();
 return welcomeGift(accountId,guestId);
}
export async function claimWelcomeGift(accountId:string,guestId?:string){
 const db=localDb();
 for(let retry=0;retry<8;retry++){
  const gift=await welcomeGift(accountId,guestId);if(!gift)throw new RoomError('请先成功拼合一次，解锁见面礼',409);
  if(gift.claimed_by)return {gift,profile:await gardenFor(accountId)};
  const profile=await gardenFor(accountId),s=profile.state,now=Date.now();
  s.owned[gift.item]=(s.owned[gift.item]||0)+1;
  s.ledger.unshift({reason:'拼图见面礼:'+gift.item,amount:0,at:new Date(now).toISOString()});s.ledger=s.ledger.slice(0,50);
  // One transaction: reserve a permanent per-account receipt, update inventory by
  // version, then consume this specific offer. A guest offer can fund one account only.
  const results=await db.batch([
   db.prepare("INSERT OR IGNORE INTO puzzle_courtyard_events(user_id,operation,kind,created_at) SELECT ?,'welcome-gift-v1','welcome',? WHERE EXISTS(SELECT 1 FROM puzzle_courtyards WHERE user_id=? AND version=?) AND EXISTS(SELECT 1 FROM puzzle_welcome_gifts WHERE owner_id=? AND claimed_by IS NULL) AND NOT EXISTS(SELECT 1 FROM puzzle_welcome_gifts WHERE claimed_by=?)").bind(accountId,now,accountId,profile.version,gift.owner_id,accountId),
   db.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=? AND version=? AND changes()=1').bind(JSON.stringify(s),accountId,profile.version),
   db.prepare('UPDATE puzzle_welcome_gifts SET claimed_by=?,claimed_at=? WHERE owner_id=? AND claimed_by IS NULL AND changes()=1').bind(accountId,now,gift.owner_id)
  ]);
  if(results[2].meta.changes===1)return {gift:(await welcomeGift(accountId,guestId))!,profile:await gardenFor(accountId)};
 }
 throw new RoomError('奖励正在同步，请稍后重试',409);
}
