'use client';
import { usePathname,useRouter } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import DreamIntro from './dream-intro';
import ResumePuzzle from './resume-puzzle';
import SearchIntroduction from './search-introduction';
import ServiceFooter from './service-footer';
// `daily` is a server-rendered slot: the page decides which language's puzzle of
// the day to place under the entrance, so its text is in the HTML rather than
// appearing only after the client picks a language. `footer` is false on the
// Chinese page, which renders its own copy of the copy below the footer's usual
// position — otherwise the footer sat in the middle of the page.
export default function HomeExperience({daily,footer=true}:{daily?:React.ReactNode;footer?:boolean}) {
  const router=useRouter();
  // The entrance button must land in the same language as the page it was pressed on.
  const zh=isChinesePath(usePathname()||'');
  return <><DreamIntro onEnter={() => router.push(zh?'/zh/lobby':'/lobby')}/><ResumePuzzle/>{daily}<SearchIntroduction kind="home"/>{footer&&<ServiceFooter/>}</>;
}
