'use client';
import { usePathname } from 'next/navigation';
import { t } from './i18n';
import { isChinesePath } from './site-paths';

// Every public page exists at two addresses, one per language, and on those pages the
// address decides the copy. t() falls back to English while the server renders (the
// interface language is only known after the visitor's browser reports it), so a page
// reached at /zh/... would otherwise hand English text to crawlers and to the first paint
// even though it declares lang="zh-CN". Same rule already applied to the day's picture
// label, the resume card and the gallery links; this is the shared version of it.
//
// Pages with no Chinese twin (a live room, the personal space) are not paired, so there
// isChinesePath is false and t() keeps following the interface language as before.
export function useAddressCopy() {
  const chinese = isChinesePath(usePathname() || '');
  // Same permissiveness as t(): anything that is not a string comes back untouched, so a
  // caller can hand over an optional field without a guard.
  return <T,>(text: T): T => (chinese || typeof text !== 'string' ? text : t(text));
}
