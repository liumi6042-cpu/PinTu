import { neighbors,type Group,type PuzzleState } from './puzzle-engine';

/** 默契拼合: two players each held one side of a seam that just joined. The server never
 * merges into a group someone else holds, so in practice one player drops beside the other's
 * held group and the other then drops onto it; both holds count for TEAM_MERGE_WINDOW_MS
 * after they end. Client-side only: every client derives it from the same snapshots. */
export const TEAM_MERGE_WINDOW_MS=3000;
/** releasedAt is null while the player still holds the group. */
export type MergeHolder={player:string;name:string;color:string;releasedAt:number|null};
/** a and b are touching pieces on the joined seam, one from each player's group. */
export type TeamMerge={a:number;b:number;holders:[MergeHolder,MergeHolder]};

/** Recent holders by group id. A group id names the same pieces until it is merged away, so stale entries only expire. */
export class MergeHolderLog {
 readonly holders=new Map<number,MergeHolder>();
 hold(groupId:number,holder:Omit<MergeHolder,'releasedAt'>){this.holders.set(groupId,{...holder,releasedAt:null});}
 release(groupId:number,now:number){const holder=this.holders.get(groupId);if(holder&&holder.releasedAt===null)holder.releasedAt=now;}
 /** Remote leases: every listed group is held now; a remote hold missing from the list has ended. */
 syncRemote(owners:Readonly<Record<string,{playerId?:string;name:string;color:string}>>,now:number,localKey:string){
  for(const [id,owner] of Object.entries(owners))this.hold(Number(id),{player:owner.playerId||'name:'+owner.name,name:owner.name,color:owner.color});
  for(const [id,holder] of this.holders){if(holder.player!==localKey&&!owners[id])this.release(id,now);if(holder.releasedAt!==null&&now-holder.releasedAt>TEAM_MERGE_WINDOW_MS)this.holders.delete(id);}
 }
 clear(){this.holders.clear();}
}

export function detectTeamMerges(before:readonly Group[],after:Pick<PuzzleState,'cols'|'rows'|'groups'>,holders:ReadonlyMap<number,MergeHolder>,now:number,windowMs=TEAM_MERGE_WINDOW_MS):TeamMerge[]{
 if(holders.size<2)return [];
 const recent=(id:number)=>{const holder=holders.get(id);return holder&&(holder.releasedAt===null||now-holder.releasedAt<=windowMs)?holder:undefined;};
 const previous=new Int32Array(after.cols*after.rows).fill(-1),sizes=new Map<number,number>();
 for(const group of before){sizes.set(group.id,group.pieces.length);for(const id of group.pieces)previous[id]=group.id;}
 const result:TeamMerge[]=[];
 for(const group of after.groups){
  if(group.pieces.length<2||group.pieces.length===sizes.get(group.id))continue;
  const members=new Set(group.pieces);let found:TeamMerge|null=null;
  for(const id of group.pieces){
   const ga=previous[id],ha=ga>=0?recent(ga):undefined;if(!ha)continue;
   for(const next of neighbors(id,after.cols,after.rows)){
    const gb=previous[next];if(gb<0||gb===ga||!members.has(next))continue;
    const hb=recent(gb);if(hb&&hb.player!==ha.player){found={a:id,b:next,holders:[ha,hb]};break;}
   }
   if(found)break;
  }
  if(found)result.push(found);
  if(result.length===2)break;
 }
 return result;
}
