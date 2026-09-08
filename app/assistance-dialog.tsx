'use client';
import { LockKeyhole,Clapperboard } from 'lucide-react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { ASSISTANCE_POLICY,type AssistanceKind } from '@/lib/assistance-policy';
export default function AssistanceDialog({kind,onClose}:{kind:AssistanceKind|null;onClose:()=>void}){
 const policy=kind?ASSISTANCE_POLICY[kind]:null;
 return <Dialog open={kind!==null} onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="underlay-dialog"><div className="room-icon"><LockKeyhole size={26}/></div><DialogTitle>{policy?.title}暂时锁定</DialogTitle><DialogDescription>{policy?.description}</DialogDescription><div className="ad-rule"><Clapperboard size={22}/><div><strong>{kind==='hint'?'每局最多 3 次':kind==='reference'?'不限次数 · 每次 30 秒':'每次 30 秒'}</strong><p>广告解锁暂未开放</p></div></div><button className="primary" onClick={onClose}>知道了，继续拼图</button></DialogContent></Dialog>;
}
