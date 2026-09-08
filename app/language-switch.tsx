'use client';
import { useEffect,useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import { getLanguage,setLanguage,subscribeLanguage } from '@/lib/i18n';

export function useLanguage(){return useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'zh' as const);}
export function LanguageProvider({children}:{children:React.ReactNode}){
  useEffect(()=>{
    try{setLanguage(localStorage.getItem('puzzle:language')==='en'?'en':'zh');}catch{}
    const sync=(event:StorageEvent)=>{if(event.key==='puzzle:language')setLanguage(event.newValue==='en'?'en':'zh');};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  return children;
}
export default function LanguageSwitch(){
  const language=useLanguage();
  return <div className="language-switch" role="group" aria-label={language==='en'?'Language':'语言'}><Languages size={15} aria-hidden="true"/><button type="button" lang="zh-CN" aria-pressed={language==='zh'} onClick={()=>setLanguage('zh')}>中文</button><button type="button" lang="en" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>EN</button></div>;
}
