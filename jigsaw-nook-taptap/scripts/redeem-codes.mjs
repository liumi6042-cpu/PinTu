#!/usr/bin/env node
// Operator tool for 兑换码. Safe on the live database while the service runs (WAL, short IMMEDIATE writes, busy wait).
// Run from a mobile backend release directory (the live one: /srv/sites/jigsaw-mobile-v3/current). Times are Beijing time.
//   node scripts/redeem-codes.mjs create [--code QUN2026] [--coins 300] [--fragments 20] [--energy 50] [--packs 1]
//        [--decorations cat-paw,cream-bow [--if-owned-fragments 20] [--if-owned-coins 100]]
//        [--max-uses 500] [--starts "2026-11-03 20:00"] [--expires "2026-12-31 23:59"] [--note 玩家群]
//   node scripts/redeem-codes.mjs batch --count 50 --coins 500 [--packs 3] [--length 10] [--expires ...] [--batch-id rewards-1102] [--csv file.csv]
//   node scripts/redeem-codes.mjs list [--all | --batch <id>]
//   node scripts/redeem-codes.mjs stats <CODE>
//   node scripts/redeem-codes.mjs disable <CODE>      (enable <CODE> undoes it)
// Database: --db <mobile-v3.sqlite>, else $MOBILE_DB, else the live /srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite.
// create = one shared code (each account once, optional total --max-uses); batch = N single-use codes, printed and saved as CSV.
// --if-owned-* gives that instead of a listed decoration the account already owns. Energy may go above the cap; packs stop at 3.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};
import {createGameSettings} from '../server/game-settings.mjs';
import {isRetiredDecoration} from '../lib/decoration-policy.mjs';
import {ensureRedeemTables,insertRedeemCode,redeemCodeRow,generateRedeemCode,normalizeRedeemCode,formatBeijingTime} from '../server/mobile-redeem.mjs';

const LIVE_DB='/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite';
const VALUE_OPTIONS={'--db':'db','--code':'code','--coins':'coins','--fragments':'fragments','--if-owned-fragments':'ifOwnedFragments','--if-owned-coins':'ifOwnedCoins','--energy':'energy','--packs':'packs','--decorations':'decorations','--max-uses':'maxUses','--starts':'starts','--expires':'expires','--note':'note','--count':'count','--length':'length','--batch-id':'batchId','--batch':'batch','--csv':'csv','--game-settings':'gameSettings'};

function parse(argv){
 const options={all:false,positional:[]};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--all'){options.all=true;continue;}
  if(VALUE_OPTIONS[arg]){if(i+1>=argv.length)throw Error('Missing value for '+arg);options[VALUE_OPTIONS[arg]]=argv[++i];continue;}
  if(arg.startsWith('--'))throw Error('Unknown option '+arg);
  options.positional.push(arg);
 }
 return options;
}
const integer=(value,name)=>{if(value===undefined)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error(name+' must be a whole number');return n;};
const beijingStamp=()=>formatBeijingTime(Date.now()).replace(/[-: ]/g,'').slice(0,12);
function rewardsOf(options){
 const ifOwned=Object.fromEntries(Object.entries({coins:integer(options.ifOwnedCoins,'--if-owned-coins'),fragments:integer(options.ifOwnedFragments,'--if-owned-fragments')}).filter(([,value])=>value!==undefined));
 if(Object.keys(ifOwned).length&&!options.decorations)throw Error('--if-owned-* needs --decorations');
 const decorations=options.decorations?options.decorations.split(',').map(id=>id.trim()).filter(Boolean).map(id=>Object.keys(ifOwned).length?{id,ifOwned}:id):undefined;
 const rewards={coins:integer(options.coins,'--coins'),fragments:integer(options.fragments,'--fragments'),energy:integer(options.energy,'--energy'),energyPacks:integer(options.packs,'--packs'),decorations};
 return Object.fromEntries(Object.entries(rewards).filter(([,value])=>value!==undefined));
}
function decorationIds(options){
 const settings=createGameSettings({configurationPath:options.gameSettings?resolve(options.gameSettings):process.env.MOBILE_GAME_SETTINGS_CONFIG}).read();
 return new Set([...settings.decorations,...(catalog.rewardDecorations??[])].map(item=>item.id).filter(id=>!isRetiredDecoration(id)));
}
const decorationText=entry=>typeof entry==='string'?'装饰 '+entry:'装饰 '+entry.id+'（已拥有则 '+[entry.ifOwned.coins&&entry.ifOwned.coins+' 金币',entry.ifOwned.fragments&&entry.ifOwned.fragments+' 碎片'].filter(Boolean).join(' + ')+'）';
const rewardText=json=>{const r=JSON.parse(json);return [r.coins&&r.coins+' 金币',r.fragments&&r.fragments+' 碎片',r.energy&&r.energy+' 体力',r.energyPacks&&r.energyPacks+' 体力包',...(r.decorations??[]).map(decorationText)].filter(Boolean).join(' + ');};
function status(row,now){
 if(row.disabled)return 'disabled';
 if(row.starts_at!==null&&now<row.starts_at)return 'not-started';
 if(row.expires_at!==null&&now>row.expires_at)return 'expired';
 if(row.max_uses!==null&&row.uses>=row.max_uses)return 'used-up';
 return 'active';
}
const describe=(row,now)=>({code:row.code,kind:row.kind,batch:row.batch_id,status:status(row,now),uses:row.uses,maxUses:row.max_uses,rewards:JSON.parse(row.rewards),rewardText:rewardText(row.rewards),startsAt:row.starts_at===null?null:formatBeijingTime(row.starts_at)+' 北京',expiresAt:row.expires_at===null?null:formatBeijingTime(row.expires_at)+' 北京',note:row.note,createdAt:formatBeijingTime(row.created_at)+' 北京'});
function write(dbPath,fn){
 const db=new DatabaseSync(dbPath,{timeout:10000});
 try{
  db.exec('PRAGMA busy_timeout=10000');ensureRedeemTables(db);
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn(db);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 }finally{db.close();}
}
function read(dbPath,fn){
 const db=new DatabaseSync(dbPath,{readOnly:true,timeout:10000});
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_redeem_codes'").get())throw Error('No redeem tables yet: the backend with 兑换码 has not started on this database');
  return fn(db);
 }finally{db.close();}
}
const table=rows=>{if(!rows.length)return '(none)';const keys=Object.keys(rows[0]),width=keys.map(key=>Math.max(key.length,...rows.map(row=>String(row[key]??'').length)));return [keys.map((key,i)=>key.padEnd(width[i])).join('  '),...rows.map(row=>keys.map((key,i)=>String(row[key]??'').padEnd(width[i])).join('  '))].join('\n');};

function main(){
 const options=parse(process.argv.slice(2)),[command,argument]=options.positional;
 const dbPath=resolve(options.db??process.env.MOBILE_DB??LIVE_DB);
 if(!existsSync(dbPath))throw Error('Database not found: '+dbPath+' (pass --db <mobile-v3.sqlite>)');
 const now=Date.now();
 if(command==='create'){
  const entry={kind:'shared',rewards:rewardsOf(options),maxUses:integer(options.maxUses,'--max-uses')??null,startsAt:options.starts,expiresAt:options.expires,note:options.note};
  const ids=decorationIds(options),length=integer(options.length,'--length')??8;
  const row=write(dbPath,db=>{
   if(options.code){const made=redeemCodeRow({...entry,code:options.code},{now,decorationIds:ids});if(!insertRedeemCode(db,made))throw Error('Code already exists: '+made.code);return made;}
   for(let attempt=0;attempt<20;attempt++){const made=redeemCodeRow({...entry,code:generateRedeemCode(length)},{now,decorationIds:ids});if(insertRedeemCode(db,made))return made;}
   throw Error('Could not find a free code');
  });
  console.log(JSON.stringify({result:'created',...describe({...row,uses:0,disabled:0},now)},null,2));
  return;
 }
 if(command==='batch'){
  const count=integer(options.count,'--count'),length=integer(options.length,'--length')??10,batchId=options.batchId??'batch-'+beijingStamp();
  if(!count||count>5000)throw Error('--count must be 1..5000');
  const csv=resolve(options.csv??'redeem-'+batchId+'.csv');
  if(existsSync(csv))throw Error('CSV exists, choose another --csv: '+csv);
  const entry={kind:'single',batchId,rewards:rewardsOf(options),startsAt:options.starts,expiresAt:options.expires,note:options.note},ids=decorationIds(options);
  const rows=write(dbPath,db=>{
   if(db.prepare('SELECT 1 FROM mobile_redeem_codes WHERE batch_id=? LIMIT 1').get(batchId))throw Error('Batch id already used: '+batchId);
   const made=[];
   while(made.length<count){
    let row=null;for(let attempt=0;attempt<20&&!row;attempt++){const candidate=redeemCodeRow({...entry,code:generateRedeemCode(length)},{now,decorationIds:ids});if(insertRedeemCode(db,candidate))row=candidate;}
    if(!row)throw Error('Could not find a free code');made.push(row);
   }
   return made;
  });
  const quote=value=>/[",\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
  const lines=['code,batch,rewards,startsAt,expiresAt,note',...rows.map(row=>[row.code,batchId,rewardText(row.rewards),row.starts_at===null?'':formatBeijingTime(row.starts_at),row.expires_at===null?'':formatBeijingTime(row.expires_at),row.note??''].map(value=>quote(String(value))).join(','))];
  // BOM so Excel opens the Chinese reward text correctly.
  writeFileSync(csv,'﻿'+lines.join('\r\n')+'\r\n');
  console.log(JSON.stringify({result:'created',batch:batchId,count:rows.length,kind:'single',rewardText:rewardText(rows[0].rewards),startsAt:rows[0].starts_at===null?null:formatBeijingTime(rows[0].starts_at)+' 北京',expiresAt:rows[0].expires_at===null?null:formatBeijingTime(rows[0].expires_at)+' 北京',csv},null,2));
  for(const row of rows)console.log(row.code);
  return;
 }
 if(command==='list'){
  read(dbPath,db=>{
   const rows=options.batch?db.prepare('SELECT * FROM mobile_redeem_codes WHERE batch_id=? ORDER BY created_at,code').all(options.batch)
    :options.all?db.prepare('SELECT * FROM mobile_redeem_codes ORDER BY created_at,code').all()
    :db.prepare("SELECT * FROM mobile_redeem_codes WHERE kind='shared' ORDER BY created_at,code").all();
   console.log(table(rows.map(row=>{const d=describe(row,now);return {code:d.code,kind:d.kind,batch:d.batch??'',status:d.status,uses:d.uses+'/'+(d.maxUses??'∞'),rewards:d.rewardText,starts:d.startsAt??'',expires:d.expiresAt??'',note:d.note??''};})));
   if(!options.batch&&!options.all){
    const batches=db.prepare("SELECT batch_id,COUNT(*) codes,SUM(uses) used,MIN(created_at) created,MAX(disabled) anyDisabled FROM mobile_redeem_codes WHERE kind='single' GROUP BY batch_id ORDER BY created").all();
    console.log('\nSingle-use batches (list --batch <id> for the codes):');
    console.log(table(batches.map(row=>({batch:row.batch_id??'',codes:row.codes,used:row.used,created:formatBeijingTime(row.created)+' 北京'}))));
   }
  });
  return;
 }
 if(command==='stats'){
  const code=normalizeRedeemCode(argument);if(!code)throw Error('Usage: stats <CODE>');
  read(dbPath,db=>{
   const row=db.prepare('SELECT * FROM mobile_redeem_codes WHERE code=?').get(code);if(!row)throw Error('No such code: '+code);
   const claims=db.prepare('SELECT COUNT(*) n,MIN(claimed_at) first,MAX(claimed_at) last FROM mobile_redeem_claims WHERE code=?').get(code);
   const totals={coins:0,fragments:0,energy:0,energyPacks:0,energyPacksSkipped:0,decorations:0,decorationFallbacks:0};
   for(const claim of db.prepare('SELECT rewards FROM mobile_redeem_claims WHERE code=?').all(code)){const r=JSON.parse(claim.rewards);for(const key of ['coins','fragments','energy','energyPacks','energyPacksSkipped'])totals[key]+=r[key]??0;totals.decorations+=(r.decorations??[]).filter(d=>d.status==='granted').length;totals.decorationFallbacks+=(r.decorations??[]).filter(d=>d.fallback).length;}
   const hasAccounts=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_taptap_accounts'").get());
   const recent=db.prepare('SELECT c.owner,c.claimed_at,p.data FROM mobile_redeem_claims c LEFT JOIN mobile_profiles p ON p.id=c.owner WHERE c.code=? ORDER BY c.claimed_at DESC LIMIT 20').all(code).map(claim=>({
    owner:claim.owner.slice(0,12)+'…',name:(hasAccounts?db.prepare('SELECT nickname FROM mobile_taptap_accounts WHERE canonical_identity=? AND nickname IS NOT NULL LIMIT 1').get(claim.owner)?.nickname:null)??(claim.data?JSON.parse(claim.data).name:null),at:formatBeijingTime(claim.claimed_at)+' 北京'}));
   console.log(JSON.stringify({...describe(row,now),claims:{count:claims.n,first:claims.first?formatBeijingTime(claims.first)+' 北京':null,last:claims.last?formatBeijingTime(claims.last)+' 北京':null,granted:totals},recentClaims:recent},null,2));
  });
  return;
 }
 if(command==='disable'||command==='enable'){
  const code=normalizeRedeemCode(argument);if(!code)throw Error('Usage: '+command+' <CODE>');
  const row=write(dbPath,db=>{
   if(!db.prepare('UPDATE mobile_redeem_codes SET disabled=? WHERE code=?').run(command==='disable'?1:0,code).changes)throw Error('No such code: '+code);
   return db.prepare('SELECT * FROM mobile_redeem_codes WHERE code=?').get(code);
  });
  console.log(JSON.stringify({result:command+'d',...describe(row,now)},null,2));
  return;
 }
 throw Error('Usage: node scripts/redeem-codes.mjs create|batch|list|stats CODE|disable CODE|enable CODE [--db <mobile-v3.sqlite>] (see the header of this file)');
}

try{main();}catch(error){console.error(error.message);process.exitCode=1;}
