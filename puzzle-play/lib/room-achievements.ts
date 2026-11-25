import { achievementDay } from './achievements';
import type { Room,Member } from './room-engine';
export type RoomAchievementContribution={count:number;days:string[]};
export type RoomAchievementState={version:1;contributors:Record<string,RoomAchievementContribution>};
export const achievementOwner=(member:Member)=>member.accountId||member.guestId||null;
export function recordRoomContribution(room:Room,member:Member,now:number){
  const owner=achievementOwner(member);if(!owner)return;
  const state=room.achievements??={version:1,contributors:{}};
  const contribution=state.contributors[owner]??={count:0,days:[]};contribution.count++;
  const day=achievementDay(now);if(!contribution.days.includes(day))contribution.days.push(day);
}
export function completionOwners(room:Room){
  if(!room.completedAt)return [];
  if(room.visibility==='solo')return room.ownerId?[{owner:room.ownerId,mode:'solo' as const}]:[];
  const owners=Object.entries(room.achievements?.contributors||{}).filter(([,c])=>c.count>0).map(([id])=>id);
  // A lone contributor to a shared table still earns collection achievements, not teamwork or solo-mode challenges.
  return owners.map(owner=>({owner,mode:owners.length>=2?'team' as const:'shared' as const}));
}
