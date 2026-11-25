import {localDb} from './local-db';
import {playerName} from './player-name';
import type {Room} from './room-engine';

/** Match mobile: positive counts, stable insertion order for ties, at most eight. */
export async function sharedContributionView(room:Room,viewer?:string){
 const contributors=room.achievements?.contributors??{};
 const ranked=Object.entries(contributors).filter(([,value])=>value.count>0).sort((a,b)=>b[1].count-a[1].count).slice(0,8);
 const identity=new Map(room.members.map(member=>[member.id,member.guestId||member.accountId]));
 const owners=[...new Set([...identity.values(),...ranked.map(([owner])=>owner)].filter((owner):owner is string=>!!owner))];
 const people=new Map<string,{name:string|null;code:string|null}>();
 if(owners.length){
  const rows=await localDb().prepare(`SELECT c.owner,c.code,u.name FROM puzzle_managed_invitation_codes c LEFT JOIN puzzle_users u ON u.id=c.owner WHERE c.owner IN (${owners.map(()=>'?').join(',')})`).bind(...owners).all<{owner:string;code:string|null;name:string|null}>();
  for(const row of rows.results)people.set(row.owner,row);
 }
 return {
  member:(id:string)=>{const owner=identity.get(id);return {contribution:owner?contributors[owner]?.count??0:0,code:owner?people.get(owner)?.code??null:null};},
  ranking:ranked.map(([owner,value])=>({
   name:playerName(people.get(owner)?.name??room.members.find(member=>(member.guestId||member.accountId)===owner)?.name??room.participants?.[owner],owner),
   code:people.get(owner)?.code??null,contribution:value.count,mine:owner===viewer,
  })),
 };
}
