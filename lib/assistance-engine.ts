import type { PuzzleState } from './puzzle-engine';
import { ASSISTANCE_POLICY,isAssistanceKind,activeAssistance,assistanceRemaining,type AssistanceGrant,type AssistanceKind } from './assistance-policy';

export function hintPieces(state:PuzzleState,excluded=new Set<number>(),previous:number[]=[]){
 const seen=new Set(previous),available=state.groups.filter(g=>!g.locked&&!excluded.has(g.id)).flatMap(g=>g.pieces);
 // Prefer fresh pieces; do not move groups or include pieces being held by a player.
 return [...available.filter(id=>!seen.has(id)),...available.filter(id=>seen.has(id))].slice(0,3);
}
export function makeAssistanceGrant(grants:AssistanceGrant[],kind:AssistanceKind,requestId:string,state:PuzzleState,now:number,excluded=new Set<number>()):AssistanceGrant{
 if(!isAssistanceKind(kind))throw new Error('该帮助功能已移除，请使用底图或提示。');
 const retry=grants.find(g=>g.requestId===requestId);
 if(retry){if(retry.kind!==kind)throw new Error('请求格式无效');return retry;}
 const active=activeAssistance(grants,kind,now);if(active)return active;
 if(!assistanceRemaining(grants,kind,state.cols*state.rows))throw new Error('本局次数已用完');
 const pieceIds=kind==='hint'?hintPieces(state,excluded,grants.flatMap(g=>g.pieceIds)):[];
 if(kind==='hint'&&!pieceIds.length)throw new Error('暂时没有可提示的拼块，请稍后再试');
 return {requestId,kind,pieceIds,expiresAt:now+ASSISTANCE_POLICY[kind].durationSeconds*1000};
}
export function localAssistanceKey(state:Pick<PuzzleState,'imageId'|'cols'|'rows'|'seed'>){return `together-puzzle:assistance:v1:${state.imageId}:${state.cols}x${state.rows}:${state.seed}`;}
