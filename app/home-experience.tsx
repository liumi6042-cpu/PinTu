'use client';
import { usePathname,useRouter } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import DreamIntro from './dream-intro';
import ResumePuzzle from './resume-puzzle';
import SearchIntroduction from './search-introduction';
import ServiceFooter from './service-footer';
// `daily` is a server-rendered slot: the page decides which language's puzzle of
// the day to place under the entrance, so its text is in the HTML rather than
// appearing only after the client picks a language. `dailyTitle` is that same
// picture's name in the page's language, which the entrance names in its link down.
// `footer` is false on the Chinese page, which renders its own copy of the copy below
// the footer's usual position — otherwise the footer sat in the middle of the page.
export default function HomeExperience({daily,dailyTitle,footer=true}:{daily?:React.ReactNode;dailyTitle?:string;footer?:boolean}) {
  const router=useRouter();
  // The entrance button must land in the same language as the page it was pressed on.
  const zh=isChinesePath(usePathname()||'');
  return <>
    <DreamIntro onEnter={() => router.push(zh?'/zh/lobby':'/lobby')} dailyTitle={dailyTitle}/>
    {/* The entrance fills the first screen by itself, so the two cards under it are
        invisible until someone scrolls — and the entrance's own button leaves the page
        instead, which is the usual path. The link inside the entrance points at this
        anchor, and the anchor starts above the returning-player reminder rather than at
        the picture of the day, so that reminder is not scrolled past. */}
    <div id="today"><ResumePuzzle/>{daily}</div>
    <SearchIntroduction kind="home"/>
    {footer&&<ServiceFooter/>}
  </>;
}
