'use client';
import { useEffect,useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowRight, Puzzle } from 'lucide-react';
import { nextResume,resumeProgress,type ResumeProgress } from '@/lib/resume-progress';
import type { RoomCard } from '@/lib/lobby-types';
import { apiJson } from '@/lib/community-client';
import { englishCopy } from '@/lib/seo';
import { isChinesePath } from '@/lib/site-paths';

// A returning player's unfinished table is the most personal thing the home page can
// show, so it comes first and leads straight back into that room.
//
// Only server rooms count. Personal play is switched off (PERSONAL_PLAY_VISIBLE), so
// the gallery never loads this browser's own saves and there is no local game to
// offer; when personal play returns, feed readLocalProgress in here as well.
//
// The language follows the address, like every other link on the site, rather than
// the interface language: a Chinese visitor reading the English page automatically
// gets Chinese chrome, and mixing the two put a Chinese artwork name inside an
// English sentence.
export default function ResumePuzzle({compact=false}:{compact?:boolean}){
  const zh=isChinesePath(usePathname()||'');
  const [entry,setEntry]=useState<ResumeProgress|null>(null);
  useEffect(()=>{
    let alive=true;
    const take=(rooms:RoomCard[])=>{if(alive)setEntry(nextResume(resumeProgress([],rooms))??null);};
    const load=()=>{void apiJson<{rooms:RoomCard[]}>('/api/my-rooms').then(data=>take(data.rooms??[])).catch(()=>take([]));};
    load();
    // Coming back to the tab is exactly when a reminder is worth refreshing.
    window.addEventListener('focus',load);
    return ()=>{alive=false;window.removeEventListener('focus',load);};
  },[]);
  if(!entry)return null;
  const left=Math.max(0,entry.pieces-entry.placed),title=zh?entry.title:englishCopy(entry.title);
  if(compact)return <a className="h5-quick-action h5-resume-action" href={'/room/'+entry.id} aria-label={zh?'接着拼 · '+title:'Continue · '+title} title={title}>
    <Puzzle size={18} aria-hidden="true"/><span>{zh?'接着拼':'Continue'}</span><ArrowRight size={16} aria-hidden="true"/>
  </a>;
  return <section className="resume-puzzle" aria-label={zh?'继续未完成的拼图':'Continue an unfinished puzzle'}>
    <div className="resume-puzzle-inner">
      <span className="resume-puzzle-icon" aria-hidden="true"><Puzzle size={20}/></span>
      <div>
        <h2>{zh?`你的《${title}》还差 ${left} 片`:`Your “${title}” is ${left} pieces from done`}</h2>
        <p>{zh?`已归位 ${entry.placed} / ${entry.pieces} 片`:`${entry.placed} / ${entry.pieces} pieces placed`}</p>
      </div>
      <a className="resume-puzzle-action" href={'/room/'+entry.id}>{zh?'接着拼':'Keep going'}<ArrowRight size={16}/></a>
    </div>
  </section>;
}
