'use client';
import { useEffect } from 'react';
import { setLanguagePreference } from '@/lib/i18n';
// Chinese pages pin the interface to Chinese but do not persist the choice, so a
// visitor who only ever opens /zh still gets automatic detection on the English
// pages. The same call also rewrites documentElement.lang, which is how the page
// is announced to assistive technology.
export default function ForceChinese(){
  useEffect(()=>{setLanguagePreference('zh',false);},[]);
  return null;
}
