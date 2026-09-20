'use client';
import { ArrowLeft, Puzzle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import { usePathname } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';

export default function PuzzleOpening({photo,pieces}:{photo:{title:string;thumbSrc:string};pieces:number}){
 useLanguage();
 const back=isChinesePath(usePathname()||'')?'/zh/lobby':'/lobby';
 return <main className="puzzle-opening">
  <nav className="puzzle-opening-nav"><a href={back} className="puzzle-opening-back"><ArrowLeft size={17} aria-hidden="true"/>{t('返回大厅')}</a></nav>
  <div className="puzzle-opening-stage">
   <section className="puzzle-opening-card" aria-labelledby="opening-title" aria-busy="true">
    <div className="puzzle-opening-frame"><img className="puzzle-opening-picture" src={photo.thumbSrc} width={480} height={240} alt=""/></div>
    <div className="puzzle-opening-details">
     <h1 id="opening-title">{t(photo.title)}</h1>
     <span className="puzzle-opening-count">{pieces.toLocaleString()} {t('片')}</span>
    </div>
    <p className="puzzle-opening-status" role="status" aria-live="polite"><Puzzle size={18} aria-hidden="true"/><span>{t('正在打开拼图…')}</span></p>
   </section>
  </div>
 </main>;
}
