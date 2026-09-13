'use client';
import { Play } from 'lucide-react';
import { t } from '@/lib/i18n';
import Link from 'next/link';

type Props={photo:{id:string;title:string;subtitle:string;category:string;thumbSrc:string};disabled:boolean;eager:boolean;onPlay:()=>void;progress?:number;pieces:number};
export default function GalleryCard({photo,disabled,eager,onPlay,progress,pieces}:Props){
 return <article className="gallery-entry-card"><div className="gallery-card">
  <button className="gallery-picture gallery-launch" disabled={disabled} onClick={onPlay} aria-label={t(photo.title)+' · '+t(progress!==undefined?'继续拼图':'开始拼图')}>
   <img src={photo.thumbSrc} alt={t(photo.title)} loading={eager?'eager':'lazy'} decoding="async"/>
   <span className="gallery-card-action"><Play size={17}/>{t(progress!==undefined?'继续拼图':'开始拼图')}</span>
  </button>
  <div className="gallery-card-copy"><div><h2><Link prefetch={false} href={'/puzzle/'+photo.id}>{t(photo.title)}</Link></h2><span>{t(photo.category)}</span></div><p>{t(photo.subtitle)}</p>{progress!==undefined&&<small>{progress} / {pieces} {t('片')}</small>}</div>
 </div></article>;
}
