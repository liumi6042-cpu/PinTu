'use client';
import { ArrowLeft, Puzzle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLanguage } from './language-switch';

export default function PuzzleOpening({photo,pieces}:{photo:{title:string;thumbSrc:string};pieces:number}){
 useLanguage();
 return <main className="room-join-page puzzle-opening" aria-busy="true">
  <div className="room-join-heading"><a href="/lobby" className="back-button"><ArrowLeft size={18}/>{t('返回大厅')}</a></div>
  <section className="join-card" role="status" aria-live="polite">
   <img className="opening-picture" src={photo.thumbSrc} alt=""/>
   <h1>{t(photo.title)}</h1><p className="opening-progress"><Puzzle className="loading-icon" size={22}/>{t('正在打开拼图…')}</p>
   <p className="muted">{pieces.toLocaleString()} {t('片')}</p>
  </section>
 </main>;
}
