export const ADS_AVAILABLE=false;
export const ASSISTANCE_POLICY={
 hint:{title:'提示',maxPerGame:3,durationSeconds:30,description:'每局每人 3 次，每次标出最多 3 片及对应位置，持续 30 秒。'},
 underlay:{title:'底图',maxPerGame:2,durationSeconds:30,description:'每局每人可开启两次底图，每次持续 30 秒。'}
} as const;
export type AssistanceKind=keyof typeof ASSISTANCE_POLICY;
export const ASSISTANCE_KINDS:AssistanceKind[]=['underlay','hint'];
// Historical reference grants stay readable, but can no longer be activated.
export type AssistanceGrant={requestId:string;kind:AssistanceKind|'reference';expiresAt:number;pieceIds:number[]};
export type AssistanceState={grants:AssistanceGrant[];serverTime:number};
export function isAssistanceKind(value:unknown):value is AssistanceKind{return typeof value==='string'&&ASSISTANCE_KINDS.includes(value as AssistanceKind);}
export function assistanceRemaining(grants:AssistanceGrant[],kind:AssistanceKind){return Math.max(0,ASSISTANCE_POLICY[kind].maxPerGame-grants.filter(g=>g.kind===kind).length);}
export function activeAssistance(grants:AssistanceGrant[],kind:AssistanceKind,now:number){return grants.findLast(g=>g.kind===kind&&g.expiresAt>now);}
