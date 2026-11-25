import {readFileSync} from 'node:fs';
import {randomInt} from 'node:crypto';
import defaults from '../config/redeem-codes.json' with {type:'json'};

// Generated codes skip 0 O 1 I L so a code read aloud or copied from a chat screenshot is never ambiguous.
export const REDEEM_CODE_ALPHABET='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REDEEM_SUPPLY_MAXIMUM=3;
export const REDEEM_FAILURE_LIMIT=Object.freeze({count:10,windowMs:3600000});
const CODE_PATTERN=/^[A-Z0-9]{4,24}$/;
const LIMITS=Object.freeze({coins:100000,fragments:100000,energy:1000,energyPacks:REDEEM_SUPPLY_MAXIMUM});
const BEIJING_MS=8*3600000;
const reject=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const invalid=message=>{throw new TypeError('Invalid redeem code: '+message);};

/** Player input: trim, NFKC (full-width letters from a Chinese keyboard), uppercase, drop spaces and dashes. */
export function normalizeRedeemCode(value){
 if(typeof value!=='string')return '';
 return value.normalize('NFKC').toUpperCase().replace(/[\s\-‐-―−ー]/g,'');
}

export function generateRedeemCode(length=8){
 if(!Number.isInteger(length)||length<8||length>10)invalid('generated codes have 8-10 characters');
 let code='';for(let i=0;i<length;i++)code+=REDEEM_CODE_ALPHABET[randomInt(REDEEM_CODE_ALPHABET.length)];
 return code;
}

/** "2026-12-31", "2026-12-31 23:59" or "2026-12-31 23:59:30" in Beijing time. An end bound covers its whole day/minute/second. */
export function parseBeijingTime(text,{end=false}={}){
 const match=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(text??'').trim());
 if(!match)invalid('time must look like 2026-12-31 23:59 (Beijing)');
 const [,y,mo,d,h,mi,s]=match,at=Date.UTC(+y,+mo-1,+d,+(h??0),+(mi??0),+(s??0))-BEIJING_MS;
 const check=new Date(at+BEIJING_MS);
 if(check.getUTCFullYear()!==+y||check.getUTCMonth()!==+mo-1||check.getUTCDate()!==+d||+(h??0)>23||+(mi??0)>59||+(s??0)>59)invalid('no such time: '+text);
 if(!end)return at;
 return at+(s!==undefined?1000:mi!==undefined?60000:86400000)-1;
}
export const formatBeijingTime=ms=>new Date(ms+BEIJING_MS).toISOString().slice(0,16).replace('T',' ');
const shortBeijing=ms=>{const t=new Date(ms+BEIJING_MS);return (t.getUTCMonth()+1)+'月'+t.getUTCDate()+'日 '+t.toISOString().slice(11,16);};

function amounts(value,keys,label){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(label+' must be an object');
 const unknown=Object.keys(value).filter(key=>!keys.includes(key));
 if(unknown.length)invalid('unknown '+label+' '+unknown.join(', '));
 const result={};
 for(const key of keys){
  if(value[key]===undefined||value[key]===0)continue;
  if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>LIMITS[key])invalid(key+' must be an integer 0..'+LIMITS[key]);
  result[key]=value[key];
 }
 return result;
}

/** Rewards of one code: coins, 碎片 (fragments), energy, energy packs (stock cap 3) and decorations.
 * A decoration is an id, or {id, ifOwned:{coins?,fragments?}} to give that instead when it cannot be given
 * (the account already owns it, or it was retired). */
export function readRedeemRewards(value,{decorationIds=null}={}){
 const {decorations,...rest}=value&&typeof value==='object'&&!Array.isArray(value)?value:invalid('rewards must be an object');
 const rewards=amounts(rest,['coins','fragments','energy','energyPacks'],'reward');
 if(decorations!==undefined){
  if(!Array.isArray(decorations))invalid('decorations must be a list');
  const list=decorations.map(entry=>{
   const item=typeof entry==='string'?{id:entry}:entry;
   if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(item.id)||Object.keys(item).some(key=>!['id','ifOwned'].includes(key)))invalid('decorations must be ids or {id, ifOwned}');
   if(decorationIds&&!decorationIds.has(item.id))invalid('unknown decoration '+item.id);
   if(item.ifOwned===undefined)return item.id;
   const ifOwned=amounts(item.ifOwned,['coins','fragments'],'ifOwned reward');
   if(!Object.keys(ifOwned).length)invalid('ifOwned needs coins or fragments');
   return {id:item.id,ifOwned};
  });
  if(new Set(list.map(item=>typeof item==='string'?item:item.id)).size!==list.length)invalid('decorations must be distinct');
  if(list.length)rewards.decorations=list;
 }
 if(!Object.keys(rewards).length)invalid('a code needs at least one reward');
 return rewards;
}

/** One code row from the seed file or the operator script. Times are Beijing strings or epoch ms. */
export function redeemCodeRow(entry,{now,decorationIds=null}){
 const code=normalizeRedeemCode(entry?.code);
 if(!CODE_PATTERN.test(code))invalid('code must be 4-24 letters/digits: '+entry?.code);
 const kind=entry.kind??'shared';if(!['shared','single'].includes(kind))invalid('kind must be shared or single');
 const time=(value,end)=>value===undefined||value===null?null:typeof value==='number'?value:parseBeijingTime(value,{end});
 const startsAt=time(entry.startsAt,false),expiresAt=time(entry.expiresAt,true);
 if(startsAt!==null&&expiresAt!==null&&expiresAt<=startsAt)invalid('expiry must be after the start');
 const maxUses=kind==='single'?1:entry.maxUses??null;
 if(maxUses!==null&&(!Number.isSafeInteger(maxUses)||maxUses<1))invalid('maxUses must be a positive integer');
 if(entry.note!==undefined&&(typeof entry.note!=='string'||entry.note.length>200))invalid('note must be text up to 200 characters');
 if(entry.batchId!==undefined&&entry.batchId!==null&&!/^[A-Za-z0-9._-]{1,64}$/.test(entry.batchId))invalid('batch id');
 return {code,kind,batch_id:entry.batchId??null,rewards:JSON.stringify(readRedeemRewards(entry.rewards,{decorationIds})),max_uses:maxUses,starts_at:startsAt,expires_at:expiresAt,note:entry.note??null,created_at:now};
}

export function readRedeemSeeds(config){
 const value=config??(process.env.MOBILE_REDEEM_CONFIG?JSON.parse(readFileSync(process.env.MOBILE_REDEEM_CONFIG,'utf8')):defaults);
 if(value?.schema!=='jigsaw-redeem-codes/v1'||!Array.isArray(value.codes))invalid('seed file schema');
 return value.codes;
}

export function ensureRedeemTables(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_redeem_codes(code TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('shared','single')),batch_id TEXT,rewards TEXT NOT NULL,max_uses INTEGER,uses INTEGER NOT NULL DEFAULT 0,starts_at INTEGER,expires_at INTEGER,disabled INTEGER NOT NULL DEFAULT 0,note TEXT,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mobile_redeem_codes_batch ON mobile_redeem_codes(batch_id);
 CREATE TABLE IF NOT EXISTS mobile_redeem_claims(code TEXT NOT NULL,owner TEXT NOT NULL,claimed_at INTEGER NOT NULL,rewards TEXT NOT NULL,PRIMARY KEY(code,owner));
 `);
}

/** Returns false when the code already exists (seeds and operator rows are never overwritten). */
export function insertRedeemCode(db,row){
 return db.prepare('INSERT OR IGNORE INTO mobile_redeem_codes(code,kind,batch_id,rewards,max_uses,uses,starts_at,expires_at,disabled,note,created_at) VALUES(?,?,?,?,?,0,?,?,0,?,?)')
  .run(row.code,row.kind,row.batch_id,row.rewards,row.max_uses,row.starts_at,row.expires_at,row.note,row.created_at).changes>0;
}

/** Claims run inside the service's IMMEDIATE request transaction together with the profile save,
 * so the claim row, uses+1 and every credited reward commit or roll back as one. */
export function createMobileRedeem({db,seeds,now:clock=Date.now,awardWallet,grantDecoration}){
 ensureRedeemTables(db);
 // Seeds only fill in missing codes: a code the operator disabled stays disabled after a restart.
 const seeded=clock();for(const entry of readRedeemSeeds(seeds))insertRedeemCode(db,redeemCodeRow(entry,{now:seeded}));
 // Failed attempts per owner, in memory: every failure rolls its request back, so it cannot be stored in that transaction.
 const failures=new Map();
 function recentFailures(owner,now){
  const recent=(failures.get(owner)??[]).filter(at=>at>now-REDEEM_FAILURE_LIMIT.windowMs);
  if(recent.length)failures.set(owner,recent);else failures.delete(owner);
  return recent;
 }
 function noteFailure(owner,now){
  if(failures.size>20000)for(const key of [...failures.keys()])recentFailures(key,now);
  failures.set(owner,[...recentFailures(owner,now),now]);
 }
 function check(owner,code,now){
  if(!CODE_PATTERN.test(code))reject(404,'REDEEM_CODE_NOT_FOUND','兑换码不存在，请检查后重新输入');
  const row=db.prepare('SELECT * FROM mobile_redeem_codes WHERE code=?').get(code);
  if(!row)reject(404,'REDEEM_CODE_NOT_FOUND','兑换码不存在，请检查后重新输入');
  if(row.disabled)reject(409,'REDEEM_CODE_DISABLED','这个兑换码已停用');
  if(row.starts_at!==null&&now<row.starts_at)reject(409,'REDEEM_CODE_NOT_STARTED','兑换码还没开始，'+shortBeijing(row.starts_at)+' 后可以兑换');
  if(row.expires_at!==null&&now>row.expires_at)reject(409,'REDEEM_CODE_EXPIRED','兑换码已过期');
  if(db.prepare('SELECT 1 FROM mobile_redeem_claims WHERE code=? AND owner=?').get(code,owner))reject(409,'REDEEM_ALREADY_CLAIMED','你已经兑换过这个兑换码啦');
  if(row.max_uses!==null&&row.uses>=row.max_uses)reject(409,'REDEEM_CODE_USED_UP',row.kind==='single'?'这个兑换码已经被使用过了':'兑换码已被领完');
  return row;
 }
 function grant(p,row,now){
  const rewards=JSON.parse(row.rewards),granted={code:row.code,coins:0,fragments:0,energy:0,energyPacks:0,energyPacksSkipped:0,decorations:[]};
  // Two fences besides the checks above: the claim's primary key (once per owner) and a guarded uses+1 (total cap).
  if(!db.prepare("INSERT OR IGNORE INTO mobile_redeem_claims VALUES(?,?,?,'{}')").run(row.code,p.id,now).changes)reject(409,'REDEEM_ALREADY_CLAIMED','你已经兑换过这个兑换码啦');
  if(!db.prepare('UPDATE mobile_redeem_codes SET uses=uses+1 WHERE code=? AND disabled=0 AND (max_uses IS NULL OR uses<max_uses)').run(row.code).changes)reject(409,'REDEEM_CODE_USED_UP','兑换码已被领完');
  // Ownership is decided here, inside the claim transaction; a fallback adds to the code's single ledger entry.
  let coins=rewards.coins??0,fragments=rewards.fragments??0;
  for(const entry of rewards.decorations??[]){
   const {id,ifOwned}=typeof entry==='string'?{id:entry}:entry,result=grantDecoration(p.id,id,now);
   if(result.status!=='granted'&&ifOwned){result.fallback={coins:ifOwned.coins??0,fragments:ifOwned.fragments??0};coins+=result.fallback.coins;fragments+=result.fallback.fragments;}
   granted.decorations.push(result);
  }
  if(coins||fragments)Object.assign(granted,awardWallet(p.id,'redeem:'+row.code,{coins,fragments},now));
  // Like gameplay rewards, redeemed energy may go above the cap.
  if(rewards.energy){p.energy+=rewards.energy;granted.energy=rewards.energy;}
  if(rewards.energyPacks){
   p.supply={energy:0,create:0,...p.supply};
   granted.energyPacks=Math.max(0,Math.min(rewards.energyPacks,REDEEM_SUPPLY_MAXIMUM-p.supply.energy));
   granted.energyPacksSkipped=rewards.energyPacks-granted.energyPacks;p.supply.energy+=granted.energyPacks;
  }
  db.prepare('UPDATE mobile_redeem_claims SET rewards=? WHERE code=? AND owner=?').run(JSON.stringify(granted),row.code,p.id);
  return granted;
 }
 function claim(p,raw,now){
  const code=normalizeRedeemCode(raw);
  if(!code)reject(400,'REDEEM_CODE_REQUIRED','请输入兑换码');
  const recent=recentFailures(p.id,now);
  if(recent.length>=REDEEM_FAILURE_LIMIT.count)reject(429,'REDEEM_RATE_LIMIT','尝试次数太多，请 '+Math.max(1,Math.ceil((recent[0]+REDEEM_FAILURE_LIMIT.windowMs-now)/60000))+' 分钟后再试');
  try{return grant(p,check(p.id,code,now),now);}
  catch(error){if(typeof error.code==='string'&&error.code.startsWith('REDEEM_'))noteFailure(p.id,now);throw error;}
 }
 return {claim};
}
