'use client';
import { useEffect,useState,useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import { applyDetectedLanguage,getLanguage,getLanguagePreference,getLanguageRevision,restoreLanguagePreference,setLanguage,setLanguagePreference,subscribeLanguage } from '@/lib/i18n';
import { browserLanguage,detectLanguage,LANGUAGE_KEY,languagePreference } from '@/lib/language-detection';

export function useLanguage(){return useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'en' as const);}
function useLanguagePreference(){return useSyncExternalStore(subscribeLanguage,getLanguagePreference,()=> 'auto' as const);}
export function LanguageProvider({children}:{children:React.ReactNode}){
  const preference=useLanguagePreference();
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    restoreLanguagePreference();setReady(true);
    const sync=(event:StorageEvent)=>{if(event.key===LANGUAGE_KEY||event.key===null)setLanguagePreference(languagePreference(event.newValue),false);};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  useEffect(()=>{
    if(!ready||preference!=='auto')return;
    const controller=new AbortController(),revision=getLanguageRevision();
    const fallback=browserLanguage(navigator.languages?.length?navigator.languages:[navigator.language]);
    let active=true;
    const timer=window.setTimeout(()=>{
      controller.abort();if(active)applyDetectedLanguage(fallback,revision);
    },2500);
    void detectLanguage(fallback,controller.signal).then(value=>{
      window.clearTimeout(timer);if(active&&!controller.signal.aborted)applyDetectedLanguage(value,revision);
    });
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[ready,preference]);
  return children;
}
export default function LanguageSwitch(){
  const language=useLanguage(),preference=useLanguagePreference();
  return <div className="language-switch" role="group" aria-label={language==='en'?'Language':'语言'}><Languages size={15} aria-hidden="true"/><button type="button" aria-pressed={preference==='auto'} title={language==='en'?'Choose language automatically by IP region':'根据 IP 所在地区自动选择语言'} onClick={()=>{if(preference!=='auto')setLanguagePreference('auto');}}>{language==='en'?'Auto':'自动'}</button><button type="button" lang="zh-CN" aria-pressed={preference==='zh'} onClick={()=>setLanguage('zh')}>中文</button><button type="button" lang="en" aria-pressed={preference==='en'} onClick={()=>setLanguage('en')}>EN</button></div>;
}
