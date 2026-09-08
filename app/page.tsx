'use client';
import { useState } from 'react';
import DreamIntro from './dream-intro';
import PuzzleApp from './puzzle-app';
export default function Home() {
 const [entered,setEntered]=useState(false);
 return entered?<PuzzleApp guestPlay/>:<DreamIntro onEnter={()=>setEntered(true)}/>;
}
