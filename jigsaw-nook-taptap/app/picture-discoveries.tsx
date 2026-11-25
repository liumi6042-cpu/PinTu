'use client';
import {useEffect,useRef,useState} from 'react';
import {DiscoveryTracker,pictureDiscoveries,discoveryBounds,type Discovery} from '@/lib/picture-discoveries';
import type {PuzzleState} from '@/lib/puzzle-engine';
import type {PuzzleTable} from '@/lib/puzzle-table';
import type {RoomClient} from '@/lib/room-client';
import {useLanguage} from './language-switch';

export default function PictureDiscoveries({state,client,ready,hidden,getTable}:{state:PuzzleState;client?:RoomClient;ready:boolean;hidden:boolean;getTable:()=>PuzzleTable|null}){
 const zh=useLanguage()==='zh',[notice,setNotice]=useState<Discovery|null>(null),blocked=useRef(hidden);blocked.current=hidden;
 useEffect(()=>{
  if(!ready||!pictureDiscoveries[state.imageId])return;
  const key='jigsaw:discoveries:v1:'+(client?.snapshot.id||`${state.imageId}:${state.cols}:${state.rows}:${state.seed}`);
  let saved:string[]=[];try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))saved=value.filter(v=>typeof v==='string');}catch{}
  const tracker=new DiscoveryTracker(state,saved),queue:Discovery[]=[];let until=0;
  const puzzle=()=>client?.snapshot.puzzle||state;
  tracker.observe(puzzle());setNotice(null);
  const tick=()=>{
   if(document.hidden)return;
   const count=tracker.seen.size;queue.push(...tracker.observe(puzzle()));
   if(count!==tracker.seen.size)try{localStorage.setItem(key,JSON.stringify([...tracker.seen]));}catch{}
   if(blocked.current){until=0;setNotice(null);return;}
   if(Date.now()<until)return;
   const next=queue.shift()||null;setNotice(next);until=next?Date.now()+4800:0;
  };
  const timer=setInterval(tick,600);return()=>clearInterval(timer);
 },[state,client,ready]);
 return !hidden&&notice?<DiscoverySpotlight key={notice.id} detail={notice} zh={zh} getTable={getTable}/>:null;
}
function DiscoverySpotlight({detail,zh,getTable}:{detail:Discovery;zh:boolean;getTable:()=>PuzzleTable|null}){
 const ring=useRef<HTMLDivElement>(null),label=useRef<HTMLElement>(null);
 useEffect(()=>{
  let frame=0;
  const position=()=>{
   const table=getTable(),r=ring.current,l=label.current;
   if(!table||!r||!l)return;
   const b=discoveryBounds(detail,table.state),view=table.canvas.getBoundingClientRect(),c=table.camera;
   if(!b||document.hidden){r.style.visibility=l.style.visibility='hidden';frame=requestAnimationFrame(position);return;}
   const x=view.left+c.x+b.x*c.z,y=view.top+c.y+b.y*c.z,w=b.width*c.z,h=b.height*c.z;
   const visible=x+w>view.left&&y+h>view.top&&x<view.right&&y<view.bottom;
   r.style.visibility=l.style.visibility=visible?'visible':'hidden';
   r.style.left=(x-8)+'px';r.style.top=(y-8)+'px';r.style.width=(w+16)+'px';r.style.height=(h+16)+'px';
   const labelWidth=Math.min(340,Math.max(120,view.width-24)),labelHeight=l.offsetHeight||90;
   l.style.width=labelWidth+'px';
   l.style.left=Math.max(view.left+12,Math.min(x+w/2-labelWidth/2,view.right-labelWidth-12))+'px';
   const above=y-labelHeight-22;
   l.style.top=Math.max(view.top+12,Math.min(above>=view.top+12?above:y+h+22,view.bottom-labelHeight-68))+'px';
   frame=requestAnimationFrame(position);
  };
  position();return()=>cancelAnimationFrame(frame);
 },[detail,getTable]);
 return <><div ref={ring} className="discovery-spotlight" aria-hidden="true"><div className="discovery-halo"/><i>✦</i><i>✧</i><i>✦</i><i>✧</i></div><aside ref={label} className="picture-discovery" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">✦</span><div><small>{zh?'画中发现 · 发现啦！':'A little discovery!'}</small><p>{zh?detail.zh:detail.en}</p></div></aside></>;
}
