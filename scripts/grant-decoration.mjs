#!/usr/bin/env node
// Operator tool for feedback gifts: gift-only decorations (e.g. 猫爪), extra energy
// and a full stock of energy packs. Run from a mobile backend release directory:
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --list-nickname 老头
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --player-code 123456789
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --owner <canonical> --grant cat-paw [--yes]
//   node scripts/grant-decoration.mjs --db <mobile-v3.sqlite> --owner <canonical> --energy 100 --fill-refills
//       --source gift:20261030-echo [--game-settings <live game config>] [--yes]
// Without --yes a grant is a dry run. A real grant first writes an online backup.
// Energy may exceed the cap, as gameplay rewards do; natural recovery is settled first.
// Energy/refill grants are recorded once per (owner, source) in mobile_operator_grants.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {grantRewardDecoration,MOBILE_COLLECTION_CATALOG} from '../server/mobile-collection.mjs';
import {createGameSettings} from '../server/game-settings.mjs';
import {restoreEnergy,inviteCapBonus,effectiveEnergyCap} from '../server/mobile-economy.mjs';

/** Mirrors the supply inventory limit in mobile-service (库存已满 at 3). */
const SUPPLY_STOCK_MAXIMUM=3;

function parse(argv){
 const options={yes:false,fillRefills:false};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--yes'){options.yes=true;continue;}
  if(arg==='--fill-refills'){options.fillRefills=true;continue;}
  const key={'--db':'db','--list-nickname':'nickname','--player-code':'code','--grant':'grant','--owner':'owner','--backup':'backup','--energy':'energy','--source':'source','--game-settings':'gameSettings'}[arg];
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
 const social=hasTable(db,'mobile_social_players')?db.prepare('SELECT code,last_seen FROM mobile_social_players WHERE owner=?').get(owner):null;
 const owned=hasTable(db,'mobile_collection_owned')?db.prepare("SELECT item_id FROM mobile_collection_owned WHERE owner=? AND kind='decoration' ORDER BY item_id").all(owner).map(row=>row.item_id):[];
 const equipped=hasTable(db,'mobile_collection_wallets')?db.prepare('SELECT equipped FROM mobile_collection_wallets WHERE owner=?').get(owner)?.equipped??null:null;
 return {canonicalIdentity:owner,taptapNickname:account?.nickname??null,taptapBoundAt:iso(account?.created_at),profileCreatedAt:iso(profile?.createdAt),lastSeenAt:iso(social?.last_seen),playerCode:social?.code??null,profileName:profile?.name??null,level:profile?.level??null,energy:profile?.energy??null,energyPacks:profile?.supply?.energy??null,ownedDecorations:owned,equipped};
}

function list(db,nickname){
 const pattern='%'+nickname.replace(/[\\%_]/g,match=>'\\'+match)+'%';
 const owners=new Set([
  ...db.prepare("SELECT canonical_identity id FROM mobile_taptap_accounts WHERE nickname LIKE ? ESCAPE '\\'").all(pattern).map(row=>row.id),
  ...db.prepare("SELECT id FROM mobile_profiles WHERE json_extract(data,'$.name') LIKE ? ESCAPE '\\'").all(pattern).map(row=>row.id),
 ]);
 return [...owners].map(owner=>describe(db,owner));
}

function applySupplies(db,owner,{energy,fillRefills,source,settings},now){
 db.exec('CREATE TABLE IF NOT EXISTS mobile_operator_grants(owner TEXT NOT NULL,source TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,source))');
 if(db.prepare('SELECT 1 FROM mobile_operator_grants WHERE owner=? AND source=?').get(owner,source))return 'already-granted';
 const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data);
 const bonus=hasTable(db,'mobile_invitation_bindings')?inviteCapBonus(db,owner).count:0,cap=effectiveEnergyCap(profile.level,settings,bonus);
 const from={energy:profile.energy,energyPacks:profile.supply?.energy??0};
 restoreEnergy(profile,now,settings,{inviteBonus:bonus});
 const settled=profile.energy;
 profile.energy+=energy;if(energy>0)profile.energyAt=now;
 profile.supply={energy:0,create:0,...profile.supply};
 if(fillRefills)profile.supply.energy=Math.max(profile.supply.energy,SUPPLY_STOCK_MAXIMUM);
 db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),owner);
 const record={energy,fillRefills,cap,from,settled,to:{energy:profile.energy,energyPacks:profile.supply.energy}};
 db.prepare('INSERT INTO mobile_operator_grants VALUES(?,?,?,?)').run(owner,source,JSON.stringify(record),now);
 return record;
}

async function main(){
 const options=parse(process.argv.slice(2));
 const dbPath=options.db?resolve(options.db):process.env.MOBILE_DB?resolve(process.env.MOBILE_DB):null;
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
 const energy=options.energy===undefined?0:Number(options.energy);
 if(!Number.isSafeInteger(energy)||energy<0||energy>1000)throw Error('--energy must be an integer 0..1000');
 const supplies=energy>0||options.fillRefills;
 if(!options.owner||!options.grant&&!supplies)throw Error('Use --list-nickname, --player-code, or --owner <canonical identity> with --grant <decoration> and/or --energy/--fill-refills');
 if(supplies&&!/^gift:[a-z0-9-]{1,80}$/.test(options.source??''))throw Error('--energy/--fill-refills need --source gift:<id> so the grant is applied once');
 const reward=options.grant?(MOBILE_COLLECTION_CATALOG.rewardDecorations??[]).find(item=>item.id===options.grant):null;
 if(options.grant&&!reward)throw Error('Not a gift decoration: '+options.grant);
 const settings=createGameSettings({configurationPath:options.gameSettings?resolve(options.gameSettings):process.env.MOBILE_GAME_SETTINGS_CONFIG}).read();
 const probe=new DatabaseSync(dbPath,{readOnly:true});
 let before,suppliesDone=false;
 try{
  if(!probe.prepare('SELECT 1 FROM mobile_profiles WHERE id=?').get(options.owner)&&!probe.prepare('SELECT 1 FROM mobile_taptap_accounts WHERE canonical_identity=?').get(options.owner))throw Error('Unknown owner: '+options.owner);
  if(supplies&&!probe.prepare('SELECT 1 FROM mobile_profiles WHERE id=?').get(options.owner))throw Error('Owner has no profile yet: '+options.owner);
  before=describe(probe,options.owner);
  suppliesDone=supplies&&hasTable(probe,'mobile_operator_grants')&&Boolean(probe.prepare('SELECT 1 FROM mobile_operator_grants WHERE owner=? AND source=?').get(options.owner,options.source));
 }finally{probe.close();}
 const decorationPending=Boolean(reward)&&!before.ownedDecorations.includes(reward.id);
 const plan={decoration:reward?(decorationPending?reward.id:'already-owned'):null,energy:supplies?(suppliesDone?'already-granted':energy):null,fillRefills:supplies?(suppliesDone?'already-granted':options.fillRefills):null,source:options.source??null};
 if(!decorationPending&&!(supplies&&!suppliesDone)){console.log(JSON.stringify({result:'already-granted',plan,player:before},null,2));return;}
 if(!options.yes){console.log(JSON.stringify({result:'dry-run',plan,player:before,next:'add --yes to grant'},null,2));return;}
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backupPath=resolve(options.backup??join(dirname(dbPath),'operations','grant-decoration-'+stamp,'mobile-v3.sqlite'));
 mkdirSync(dirname(backupPath),{recursive:true});
 const db=new DatabaseSync(dbPath,{timeout:5000});
 try{
  await backup(db,backupPath);
  const details={decoration:null,supplies:null};
  db.exec('BEGIN IMMEDIATE');
  try{
   const now=Date.now();
   if(reward)details.decoration=grantRewardDecoration(db,options.owner,reward.id,now)?'granted':'already-owned';
   if(supplies)details.supplies=applySupplies(db,options.owner,{energy,fillRefills:options.fillRefills,source:options.source,settings},now);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(JSON.stringify({result:'granted',details,backup:backupPath,player:describe(db,options.owner)},null,2));
 }finally{db.close();}
}

try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
