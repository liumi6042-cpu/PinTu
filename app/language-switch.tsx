'use client';
import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { usePathname,useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { applyDetectedLanguage,getLanguage,getLanguagePreference,getLanguageRevision,restoreLanguagePreference,setLanguage,setLanguagePreference,subscribeLanguage } from '@/lib/i18n';
import { browserLanguage,detectLanguage,LANGUAGE_KEY,languagePreference } from '@/lib/language-detection';
import { activeLanguage,englishPath,hasChineseAddress,isChinesePath,zhPath } from '@/lib/site-paths';

export function useLanguage(){return useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'en' as const);}
function useLanguagePreference(){return useSyncExternalStore(subscribeLanguage,getLanguagePreference,()=> 'auto' as const);}
export function LanguageProvider({children}:{children:React.ReactNode}){
  const preference=useLanguagePreference();
  const [ready,setReady]=useState(false);
  const pathname=usePathname()||'/',router=useRouter(),syncedOnce=useRef(false);
  useEffect(()=>{
    restoreLanguagePreference();setReady(true);
    const sync=(event:StorageEvent)=>{if(event.key===LANGUAGE_KEY||event.key===null)setLanguagePreference(languagePreference(event.newValue),false);};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  // A visitor whose choice predates the language cookie: the middleware could not see it on
  // this first visit, so the page moves to the address that speaks it here. Restoring the
  // choice above writes the cookie, and from the next request on the middleware redirects
  // before anything renders, leaving this effect with nothing to do. Runs once so it never
  // races a click on the switch itself.
  useEffect(()=>{
    if(!ready||syncedOnce.current)return;
    syncedOnce.current=true;
    if(preference==='auto'||!hasChineseAddress(pathname))return;
    const english=isChinesePath(pathname)?englishPath(pathname):pathname;
    const target=preference==='zh'?zhPath(english):english;
    if(target!==pathname)router.replace(target);
  },[ready,preference,pathname,router]);
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
  const paired=hasChineseAddress(pathname);
  const chineseTarget=paired?zhPath(english):null;
  // The lit button says what the page in front of the visitor actually is. On a paired
  // address the address decides — showing 中文 as selected while /lobby reads English was
  // exactly the disagreement visitors noticed. Elsewhere the visitor's own choice decides.
  const active=activeLanguage(pathname,preference);
  const go=(next:'zh'|'en')=>{
    const target=next==='zh'?chineseTarget:(chinesePage?english:null);
    setLanguage(next);
    if(target&&target!==pathname)router.push(target);
  };
  // 自动 hands the decision back to detection, and on a paired address that decision has an
  // address too: the page follows the detected language instead of staying behind.
  const auto=()=>{
    setLanguagePreference('auto');
    if(!paired)return;
    const fallback=browserLanguage(navigator.languages?.length?navigator.languages:[navigator.language]);
    void detectLanguage(fallback,new AbortController().signal).then(value=>{
      const target=value==='zh'?zhPath(english):english;
      if(target!==pathname)router.push(target);
    });
  };
  return <div className="language-switch" role="group" aria-label={chinesePage?'语言':'Language'}><Languages size={15} aria-hidden="true"/><button type="button" aria-pressed={active==='auto'} title={chinesePage?'根据 IP 所在地区自动选择语言':'Choose language automatically by IP region'} onClick={auto}>{chinesePage?'自动':'Auto'}</button><button type="button" lang="zh-CN" aria-pressed={active==='zh'} onClick={()=>go('zh')}>中文</button><button type="button" lang="en" aria-pressed={active==='en'} onClick={()=>go('en')}>EN</button></div>;
}
