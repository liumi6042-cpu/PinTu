'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,Gift } from 'lucide-react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { clamp,reducedPaperMotion,surpriseIndex } from '@/lib/paper-interactions';
import type { PHOTOS } from '@/lib/puzzle-catalog';
type Photo=typeof PHOTOS[number];

export default function PaperSurprise({photos,disabled,onPick}:{photos:Photo[];disabled:boolean;onPick:(photo:Photo)=>void}){
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<'closed'|'opening'|'revealed'>('closed'),[pick,setPick]=useState<Photo|null>(null);
 const phaseRef=useRef('closed'),last=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),seal=useRef<HTMLButtonElement>(null),flap=useRef<HTMLDivElement>(null),suppress=useRef(false);
 const drag=useRef<{id:number;y:number;amount:number;moved:boolean}|null>(null),ids=photos.map(p=>p.id).join('|');
 function reset(){if(timer.current)clearTimeout(timer.current);timer.current=null;phaseRef.current='closed';setPhase('closed');setPick(null);drag.current=null;suppress.current=false;if(seal.current){seal.current.style.transform='';seal.current.style.transition='';}if(flap.current)flap.current.style.transform='';}
 useEffect(()=>{setOpen(false);reset();return()=>{if(timer.current)clearTimeout(timer.current);};},[ids]);
 useEffect(()=>{if(disabled){setOpen(false);reset();}},[disabled]);
 function changeOpen(value:boolean){reset();setOpen(value);}
 function draw(){
  if(phaseRef.current==='opening'||!photos.length||disabled)return;
  if(timer.current)clearTimeout(timer.current);timer.current=null;
  const i=surpriseIndex(photos.length,photos.findIndex(p=>p.id===last.current)),photo=photos[i];last.current=photo.id;setPick(photo);phaseRef.current='opening';setPhase('opening');
  if(seal.current){seal.current.style.transform='';seal.current.style.transition='';}if(flap.current)flap.current.style.transform='';
  if(reducedPaperMotion()){phaseRef.current='revealed';setPhase('revealed');return;}
  timer.current=setTimeout(()=>{phaseRef.current='revealed';setPhase('revealed');timer.current=null;},1000);
 }
 function release(event:React.PointerEvent<HTMLButtonElement>,cancelled=false){const g=drag.current;if(!g||g.id!==event.pointerId)return;drag.current=null;suppress.current=g.moved;try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{}event.currentTarget.style.transition='';event.currentTarget.style.transform='';if(flap.current)flap.current.style.transform='';if(!cancelled&&g.amount>=60)draw();}
 return <><button type="button" className="paper-surprise-trigger" onClick={()=>changeOpen(true)} disabled={disabled||!photos.length}><Gift size={17}/>抽一张惊喜</button><Dialog open={open} onOpenChange={changeOpen}><DialogContent className="paper-bag-dialog"><DialogTitle>今天，拼哪一张？</DialogTitle><DialogDescription>{photos.length===1?'这一类只有一张，打开看看吧。':'向上拉开封口，从当前选图里抽一张。'}</DialogDescription>
  <div className={'paper-bag-stage bag-'+phase}>
   <div className="paper-bag-shadow"/><div className="paper-bag-assembly"><div className="paper-bag-back"/><div className="paper-surprise-card">{pick&&<><img src={pick.src} alt={pick.title} draggable={false}/><span>{pick.title}</span></>}</div><div className="paper-bag-front" aria-hidden="true"><small>A LITTLE SURPRISE</small><Gift size={36}/><strong>把未知的一片，<br/>留给今天。</strong></div><div className="paper-bag-flap" ref={flap}/><button ref={seal} className="paper-bag-seal" disabled={phase!=='closed'} aria-label="向上拉封口，或点击抽取拼图" onClick={event=>{if(event.detail===0||!suppress.current)draw();}} onPointerDown={event=>{if(event.button!==0||phaseRef.current!=='closed'||drag.current)return;suppress.current=false;drag.current={id:event.pointerId,y:event.clientY,amount:0,moved:false};event.currentTarget.style.transition='none';event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const g=drag.current;if(!g||g.id!==event.pointerId)return;g.amount=clamp(g.y-event.clientY,0,100);g.moved ||= Math.abs(g.y-event.clientY)>5;event.currentTarget.style.transform=`translateY(${-g.amount*.6}px) rotate(${-g.amount*.07}deg)`;if(flap.current)flap.current.style.transform=`rotateX(${g.amount*.6}deg)`;}} onPointerUp={event=>release(event)} onPointerCancel={event=>release(event,true)} onLostPointerCapture={event=>release(event,true)}>↑<span>拉开封口</span></button></div>
  </div>
  <div className="paper-bag-actions">{phase==='revealed'&&pick?<><button className="primary" onClick={()=>{onPick(pick);changeOpen(false);}}>就选这张<ArrowRight size={17}/></button>{photos.length>1&&<button className="text-button" onClick={()=>{reset();timer.current=setTimeout(draw,reducedPaperMotion()?0:250);}}>再抽一张 ↻</button>}</>:<button className="primary" onClick={draw} disabled={phase==='opening'}>{phase==='opening'?'正在拆开…':'替我抽一张 ↑'}</button>}</div><p className="paper-bag-result" role="status" aria-live="polite">{phase==='revealed'&&pick?'抽到了「'+pick.title+'」。选好片数后就能开始。':'每一幅画，都是一段新时光。'}</p>
 </DialogContent></Dialog></>;
}
