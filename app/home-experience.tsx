'use client';
import { usePathname,useRouter } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import DreamIntro from './dream-intro';
import SearchIntroduction from './search-introduction';
import ServiceFooter from './service-footer';
export default function HomeExperience() {
  const router=useRouter();
  // The entrance button must land in the same language as the page it was pressed on.
  const zh=isChinesePath(usePathname()||'');
  return <><DreamIntro onEnter={() => router.push(zh?'/zh/lobby':'/lobby')}/><SearchIntroduction kind="home"/><ServiceFooter/></>;
}
