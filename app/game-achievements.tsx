'use client';
import { useEffect,useState } from 'react';
import { X,ArrowUpRight } from 'lucide-react';
import { achievementById,emptyBook,type AchievementBook,type AchievementId } from '@/lib/achievements';
import { readLocalAchievements,recordLocalPuzzle } from '@/lib/local-achievements';
import type { PuzzleState } from '@/lib/puzzle-engine';
import type { RoomClient } from '@/lib/room-client';
import { t } from '@/lib/i18n';
import AchievementBadge from './achievement-badge';
export function useGameAchievements(state:PuzzleState,client?:RoomClient){
  const [book,setBook]=useState<AchievementBook>(emptyBook),[earned,setEarned]=useState<AchievementId[]>([]),[toast,setToast]=useState<AchievementId[]>([]);
  useEffect(()=>{
    let alive=true,busy=false,again=false,known:Set<string>|null=null,lastSignal='';
    const announce=(ids:AchievementId[])=>{if(!ids.length)return;setEarned(previous=>[...new Set([...previous,...ids])]);setToast(ids);};
    const load=async()=>{
      if(busy){again=true;return;}busy=true;
      try{
        let next:AchievementBook;
        if(client){const response=await fetch('/api/achievements?room='+client.snapshot.id,{headers:{Authorization:'Bearer '+client.ticket.token},cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();next=((await response.json()) as {book:AchievementBook}).book;}
        else next=readLocalAchievements(localStorage);
        if(alive){if(known)announce((Object.keys(next.earned) as AchievementId[]).filter(id=>!known!.has(id)));known=new Set(Object.keys(next.earned));setBook(next);}
      }catch{/* Achievements never interrupt puzzle controls; the album offers retry. */}
      finally{busy=false;if(again&&alive){again=false;void load();}}
    };
    if(!client)try{recordLocalPuzzle(localStorage,state);}catch{}
    void load();
    const localUpdate=(event:Event)=>{announce((event as CustomEvent<AchievementId[]>).detail||[]);void load();};
    const check=()=>{if(!client)return;const signal=(client.snapshot.achievementDays?.[client.ticket.playerId]||'')+':'+(client.snapshot.completedAt||'');if(signal!==lastSignal){lastSignal=signal;void load();}};
    const unsubscribe=client?.subscribe(check);if(client)lastSignal=(client.snapshot.achievementDays?.[client.ticket.playerId]||'')+':'+(client.snapshot.completedAt||'');
    const reload=()=>void load();
    window.addEventListener('focus',reload);
    if(!client){window.addEventListener('puzzle:achievements',localUpdate);window.addEventListener('storage',reload);}
    return()=>{alive=false;unsubscribe?.();window.removeEventListener('focus',reload);window.removeEventListener('storage',reload);window.removeEventListener('puzzle:achievements',localUpdate);};
  },[state,client]);
  useEffect(()=>{if(!toast.length)return;const timer=setTimeout(()=>setToast([]),5500);return()=>clearTimeout(timer);},[toast]);
  return {book,earned,toast,dismiss:()=>setToast([]),href:'/achievements?source='+(client?'server':'local')};
}
export function AchievementToast({ids,onClose,href}:{ids:AchievementId[];onClose:()=>void;href:string}){
  if(!ids.length)return null;return <aside className="achievement-toast" role="status" aria-live="polite"><AchievementBadge id={ids[0]}/><div><small>{t('新成就已收进纪念册')}</small><strong>{ids.map(id=>t(achievementById(id)!.name)).join(' · ')}</strong><a href={href} target="_blank" rel="noreferrer">{t('查看纪念册')}<ArrowUpRight size={14}/></a></div><button onClick={onClose} aria-label={t('关闭')}><X size={16}/></button></aside>;
}
export function CompletionAchievements({ids}:{ids:AchievementId[]}){
  return <div className="completion-achievements">{ids.length>0&&<><p>{t('这一局的新纪念')}</p><div>{ids.map(id=><span key={id}><AchievementBadge id={id}/><small>{t(achievementById(id)!.name)}</small></span>)}</div></>}</div>;
}
