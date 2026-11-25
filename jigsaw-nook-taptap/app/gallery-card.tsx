'use client';
import { useAddressCopy } from '@/lib/address-copy';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isChinesePath,zhPath } from '@/lib/site-paths';

type Props={photo:{id:string;title:string;subtitle:string;category:string;thumbSrc:string};disabled:boolean;eager:boolean;onPlay:()=>void;progress?:number;pieces:number};
export default function GalleryCard({photo,disabled,eager,onPlay,progress,pieces}:Props){
 // The picture links to the puzzle page in the language of the gallery it was
 // clicked from, so the Chinese gallery never drops a visitor into English.
 const copy=useAddressCopy();
 const href=zhPath('/puzzle/'+photo.id),path=isChinesePath(usePathname()||'')?href:'/puzzle/'+photo.id;
 return <article className="gallery-entry-card"><div className="gallery-card">
  <button className="gallery-picture gallery-launch" disabled={disabled} onClick={onPlay} aria-label={copy(photo.title)+' · '+copy(progress!==undefined?'继续拼图':'开始拼图')}>
   <img src={photo.thumbSrc} alt={copy(photo.title)} loading={eager?'eager':'lazy'} decoding="async"/>
   <span className="gallery-card-action"><Play size={17}/>{copy(progress!==undefined?'继续拼图':'开始拼图')}</span>
  </button>
  <div className="gallery-card-copy"><div><h2><Link prefetch={false} href={path}>{copy(photo.title)}</Link></h2><span>{copy(photo.category)}</span></div><p>{copy(photo.subtitle)}</p>{progress!==undefined&&<small>{progress} / {pieces} {copy('片')}</small>}</div>
 </div></article>;
}
