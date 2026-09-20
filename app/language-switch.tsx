'use client';
import { useEffect,useState,useSyncExternalStore } from 'react';
import { usePathname,useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { applyDetectedLanguage,getLanguage,getLanguagePreference,getLanguageRevision,restoreLanguagePreference,setLanguage,setLanguagePreference,subscribeLanguage } from '@/lib/i18n';
import { browserLanguage,detectLanguage,LANGUAGE_KEY,languagePreference } from '@/lib/language-detection';
import { englishPath,hasChineseAddress,isChinesePath,zhPath } from '@/lib/site-paths';

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
  const pathname=usePathname()||'/',router=useRouter();
  // Public pages exist at two addresses, one per language, so choosing a language
  // moves to the matching address rather than only recolouring the page in place.
  // Routes without a Chinese copy (account, personal space, a live room) still just
  // switch the interface, because sending the visitor to /zh there would 404.
  const chinesePage=isChinesePath(pathname),english=chinesePage?englishPath(pathname):pathname;
  const chineseTarget=hasChineseAddress(english)?zhPath(english):null;
  const active=chinesePage?'zh':preference;
  const go=(next:'zh'|'en')=>{
    const target=next==='zh'?chineseTarget:(chinesePage?english:null);
    setLanguage(next);
    if(target&&target!==pathname)router.push(target);
  };
  const auto=()=>{setLanguagePreference('auto');if(chinesePage)router.push(english);};
  return <div className="language-switch" role="group" aria-label={language==='en'?'Language':'语言'}><Languages size={15} aria-hidden="true"/><button type="button" aria-pressed={active==='auto'} title={language==='en'?'Choose language automatically by IP region':'根据 IP 所在地区自动选择语言'} onClick={auto}>{language==='en'?'Auto':'自动'}</button><button type="button" lang="zh-CN" aria-pressed={active==='zh'} onClick={()=>go('zh')}>中文</button><button type="button" lang="en" aria-pressed={active==='en'} onClick={()=>go('en')}>EN</button></div>;
}
