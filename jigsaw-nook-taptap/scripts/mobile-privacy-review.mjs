import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readMobilePrivacyReview} from '../server/mobile-privacy.mjs';

const MISMATCH='参数或申请信息不匹配，请核对命令及申请编号、核验编号。';
const UNAVAILABLE='无法进行只读核对，请核对数据库绝对路径及数据库版本。';
const queries=[
 ['mobile_profiles','id=?'],
 ['mobile_rooms',"owner=? OR EXISTS(SELECT 1 FROM json_each(data,'$.members') m WHERE json_extract(m.value,'$.guestId')=? OR json_extract(m.value,'$.accountId')=?)",3],
 ['mobile_requests','owner=?'],['mobile_ad_challenges','owner=?'],
 ['mobile_tool_uses','owner=?'],['mobile_tool_grants','owner=?'],['mobile_settlements','owner=?'],['mobile_chat','owner=?'],
 ['mobile_cursors',"EXISTS(SELECT 1 FROM mobile_rooms r,json_each(r.data,'$.members') m WHERE r.id=mobile_cursors.room_id AND json_extract(m.value,'$.id')=mobile_cursors.player_id AND (json_extract(m.value,'$.guestId')=? OR json_extract(m.value,'$.accountId')=?))",2],
 ['mobile_collection_wallets','owner=?'],['mobile_collection_ledger','owner=?'],['mobile_collection_owned','owner=?'],
 ['mobile_collection_artworks','owner=?'],['mobile_collection_milestones','owner=?'],['mobile_collection_milestone_rewards','owner=?'],['mobile_collection_completions','owner=?'],
 ['mobile_task_events','owner=?'],['mobile_task_daily','owner=?'],['mobile_task_gifts','owner=?'],
 ['mobile_task_gift_rewards','EXISTS(SELECT 1 FROM mobile_task_gifts g WHERE g.id=mobile_task_gift_rewards.gift_id AND g.owner=?)'],
 ['mobile_invitation_codes','owner=?'],['mobile_invitation_bindings','invitee=? OR inviter=?',2],['mobile_invitation_shares','owner=?'],
 ['mobile_social_players','owner=?'],['mobile_friend_requests','sender=? OR recipient=?',2],['mobile_friends','owner=? OR peer=?',2],
 ['mobile_social_blocks','owner=? OR peer=?',2],['mobile_social_rates','owner=?'],
 ['mobile_private_messages','sender=? OR recipient=?',2],['mobile_private_reads','owner=? OR peer=?',2],
 ['mobile_chat_reports','reporter=? OR target=?',2],['mobile_privacy_requests','owner=?'],['mobile_privacy_receipts','owner=?'],
];

function parse(args){
 const values={};let command;
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(['list','review'].includes(arg)){if(command)throw Error(MISMATCH);command=arg;continue;}
  if(!['--db','--request-id','--verification-code'].includes(arg)||values[arg]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error(MISMATCH);
  values[arg]=args[++i];
 }
 if(!command||!values['--db']||!isAbsolute(values['--db']))throw Error(MISMATCH);
 if(command==='list'&&(values['--request-id']||values['--verification-code']))throw Error(MISMATCH);
 if(command==='review'&&(!/^[a-f0-9]{32}$/.test(values['--request-id']??'')||!/^[a-fA-F0-9]{20}$/.test(values['--verification-code']??'')))throw Error(MISMATCH);
 return {command,path:values['--db'],requestId:values['--request-id'],verificationCode:values['--verification-code']?.toUpperCase()};
}

/** Operator-only inspection. No environment/config loading, database creation,
 * mutations, status transitions, message bodies, identity hashes or tokens.
 * Counts are for review planning; they are not an automatic deletion plan.
 */
export function mobilePrivacyReview(args){
 let input;
 try{input=parse(args);}catch{return {ok:false,matched:false,error:MISMATCH};}
 let db;
 try{
  // readOnly also prevents creation if the file disappears after stat().
  if(!statSync(input.path).isFile())throw Error(UNAVAILABLE);
  db=new DatabaseSync(input.path,{readOnly:true});
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
  if(input.command==='list'){
   const requests=db.prepare("SELECT request_id AS requestId,type,status,created_at AS createdAt,updated_at AS updatedAt FROM mobile_privacy_requests WHERE status IN ('pending','in_review') ORDER BY created_at,request_id LIMIT 101").all();
   return {ok:true,requests:requests.slice(0,100),hasMore:requests.length>100};
  }
  const request=readMobilePrivacyReview(db,{requestId:input.requestId,verificationCode:input.verificationCode});
  if(!request)return {ok:false,matched:false,error:MISMATCH};
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const counts={};
  for(const [table,where,parameters=1] of queries){
   counts[table]=tables.has(table)?Number(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...Array(parameters).fill(request.owner)).n):null;
  }
  return {ok:true,matched:true,counts};
 }catch{return {ok:false,matched:false,error:UNAVAILABLE};}
 finally{if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=mobilePrivacyReview(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));
 if(!result.ok)process.exitCode=1;
}
