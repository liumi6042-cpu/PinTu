'use client';
import { useRouter } from 'next/navigation';
import DreamIntro from './dream-intro';
import SearchIntroduction from './search-introduction';
import ServiceFooter from './service-footer';
export default function HomeExperience() {
  const router=useRouter();
  return <><DreamIntro onEnter={() => router.push('/lobby')}/><SearchIntroduction kind="home"/><ServiceFooter/></>;
}
