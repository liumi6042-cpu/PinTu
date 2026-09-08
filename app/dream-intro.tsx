'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowUpRight, Puzzle } from 'lucide-react';
export default function DreamIntro({onEnter}:{onEnter:()=>void}){
 const scene=useRef<HTMLElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),frame=useRef(0),[flying,setFlying]=useState(false);
 const finish=()=>{try{sessionStorage.setItem('puzzle:intro-seen','1');}catch{}onEnter();};
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);cancelAnimationFrame(frame.current);},[]);
 function enter(){if(flying)return;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}setFlying(true);timer.current=setTimeout(finish,1450);}
 return <section ref={scene} className={'dream-intro'+(flying?' is-flying':'')} aria-label="一起拼图开场" onPointerMove={event=>{if(flying||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const r=event.currentTarget.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{scene.current?.style.setProperty('--mx',String(x));scene.current?.style.setProperty('--my',String(y));});}}>
  <div className="dream-camera" aria-hidden="true">
   <img className="dream-horizon" src="/intro/dream-horizon.png" alt="" fetchPriority="high"/>
   <div className="dream-atmosphere"/>
   <img className="dream-garden" src="/intro/floating-garden.png" alt="" draggable={false}/>
   <img className="dream-crane" src="/intro/paper-crane.png" alt="" draggable={false}/>
  </div>
  <header className="dream-header"><span><Puzzle size={25}/>一起拼图</span><button onClick={finish} disabled={flying}>跳过开场</button></header>
  <div className="dream-copy"><p>THE WORLD, PIECE BY PIECE</p><h1>走进<br/><em>另一片世界。</em></h1><button className="dream-enter" onClick={enter} disabled={flying}><span>{flying?'正在穿越…':'进入拼图世界'}</span><ArrowUpRight size={24}/></button><span className="dream-caption">一扇门，一场相遇，一起拼完整。</span></div>
  <div className="dream-bottom"><span>01 / A NEW PERSPECTIVE</span><span>移动光标，看看世界的另一层</span></div>
  <div className="dream-flash" aria-hidden="true"/>
 </section>;
}
