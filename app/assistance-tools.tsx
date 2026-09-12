'use client';
import { useEffect,useState,type ReactNode } from 'react';
import { Image as ImageIcon,Layers,Lightbulb,X } from 'lucide-react';
import { useLanguage } from './language-switch';
import { t } from '@/lib/i18n';
import { useAssistance } from '@/lib/use-assistance';
import { ASSISTANCE_POLICY,activeAssistance,assistanceRemaining,type AssistanceKind } from '@/lib/assistance-policy';
import type { PuzzleState } from '@/lib/puzzle-engine';
import type { PuzzleTable } from '@/lib/puzzle-table';
import type { RoomClient } from '@/lib/room-client';
import './assistance-tools.css';

export default function AssistanceTools({state,src,client,getTable,loading,disabled,edgesButton,organizeButton}:{state:PuzzleState;src:string;client?:RoomClient;getTable:()=>PuzzleTable|null;loading:boolean;disabled:boolean;edgesButton:ReactNode;organizeButton:ReactNode}){
 useLanguage();const aid=useAssistance(state,client),[referenceHidden,setReferenceHidden]=useState(false);
 const underlayUntil=aid.underlay?.expiresAt||0,hint=aid.hint;
 useEffect(()=>{if(!loading)getTable()?.setUnderlay(disabled?0:underlayUntil);},[underlayUntil,loading,disabled,getTable]);
 useEffect(()=>{if(!loading)getTable()?.setHints(disabled?[]:hint?.pieceIds||[],disabled?0:hint?.expiresAt||0);},[hint,loading,disabled,getTable]);
 const button=(kind:AssistanceKind)=>{
  const policy=ASSISTANCE_POLICY[kind],active=activeAssistance(aid.grants,kind,aid.now),remaining=assistanceRemaining(aid.grants,kind),Icon=kind==='reference'?ImageIcon:kind==='underlay'?Layers:Lightbulb;
  const counter=active?`${Math.max(0,Math.ceil((active.expiresAt-aid.now)/1000))}s`:`${remaining}/${policy.maxPerGame}`;
  return <button className={'tool assistance-tool'+(active?' active':'')} disabled={disabled||loading||!aid.ready||aid.busy||(!active&&!remaining)||(!!active&&kind!=='reference')} aria-label={`${t(policy.title)} · ${counter} · ${t(policy.description)}`} title={t(policy.description)} aria-busy={aid.busy} onClick={()=>{if(kind==='reference')setReferenceHidden(false);void aid.activate(kind);}}><Icon size={20}/><span>{t(policy.title)}</span><small>{counter}</small></button>;
 };
 return <><aside className="table-tools" aria-label={t('拼图工具')}>{button('reference')}{edgesButton}{button('underlay')}<span className="tool-divider"/>{button('hint')}{organizeButton}</aside>
 {aid.reference&&!referenceHidden&&!disabled&&<section className="reference-card assistance-reference" aria-label={t('原图')}><div><span>{t('原图')} · {Math.max(0,Math.ceil((aid.reference.expiresAt-aid.now)/1000))}s</span><button className="icon-button" aria-label={t('收起原图')} onClick={()=>setReferenceHidden(true)}><X size={17}/></button></div><img src={src} alt={t('原图')} style={{aspectRatio:state.cols/state.rows,objectFit:'cover'}}/><p>{t('倒计时结束后自动收起')}</p></section>}
 {aid.error&&<div className="assistance-error" role="alert"><span>{t(aid.error)}</span><button className="text-button" onClick={()=>void aid.reload()}>{t('重试')}</button></div>}
 </>;
}
