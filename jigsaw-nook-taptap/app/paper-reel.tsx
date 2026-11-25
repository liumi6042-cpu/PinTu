'use client';
import {t} from '@/lib/i18n';
import {useLanguage} from './language-switch';
import {useCallback,useEffect,useRef} from 'react';
import {clamp,reelDestination,reducedPaperMotion,wrapPhoto} from '@/lib/paper-interactions';
import type {PHOTOS} from '@/lib/puzzle-catalog';
type Photo=typeof PHOTOS[number];
type Props={photos:Photo[];index:number;onIndex:(index:number)=>void;disabled:boolean;onStart:(photo:Photo)=>void};

export default function PaperReel({photos,index,onIndex,disabled,onStart}:Props){
 const language=useLanguage();
 const track=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),frames=useRef<(HTMLButtonElement|null)[]>([]);
 const props=useRef({photos,index,onIndex,disabled,onStart});props.current={photos,index,onIndex,disabled,onStart};
 const position=useRef(index),reported=useRef(index),width=useRef(244),raf=useRef(0),wheelTimer=useRef<ReturnType<typeof setTimeout>|null>(null),suppress=useRef(false);
 const gesture=useRef<{id:number;x:number;y:number;start:number;lastX:number;time:number;velocity:number;moved:boolean;target:HTMLElement}|null>(null);
 const ids=photos.map(p=>p.id).join('|');
 const stop=useCallback(()=>{cancelAnimationFrame(raf.current);raf.current=0;if(wheelTimer.current)clearTimeout(wheelTimer.current);wheelTimer.current=null;},[]);
 const draw=useCallback(()=>{
  const node=track.current;if(!node||!props.current.photos.length)return;
  width.current=Math.min(292,Math.max(154,node.clientWidth*.35));
  const base=Math.round(position.current),single=props.current.photos.length===1,radius=width.current/.62;
  frames.current.forEach((el,i)=>{if(!el)return;const logical=base+i-3,offset=logical-position.current,angle=offset*.62,photo=props.current.photos[wrapPhoto(logical,props.current.photos.length)],opacity=single?(i===3?1:0):clamp(1-(Math.abs(offset)-1.65)*.85,0,1);
   el.style.width=width.current+'px';el.style.height=width.current*.75+38+'px';el.style.transform='translate(-50%,-50%) translateX('+Math.sin(angle)*radius+'px) translateZ('+(Math.cos(angle)-1)*radius+'px) rotateY('+(-angle)+'rad)';el.style.opacity=String(opacity);el.style.zIndex=String(12-Math.round(Math.abs(offset)*2));el.style.pointerEvents=opacity>.2?'auto':'none';el.classList.toggle('is-selected',Math.abs(offset)<.5);el.tabIndex=i===3?0:-1;el.setAttribute('aria-label',t(photo.title)+' · '+t('开始拼图'));el.setAttribute('aria-hidden',String(opacity===0));el.dataset.photoId=photo.id;
   const img=el.querySelector('img')!;if(img.getAttribute('src')!==photo.src)img.src=photo.src;
  });
  if(base!==reported.current){reported.current=base;props.current.onIndex(base);}
 },[]);
 const settle=useCallback((target:number)=>{stop();if(props.current.photos.length<2){position.current=0;draw();return;}const from=position.current,change=target-from;if(reducedPaperMotion()){position.current=target;draw();return;}const start=performance.now(),duration=clamp(430+Math.abs(change)*95,430,1000);const step=(now:number)=>{const progress=clamp((now-start)/duration,0,1);position.current=from+change*(1-(1-progress)**3);draw();if(progress<1)raf.current=requestAnimationFrame(step);else raf.current=0;};raf.current=requestAnimationFrame(step);},[draw,stop]);
 useEffect(()=>{stop();gesture.current=null;stage.current?.classList.remove('is-dragging');position.current=props.current.index;reported.current=props.current.index;draw();const observer=new ResizeObserver(draw);if(track.current)observer.observe(track.current);return()=>{observer.disconnect();stop();};},[ids,draw,stop]);
 useEffect(()=>{draw();},[language,draw]);
 useEffect(()=>{if(index!==reported.current){reported.current=index;settle(index);}},[index,settle]);
 useEffect(()=>{if(disabled){stop();gesture.current=null;position.current=props.current.index;draw();stage.current?.classList.remove('is-dragging');}},[disabled,stop,draw]);
 useEffect(()=>{const node=track.current;if(!node)return;const wheel=(event:WheelEvent)=>{if(props.current.disabled||props.current.photos.length<2)return;event.preventDefault();if(gesture.current)return;stop();const amount=(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?250:1);position.current+=clamp(amount/width.current*.65,-1.1,1.1);draw();wheelTimer.current=setTimeout(()=>{if(!gesture.current&&!props.current.disabled)settle(Math.round(position.current));},130);};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[draw,settle,stop]);
 function down(event:React.PointerEvent<HTMLDivElement>){if(event.button!==0||props.current.disabled||gesture.current)return;stop();suppress.current=false;const target=(event.target as HTMLElement).closest<HTMLButtonElement>('.paper-reel-card')||event.currentTarget;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:position.current,lastX:event.clientX,time:performance.now(),velocity:0,moved:false,target};target.setPointerCapture(event.pointerId);}
 function move(event:React.PointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.id!==event.pointerId)return;const dx=event.clientX-g.x,dy=event.clientY-g.y;g.moved ||= Math.hypot(dx,dy)>5;if(g.moved)stage.current?.classList.add('is-dragging');const now=performance.now(),dt=Math.max(8,now-g.time);g.velocity=g.velocity*.35+(g.lastX-event.clientX)/width.current/dt*.65;g.lastX=event.clientX;g.time=now;position.current=g.start-dx/width.current;draw();}
 function end(event:React.PointerEvent<HTMLDivElement>,cancelled=false){const g=gesture.current;if(!g||g.id!==event.pointerId)return;gesture.current=null;suppress.current=g.moved||cancelled;try{g.target.releasePointerCapture(event.pointerId);}catch{}stage.current?.classList.remove('is-dragging');if(g.moved||cancelled)settle(reelDestination(position.current,cancelled||performance.now()-g.time>100?0:g.velocity));}
 return <div ref={stage} className={'paper-reel paper-reel-click'+(disabled?' is-busy':'')} role="region" aria-label={t('纸胶片选图，左右拖动或使用滚轮切换')} tabIndex={0} onKeyDown={event=>{if(disabled||photos.length<2)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();settle(Math.round(position.current)+(event.key==='ArrowLeft'?-1:1));}}}><div className="paper-reel-shadow"/><div className="paper-reel-track" ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={event=>end(event)} onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}>{Array.from({length:7},(_,i)=><button type="button" key={i} ref={node=>{frames.current[i]=node;}} className="paper-reel-card" disabled={disabled} tabIndex={i===3?0:-1} style={{transform:'translate(-50%,-50%)',opacity:i===3?1:0}} aria-label={t('开始拼图')} onClick={event=>{if(props.current.disabled||(event.detail!==0&&suppress.current))return;const photo=props.current.photos.find(p=>p.id===event.currentTarget.dataset.photoId);if(photo)props.current.onStart(photo);}}><span className="paper-reel-paper"><img src={photos[wrapPhoto(index+i-3,photos.length)]?.src} alt="" draggable={false}/></span></button>)}</div></div>;
}
