#!/usr/bin/env node
// Operator tool for gift-only decorations (e.g. 猫爪 for forum feedback).
// Run from a mobile backend release directory against the live database:
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --list-nickname 老头
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --player-code 123456789
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --grant cat-paw --owner <canonical> [--yes]
// Without --yes a grant is a dry run. A real grant first writes an online backup.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {grantRewardDecoration,MOBILE_COLLECTION_CATALOG} from '../server/mobile-collection.mjs';

function parse(argv){
 const options={yes:false};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--yes'){options.yes=true;continue;}
  const key={'--db':'db','--list-nickname':'nickname','--player-code':'code','--grant':'grant','--owner':'owner','--backup':'backup'}[arg];
  if(!key||i+1>=argv.length)throw Error('Unknown or incomplete argument: '+arg);
  options[key]=argv[++i];
 }
 return options;
}
const iso=ms=>Number.isFinite(Number(ms))&&Number(ms)>0?new Date(Number(ms)).toISOString():null;
const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

function describe(db,owner){
 const profileRow=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner),profile=profileRow?JSON.parse(profileRow.data):null;
 const account=db.prepare('SELECT nickname,created_at FROM mobile_taptap_accounts WHERE canonical_identity=? ORDER BY created_at LIMIT 1').get(owner);
 const code=hasTable(db,'mobile_social_players')?db.prepare('SELECT code FROM mobile_social_players WHERE owner=?').get(owner)?.code??null:null;
 const owned=hasTable(db,'mobile_collection_owned')?db.prepare("SELECT item_id FROM mobile_collection_owned WHERE owner=? AND kind='decoration' ORDER BY item_id").all(owner).map(row=>row.item_id):[];
 const equipped=hasTable(db,'mobile_collection_wallets')?db.prepare('SELECT equipped FROM mobile_collection_wallets WHERE owner=?').get(owner)?.equipped??null:null;
 return {canonicalIdentity:owner,taptapNickname:account?.nickname??null,taptapBoundAt:iso(account?.created_at),playerCode:code,profileName:profile?.name??null,level:profile?.level??null,ownedDecorations:owned,equipped};
}

function list(db,nickname){
 const pattern='%'+nickname.replace(/[\\%_]/g,match=>'\\'+match)+'%';
 const owners=new Set([
  ...db.prepare("SELECT canonical_identity id FROM mobile_taptap_accounts WHERE nickname LIKE ? ESCAPE '\\'").all(pattern).map(row=>row.id),
  ...db.prepare("SELECT id FROM mobile_profiles WHERE json_extract(data,'$.name') LIKE ? ESCAPE '\\'").all(pattern).map(row=>row.id),
 ]);
 return [...owners].map(owner=>describe(db,owner));
}

function main(){
 const options=parse(process.argv.slice(2));
 const dbPath=options.db?resolve(options.db):process.env.MOBILE_DATABASE_PATH?resolve(process.env.MOBILE_DATABASE_PATH):null;
 if(!dbPath||!existsSync(dbPath))throw Error('Pass --db <mobile-v3.sqlite> (file must exist)');
 if(options.nickname||options.code){
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
   if(options.nickname)console.log(JSON.stringify({query:{nickname:options.nickname},candidates:list(db,options.nickname)},null,2));
   if(options.code){
    if(!/^\d{9}$/.test(options.code))throw Error('Player code must be 9 digits');
    const owner=hasTable(db,'mobile_social_players')?db.prepare('SELECT owner FROM mobile_social_players WHERE code=?').get(options.code)?.owner:null;
    console.log(JSON.stringify({query:{playerCode:options.code},candidates:owner?[describe(db,owner)]:[]},null,2));
   }
  }finally{db.close();}
  return;
 }
 if(!options.grant||!options.owner)throw Error('Use --list-nickname, --player-code, or --grant <decoration> --owner <canonical identity>');
 const reward=(MOBILE_COLLECTION_CATALOG.rewardDecorations??[]).find(item=>item.id===options.grant);
 if(!reward)throw Error('Not a gift decoration: '+options.grant);
 const probe=new DatabaseSync(dbPath,{readOnly:true});
 let before;
 try{
  if(!probe.prepare('SELECT 1 FROM mobile_profiles WHERE id=?').get(options.owner)&&!probe.prepare('SELECT 1 FROM mobile_taptap_accounts WHERE canonical_identity=?').get(options.owner))throw Error('Unknown owner: '+options.owner);
  before=describe(probe,options.owner);
 }finally{probe.close();}
 if(before.ownedDecorations.includes(reward.id)){console.log(JSON.stringify({result:'already-owned',decoration:reward.id,player:before},null,2));return;}
 if(!options.yes){console.log(JSON.stringify({result:'dry-run',decoration:reward.id,title:reward.title,player:before,next:'add --yes to grant'},null,2));return;}
 return (async()=>{
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath=resolve(options.backup??join(dirname(dbPath),'operations','grant-decoration-'+stamp,'mobile-v3.sqlite'));
  mkdirSync(dirname(backupPath),{recursive:true});
  const db=new DatabaseSync(dbPath,{timeout:5000});
  try{
   await backup(db,backupPath);
   db.exec('BEGIN IMMEDIATE');
   let granted;
   try{granted=grantRewardDecoration(db,options.owner,reward.id,Date.now());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
   console.log(JSON.stringify({result:granted?'granted':'already-owned',decoration:reward.id,backup:backupPath,player:describe(db,options.owner)},null,2));
  }finally{db.close();}
 })();
}

try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
