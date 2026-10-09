import {pieceBand} from './piece-policy';
export const ADS_AVAILABLE=false;
export const ASSISTANCE_POLICY={
 hint:{title:'提示',maxPerGame:3,durationSeconds:30,description:'次数随片数增加，每次标出最多 3 片及对应位置，持续 30 秒。'},
 underlay:{title:'底图',maxPerGame:2,durationSeconds:30,description:'次数随片数增加，每次底图持续 30 秒。'}
} as const;
export type AssistanceKind=keyof typeof ASSISTANCE_POLICY;
export const ASSISTANCE_KINDS:AssistanceKind[]=['underlay','hint'];
// Historical reference grants stay readable, but can no longer be activated.
export type AssistanceGrant={requestId:string;kind:AssistanceKind|'reference';expiresAt:number;pieceIds:number[]};
export type AssistanceState={grants:AssistanceGrant[];serverTime:number};
export function isAssistanceKind(value:unknown):value is AssistanceKind{return typeof value==='string'&&ASSISTANCE_KINDS.includes(value as AssistanceKind);}
export function assistanceLimit(kind:AssistanceKind,pieces=108){
 const band=pieceBand(pieces)??108;
 const limits=band>=1000?{underlay:6,hint:12}:band>=500?{underlay:4,hint:8}:band>=300?{underlay:3,hint:5}:{underlay:2,hint:3};
 return limits[kind];
}
export function assistanceRemaining(grants:AssistanceGrant[],kind:AssistanceKind,pieces=108){return Math.max(0,assistanceLimit(kind,pieces)-grants.filter(g=>g.kind===kind).length);}
export function activeAssistance(grants:AssistanceGrant[],kind:AssistanceKind,now:number){return grants.findLast(g=>g.kind===kind&&g.expiresAt>now);}
