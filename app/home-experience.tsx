'use client';
import { useState } from 'react';
import DreamIntro from './dream-intro';
import PuzzleApp from './puzzle-app';
import SearchIntroduction from './search-introduction';
import ServiceFooter from './service-footer';
export default function HomeExperience() {
  const [entered, setEntered] = useState(false);
  return entered ? <PuzzleApp guestPlay/> : <><DreamIntro onEnter={() => setEntered(true)}/><SearchIntroduction kind="home"/><ServiceFooter/></>;
}
