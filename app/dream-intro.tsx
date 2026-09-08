'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,Puzzle } from 'lucide-react';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { PAPER_PIECE_PATH,reducedPaperMotion } from '@/lib/paper-interactions';
import HomeNavigation from './home-navigation';
export default function DreamIntro({onEnter}:{onEnter:()=>void}){
 const scene=useRef<HTMLElement>(null),stage=useRef<HTMLDivElement>(null),key=useRef<HTMLButtonElement>(null),slot=useRef<HTMLDivElement>(null);
 const phaseRef=useRef('idle'),done=useRef(false),timers=useRef<ReturnType<typeof setTimeout>[]>([]),raf=useRef(0),suppress=useRef(false),drag=useRef<{id:number;x:number;y:number;moved:boolean}|null>(null);
 const [phase,setPhase]=useState('idle'),[near,setNear]=useState(false),[message,setMessage]=useState('把拼块拖进画框上的缺口，打开这段时光。');
 useEffect(()=>()=>{for(const timer of timers.current)clearTimeout(timer);cancelAnimationFrame(raf.current);},[]);
 function finish(){if(done.current)return;done.current=true;for(const timer of timers.current)clearTimeout(timer);try{sessionStorage.setItem('puzzle:intro-seen','1');}catch{}onEnter();}
 function enter(){
  if(phaseRef.current!=='idle'||done.current)return;phaseRef.current='snapping';setPhase('snapping');setNear(true);setMessage('咔哒。每一片，都有自己的位置。');
  if(key.current&&slot.current&&stage.current){const target=slot.current.getBoundingClientRect(),base=stage.current.getBoundingClientRect();key.current.classList.remove('is-dragging');key.current.style.transform=`translate(${target.left+target.width/2-base.left-key.current.offsetLeft-key.current.offsetWidth/2}px,${target.top+target.height/2-base.top-key.current.offsetTop-key.current.offsetHeight/2}px) scale(${target.width/key.current.offsetWidth})`;}
  if(reducedPaperMotion()){finish();return;}timers.current.push(setTimeout(()=>{phaseRef.current='opening';setPhase('opening');},240),setTimeout(finish,1370));
 }
 function release(event:React.PointerEvent<HTMLButtonElement>,cancelled=false){
  const g=drag.current;if(!g||event.pointerId!==g.id)return;drag.current=null;suppress.current=g.moved;event.currentTarget.classList.remove('is-dragging');try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{}
  const a=event.currentTarget.getBoundingClientRect(),b=slot.current?.getBoundingClientRect();
  if(!cancelled&&g.moved&&b&&Math.hypot(a.left+a.width/2-b.left-b.width/2,a.top+a.height/2-b.top-b.height/2)<65)enter();
  else{event.currentTarget.style.transform='';setNear(false);if(g.moved)setMessage('再靠近一点点，拼块就会轻轻吸附。');}
 }
 return <main ref={scene} className={'paper-intro paper-phase-'+phase} onPointerMove={event=>{
  if(drag.current||phaseRef.current!=='idle'||event.pointerType!=='mouse'||reducedPaperMotion())return;
  const r=event.currentTarget.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(()=>{scene.current?.style.setProperty('--paper-mx',String(x));scene.current?.style.setProperty('--paper-my',String(y));});
 }} onPointerLeave={()=>{if(!drag.current){scene.current?.style.setProperty('--paper-mx','0');scene.current?.style.setProperty('--paper-my','0');}}}>
  <header className="site-header paper-intro-header"><a className="brand" href="/"><Puzzle size={26}/><span>一起拼图<small>THE PAPER COLLECTION</small></span></a><HomeNavigation/></header>
  <div className="paper-intro-content">
   <section className="paper-intro-copy"><p className="eyebrow">A LITTLE PIECE OF YOUR DAY</p><h1>把时光，<br/>拼成喜欢的样子。</h1><p className="muted">从一片开始，收集生活里的美好。</p><button className="primary" onClick={enter} disabled={phase!=='idle'}>{phase==='idle'?'进入选图':'正在打开纸艺馆…'}<ArrowRight size={19}/></button><span className="paper-intro-note">无需登录，即刻开始</span><button className="text-button paper-skip" onClick={finish}>跳过开场，直接选图 →</button></section>
   <div className="paper-gate" ref={stage} aria-label="拖动拼块打开纸艺馆">
    <div className="paper-gate-world" aria-hidden="true"><div className="paper-arch paper-arch-back"/><div className="paper-arch paper-arch-middle"/><div className="paper-arch paper-arch-front"/><div className="paper-gate-picture"><img src={PHOTOS[0].src} alt="" fetchPriority="high" draggable={false}/><div className={'paper-gate-slot'+(near?' is-near':'')} ref={slot}><svg viewBox="0 0 100 100"><path d={PAPER_PIECE_PATH}/></svg></div></div><div className="paper-leaf paper-leaf-one"/><div className="paper-leaf paper-leaf-two"/><div className="paper-gate-film"><img src={PHOTOS[1].src} alt=""/><img src={PHOTOS[0].src} alt=""/><img src={PHOTOS[2].src} alt=""/></div></div>
    <button className="paper-gate-key" ref={key} aria-label="拖动拼块到缺口，或点击打开纸门" disabled={phase!=='idle'} onClick={event=>{if(event.detail===0||!suppress.current)enter();}} onPointerDown={event=>{if(event.button!==0||phaseRef.current!=='idle'||drag.current)return;suppress.current=false;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.classList.add('is-dragging');}} onPointerMove={event=>{const g=drag.current;if(!g||g.id!==event.pointerId)return;const dx=event.clientX-g.x,dy=event.clientY-g.y;g.moved ||= Math.hypot(dx,dy)>5;event.currentTarget.style.transform=`translate(${dx}px,${dy}px)`;const a=event.currentTarget.getBoundingClientRect(),b=slot.current?.getBoundingClientRect();if(b)setNear(Math.hypot(a.left+a.width/2-b.left-b.width/2,a.top+a.height/2-b.top-b.height/2)<65);}} onPointerUp={event=>release(event)} onPointerCancel={event=>release(event,true)} onLostPointerCapture={event=>release(event,true)}><svg viewBox="0 0 100 100" aria-hidden="true"><path d={PAPER_PIECE_PATH}/></svg></button>
    <span className="paper-key-caption">拿起这一片 ↗</span>
   </div>
  </div>
  <footer className="paper-intro-footer"><span role="status" aria-live="polite">{message}</span><span>01 / A BRIGHTER DAY</span></footer><div className="paper-intro-wash" aria-hidden="true"/>
 </main>;
}
