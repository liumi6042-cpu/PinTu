'use client';
import { useEffect,useRef,useState } from 'react';
import { Volume2,VolumeX,X } from 'lucide-react';
import { useLanguage } from './language-switch';
import { t } from '@/lib/i18n';
import { DEFAULT_SOUND,SNAP_SOUND_KEY,soundPreferences,type SoundPreferences } from '@/lib/snap-sound';
import type { PuzzleTable } from '@/lib/puzzle-table';
import './sound-control.css';

export default function SoundControl({getTable,loading}:{getTable:()=>PuzzleTable|null;loading:boolean}){
 useLanguage();const [settings,setSettings]=useState({...DEFAULT_SOUND}),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{try{setSettings(soundPreferences(localStorage.getItem(SNAP_SOUND_KEY)));}catch{}const sync=(e:StorageEvent)=>{if(e.key===SNAP_SOUND_KEY||e.key===null)setSettings(soundPreferences(e.newValue));};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 useEffect(()=>{if(!loading)getTable()?.setSoundPreferences(settings);},[settings,getTable,loading]);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const change=(next:SoundPreferences)=>{setSettings(next);const table=getTable();table?.setSoundPreferences(next);if(next.enabled)table?.unlockSound();try{localStorage.setItem(SNAP_SOUND_KEY,JSON.stringify(next));}catch{}};
 return <div className="snap-sound-control" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus();}}}>
  <button className="icon-button" aria-label={t(settings.enabled?'拼合音效：已开启':'拼合音效：已关闭')} title={t('拼合音效设置')} aria-expanded={open} onClick={()=>setOpen(!open)}>{settings.enabled?<Volume2 size={17}/>:<VolumeX size={17}/>}</button>
  {open&&<section className="snap-sound-panel" aria-label={t('拼合音效设置')}><div className="snap-sound-heading"><strong>{t('清脆双击')}</strong><button className="icon-button" aria-label={t('关闭音效设置')} onClick={()=>setOpen(false)}><X size={15}/></button></div>
   <label className="snap-sound-enabled"><span>{t('开启拼合音效')}</span><input type="checkbox" checked={settings.enabled} onChange={e=>change({...settings,enabled:e.target.checked})}/></label>
   <label className="snap-sound-volume"><span>{t('音效音量')} <output>{Math.round(settings.volume*100)}%</output></span><input type="range" min="0" max="100" step="1" aria-label={t('音效音量')} aria-valuetext={`${Math.round(settings.volume*100)}%`} value={Math.round(settings.volume*100)} onChange={e=>change({...settings,volume:Number(e.target.value)/100})}/></label>
   <button className="text-button" disabled={!settings.enabled||!settings.volume||loading} onClick={()=>getTable()?.playConnectionSound()}>{t('试听轻扣声')}<Volume2 size={14}/></button>
  </section>}
 </div>;
}
